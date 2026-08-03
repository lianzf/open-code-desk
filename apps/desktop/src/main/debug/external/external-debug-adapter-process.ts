import type { DapClient } from '../dap/dap-client';

export type ExternalDebugAdapterLogStream = 'stdout' | 'stderr';

export interface ExternalDebugAdapterProcess {
  readonly client: DapClient;
  readonly processId: number;
  onLog(listener: (stream: ExternalDebugAdapterLogStream, chunk: string) => void): () => void;
  onExit(listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): () => void;
  dispose(): Promise<void>;
}
