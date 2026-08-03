import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { detectProject } from './project-detector';

const temporaryDirectories: string[] = [];
const workspaceId = '00000000-0000-4000-8000-000000000001';

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-code-desk-detector-'));
  temporaryDirectories.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('project detector', () => {
  it('detects a TypeScript Next.js project and creates safe package-script drafts', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({
        scripts: { dev: 'next dev', build: 'next build', '--unsafe': 'ignored' },
        dependencies: { next: '15.0.0', react: '19.0.0' },
        devDependencies: { typescript: '5.0.0' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'tsconfig.json': '{}',
    });

    const result = await detectProject(workspaceId, root);

    expect(result.primaryType).toBe('nextjs');
    expect(result.detectedTypes).toEqual(
      expect.arrayContaining(['nextjs', 'react', 'typescript', 'node']),
    );
    expect(result.suggestedConfigurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'nextjs',
          executable: 'pnpm',
          args: ['run', 'dev'],
          port: 3000,
        }),
        expect.objectContaining({ executable: 'pnpm', args: ['run', 'build'] }),
      ]),
    );
    expect(result.suggestedConfigurations.some((draft) => draft.args.includes('--unsafe'))).toBe(
      false,
    );
  });

  it('records safe browser-debug ports for front-end development scripts only', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({
        scripts: {
          dev: 'vite --port 4310',
          build: 'vite build',
        },
        dependencies: { react: '19.0.0', vite: '7.0.0' },
      }),
    });

    const result = await detectProject(workspaceId, root);
    expect(result.suggestedConfigurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'react', args: ['run', 'dev'], port: 4310 }),
      ]),
    );
    expect(
      result.suggestedConfigurations.find((configuration) => configuration.args.includes('build'))
        ?.port,
    ).toBeUndefined();
  });

  it('detects Electron and suggests a deterministic dual-process debug configuration', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({
        main: 'main.cjs',
        dependencies: { electron: '43.2.0' },
      }),
      'main.cjs': "const { app } = require('electron');\napp.whenReady().then(() => app.quit());\n",
    });

    const result = await detectProject(workspaceId, root, 'en-US');

    expect(result.primaryType).toBe('electron');
    expect(result.detectedTypes).toEqual(expect.arrayContaining(['electron', 'node']));
    expect(result.suggestedConfigurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Electron · Main and renderer',
          type: 'electron',
          executable: expect.stringContaining('node_modules'),
          args: ['.'],
          port: 9222,
        }),
      ]),
    );
  });

  it.each([
    [{ 'package.json': '{"scripts":{"dev":"vite"},"dependencies":{"vue":"3"}}' }, 'vue'],
    [
      {
        'pom.xml':
          '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>',
      },
      'spring-boot',
    ],
    [{ 'build.gradle': "plugins { id 'java'; id 'org.springframework.boot' }" }, 'spring-boot'],
    [{ 'main.py': 'print("ok")\n' }, 'python'],
    [{ 'main.c': 'int main(void) { return 0; }\n', Makefile: 'all:\n\tcc main.c\n' }, 'c'],
    [
      {
        'main.cpp': 'int main() { return 0; }\n',
        'CMakeLists.txt': 'project(example LANGUAGES CXX)\n',
      },
      'cpp',
    ],
    [{ 'example.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n' }, 'dotnet'],
    [{ 'go.mod': 'module example.invalid/project\n' }, 'go'],
    [{ 'Cargo.toml': '[package]\nname = "example"\n' }, 'rust'],
    [{ 'run.sh': '#!/bin/sh\nprintf ok\n' }, 'script'],
  ] as const)('detects marker-based project type %s as %s', async (files, expectedType) => {
    const root = await fixture(files);
    const result = await detectProject(workspaceId, root);
    expect(result.detectedTypes).toContain(expectedType);
    expect(result.suggestedConfigurations.length).toBeGreaterThan(0);
  });

  it('does not recurse into nested projects and falls back to custom', async () => {
    const root = await fixture({ 'nested/package.json': '{"scripts":{"start":"node index.js"}}' });
    await expect(detectProject(workspaceId, root)).resolves.toMatchObject({
      primaryType: 'custom',
      detectedTypes: ['custom'],
      suggestedConfigurations: [],
    });
  });

  it('does not parse oversized package metadata or expose its script names', async () => {
    const hiddenScript = 'must-not-be-returned';
    const root = await fixture({
      'package.json': `${' '.repeat(256 * 1024 + 1)}${JSON.stringify({ scripts: { [hiddenScript]: 'echo secret' } })}`,
    });

    const result = await detectProject(workspaceId, root);
    expect(result.detectedTypes).toContain('node');
    expect(JSON.stringify(result)).not.toContain(hiddenScript);
  });

  it('uses a workspace virtual environment in suggested Python configurations', async () => {
    const interpreterRelativePath =
      process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
    const root = await fixture({
      'main.py': 'print("ok")\n',
      [interpreterRelativePath]: '',
      '.venv/pyvenv.cfg': 'version = 3.13.2\n',
    });

    const result = await detectProject(workspaceId, root);
    const expectedExecutable = join(root, ...interpreterRelativePath.split('/'));

    expect(result.runtimeCandidates[0]).toMatchObject({
      executable: expectedExecutable,
      source: 'workspace-venv',
      version: '3.13.2',
    });
    expect(result.suggestedConfigurations[0]?.executable).toBe(expectedExecutable);
  });

  it('suggests framework and test configurations from bounded Python metadata', async () => {
    const root = await fixture({
      'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
      'app.py': 'from flask import Flask\napp = Flask(__name__)\n',
      'requirements.txt': 'fastapi==1.0\nuvicorn==1.0\nflask==3.0\npytest==9.0\n',
      'pytest.ini': '[pytest]\n',
    });

    const result = await detectProject(workspaceId, root);
    expect(result.suggestedConfigurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Python · Flask 开发服务器',
          runtimeArgs: ['-m', 'flask'],
        }),
        expect.objectContaining({
          name: 'Python · FastAPI (uvicorn)',
          runtimeArgs: ['-m', 'uvicorn'],
        }),
        expect.objectContaining({ name: 'Python · pytest', runtimeArgs: ['-m', 'pytest'] }),
      ]),
    );
  });

  it('localizes Python detection evidence, runtimes, and framework suggestions to English', async () => {
    const interpreterRelativePath =
      process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
    const root = await fixture({
      'app.py': 'from flask import Flask\napp = Flask(__name__)\n',
      'requirements.txt': 'flask==3.0\n',
      [interpreterRelativePath]: '',
    });

    const result = await detectProject(workspaceId, root, 'en-US');

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'Detected python project marker.' }),
      ]),
    );
    expect(result.runtimeCandidates[0]).toMatchObject({
      label: '.venv virtual environment',
      reason:
        'Workspace virtual environments are preferred to reduce dependency and interpreter mismatches.',
    });
    expect(result.suggestedConfigurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Python · Flask development server' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(/\p{Script=Han}/u);
  });
});
