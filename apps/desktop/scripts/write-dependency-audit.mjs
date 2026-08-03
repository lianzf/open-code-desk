import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const options = parseArguments(process.argv.slice(2));
const outputPath = resolve(options.get('output') ?? 'release/dependency-audit.json');
const argumentsList = ['audit', '--audit-level', 'high', '--json'];
const npmExecPath = process.env.npm_execpath;
const completed =
  npmExecPath !== undefined && npmExecPath.length > 0
    ? spawnSync(process.execPath, [npmExecPath, ...argumentsList], spawnOptions())
    : spawnSync(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        argumentsList,
        spawnOptions(process.platform === 'win32'),
      );

if (completed.error !== undefined) throw completed.error;
let report;
try {
  report = JSON.parse(completed.stdout);
} catch (error) {
  throw new Error(`pnpm audit did not return JSON: ${completed.stderr}`, { cause: error });
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const vulnerabilities = report.metadata?.vulnerabilities ?? {};
console.info(
  `Wrote ${outputPath}; high=${vulnerabilities.high ?? 0}, critical=${vulnerabilities.critical ?? 0}.`,
);
if (completed.status !== 0) {
  throw new Error(`Workspace dependency audit failed with exit code ${completed.status}.`);
}

function spawnOptions(shell = false) {
  return {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell,
  };
}

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid dependency-audit argument near ${name ?? '<end>'}.`);
    }
    parsed.set(name.slice(2), value);
  }
  return parsed;
}
