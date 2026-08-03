import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const options = parseArguments(process.argv.slice(2));
const sbomPath = resolve(options.get('sbom') ?? 'release/open-code-desk.cdx.json');
const outputPath = resolve(options.get('output') ?? 'release/license-audit.json');
const bom = JSON.parse(await readFile(sbomPath, 'utf8'));
const reviewedDistributionLicenses = new Set([
  '(MPL-2.0 OR Apache-2.0)',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-3-Clause',
  'EPL-1.0',
  'EPL-2.0',
  'ISC',
  'MIT',
  'Python-2.0',
]);
const prohibitedLicensePattern = /(?:^|[^A-Z])(?:AGPL|GPL|SSPL|BUSL)(?:-|\b)|Commons Clause/iu;

const shippedThirdParty = bom.components.filter(
  (component) => component.scope === 'required' && !component.name.startsWith('@open-code-desk/'),
);
const reviewRequired = [];
const licenseCounts = new Map();
for (const component of shippedThirdParty) {
  const license = componentLicense(component);
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
  if (!reviewedDistributionLicenses.has(license)) {
    reviewRequired.push({
      name: component.name,
      version: component.version,
      license,
      prohibited: prohibitedLicensePattern.test(license),
    });
  }
}

const report = {
  schemaVersion: 1,
  status: reviewRequired.length === 0 ? 'passed' : 'failed',
  policy: {
    scope: 'shipped-third-party-components',
    reviewedLicenses: [...reviewedDistributionLicenses].sort((left, right) =>
      left.localeCompare(right, 'en-US'),
    ),
    note: 'This automated inventory is a release gate, not legal advice.',
  },
  shippedThirdPartyComponents: shippedThirdParty.length,
  licenseCounts: Object.fromEntries(
    [...licenseCounts].sort(([left], [right]) => left.localeCompare(right, 'en-US')),
  ),
  reviewRequired: reviewRequired.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, 'en-US'),
  ),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(
  `Wrote ${outputPath}; shippedThirdParty=${shippedThirdParty.length}, reviewRequired=${reviewRequired.length}.`,
);
if (reviewRequired.length > 0) {
  throw new Error(`License audit requires review for ${reviewRequired.length} component(s).`);
}

function componentLicense(component) {
  const choice = component.licenses?.[0];
  const value = choice?.expression ?? choice?.license?.id ?? choice?.license?.name;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'NOASSERTION';
}

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid license-audit argument near ${name ?? '<end>'}.`);
    }
    parsed.set(name.slice(2), value);
  }
  return parsed;
}
