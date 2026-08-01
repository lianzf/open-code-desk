import { describe, expect, it } from 'vitest';

import { StructuredCommandRunner, type CommandOutputChunk } from './command-runner';

const runner = new StructuredCommandRunner();

function runNode(
  source: string,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly onOutput?: (output: CommandOutputChunk) => void;
  } = {},
) {
  return runner.run(
    {
      executable: process.execPath,
      args: ['-e', source],
      cwd: process.cwd(),
      timeoutMs: options.timeoutMs ?? 10_000,
    },
    options.signal ?? new AbortController().signal,
    options.onOutput ?? (() => undefined),
  );
}

describe('StructuredCommandRunner integration', () => {
  it('streams stdout and stderr and records a successful exit code', async () => {
    const chunks: CommandOutputChunk[] = [];
    const result = await runNode(
      'process.stdout.write("stdout-marker"); process.stderr.write("stderr-marker");',
      { onOutput: (output) => chunks.push(output) },
    );

    expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(
      chunks.some((chunk) => chunk.stream === 'stdout' && chunk.chunk.includes('stdout-marker')),
    ).toBe(true);
    expect(
      chunks.some((chunk) => chunk.stream === 'stderr' && chunk.chunk.includes('stderr-marker')),
    ).toBe(true);
    expect(result.outputTail).toContain('stdout-marker');
    expect(result.outputTail).toContain('stderr-marker');
  });

  it('returns a failed result for a non-zero process exit', async () => {
    const result = await runNode('process.stderr.write("failed-marker"); process.exit(7);');

    expect(result).toMatchObject({
      status: 'failed',
      exitCode: 7,
      errorMessage: 'The command exited with code 7.',
    });
  });

  it('terminates a command after its configured timeout', async () => {
    const result = await runNode('setInterval(() => undefined, 1000);', { timeoutMs: 100 });

    expect(result.status).toBe('timed_out');
    expect(result.errorMessage).toContain('100 ms timeout');
  });

  it('terminates a running process tree when the user cancels', async () => {
    const controller = new AbortController();
    const resultPromise = runNode(
      'process.stdout.write("ready"); setInterval(() => undefined, 1000);',
      {
        signal: controller.signal,
        onOutput: (output) => {
          if (output.chunk.includes('ready')) {
            controller.abort(new DOMException('Cancelled by test.', 'AbortError'));
          }
        },
      },
    );

    await expect(resultPromise).resolves.toMatchObject({
      status: 'cancelled',
      errorMessage: 'The command was cancelled by the user.',
    });
  });

  it('stops commands that exceed the one-megabyte output safety limit', async () => {
    const result = await runNode(
      'process.stdout.write("x".repeat(1_050_000)); setInterval(() => undefined, 1000);',
    );

    expect(result.status).toBe('failed');
    expect(result.outputBytes).toBeGreaterThan(1_000_000);
    expect(result.outputTail.length).toBeLessThanOrEqual(100_000);
    expect(result.errorMessage).toContain('1 MB output safety limit');
  });
});
