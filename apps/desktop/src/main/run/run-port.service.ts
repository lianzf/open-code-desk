import { execFile } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { promisify } from 'node:util';

import type { RunPortInspection } from '@open-code-desk/domain';

import type { RunProcessInfo } from './run-process-supervisor';

const execFileAsync = promisify(execFile);

export class RunPortServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunPortServiceError';
  }
}

export class RunPortService {
  public constructor(
    private readonly listManagedProcesses: () => ReadonlyArray<RunProcessInfo> = () => [],
  ) {}

  public async inspect(port: number): Promise<RunPortInspection> {
    const managed = this.listManagedProcesses().find((process) => process.port === port);
    if (managed !== undefined) {
      return {
        port,
        available: false,
        processId: managed.pid,
        processName: managed.executable,
        managedExecutionId: managed.executionId,
      };
    }

    if (await canListen(port)) {
      return { port, available: true };
    }

    const owner = await findPortOwner(port);
    return {
      port,
      available: false,
      ...(owner?.processId === undefined ? {} : { processId: owner.processId }),
      ...(owner?.processName === undefined ? {} : { processName: owner.processName }),
    };
  }

  public async terminateExternal(port: number, expectedProcessId: number): Promise<void> {
    const inspection = await this.inspect(port);
    if (inspection.available) return;
    if (inspection.managedExecutionId !== undefined) {
      throw new RunPortServiceError(
        'RUN_PORT_MANAGED',
        '该端口由本软件管理的运行占用，请使用停止运行操作。',
      );
    }
    if (inspection.processId === undefined) {
      throw new RunPortServiceError(
        'RUN_PORT_OWNER_UNKNOWN',
        '无法安全识别端口占用进程，未执行终止操作。',
      );
    }
    if (inspection.processId !== expectedProcessId) {
      throw new RunPortServiceError(
        'RUN_PORT_OWNER_CHANGED',
        '端口占用进程已变化，请重新检查并确认。',
      );
    }
    if (expectedProcessId === process.pid) {
      throw new RunPortServiceError('RUN_PORT_SELF', '不能终止当前应用进程。');
    }

    if (process.platform === 'win32') {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(expectedProcessId), '/T'], {
          windowsHide: true,
          timeout: 10_000,
        });
      } catch (error) {
        throw new RunPortServiceError(
          'RUN_PORT_TERMINATE_FAILED',
          `终止端口占用进程失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    try {
      process.kill(expectedProcessId, 'SIGTERM');
    } catch (error) {
      throw new RunPortServiceError(
        'RUN_PORT_TERMINATE_FAILED',
        `终止端口占用进程失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function canListen(port: number): Promise<boolean> {
  if ((await canConnect(port, '127.0.0.1')) || (await canConnect(port, '::1'))) {
    return false;
  }
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(200, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function findPortOwner(
  port: number,
): Promise<{ readonly processId?: number; readonly processName?: string } | null> {
  return process.platform === 'win32' ? findWindowsPortOwner(port) : findUnixPortOwner(port);
}

async function findWindowsPortOwner(
  port: number,
): Promise<{ readonly processId?: number; readonly processName?: string } | null> {
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], {
      windowsHide: true,
      timeout: 5_000,
    });
    const matchingLine = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u))
      .find(
        (fields) =>
          fields.length >= 5 &&
          fields[0]?.toUpperCase() === 'TCP' &&
          fields[1]?.endsWith(`:${port}`) === true &&
          fields[3]?.toUpperCase() === 'LISTENING',
      );
    const processId = Number(matchingLine?.at(-1));
    if (!Number.isInteger(processId) || processId <= 0) return null;
    return { processId, ...(await findWindowsProcessName(processId)) };
  } catch {
    return null;
  }
}

async function findWindowsProcessName(
  processId: number,
): Promise<{ readonly processName?: string }> {
  try {
    const { stdout } = await execFileAsync(
      'tasklist.exe',
      ['/FI', `PID eq ${processId}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 5_000 },
    );
    const processName = /^"([^"]+)"/u.exec(stdout.trim())?.[1];
    return processName === undefined ? {} : { processName };
  } catch {
    return {};
  }
}

async function findUnixPortOwner(
  port: number,
): Promise<{ readonly processId?: number; readonly processName?: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpct'],
      { timeout: 5_000 },
    );
    const processId = Number(/^p(\d+)$/mu.exec(stdout)?.[1]);
    const processName = /^c(.+)$/mu.exec(stdout)?.[1];
    if (!Number.isInteger(processId) || processId <= 0) return null;
    return { processId, ...(processName === undefined ? {} : { processName }) };
  } catch {
    return null;
  }
}
