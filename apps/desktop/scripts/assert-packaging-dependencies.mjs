import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(desktopRoot, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const dependencyNames = Object.keys(manifest.dependencies ?? {});
const missing = dependencyNames.filter((dependencyName) => {
  const dependencyPath = join(desktopRoot, 'node_modules', ...dependencyName.split('/'));

  try {
    return !statSync(dependencyPath).isDirectory();
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  throw new Error(
    [
      'Desktop packaging dependencies are missing from apps/desktop/node_modules.',
      `Missing: ${missing.join(', ')}`,
      'Run pnpm install --frozen-lockfile before packaging.',
    ].join('\n'),
  );
}

console.log(`Verified ${dependencyNames.length} desktop packaging dependencies.`);
