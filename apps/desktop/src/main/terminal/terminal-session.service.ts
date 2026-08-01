import { randomUUID } from 'node:crypto';

import { spawn as spawnPty, type IPty } from 'node-pty';

import type { WorkspaceService } from '../workspace/workspace.service';

export interface TerminalSessionInfo {
  readonly sessionId: string;
  readonly shell: string;
  readonly cwd: string;
}

export type TerminalSessionEvent =
  | {
      readonly type: 'data';
      readonly ownerId: number;
      readonly sessionId: string;
      readonly data: string;
    }
  | {
      readonly type: 'exit';
      readonly ownerId: number;
      readonly sessionId: string;
      readonly exitCode: number;
      readonly signal?: number;
    };

interface ActiveTerminal {
  readonly ownerId: number;
  readonly workspaceId: string;
  readonly pty: IPty;
}

function terminalEnvironment(): Record<string, string> {
  const allowed =
    process.platform === 'win32'
      ? [
          'COLORTERM',
          'HOMEDRIVE',
          'HOMEPATH',
          'LOCALAPPDATA',
          'Path',
          'PATH',
          'PATHEXT',
          'PSModulePath',
          'SYSTEMROOT',
          'TEMP',
          'TMP',
          'USERPROFILE',
          'WINDIR',
        ]
      : ['COLORTERM', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER'];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe';
  }
  return process.env.SHELL ?? '/bin/sh';
}

export class TerminalSessionService {
  readonly #sessions = new Map<string, ActiveTerminal>();
  readonly #listeners = new Set<(event: TerminalSessionEvent) => void>();

  public constructor(private readonly workspaces: WorkspaceService) {}

  public subscribe(listener: (event: TerminalSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async create(
    ownerId: number,
    workspaceId: string,
    cols: number,
    rows: number,
  ): Promise<TerminalSessionInfo> {
    const workspace = await this.workspaces.getById(workspaceId);
    const shell = defaultShell();
    const sessionId = randomUUID();
    const pty = spawnPty(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workspace.rootPath,
      env: {
        ...terminalEnvironment(),
        TERM: 'xterm-256color',
      },
      useConpty: process.platform === 'win32',
      useConptyDll: process.platform === 'win32',
    });
    this.#sessions.set(sessionId, { ownerId, workspaceId, pty });
    pty.onData((data) => {
      this.emit({ type: 'data', ownerId, sessionId, data });
    });
    pty.onExit(({ exitCode, signal }) => {
      this.#sessions.delete(sessionId);
      this.emit({
        type: 'exit',
        ownerId,
        sessionId,
        exitCode,
        ...(signal === undefined ? {} : { signal }),
      });
    });
    return { sessionId, shell, cwd: workspace.rootPath };
  }

  public write(ownerId: number, sessionId: string, data: string): void {
    this.requireOwned(ownerId, sessionId).pty.write(data);
  }

  public resize(ownerId: number, sessionId: string, cols: number, rows: number): void {
    this.requireOwned(ownerId, sessionId).pty.resize(cols, rows);
  }

  public close(ownerId: number, sessionId: string): boolean {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.ownerId !== ownerId) {
      return false;
    }
    this.#sessions.delete(sessionId);
    session.pty.kill();
    return true;
  }

  public closeOwner(ownerId: number): void {
    for (const [sessionId, session] of this.#sessions) {
      if (session.ownerId === ownerId) {
        this.#sessions.delete(sessionId);
        session.pty.kill();
      }
    }
  }

  public closeAll(): void {
    for (const session of this.#sessions.values()) {
      session.pty.kill();
    }
    this.#sessions.clear();
  }

  private requireOwned(ownerId: number, sessionId: string): ActiveTerminal {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.ownerId !== ownerId) {
      throw new Error('Terminal session was not found or belongs to another window.');
    }
    return session;
  }

  private emit(event: TerminalSessionEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
