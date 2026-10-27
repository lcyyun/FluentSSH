import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ApiError, badRequest, internal } from './errors.js';

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Express 4 does not forward rejected promises; do it for every route. */
export function asyncHandler(handler: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw badRequest(first ? `${first.path.join('.') || 'body'}: ${first.message}` : '请求参数不合法。', {
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      });
    }
    throw error;
  }
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    res.status(error.status).json(error.toJSON());
    return;
  }
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[api] unhandled error:', err);
  const wrapped = internal(err.message);
  res.status(wrapped.status).json(wrapped.toJSON());
}

/** Strip undefined values from an object (helps partial updates). */
export function defined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
