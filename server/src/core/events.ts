import type { ServerEvent } from '../../../shared/types.js';

type Listener = (event: ServerEvent) => void;

/**
 * In-process fan-out for server events. The HTTP layer bridges these to the
 * `/ws/events` WebSocket. Backend services publish, never touch sockets.
 */
class EventHub {
  private listeners = new Set<Listener>();
  private recent: ServerEvent[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ServerEvent) {
    this.recent.push(event);
    if (this.recent.length > 200) this.recent.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must never break a service.
      }
    }
  }

  getRecent(): ServerEvent[] {
    return this.recent;
  }
}

export const eventHub = new EventHub();
