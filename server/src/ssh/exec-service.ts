import crypto from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import type { CommandHistoryEntry, ExecInput, ExecResult } from '../../../shared/types.js';
import { audit } from '../core/audit.js';
import { getStore } from '../core/store.js';
import { ApiError } from '../core/errors.js';
import { openConnection, resolveConnection, type OpenConnection } from './connection.js';

/**
 * One-shot command execution (`POST /api/exec`).
 *
 * A dedicated ssh2 connection is opened per run, the command is executed in a
 * single session channel (sshd runs it through the login shell, i.e. the
 * `bash -lc`/`sh -c` equivalent on POSIX servers) and the connection is closed
 * again. Output is capped at 1 MiB per stream and runs are capped at 10 min.
 */

const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const AUDIT_COMMAND_MAX_CHARS = 120;

interface Capture {
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

function createCapture(): Capture {
  return { chunks: [], bytes: 0, truncated: false };
}

function appendCapture(capture: Capture, chunk: Buffer) {
  if (chunk.length === 0 || capture.truncated) return;
  const remaining = MAX_OUTPUT_BYTES - capture.bytes;
  if (chunk.length <= remaining) {
    capture.chunks.push(chunk);
    capture.bytes += chunk.length;
    return;
  }
  if (remaining > 0) {
    capture.chunks.push(chunk.subarray(0, remaining));
    capture.bytes += remaining;
  }
  capture.truncated = true;
}

function captureToString(capture: Capture): string {
  return Buffer.concat(capture.chunks).toString('utf8');
}

function truncateForAudit(command: string): string {
  const singleLine = command.replace(/\s+/g, ' ').trim();
  return singleLine.length > AUDIT_COMMAND_MAX_CHARS
    ? `${singleLine.slice(0, AUDIT_COMMAND_MAX_CHARS)}…`
    : singleLine;
}

interface RawExecOutcome {
  stdout: Capture;
  stderr: Capture;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

function execOnConnection(connection: OpenConnection, command: string, timeoutMs: number): Promise<RawExecOutcome> {
  return new Promise<RawExecOutcome>((resolve, reject) => {
    const stdout = createCapture();
    const stderr = createCapture();
    let exitCode: number | null = null;
    let signal: string | null = null;
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let channel: ClientChannel | null = null;

    const finish = (rejection?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (rejection !== undefined) {
        reject(rejection instanceof Error ? rejection : new Error(String(rejection)));
        return;
      }
      resolve({ stdout, stderr, exitCode, signal, timedOut });
    };

    const onClientError = (error: Error) => {
      appendCapture(stderr, Buffer.from(`\n[连接中断: ${error.message}]`, 'utf8'));
      finish();
    };
    connection.client.once('error', onClientError);

    timer = setTimeout(() => {
      timedOut = true;
      appendCapture(stderr, Buffer.from(`\n[命令执行超过 ${timeoutMs} ms，已超时终止]`, 'utf8'));
      try {
        channel?.signal('TERM');
      } catch {
        // ignore
      }
      try {
        channel?.close();
      } catch {
        // ignore
      }
      finish();
    }, timeoutMs);
    timer.unref?.();

    connection.client.exec(command, (error, stream) => {
      if (error) {
        appendCapture(stderr, Buffer.from(`[无法执行命令: ${error.message}]`, 'utf8'));
        finish();
        return;
      }
      channel = stream;
      stream.on('data', (chunk: Buffer) => appendCapture(stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      try {
        stream.stderr.on('data', (chunk: Buffer) =>
          appendCapture(stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
      } catch {
        // Some transports do not expose stderr; treat as empty.
      }
      const channelEvents = stream as unknown as import('node:events').EventEmitter;
      channelEvents.on('exit', (code: number | null, exitSignal?: string) => {
        exitCode = typeof code === 'number' ? code : null;
        signal = typeof exitSignal === 'string' ? exitSignal : null;
      });
      channelEvents.on('close', () => finish());
      channelEvents.on('error', (streamError: unknown) => {
        appendCapture(stderr, Buffer.from(`[通道错误: ${streamError instanceof Error ? streamError.message : String(streamError)}]`, 'utf8'));
        finish();
      });
    });
  });
}

export interface ExecOutcome {
  result: ExecResult;
  historyEntry: CommandHistoryEntry;
}

/** Execute a command and append it (success or failure) to history + audit. */
export async function runExec(input: ExecInput): Promise<ExecResult> {
  const outcome = await runExecWithHistory(input);
  return outcome.result;
}

export async function runExecWithHistory(input: ExecInput): Promise<ExecOutcome> {
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command.trim()) throw new ApiError(400, 'VALIDATION', '命令不能为空。');
  if (command.length > 200_000) throw new ApiError(400, 'VALIDATION', '命令过长。');
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, Math.round(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS))
  );
  const resolved = resolveConnection(input);
  const startedAt = Date.now();
  let connection: OpenConnection | null = null;
  try {
    connection = await openConnection(resolved, { kind: 'exec' });
    const raw = await execOnConnection(connection, command, timeoutMs);
    const durationMs = Date.now() - startedAt;
    const truncated = raw.stdout.truncated || raw.stderr.truncated;
    const result: ExecResult = {
      command,
      stdout: captureToString(raw.stdout),
      stderr: captureToString(raw.stderr),
      exitCode: raw.timedOut ? null : raw.exitCode,
      signal: raw.signal,
      startedAt,
      durationMs,
      truncated,
      hostLabel: resolved.label
    };
    const historyEntry: CommandHistoryEntry = {
      id: crypto.randomUUID(),
      hostId: resolved.hostId,
      ...result
    };
    getStore().addCommandHistory(historyEntry);
    const failed = result.exitCode !== null && result.exitCode !== 0;
    const level = raw.timedOut || result.exitCode === null ? 'error' : failed ? 'warn' : 'info';
    const statusText = raw.timedOut
      ? '执行超时'
      : result.exitCode === null
        ? '已结束（无退出码）'
        : `退出码 ${result.exitCode}`;
    audit('command', level, `执行命令「${truncateForAudit(command)}」— ${statusText}`, {
      hostId: resolved.hostId,
      hostLabel: resolved.label,
      details: {
        historyId: historyEntry.id,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        truncated: result.truncated,
        timedOut: raw.timedOut
      }
    });
    return { result, historyEntry };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    audit('command', 'error', `执行命令失败「${truncateForAudit(command)}」— ${message}`, {
      hostId: resolved.hostId,
      hostLabel: resolved.label,
      details: { durationMs: Date.now() - startedAt }
    });
    throw new ApiError(502, 'CONNECTION_FAILED', `命令执行失败：${message}`);
  } finally {
    if (connection) {
      try {
        connection.close();
      } catch {
        // ignore
      }
    }
  }
}

/** Command history helpers (store-backed, newest first). */
export function listCommandHistory(limit = 200): CommandHistoryEntry[] {
  const capped = Math.min(500, Math.max(1, Math.round(Number(limit) || 200)));
  return getStore().data.commandHistory.slice(0, capped);
}

export function clearCommandHistory() {
  getStore().mutate((data) => {
    data.commandHistory = [];
  });
  audit('command', 'info', '清空命令历史');
}
