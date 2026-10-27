import type { AuditCategory, AuditLevel } from '../../../shared/types.js';
import { getStore } from './store.js';
import { eventHub } from './events.js';

export function audit(
  category: AuditCategory,
  level: AuditLevel,
  message: string,
  extra: { hostId?: string | null; hostLabel?: string | null; details?: Record<string, unknown> | null } = {}
) {
  try {
    const event = getStore().addAudit(category, level, message, extra);
    eventHub.publish({ type: 'audit', event });
    return event;
  } catch (error) {
    console.error('[audit] failed', error);
    return null;
  }
}
