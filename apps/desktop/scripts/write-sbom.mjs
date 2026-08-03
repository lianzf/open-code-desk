import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const options = parseArguments(process.argv.slice(2));
const outputPath = resolve(options.get('output') ?? 'release/open-code-desk.cdx.json');
const rootPackage = await readJson('package.json');
const desktopPackage = await readJson('apps/desktop/package.json');

const allLicenses = parsePnpmJson(['licenses', 'list', '--json']);
const productionLicenses = parsePnpmJson(['licenses', 'list', '--prod', '--json']);
const projects = parsePnpmJson(['-r', 'list', '--prod', '--json', '--depth', 'Infinity']);
const desktopDevelopment = parsePnpmJson([
  '--filter',
  '@open-code-desk/desktop',
  'list',
  '--dev',
  '--json',
  '--depth',
  'Infinity',
])[0];

const productionKeys = new Set(collectLicenseEntries(productionLicenses).map(packageKey));
const shippedKeys = new Set(productionKeys);
const shippedNodes = new Map();
const shippedDevelopmentDependencies = [
  '@monaco-editor/react',
  '@radix-ui/react-slot',
  'class-variance-authority',
  'clsx',
  'electron',
  'lucide-react',
  'monaco-editor',
  'react',
  'react-dom',
  'tailwind-merge',
  'zustand',
];

for (const name of shippedDevelopmentDependencies) {
  const node =
    desktopDevelopment?.devDependencies?.[name] ?? desktopDevelopment?.unsavedDependencies?.[name];
  if (node === undefined) {
    throw new Error(`Shipped desktop dependency ${name} was not found in the installed graph.`);
  }
  collectDependencyTree(name, node, shippedKeys, shippedNodes, name !== 'electron');
}

const components = new Map();
for (const entry of collectLicenseEntries(allLicenses)) {
  addComponent(components, npmComponent(entry, shippedKeys.has(packageKey(entry))));
}

for (const [key, node] of shippedNodes) {
  if (components.has(npmPurl(node.name, node.version))) continue;
  const manifest = await readJson(resolve(node.path, 'package.json'));
  addComponent(
    components,
    npmComponent(
      {
        name: node.name,
        version: node.version,
        license: normalizeLicense(manifest.license),
        homepage: normalizeHomepage(manifest.homepage),
        description: typeof manifest.description === 'string' ? manifest.description : undefined,
      },
      shippedKeys.has(key),
    ),
  );
}

for (const project of projects) {
  if (project.name === rootPackage.name) continue;
  const manifest = await readJson(resolve(project.path, 'package.json'));
  addComponent(
    components,
    npmComponent(
      {
        name: project.name,
        version: manifest.version,
        license: normalizeLicense(manifest.license ?? rootPackage.license),
        homepage: normalizeHomepage(manifest.homepage),
        description: typeof manifest.description === 'string' ? manifest.description : undefined,
      },
      true,
    ),
  );
}

