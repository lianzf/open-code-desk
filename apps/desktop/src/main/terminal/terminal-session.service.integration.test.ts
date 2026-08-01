import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppDatabase, type AppDatabase } from '../database/database';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { TerminalSessionService, type TerminalSessionEvent } from './terminal-session.service';

class StaticDirectoryPicker implements DirectoryPicker {
  public constructor(private readonly rootPath: string) {}

  public async pickDirectory(): Promise<string> {
    return this.rootPath;
  }
}

function waitForSessionExit(
  service: TerminalSessionService,
  sessionId: string,
): Promise<Extract<TerminalSessionEvent, { type: 'exit' }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Terminal ${sessionId} did not exit within 10 seconds.`));
    }, 10_000);
    const unsubscribe = service.subscribe((event) => {
      if (event.type === 'exit' && event.sessionId === sessionId) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

describe('TerminalSessionService integration', () => {
  let database: AppDatabase;
  let rootPath: string;
  let workspaceId: string;
  let service: TerminalSessionService;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-terminal-'));
    database = createAppDatabase(':memory:');
    const workspaces = new WorkspaceService(
      new WorkspaceRepository(database),
      new StaticDirectoryPicker(rootPath),
    );
    const workspace = await workspaces.openFromDialog();
    if (workspace === null) {
      throw new Error('Expected the test workspace to open.');
    }
    workspaceId = workspace.id;
    service = new TerminalSessionService(workspaces);
  });

  afterEach(async () => {
    service.closeAll();
    database.close();
    await rm(rootPath, { recursive: true, force: true });
  });

  it('runs an interactive shell in the workspace and emits data plus an exit code', async () => {
    const events: TerminalSessionEvent[] = [];
    const exitPromise = new Promise<Extract<TerminalSessionEvent, { type: 'exit' }>>((resolve) => {
      service.subscribe((event) => {
        events.push(event);
        if (event.type === 'exit') {
          resolve(event);
        }
      });
    });
    const session = await service.create(101, workspaceId, 80, 24);

    expect(session.cwd).toBe(rootPath);
    expect(session.shell.length).toBeGreaterThan(0);
    expect(() => service.write(202, session.sessionId, 'echo forbidden')).toThrow(
      'belongs to another window',
    );
    service.resize(101, session.sessionId, 100, 30);
    service.write(
      101,
      session.sessionId,
      process.platform === 'win32'
        ? 'echo terminal-marker\r\nexit 0\r\n'
        : 'printf "terminal-marker\\n"\nexit 0\n',
    );

    const exit = await Promise.race([
      exitPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Terminal did not exit within 10 seconds.')), 10_000);
      }),
    ]);
    const output = events
      .filter(
        (event): event is Extract<TerminalSessionEvent, { type: 'data' }> =>
          event.type === 'data' && event.sessionId === session.sessionId,
      )
      .map((event) => event.data)
      .join('');

    expect(exit).toMatchObject({ ownerId: 101, sessionId: session.sessionId, exitCode: 0 });
    expect(output).toContain('terminal-marker');
    expect(service.close(101, session.sessionId)).toBe(false);
  }, 15_000);

  it('isolates sessions by renderer owner and closes only the requested owner', async () => {
    const first = await service.create(1, workspaceId, 80, 24);
    const second = await service.create(2, workspaceId, 80, 24);
    const firstExit = waitForSessionExit(service, first.sessionId);

    service.closeOwner(1);

    expect(() => service.write(1, first.sessionId, 'echo closed')).toThrow(
      'Terminal session was not found',
    );
    expect(() => service.resize(1, second.sessionId, 80, 24)).toThrow('belongs to another window');
    const secondExit = waitForSessionExit(service, second.sessionId);
    expect(service.close(2, second.sessionId)).toBe(true);
    await Promise.all([firstExit, secondExit]);
  });
});
