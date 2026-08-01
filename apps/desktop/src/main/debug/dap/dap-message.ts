export interface DapRequest {
  readonly seq: number;
  readonly type: 'request';
  readonly command: string;
  readonly arguments?: unknown;
}

export interface DapResponse {
  readonly seq: number;
  readonly type: 'response';
  readonly request_seq: number;
  readonly success: boolean;
  readonly command: string;
  readonly message?: string;
  readonly body?: unknown;
}

export interface DapEventMessage {
  readonly seq: number;
  readonly type: 'event';
  readonly event: string;
  readonly body?: unknown;
}

export interface DapReverseRequest {
  readonly seq: number;
  readonly type: 'request';
  readonly command: string;
  readonly arguments?: unknown;
}

export type DapMessage = DapResponse | DapEventMessage | DapReverseRequest;

export function isDapMessage(value: unknown): value is DapMessage {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('seq' in value)) {
    return false;
  }
  const candidate = value as { readonly type?: unknown; readonly seq?: unknown };
  return (
    typeof candidate.seq === 'number' &&
    Number.isInteger(candidate.seq) &&
    ['response', 'event', 'request'].includes(String(candidate.type))
  );
}

export function encodeDapMessage(message: DapMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`, 'ascii'),
    payload,
  ]);
}