addComponent(components, {
  type: 'library',
  'bom-ref': 'pkg:github/microsoft/vscode-js-debug@v1.117.0',
  name: 'vscode-js-debug',
  version: '1.117.0',
  scope: 'required',
  licenses: [{ license: { id: 'MIT' } }],
  purl: 'pkg:github/microsoft/vscode-js-debug@v1.117.0',
  externalReferences: [{ type: 'vcs', url: 'https://github.com/microsoft/vscode-js-debug' }],
  properties: [
    {
      name: 'open-code-desk:entrypoint-sha256',
      value: '50EBF42EBA65B673677866B2FCC1BC82C4D6AAFE2BDB67A2EA76A3A7A89D1902',
    },
  ],
});
addComponent(components, {
  type: 'library',
  'bom-ref': 'pkg:pypi/debugpy@1.8.21',
  name: 'debugpy',
  version: '1.8.21',
  scope: 'required',
  licenses: [{ license: { id: 'MIT' } }],
  purl: 'pkg:pypi/debugpy@1.8.21',
  externalReferences: [
    { type: 'distribution', url: 'https://pypi.org/project/debugpy/1.8.21/' },
    { type: 'vcs', url: 'https://github.com/microsoft/debugpy' },
  ],
  properties: [
    {
      name: 'open-code-desk:distribution-sha256',
      value: 'b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92',
    },
  ],
});
addComponent(components, {
  type: 'library',
  'bom-ref': 'pkg:github/eclipse-jdtls/eclipse.jdt.ls@1.60.0',
  name: 'eclipse-jdt-language-server',
  version: '1.60.0',
  scope: 'required',
  licenses: [{ license: { id: 'EPL-2.0' } }],
  purl: 'pkg:github/eclipse-jdtls/eclipse.jdt.ls@1.60.0',
  externalReferences: [
    { type: 'vcs', url: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls' },
    {
      type: 'distribution',
      url: 'https://download.eclipse.org/jdtls/milestones/1.60.0/jdt-language-server-1.60.0-202606262232.tar.gz',
    },
  ],
  properties: [
    {
      name: 'open-code-desk:distribution-sha256',
      value: 'e94c303d8198f977930803582738771fd18c52c5492878410bf222b1aa81ef1d',
    },
  ],
});
addComponent(components, {
  type: 'library',
  'bom-ref': 'pkg:github/microsoft/java-debug@0.53.2',
  name: 'java-debug',
  version: '0.53.2',
  scope: 'required',
  licenses: [{ license: { id: 'EPL-1.0' } }],
  purl: 'pkg:github/microsoft/java-debug@0.53.2',
  externalReferences: [
    { type: 'vcs', url: 'https://github.com/microsoft/java-debug' },
    {
      type: 'distribution',
      url: 'https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug',
    },
  ],
  properties: [
    {
      name: 'open-code-desk:entrypoint-sha256',
      value: '4a85f60e1d838476f43c95cde318aa81ade7b39cb9cfbc73b8c5a01197e020e6',
    },
    {
      name: 'open-code-desk:marketplace-vsix-sha256',
      value: 'e5973fcd763a984ea4d6e57644ccf8f5fe6caa80c0e589f29403f00c9ace3920',
    },
  ],
});

const applicationPurl = npmPurl(rootPackage.name, rootPackage.version);
const bom = {
  $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    tools: {
      components: [
        {
          type: 'application',
          name: 'pnpm',
          version: rootPackage.packageManager.replace(/^pnpm@/, ''),
          purl: npmPurl('pnpm', rootPackage.packageManager.replace(/^pnpm@/, '')),
        },
      ],
    },
    component: {
      type: 'application',
      'bom-ref': applicationPurl,
      name: rootPackage.name,
      version: rootPackage.version,
      licenses: [{ license: { name: normalizeLicense(rootPackage.license) } }],
      purl: applicationPurl,
    },
    properties: [
      { name: 'open-code-desk:desktop-version', value: desktopPackage.version },
      { name: 'open-code-desk:sbom-scope', value: 'source-build-and-distribution' },
    ],
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref'], 'en-US'),
  ),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
console.info(`Wrote ${outputPath} with ${bom.components.length} CycloneDX components.`);

function collectLicenseEntries(report) {
  const entries = [];
  for (const [licenseGroup, packages] of Object.entries(report)) {
    for (const packageEntry of packages) {
      for (const version of packageEntry.versions) {
        entries.push({
          name: packageEntry.name,
          version,
          license: normalizeLicense(packageEntry.license ?? licenseGroup),
          homepage: normalizeHomepage(packageEntry.homepage),
          description:
            typeof packageEntry.description === 'string' ? packageEntry.description : undefined,
        });
      }
    }
  }
  return entries;
}

function collectDependencyTree(name, node, keys, nodes, includeChildren = true) {
  const version = normalizeDependencyVersion(node);
  const key = packageKey({ name, version });
  if (keys.has(key) && nodes.has(key)) return;
  keys.add(key);
  nodes.set(key, { name, version, path: node.path });
  if (!includeChildren) return;
  for (const collection of [node.dependencies, node.optionalDependencies]) {
    for (const [childName, child] of Object.entries(collection ?? {})) {
      collectDependencyTree(childName, child, keys, nodes);
    }
  }
}

function normalizeDependencyVersion(node) {
  if (!node.version.startsWith('link:')) return node.version;
  throw new Error(`Unexpected linked dependency in shipped development graph: ${node.path}`);
}

function npmComponent(entry, shipped) {
  const purl = npmPurl(entry.name, entry.version);
  return {
    type: entry.name === 'electron' ? 'framework' : 'library',
    'bom-ref': purl,
    name: entry.name,
    version: entry.version,
    scope: shipped ? 'required' : 'excluded',
    licenses: [{ license: { name: entry.license } }],
    purl,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    ...(entry.homepage === undefined
      ? {}
      : { externalReferences: [{ type: 'website', url: entry.homepage }] }),
    properties: [
      {
        name: 'open-code-desk:dependency-scope',
        value: shipped ? 'shipped' : 'development-or-build',
      },
    ],
  };
}

function addComponent(target, component) {
  target.set(component['bom-ref'], component);
}

function packageKey(entry) {
  return `${entry.name}@${entry.version}`;
}

function npmPurl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name
        .slice(1)
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function normalizeLicense(value) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return 'NOASSERTION';
}

function normalizeHomepage(value) {
  if (typeof value !== 'string' || !/^https?:\/\//u.test(value)) return undefined;
  return value;
}

function parsePnpmJson(argumentsList) {
  return JSON.parse(runPnpm(argumentsList));
}

function runPnpm(argumentsList) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath !== undefined && npmExecPath.length > 0) {
    return execFileSync(process.execPath, [npmExecPath, ...argumentsList], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  return execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', argumentsList, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid SBOM argument near ${name ?? '<end>'}.`);
    }
    parsed.set(name.slice(2), value);
  }
  return parsed;
}
