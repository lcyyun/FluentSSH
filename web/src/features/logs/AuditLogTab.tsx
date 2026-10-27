import {
  Button,
  Dropdown,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  DeleteRegular,
  DesktopMacRegular,
  FilterDismissRegular,
  ReceiptRegular,
  SearchRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditCategory, AuditEvent, AuditLevel } from '@shared/types';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SectionCard } from '../../components/SectionCard';
import { StatusPill } from '../../components/StatusPill';
import { useEventConnection, useServerEvent } from '../../events';
import { formatDateTime } from '../../lib/format';
import { useAppStore } from '../../store/app';
import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_CATEGORY_OPTIONS,
  AUDIT_LEVEL_META,
  auditCategoryTone,
  auditLevelMeta,
  matchesAuditQuery
} from './log-meta';

const useStyles = makeStyles({
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    padding: '11px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2
  },
  search: { width: '260px', maxWidth: '100%' },
  dropdown: { minWidth: '128px' },
  spacer: { flex: 1, minWidth: '8px' },
  live: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap'
  },
  liveDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: tokens.colorNeutralForeground4
  },
  liveDotOnline: { background: tokens.colorPaletteGreenBackground3 },
  banner: { margin: '12px 16px 0' },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px 16px 18px 40px',
    position: 'relative',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: '17px',
      top: '18px',
      bottom: '26px',
      width: '2px',
      borderRadius: '2px',
      background: tokens.colorNeutralStroke2
    }
  },
  event: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    padding: '10px 13px',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2
  },
  eventDot: {
    position: 'absolute',
    left: '-26px',
    top: '16px',
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    border: `2px solid ${tokens.colorNeutralBackground1}`,
    boxSizing: 'content-box'
  },
  dotInfo: { background: tokens.colorBrandBackground2, boxShadow: `0 0 0 2px ${tokens.colorBrandStroke2}` },
  dotWarn: { background: tokens.colorPaletteYellowBackground3, boxShadow: `0 0 0 2px ${tokens.colorPaletteYellowBorder2}` },
  dotError: { background: tokens.colorPaletteRedBackground3, boxShadow: `0 0 0 2px ${tokens.colorPaletteRedBorder2}` },
  eventHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  time: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums'
  },
  host: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap'
  },
  headSpacer: { flex: 1 },
  message: {
    fontSize: '12.8px',
    lineHeight: 1.55,
    color: tokens.colorNeutralForeground1,
    wordBreak: 'break-word'
  },
  details: {
    marginTop: '2px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: '7px',
    padding: '8px 10px',
    maxHeight: '220px',
    overflow: 'auto'
  },
  toggle: { fontSize: '11px', minWidth: 'auto', color: tokens.colorNeutralForeground2 },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '44px',
    color: tokens.colorNeutralForeground3
  },
  emptyPad: { padding: '16px' },
  footerBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '9px 16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3
  }
});

