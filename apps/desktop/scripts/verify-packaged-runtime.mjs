import { constants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const options = parseArguments(process.argv.slice(2));
const platform = requireOption(options, 'platform');
const releaseDirectory = resolve(requireOption(options, 'release-dir'));
const architecture = options.get('arch') ?? process.arch;

if (!['win32', 'darwin', 'linux'].includes(platform)) {
  throw new Error(`Unsupported packaged runtime platform: ${platform}`);
}

const layout = await resolveLayout(releaseDirectory, platform);
await assertExecutable(layout.executablePath, platform);
await assertFile(join(layout.resourcesPath, 'app.asar'));
await assertFile(join(layout.resourcesPath, 'js-debug', 'src', 'dapDebugServer.js'));
await assertFile(join(layout.resourcesPath, 'debugpy', 'debugpy', 'adapter', '__main__.py'));
await assertFile(
  join(
    layout.resourcesPath,
    'jdtls',
    'plugins',
    'org.eclipse.equinox.launcher_1.7.200.v20260619-2039.jar',
  ),
);
await assertFile(
  join(layout.resourcesPath, 'java-debug', 'com.microsoft.java.debug.plugin-0.53.2.jar'),
);
await assertFile(
  join(layout.resourcesPath, 'jdtls', platformConfiguration(platform, architecture), 'config.ini'),
);

const nodePtyRoot = join(layout.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty');
const nativeDirectory = await resolveNodePtyNativeDirectory(nodePtyRoot, platform, architecture);
await assertFile(join(nativeDirectory, 'pty.node'));
if (platform === 'win32') {
  await assertFile(join(nativeDirectory, 'conpty.node'));
}
if (platform === 'darwin') {
  await assertExecutable(join(nativeDirectory, 'spawn-helper'), platform);
}

console.log(
  JSON.stringify({
    status: 'ok',
    platform,
    architecture,
    executablePath: layout.executablePath,
    resourcesPath: layout.resourcesPath,
    nodePtyNativeDirectory: nativeDirectory,
  }),
);

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid packaged runtime verifier argument near ${name ?? '<end>'}.`);
    }
    parsed.set(name.slice(2), value);
  }
  return parsed;
}

function requireOption(parsed, name) {
  const value = parsed.get(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required --${name} option.`);
  }
  return value;
}

async function resolveLayout(releaseRoot, targetPlatform) {
  if (targetPlatform === 'win32') {
    const root = join(releaseRoot, 'win-unpacked');
    return {
      executablePath: join(root, 'OpenCode Desk.exe'),
      resourcesPath: join(root, 'resources'),
    };
  }
  if (targetPlatform === 'linux') {
    const root = join(releaseRoot, 'linux-unpacked');
    return {
      executablePath: join(root, 'open-code-desk'),
      resourcesPath: join(root, 'resources'),
    };
  }

  const entries = await readdir(releaseRoot, { withFileTypes: true });
  const macRoots = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => join(releaseRoot, entry.name));
  for (const root of macRoots) {
    const appRoot = join(root, 'OpenCode Desk.app', 'Contents');
    if (await exists(join(appRoot, 'MacOS', 'OpenCode Desk'))) {
      return {
        executablePath: join(appRoot, 'MacOS', 'OpenCode Desk'),
        resourcesPath: join(appRoot, 'Resources'),
      };
    }
  }
  throw new Error('Packaged macOS application directory was not found.');
}

async function resolveNodePtyNativeDirectory(root, targetPlatform, targetArchitecture) {
  const candidates = [
    join(root, 'build', 'Release'),
    join(root, 'prebuilds', `${targetPlatform}-${targetArchitecture}`),
  ];
  for (const candidate of candidates) {
    if (await exists(join(candidate, 'pty.node'))) return candidate;
  }
  throw new Error(
    `Packaged node-pty has no ${targetPlatform}-${targetArchitecture} pty.node in ${root}.`,
  );
}

async function assertFile(path) {
  const file = await stat(path).catch(() => null);
  if (file === null || !file.isFile() || file.size === 0) {
    throw new Error(`Required packaged file is missing or empty: ${path}`);
  }
}

async function assertExecutable(path, targetPlatform) {
  await assertFile(path);
  if (targetPlatform !== 'win32') {
    await access(path, constants.X_OK);
  }
  const prefix = await readFile(path).then((buffer) => buffer.subarray(0, 4));
  const signature = prefix.toString('hex');
  const allowedSignatures = {
    win32: ['4d5a'],
    linux: ['7f454c46'],
    darwin: ['cffaedfe', 'feedfacf', 'cafebabe', 'cafebabf'],
  };
  if (!allowedSignatures[targetPlatform].some((value) => signature.startsWith(value))) {
    throw new Error(`Unexpected ${targetPlatform} executable signature ${signature}: ${path}`);
  }
}

async function exists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}

function platformConfiguration(targetPlatform, targetArchitecture) {
  if (targetPlatform === 'win32' && targetArchitecture === 'x64') return 'config_win';
  if (targetPlatform === 'darwin' && targetArchitecture === 'arm64') return 'config_mac_arm';
  if (targetPlatform === 'darwin' && targetArchitecture === 'x64') return 'config_mac';
  if (targetPlatform === 'linux' && targetArchitecture === 'arm64') return 'config_linux_arm';
  if (targetPlatform === 'linux' && targetArchitecture === 'x64') return 'config_linux';
  throw new Error(`Packaged JDT LS does not support ${targetPlatform}-${targetArchitecture}.`);
}
