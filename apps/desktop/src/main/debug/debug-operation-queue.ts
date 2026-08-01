export class DebugOperationQueue {
  readonly #queues = new Map<string, Promise<void>>();

  public enqueue<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(sessionId, settled);
    void settled.then(() => {
      if (this.#queues.get(sessionId) === settled) this.#queues.delete(sessionId);
    });
    return result;
  }
}
