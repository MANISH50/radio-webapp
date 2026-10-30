import type { Response } from 'express';

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface Envelope<T> {
  data: T | null;
  meta: Record<string, unknown> | null;
  error: ApiErrorBody | null;
}

export function ok<T>(data: T, meta: Record<string, unknown> | null = null): Envelope<T> {
  return { data, meta, error: null };
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.status(status).set(headers).json({ data: null, meta: null, error: { code, message } } satisfies Envelope<never>);
}
