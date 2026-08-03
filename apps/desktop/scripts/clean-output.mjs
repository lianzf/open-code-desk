import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(desktopRoot, 'out');

if (dirname(outputDirectory) !== desktopRoot) {
  throw new Error(`Refusing to clean an unexpected build output: ${outputDirectory}`);
}

rmSync(outputDirectory, { recursive: true, force: true });
