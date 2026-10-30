import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { UNSAFE_CHARS } from '../lib/sanitize.js';

export const CountryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'ISO 3166-1 alpha-2 code')
  .transform((s) => s.toUpperCase());

export const StationUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'UUID')
  .transform((s) => s.toLowerCase());

export const SORTS = ['popular', 'votes', 'name', 'bitrate'] as const;
export type Sort = (typeof SORTS)[number];

/** Deep pagination is what scrapers do; humans do not page past this. */
export const MAX_OFFSET = 2000;

const page = z.coerce.number().int().min(1).max(MAX_OFFSET).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(30);
const boolFlag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
// Letters/digits/space and a few separators: enough for tags like "drum & bass" or "hip-hop".
const label = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{M}\p{N} .&'+\-/]+$/u)
  .transform((s) => s.toLowerCase());

const withinOffset = (v: { page: number; limit: number }) => (v.page - 1) * v.limit < MAX_OFFSET;

export const CountryParams = z.strictObject({ code: CountryCode });
export const StationParams = z.strictObject({ uuid: StationUuid });

export const StationQuery = z
  .strictObject({
    tag: label.optional(),
    lang: label.optional(),
    codec: z
      .string()
      .regex(/^[A-Za-z0-9+]{1,16}$/)
      .transform((s) => s.toUpperCase())
      .optional(),
    minBitrate: z.coerce.number().int().min(0).max(2000).optional(),
    httpsOnly: boolFlag.optional(),
    sort: z.enum(SORTS).default('popular'),
    page,
    limit,
  })
  .refine(withinOffset, 'Page out of range');
export type StationQuery = z.infer<typeof StationQuery>;

export const SearchQuery = z
  .strictObject({
    q: z
      .string()
      .max(100)
      .transform((s) => s.replace(UNSAFE_CHARS, '').trim())
      .pipe(z.string().min(2).max(100)),
    page,
    limit,
  })
  .refine(withinOffset, 'Page out of range');
export type SearchQuery = z.infer<typeof SearchQuery>;

interface Schemas {
  params?: z.ZodType;
  query?: z.ZodType;
}

/** Validates params/query with Zod; failures become a generic 400. Results go to res.locals.valid. */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const valid: Record<string, unknown> = {};
    for (const part of ['params', 'query'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) return next(badRequest());
      valid[part] = result.data;
    }
    res.locals.valid = valid;
    next();
  };
}

export function validated<T>(res: Response, part: 'params' | 'query'): T {
  return (res.locals.valid as Record<string, unknown>)[part] as T;
}
