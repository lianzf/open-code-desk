export class ProjectTaskExecutionServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProjectTaskExecutionServiceError';
  }
}
