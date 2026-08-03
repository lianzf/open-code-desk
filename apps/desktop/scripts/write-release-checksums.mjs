import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const releaseDirectory = resolve(process.argv[2] ?? 'release');
const desktopPackage = JSON.parse(await readFile(resolve('apps/desktop/package.json'), 'utf8'));
const releaseVersion = desktopPackage.version;
if (typeof releaseVersion !== 'string' || releaseVersion === '') {
  throw new Error('Desktop package version is missing.');
}
const includedSuffixes = ['.AppImage', '.blockmap', '.dmg', '.exe', '.zip'];
const includedMetadata = [
  'dependency-audit.json',
  'license-audit.json',
  'open-code-desk.cdx.json',
  'secret-scan.json',
];
const files = (await readdir(releaseDirectory, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isFile() &&
      ((entry.name.includes(releaseVersion) &&
        includedSuffixes.some((suffix) => entry.name.endsWith(suffix))) ||
        includedMetadata.includes(entry.name)),
  )
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'en-US'));

if (files.length === 0) {
  throw new Error(`No release artifacts found in ${releaseDirectory}.`);
}

const lines = [];
for (const file of files) {
  lines.push(`${await sha256(resolve(releaseDirectory, file))}  ${file}`);
}
const manifestPath = resolve(releaseDirectory, 'SHA256SUMS.txt');
await writeFile(manifestPath, `${lines.join('\n')}\n`, 'utf8');
console.info(`Wrote ${manifestPath} with ${files.length} artifact checksums.`);

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
