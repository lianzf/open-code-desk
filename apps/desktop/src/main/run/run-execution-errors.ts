export class RunExecutionServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'RunExecutionServiceError';
  }
}
