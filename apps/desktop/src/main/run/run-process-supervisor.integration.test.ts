import { afterEach, describe, expect, it } from 'vitest';

import {
  maximumForwardedRunOutputBytes,
  retainedRunOutputTailBytes,
  RunProcessSupervisor,
  type RunProcessEvent,
} from './run-process-supervisor';

const supervisors: RunProcessSupervisor[] = [];

function createSupervisor(): RunProcessSupervisor {
  const supervisor = new RunProcessSupervisor({ gracefulStopTimeoutMs: 200 });
  supervisors.push(supervisor);
  return supervisor;
}

function nodeSpec(executionId: string, source: string, environment?: Record<string, string>) {
  return {
    executionId,
    executable: process.execPath,
    args: ['-e', source],
    cwd: process.cwd(),
    ...(environment === undefined ? {} : { resolvedEnvironment: environment }),
  };
}

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.closeAll()));
});

describe('RunProcessSupervisor integration', () => {
  it('starts a structured process and exposes its PID and start time', async () => {
    const supervisor = createSupervisor();
    const info = await supervisor.start(
      nodeSpec('metadata', 'setTimeout(() => process.exit(0), 100);'),
    );

    expect(info).toMatchObject({
      executionId: 'metadata',
      executable: process.execPath,
      args: expect.any(Array),
      cwd: process.cwd(),
      status: 'running',
    });
    expect(info.pid).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(info.startedAt))).toBe(false);
    await expect(supervisor.waitForExit('metadata')).resolves.toMatchObject({
      status: 'completed',
      exitCode: 0,
    });
  });

  it('runs npm without enabling a command shell', async () => {
    const supervisor = createSupervisor();
    const events: RunProcessEvent[] = [];
    supervisor.subscribe((event) => events.push(event));
    await supervisor.start({
      executionId: 'npm-version',
      executable: 'npm',
      args: ['--version'],
      cwd: process.cwd(),
    });

    const result = await supervisor.waitForExit('npm-version');
    expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(
      events.flatMap((event) => (event.type === 'output' ? [event.chunk] : [])).join(''),
    ).toMatch(/\d+\.\d+/u);
  });

  it('streams stdout and stderr separately in real time', async () => {
    const supervisor = createSupervisor();
    const events: RunProcessEvent[] = [];
    supervisor.subscribe((event) => events.push(event));
    await supervisor.start(
      nodeSpec(
        'streams',
        'process.stdout.write("out-marker"); setTimeout(() => process.stderr.write("err-marker"), 30);',
      ),
    );
    await supervisor.waitForExit('streams');

    expect(
      events.some(
        (event) =>
          event.type === 'output' &&
          event.stream === 'stdout' &&
          event.chunk.includes('out-marker'),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'output' &&
          event.stream === 'stderr' &&
          event.chunk.includes('err-marker'),
      ),
    ).toBe(true);
  });

  it('reports a non-zero exit as failed', async () => {
    const supervisor = createSupervisor();
    await supervisor.start(nodeSpec('failure', 'process.exit(7);'));

    await expect(supervisor.waitForExit('failure')).resolves.toMatchObject({
      status: 'failed',
      exitCode: 7,
      errorMessage: 'The process exited with code 7.',
    });
  });

  it('stops a running process and rejects a duplicate execution ID', async () => {
    const supervisor = createSupervisor();
    await supervisor.start(nodeSpec('service', 'setInterval(() => undefined, 1000);'));

    await expect(supervisor.start(nodeSpec('service', 'process.exit(0);'))).rejects.toThrow(
      'already been used',
    );
    const completion = supervisor.waitForExit('service');
    await expect(supervisor.stop('service')).resolves.toBe(true);
    await expect(completion).resolves.toMatchObject({ status: 'stopped' });
    expect(supervisor.get('service')).toBeNull();
    await expect(supervisor.start(nodeSpec('service', 'process.exit(0);'))).rejects.toThrow(
      'already been used',
    );
  });

  it('prevents the same service command from starting twice', async () => {
    const supervisor = createSupervisor();
    await supervisor.start(nodeSpec('service-first', 'setInterval(() => undefined, 1000);'));

    await expect(
      supervisor.start(nodeSpec('service-second', 'setInterval(() => undefined, 1000);')),
    ).rejects.toThrow('same service is already running');
  });

  it('closeAll stops every supervised process', async () => {
    const supervisor = createSupervisor();
    await Promise.all([
      supervisor.start(nodeSpec('first', 'setInterval(() => undefined, 1000);')),
      supervisor.start(nodeSpec('second', 'setInterval(() => undefined, 1000);')),
    ]);
    const completions = [supervisor.waitForExit('first'), supervisor.waitForExit('second')];

    await supervisor.closeAll();

    expect(supervisor.list()).toEqual([]);
    await expect(Promise.all(completions)).resolves.toMatchObject([
      { status: 'stopped' },
      { status: 'stopped' },
    ]);
  });

  it('passes only resolved variables in addition to the minimal inherited environment', async () => {
    const supervisor = createSupervisor();
    const inheritedName = 'OPEN_CODE_DESK_UNRESOLVED_TEST_VALUE';
    process.env[inheritedName] = 'must-not-leak';
    const events: RunProcessEvent[] = [];
    supervisor.subscribe((event) => events.push(event));
    try {
      await supervisor.start(
        nodeSpec(
          'environment',
          `process.stdout.write(JSON.stringify({resolved: process.env.RESOLVED_VALUE, inherited: process.env.${inheritedName}}));`,
          { RESOLVED_VALUE: 'available' },
        ),
      );
      await supervisor.waitForExit('environment');
    } finally {
      delete process.env[inheritedName];
    }
    const output = events
      .flatMap((event) =>
        event.type === 'output' && event.stream === 'stdout' ? [event.chunk] : [],
      )
      .join('');
    expect(JSON.parse(output)).toEqual({ resolved: 'available' });
  });

  it('redacts sensitive environment values even when output spans chunks', async () => {
    const supervisor = createSupervisor();
    const secret = 'super-secret-value';
    const events: RunProcessEvent[] = [];
    supervisor.subscribe((event) => events.push(event));
    await supervisor.start({
      ...nodeSpec(
        'redacted-output',
        'process.stdout.write("super-"); setTimeout(() => process.stdout.write("secret-value"), 20);',
        { TOKEN: secret },
      ),
      sensitiveValues: [secret],
    });

    const result = await supervisor.waitForExit('redacted-output');
    const output = events
      .flatMap((event) => (event.type === 'output' ? [event.chunk] : []))
      .join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(secret);
    expect(result.outputTail).not.toContain(secret);
  });

  it('bounds forwarded output, keeps a 64 KiB tail, and lets the service finish normally', async () => {
    const supervisor = createSupervisor();
    await supervisor.start(
      nodeSpec(
        'large-output',
        `process.stdout.write("a".repeat(${maximumForwardedRunOutputBytes + 10_000})); process.stdout.write("tail-marker");`,
      ),
    );

    const result = await supervisor.waitForExit('large-output');
    expect(result).toMatchObject({ status: 'completed', exitCode: 0, outputTruncated: true });
    expect(result.forwardedOutputBytes).toBe(maximumForwardedRunOutputBytes);
    expect(Buffer.byteLength(result.outputTail, 'utf8')).toBeLessThanOrEqual(
      retainedRunOutputTailBytes,
    );
    expect(result.outputTail).toContain('tail-marker');
  });
});
