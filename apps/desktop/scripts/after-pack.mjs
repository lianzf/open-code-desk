import { chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const architecture = new Map([
    [1, 'x64'],
    [3, 'arm64'],
  ]).get(context.arch);
  if (architecture === undefined) {
    throw new Error(`Unsupported packaged macOS architecture: ${context.arch}`);
  }

  const helperPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds',
    `darwin-${architecture}`,
    'spawn-helper',
  );
  const helper = await stat(helperPath);
  await chmod(helperPath, helper.mode | 0o111);
}
