import { isDapMessage, type DapMessage } from './dap-message';

const headerSeparator = Buffer.from('\r\n\r\n', 'ascii');
const maximumMessageBytes = 16 * 1024 * 1024;

export class DapFrameParser {
  #buffer = Buffer.alloc(0);
  #expectedLength: number | undefined;

  public push(chunk: Buffer): ReadonlyArray<DapMessage> {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages: DapMessage[] = [];
    while (true) {
      if (this.#expectedLength === undefined) {
        const separatorIndex = this.#buffer.indexOf(headerSeparator);
        if (separatorIndex < 0) {
          if (this.#buffer.byteLength > 8 * 1024) {
            throw new Error('DAP 消息头超过安全限制。');
          }
          return messages;
        }
        const header = this.#buffer.subarray(0, separatorIndex).toString('ascii');
        this.#buffer = this.#buffer.subarray(separatorIndex + headerSeparator.byteLength);
        this.#expectedLength = parseContentLength(header);
      }
      if (this.#buffer.byteLength < this.#expectedLength) {
        return messages;
      }
      const body = this.#buffer.subarray(0, this.#expectedLength);
      this.#buffer = this.#buffer.subarray(this.#expectedLength);
      this.#expectedLength = undefined;
      const parsed: unknown = JSON.parse(body.toString('utf8'));
      if (!isDapMessage(parsed)) {
        throw new Error('调试适配器返回了无效 DAP 消息。');
      }
      messages.push(parsed);
    }
  }
}

function parseContentLength(header: string): number {
  const match = /^Content-Length:\s*(\d+)$/imu.exec(header);
  if (match?.[1] === undefined) {
    throw new Error('DAP 消息缺少 Content-Length。');
  }
  const length = Number(match[1]);
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumMessageBytes) {
    throw new Error('DAP 消息长度超过安全限制。');
  }
  return length;
}
