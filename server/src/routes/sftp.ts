import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import {
  chmodEntry,
  createSymlink,
  deleteEntries,
  getHomePath,
  listDirectory,
  makeDirectory,
  openDownload,
  readFileForEditor,
  renameEntry,
  searchFiles,
  statEntry,
  uploadFile,
  writeFileContent
} from '../sftp/service.js';

/**
 * SFTP REST API (see docs/API.md). Every route requires a live `kind:'sftp'`
 * session; all file IO runs over that session's cached SFTP channel.
 */

const SessionIdSchema = z.string().trim().min(1).max(200);
const PathSchema = z.string().min(1).max(4096);

const SessionQuerySchema = z.object({ sessionId: SessionIdSchema });
const PathQuerySchema = z.object({
  sessionId: SessionIdSchema,
  path: z.string().max(4096).optional()
});
const PathRequiredQuerySchema = z.object({
  sessionId: SessionIdSchema,
  path: PathSchema
});
const SearchQuerySchema = z.object({
  sessionId: SessionIdSchema,
  path: z.string().max(4096).optional(),
  query: z.string().trim().min(1).max(512),
  limit: z.coerce.number().int().min(1).max(2000).optional()
});
const ReadQuerySchema = z.object({
  sessionId: SessionIdSchema,
  path: PathSchema,
  maxBytes: z.coerce.number().int().min(1).max(8 * 1024 * 1024).optional()
});
const DownloadQuerySchema = PathRequiredQuerySchema;
const UploadQuerySchema = z.object({
  sessionId: SessionIdSchema,
  path: z.string().max(4096).optional(),
  name: z.string().trim().min(1).max(512),
  overwrite: z.enum(['0', '1', 'true', 'false']).optional()
});

const ModeSchema = z.union([z.string().trim().min(1).max(16), z.number().int().min(0).max(0o7777)]);

const MkdirInputSchema = z.object({
  sessionId: SessionIdSchema,
  path: PathSchema,
  mode: ModeSchema.optional()
});
const RenameInputSchema = z.object({
  sessionId: SessionIdSchema,
  from: PathSchema,
  to: PathSchema
});
const DeleteInputSchema = z.object({
  sessionId: SessionIdSchema,
  paths: z.array(PathSchema).min(1).max(200),
  recursive: z.boolean().optional()
});
const ChmodInputSchema = z.object({
  sessionId: SessionIdSchema,
  path: PathSchema,
  mode: ModeSchema
});
const SymlinkInputSchema = z.object({
  sessionId: SessionIdSchema,
  target: PathSchema,
  path: PathSchema
});
const WriteInputSchema = z.object({
  sessionId: SessionIdSchema,
  path: PathSchema,
  content: z.string().max(30 * 1024 * 1024),
  encoding: z.enum(['utf8', 'base64']).optional()
});

/** RFC 5987 friendly attachment header without letting control chars through. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii || 'download'}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function streamDownload(req: Request, res: Response, handle: { stream: NodeJS.ReadableStream; size: number; name: string }) {
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(handle.size));
  res.setHeader('Content-Disposition', contentDisposition(handle.name));
  const cleanup = () => {
    if (!res.writableEnded) {
      (handle.stream as unknown as { destroy: () => void }).destroy();
    }
  };
  res.on('close', cleanup);
  req.on('aborted', cleanup);
  handle.stream.on('error', (error: Error) => {
    res.destroy(error);
  });
  handle.stream.pipe(res);
}

export const sftpRouter = Router();

sftpRouter.get(
  '/home',
  asyncHandler(async (req, res) => {
    const { sessionId } = parse(SessionQuerySchema, req.query);
    res.json({ path: await getHomePath(sessionId) });
  })
);

sftpRouter.get(
  '/list',
  asyncHandler(async (req, res) => {
    const { sessionId, path } = parse(PathQuerySchema, req.query);
    res.json(await listDirectory(sessionId, path));
  })
);

sftpRouter.get(
  '/stat',
  asyncHandler(async (req, res) => {
    const { sessionId, path } = parse(PathRequiredQuerySchema, req.query);
    res.json({ entry: await statEntry(sessionId, path) });
  })
);

sftpRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { sessionId, path, query, limit } = parse(SearchQuerySchema, req.query);
    res.json(await searchFiles(sessionId, path, query, limit));
  })
);

sftpRouter.get(
  '/read',
  asyncHandler(async (req, res) => {
    const { sessionId, path, maxBytes } = parse(ReadQuerySchema, req.query);
    res.json(await readFileForEditor(sessionId, path, maxBytes));
  })
);

sftpRouter.get(
  '/download',
  asyncHandler(async (req, res) => {
    const { sessionId, path } = parse(DownloadQuerySchema, req.query);
    const handle = await openDownload(sessionId, path);
    streamDownload(req, res, handle);
  })
);

sftpRouter.post(
  '/mkdir',
  asyncHandler(async (req, res) => {
    const input = parse(MkdirInputSchema, req.body);
    res.json({ path: await makeDirectory(input.sessionId, input.path, input.mode) });
  })
);

sftpRouter.post(
  '/rename',
  asyncHandler(async (req, res) => {
    const input = parse(RenameInputSchema, req.body);
    res.json({ path: await renameEntry(input.sessionId, input.from, input.to) });
  })
);

sftpRouter.post(
  '/delete',
  asyncHandler(async (req, res) => {
    const input = parse(DeleteInputSchema, req.body);
    res.json({ deleted: await deleteEntries(input.sessionId, input.paths, input.recursive) });
  })
);

sftpRouter.post(
  '/chmod',
  asyncHandler(async (req, res) => {
    const input = parse(ChmodInputSchema, req.body);
    res.json({ entry: await chmodEntry(input.sessionId, input.path, input.mode) });
  })
);

sftpRouter.post(
  '/symlink',
  asyncHandler(async (req, res) => {
    const input = parse(SymlinkInputSchema, req.body);
    res.json({ path: await createSymlink(input.sessionId, input.target, input.path) });
  })
);

sftpRouter.put(
  '/write',
  asyncHandler(async (req, res) => {
    const input = parse(WriteInputSchema, req.body);
    const size = await writeFileContent(input.sessionId, input.path, input.content, input.encoding ?? 'utf8');
    res.json({ ok: true, size });
  })
);

sftpRouter.put(
  '/upload',
  asyncHandler(async (req, res) => {
    const query = parse(UploadQuerySchema, req.query);
    const overwrite = query.overwrite === '1' || query.overwrite === 'true';
    const result = await uploadFile(query.sessionId, {
      directory: query.path ?? '.',
      name: query.name,
      overwrite,
      stream: req
    });
    res.json(result);
  })
);
