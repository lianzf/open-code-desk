import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const options = parseArguments(process.argv.slice(2));
const outputPath = resolve(options.get('output') ?? 'release/secret-scan.json');
const allowlistPath = resolve(
  options.get('allowlist') ?? 'apps/desktop/scripts/secret-scan-allowlist.json',
);
const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
const maximumTextBytes = 5 * 1024 * 1024;
const excludedPrefixes = ['apps/desktop/vendor/'];
const patterns = [
  {
    id: 'private-key',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/gu,
  },
  {
    id: 'openai-or-anthropic-key',
    expression: /\bsk-(?:(?:proj|ant|svcacct)-)?[A-Za-z0-9_-]{20,}\b/gu,
  },
  { id: 'google-api-key', expression: /\bAIza[0-9A-Za-z_-]{35}\b/gu },
  { id: 'github-token', expression: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/gu },
  { id: 'gitlab-token', expression: /\bglpat-[A-Za-z0-9_-]{20,}\b/gu },
  { id: 'aws-access-key', expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu },
  { id: 'slack-token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu },
  { id: 'npm-token', expression: /\bnpm_[A-Za-z0-9]{36,}\b/gu },
  { id: 'pypi-token', expression: /\bpypi-[A-Za-z0-9_-]{40,}\b/gu },
  { id: 'stripe-secret', expression: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/gu },
  { id: 'hugging-face-token', expression: /\bhf_[A-Za-z0-9]{30,}\b/gu },
  { id: 'credentialed-url', expression: /https?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gu },
];

const trackedFiles = listRepositoryFiles();
const rawFindings = [];
const excludedThirdPartyFiles = [];
const skippedBinaryFiles = [];
let filesScanned = 0;

for (const relativePath of trackedFiles) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (excludedPrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    excludedThirdPartyFiles.push(normalizedPath);
    continue;
  }
  const absolutePath = resolve(normalizedPath);
  const file = await lstat(absolutePath).catch(() => null);
  if (file === null || !file.isFile()) continue;
  if (file.size > maximumTextBytes) {
    throw new Error(`First-party file exceeds the secret scanner limit: ${normalizedPath}`);
  }
  const bytes = await readFile(absolutePath);
  if (bytes.subarray(0, 8192).includes(0)) {
    skippedBinaryFiles.push(normalizedPath);
    continue;
  }
  const text = bytes.toString('utf8');
  filesScanned += 1;
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      rawFindings.push({
        pattern: pattern.id,
        file: normalizedPath,
        line: lineNumberAt(text, match.index ?? 0),
        fingerprint: createHash('sha256').update(match[0]).digest('hex').slice(0, 16),
      });
    }
  }
}

validateAllowlist(allowlist);
const allowedFixtureMatches = allowlist.map((entry) => ({
  ...entry,
  occurrences: rawFindings.filter((finding) => matchesAllowlist(finding, entry)).length,
}));
const staleAllowlistEntries = allowedFixtureMatches.filter((entry) => entry.occurrences === 0);
const findings = rawFindings.filter(
  (finding) => !allowlist.some((entry) => matchesAllowlist(finding, entry)),
);
const report = {
  schemaVersion: 1,
  status: findings.length === 0 && staleAllowlistEntries.length === 0 ? 'passed' : 'failed',
  filesScanned,
  excludedThirdPartyFiles: excludedThirdPartyFiles.length,
  skippedBinaryFiles,
  patterns: patterns.map((pattern) => pattern.id),
  allowedFixtureMatches,
  staleAllowlistEntries,
  findings,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(
  `Wrote ${outputPath}; scanned=${filesScanned}, findings=${findings.length}, allowedFixtures=${rawFindings.length - findings.length}, thirdPartyExcluded=${excludedThirdPartyFiles.length}.`,
);
if (findings.length > 0 || staleAllowlistEntries.length > 0) {
  throw new Error(
    `Secret scan found ${findings.length} potential credential(s) and ${staleAllowlistEntries.length} stale allowlist entries; inspect ${outputPath}.`,
  );
}

function validateAllowlist(entries) {
  if (!Array.isArray(entries)) throw new Error('Secret scan allowlist must be an array.');
  const seen = new Set();
  for (const entry of entries) {
    if (
      typeof entry.pattern !== 'string' ||
      typeof entry.file !== 'string' ||
      !/^[a-f0-9]{16}$/u.test(entry.fingerprint) ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length === 0
    ) {
      throw new Error('Secret scan allowlist contains an invalid entry.');
    }
    const key = `${entry.pattern}\0${entry.file}\0${entry.fingerprint}`;
    if (seen.has(key)) throw new Error(`Duplicate secret scan allowlist entry for ${entry.file}.`);
    seen.add(key);
  }
}

function matchesAllowlist(finding, entry) {
  return (
    finding.pattern === entry.pattern &&
    finding.file === entry.file &&
    finding.fingerprint === entry.fingerprint
  );
}

function listRepositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return output
    .split('\0')
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right, 'en-US'));
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid secret-scan argument near ${name ?? '<end>'}.`);
    }
    parsed.set(name.slice(2), value);
  }
  return parsed;
}
