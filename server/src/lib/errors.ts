/** An error whose status, code and message are safe to show to clients. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The upstream catalogue could not be reached or returned unusable data. */
export class UpstreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UpstreamError';
  }
}

export const badRequest = (message = 'Invalid request parameters') => new HttpError(400, 'BAD_REQUEST', message);
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Session missing or expired');
export const forbidden = (code = 'FORBIDDEN', message = 'Request not allowed') => new HttpError(403, code, message);
export const notFound = () => new HttpError(404, 'NOT_FOUND', 'Not found');
