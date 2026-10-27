import type { AuditCategory, AuditEvent, AuditLevel } from '@shared/types';
import type { StatusTone } from '../../components/StatusPill';

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  connection: '连接',
  sftp: '文件传输',
  tunnel: '隧道',
  command: '命令',
  vault: '保险库',
  security: '安全',
  system: '系统'
};

export const AUDIT_CATEGORY_TONES: Record<AuditCategory, StatusTone> = {
  connection: 'info',
  sftp: 'brand',
  tunnel: 'brand',
  command: 'neutral',
  vault: 'warning',
  security: 'info',
  system: 'neutral'
};

export const AUDIT_LEVEL_META: Record<AuditLevel, { label: string; tone: StatusTone }> = {
  info: { label: '信息', tone: 'info' },
  warn: { label: '警告', tone: 'warning' },
  error: { label: '错误', tone: 'danger' }
};

export const AUDIT_CATEGORY_OPTIONS: Array<{ value: AuditCategory; label: string }> = (
  Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[]
).map((value) => ({ value, label: AUDIT_CATEGORY_LABELS[value] }));

export function auditCategoryLabel(category: string): string {
  return AUDIT_CATEGORY_LABELS[category as AuditCategory] ?? category;
}

export function auditCategoryTone(category: string): StatusTone {
  return AUDIT_CATEGORY_TONES[category as AuditCategory] ?? 'neutral';
}

export function auditLevelMeta(level: string): { label: string; tone: StatusTone } {
  return AUDIT_LEVEL_META[level as AuditLevel] ?? { label: level, tone: 'neutral' };
}

export function matchesAuditQuery(event: AuditEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    event.message,
    event.hostLabel ?? '',
    event.category,
    auditCategoryLabel(event.category),
    event.level,
    event.details ? JSON.stringify(event.details) : ''
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}