export function AuditLogTab() {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const eventStatus = useEventConnection((state) => state.status);

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [level, setLevel] = useState<AuditLevel | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [clearOpen, setClearOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.audit.list(500);
      setEvents(result.events);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useServerEvent(
    useCallback((event) => {
      if (event.type !== 'audit') return;
      setEvents((current) => {
        if (current.some((entry) => entry.id === event.event.id)) return current;
        return [event.event, ...current];
      });
    }, [])
  );

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        if (category !== 'all' && event.category !== category) return false;
        if (level !== 'all' && event.level !== level) return false;
        return matchesAuditQuery(event, query);
      }),
    [events, category, level, query]
  );

  const hasFilters = query.trim().length > 0 || category !== 'all' || level !== 'all';
  const resetFilters = () => {
    setQuery('');
    setCategory('all');
    setLevel('all');
  };

  const toggleDetails = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearAudit = async () => {
    try {
      await api.audit.clear();
      setEvents([]);
      setExpanded(new Set());
      notify('success', '审计日志已清空');
      setClearOpen(false);
    } catch (error) {
      notify('error', '清空审计日志失败', errorMessage(error));
    }
  };

  return (
    <>
      <SectionCard
        title="审计时间线"
        subtitle={`显示 ${filtered.length} / ${events.length} 条事件${hasFilters ? '（已筛选）' : ''}`}
        actions={
          <>
            <Tooltip content="刷新审计事件" relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                onClick={() => void refresh()}
                aria-label="刷新审计日志"
                data-testid="audit-refresh"
              />
            </Tooltip>
            <Tooltip content="清空全部审计事件" relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<DeleteRegular />}
                onClick={() => setClearOpen(true)}
                disabled={events.length === 0}
                aria-label="清空审计日志"
                style={{ color: tokens.colorPaletteRedForeground1 }}
                data-testid="audit-clear"
              >
                清空
              </Button>
            </Tooltip>
          </>
        }
        flush
      >
        <div className={styles.filterBar}>
          <Input
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            placeholder="搜索消息、主机或详情…"
            contentBefore={<SearchRegular />}
            size="small"
            className={styles.search}
            data-testid="audit-search"
          />
          <Dropdown
            value={category === 'all' ? '全部类别' : AUDIT_CATEGORY_LABELS[category]}
            selectedOptions={[category]}
            onOptionSelect={(_, data) => {
              if (data.optionValue) setCategory(data.optionValue as AuditCategory | 'all');
            }}
            size="small"
            className={styles.dropdown}
            data-testid="audit-category"
          >
            <Option value="all" text="全部类别">
              全部类别
            </Option>
            {AUDIT_CATEGORY_OPTIONS.map((option) => (
              <Option key={option.value} value={option.value} text={option.label}>
                {option.label}
              </Option>
            ))}
          </Dropdown>
          <Dropdown
            value={level === 'all' ? '全部级别' : AUDIT_LEVEL_META[level].label}
            selectedOptions={[level]}
            onOptionSelect={(_, data) => {
              if (data.optionValue) setLevel(data.optionValue as AuditLevel | 'all');
            }}
            size="small"
            className={styles.dropdown}
            data-testid="audit-level"
          >
            <Option value="all" text="全部级别">
              全部级别
            </Option>
            <Option value="info" text="信息">
              信息
            </Option>
            <Option value="warn" text="警告">
              警告
            </Option>
            <Option value="error" text="错误">
              错误
            </Option>
          </Dropdown>
          {hasFilters && (
            <Button appearance="subtle" size="small" icon={<FilterDismissRegular />} onClick={resetFilters} data-testid="audit-reset-filters">
              重置
            </Button>
          )}
          <span className={styles.spacer} />
          <span className={styles.live} data-testid="audit-live">
            <span className={mergeClasses(styles.liveDot, eventStatus === 'online' && styles.liveDotOnline)} />
            {eventStatus === 'online' ? '实时追加中' : '实时连接中断'}
          </span>
        </div>

        {loadError && (
          <MessageBar intent="warning" className={styles.banner}>
            <MessageBarBody>
              <MessageBarTitle>审计日志加载失败</MessageBarTitle>
              {loadError}
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => void refresh()}>
                重试
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}

        {loading && events.length === 0 ? (
          <div className={styles.loading}>
            <Spinner size="small" /> 正在加载审计事件…
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyPad}>
            {!loadError && (
              <EmptyState
                compact
                icon={<ReceiptRegular />}
                title={hasFilters ? '没有匹配的审计事件' : '暂无审计事件'}
                description={
                  hasFilters
                    ? '尝试调整搜索关键词、类别或级别筛选条件。'
                    : '连接、文件传输、隧道与安全操作都会在这里留下可追溯的记录。'
                }
                actions={
                  hasFilters ? (
                    <Button appearance="secondary" size="small" onClick={resetFilters}>
                      清除筛选
                    </Button>
                  ) : (
                    <Button appearance="secondary" size="small" icon={<ArrowSyncRegular />} onClick={() => void refresh()}>
                      刷新
                    </Button>
                  )
                }
              />
            )}
          </div>
        ) : (
          <div className={styles.timeline}>
            {filtered.map((event) => {
              const levelMeta = auditLevelMeta(event.level);
              const isExpanded = expanded.has(event.id);
              const hasDetails = Boolean(event.details && Object.keys(event.details).length > 0);
              return (
                <article className={styles.event} key={event.id} data-testid="audit-row">
                  <span
                    className={mergeClasses(
                      styles.eventDot,
                      event.level === 'error' ? styles.dotError : event.level === 'warn' ? styles.dotWarn : styles.dotInfo
                    )}
                  />
                  <div className={styles.eventHead}>
                    <span className={styles.time}>{formatDateTime(event.at)}</span>
                    <StatusPill tone={levelMeta.tone}>{levelMeta.label}</StatusPill>
                    <StatusPill tone={auditCategoryTone(event.category)}>{AUDIT_CATEGORY_LABELS[event.category] ?? event.category}</StatusPill>
                    {event.hostLabel && (
                      <span className={styles.host}>
                        <DesktopMacRegular /> {event.hostLabel}
                      </span>
                    )}
                    <span className={styles.headSpacer} />
                    {hasDetails && (
                      <Button
                        appearance="subtle"
                        size="small"
                        className={styles.toggle}
                        icon={isExpanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
                        onClick={() => toggleDetails(event.id)}
                        data-testid="audit-details-toggle"
                      >
                        {isExpanded ? '收起' : '详情'}
                      </Button>
                    )}
                  </div>
                  <div className={styles.message}>{event.message}</div>
                  {isExpanded && hasDetails && (
                    <div className={styles.details}>{JSON.stringify(event.details, null, 2)}</div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {events.length > 0 && (
          <div className={styles.footerBar}>
            <span>共加载 {events.length} 条审计事件（上限 500 条），新事件会实时插入顶部。</span>
            <span>{formatDateTime(events[0]?.at)}</span>
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={clearOpen}
        title="清空审计日志"
        message={`将删除全部 ${events.length} 条审计事件，历史记录不可恢复。\n确定继续吗？`}
        confirmLabel="清空全部"
        danger
        onConfirm={clearAudit}
        onCancel={() => setClearOpen(false)}
      />
    </>
  );
}
