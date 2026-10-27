import { randomUUID } from 'node:crypto';
import type { AuthPrompt, AuthPromptField } from '../../../shared/types.js';
import { eventHub } from './events.js';
import { ApiError } from './errors.js';

interface Pending {
  prompt: AuthPrompt;
  resolve: (responses: string[] | null) => void;
  timer: NodeJS.Timeout;
}

export interface PromptRequest {
  operation: AuthPrompt['operation'];
  sessionId?: string | null;
  hostLabel: string;
  name: string;
  instructions: string;
  prompts: AuthPromptField[];
  timeoutMs?: number;
}

export interface PromptHandle {
  prompt: AuthPrompt;
  wait: Promise<string[] | null>;
}

/**
 * Bridges keyboard-interactive style prompts from a blocked ssh2 auth callback
 * to the browser. The browser answers over HTTP, which resolves `wait`.
 */
class PromptBroker {
  private pending = new Map<string, Pending>();

  request(req: PromptRequest): PromptHandle {
    const requestId = randomUUID();
    const now = Date.now();
    const timeoutMs = req.timeoutMs ?? 120_000;
    const prompt: AuthPrompt = {
      requestId,
      operation: req.operation,
      sessionId: req.sessionId ?? null,
      hostLabel: req.hostLabel,
      name: req.name,
      instructions: req.instructions,
      prompts: req.prompts,
      createdAt: now,
      expiresAt: now + timeoutMs
    };

    let resolveFn!: (value: string[] | null) => void;
    const wait = new Promise<string[] | null>((resolve) => {
      resolveFn = resolve;
    });

    const timer = setTimeout(() => this.finish(requestId, null), timeoutMs);
    timer.unref?.();
    this.pending.set(requestId, { prompt, resolve: resolveFn, timer });
    eventHub.publish({ type: 'auth.prompt', prompt });
    return { prompt, wait };
  }

  respond(requestId: string, responses: string[]) {
    if (!this.pending.has(requestId)) {
      throw new ApiError(404, 'NOT_FOUND', 'This authentication prompt has expired.');
    }
    this.finish(requestId, responses);
  }

  cancel(requestId: string) {
    this.finish(requestId, null);
  }

  cancelForSession(sessionId: string) {
    for (const [requestId, entry] of this.pending) {
      if (entry.prompt.sessionId === sessionId) this.finish(requestId, null);
    }
  }

  list(): AuthPrompt[] {
    return [...this.pending.values()].map((p) => p.prompt);
  }

  private finish(requestId: string, responses: string[] | null) {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    eventHub.publish({ type: 'auth.prompt.closed', requestId });
    entry.resolve(responses);
  }
}

export const promptBroker = new PromptBroker();
