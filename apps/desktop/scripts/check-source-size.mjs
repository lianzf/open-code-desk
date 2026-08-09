import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const maximumLines = 400;
const workspaceRoot = resolve(argumentValue('--root') ?? process.cwd());
const sourceRoots = [
  join(workspaceRoot, 'apps', 'desktop', 'src'),
  ...(await packageSourceRoots(join(workspaceRoot, 'packages'))),
];
const productionFiles = (
  await Promise.all(sourceRoots.map((sourceRoot) => listProductionTypeScript(sourceRoot)))
)
  .flat()
  .sort();
const measurements = await Promise.all(
  productionFiles.map(async (path) => ({
    path,
    lines: physicalLineCount(await readFile(path, 'utf8')),
  })),
);
const oversizedFiles = measurements
  .filter(({ lines }) => lines > maximumLines)
  .map(({ path, lines }) => ({ path: portableRelativePath(path), lines }));

if (oversizedFiles.length > 0) {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        maximumLines,
        oversizedFiles,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.info(
    JSON.stringify({
      status: 'ok',
      maximumLines,
      productionFiles: measurements.length,
      largestFileLines: Math.max(0, ...measurements.map(({ lines }) => lines)),
    }),
  );
}

async function packageSourceRoots(packagesRoot) {
  try {
    return (await readdir(packagesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(packagesRoot, entry.name, 'src'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function listProductionTypeScript(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['dist', 'node_modules', 'out', 'vendor'].includes(entry.name)) {
        files.push(...(await listProductionTypeScript(path)));
      }
    } else if (entry.isFile() && isProductionTypeScript(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function isProductionTypeScript(name) {
  if (!/\.tsx?$/u.test(name)) return false;
  return !/\.(?:acceptance|spec|test)\.tsx?$/u.test(name);
}

function physicalLineCount(text) {
  if (text === '') return 0;
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

function portableRelativePath(path) {
  return relative(workspaceRoot, path).split(sep).join('/');
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
