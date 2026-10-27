import { Button, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  ArrowDownRegular,
  ArrowDownloadRegular,
  ArrowUpRegular,
  CheckmarkRegular,
  MoreHorizontalRegular
} from '@fluentui/react-icons';
import type { SftpEntry } from '@shared/types';
import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { formatBytes } from '../../lib/format';
import { FileIcon } from './FileIcon';
import {
  describeEntryType,
  formatEntryTime,
  isDirectory,
  octalPermissions,
  permissionSummary,
  remoteParent,
  type SortKey,
  type SortState
} from './file-utils';

const COLUMNS_WIDE = '30px minmax(150px, 1fr) 88px 132px 76px 96px 64px';
const COLUMNS_MEDIUM = '30px minmax(150px, 1fr) 88px 132px 76px 64px';
const COLUMNS_NARROW = '30px minmax(120px, 1fr) 80px 56px';

const useStyles = makeStyles({
  root: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    backgroundColor: tokens.colorNeutralBackground1
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: COLUMNS_WIDE,
    alignItems: 'center',
    height: '30px',
    flex: '0 0 30px',
    padding: '0 6px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground3,
    userSelect: 'none',
    fontVariantNumeric: 'tabular-nums',
    '@media (max-width: 900px)': { gridTemplateColumns: COLUMNS_MEDIUM },
    '@media (max-width: 640px)': { gridTemplateColumns: COLUMNS_NARROW }
  },
  headerLabel: {
    fontSize: '11.5px',
    fontWeight: 600,
    letterSpacing: '0.2px',
    color: 'inherit',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  sortButton: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: '11.5px',
    fontWeight: 600,
    letterSpacing: '0.2px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
    height: '22px',
    padding: '0 4px',
    borderRadius: '4px',
    cursor: 'pointer',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
      color: tokens.colorNeutralForeground2
    },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` }
  },
  sortEnd: { justifyContent: 'flex-end' },
  sortIcon: { fontSize: '10px' },
  body: { flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' },
  row: {
    display: 'grid',
    gridTemplateColumns: COLUMNS_WIDE,
    alignItems: 'center',
    height: '31px',
    padding: '0 6px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    color: tokens.colorNeutralForeground1,
    fontSize: '12.5px',
    cursor: 'default',
    userSelect: 'none',
    outline: 'none',
    contentVisibility: 'auto',
    containIntrinsicSize: '31px',
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    '&:hover [data-row-actions]': { opacity: 1 },
    '&:focus-within [data-row-actions]': { opacity: 1 },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${tokens.colorStrokeFocus2}` },
    '@media (max-width: 900px)': { gridTemplateColumns: COLUMNS_MEDIUM },
    '@media (max-width: 640px)': { gridTemplateColumns: COLUMNS_NARROW }
  },
  rowCompact: { height: '25px', containIntrinsicSize: '25px' },
  rowSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Selected }
  },
  cellCheck: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: '15px',
    height: '15px',
    padding: 0,
    borderRadius: '3px',
    border: `1px solid ${tokens.colorNeutralStrokeAccessible}`,
    backgroundColor: 'transparent',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    ':hover': { border: `1px solid ${tokens.colorBrandStroke1}` },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '1px' }
  },
  checkboxChecked: {
    backgroundColor: tokens.colorBrandBackground,
    border: `1px solid ${tokens.colorBrandBackground}`
  },
  dash: { width: '8px', height: '2px', borderRadius: '1px', backgroundColor: '#fff' },
  nameCell: { minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '10px' },
  iconBox: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', flexShrink: 0 },
  nameWrap: { minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12.5px' },
  linkTarget: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3
  },
  sizeCell: {
    textAlign: 'right',
    paddingRight: '10px',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorNeutralForeground2,
    fontSize: '11.5px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  timeCell: {
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '11.5px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  modeCell: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    '@media (max-width: 640px)': { display: 'none' }
  },
  ownerCell: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11.5px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '@media (max-width: 900px)': { display: 'none' }
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '1px',
    opacity: 0,
    transition: 'opacity 0.1s ease'
  },
  rowMenuButton: { minWidth: '26px', width: '26px', height: '26px', color: tokens.colorNeutralForeground2 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
    gap: '6px',
    padding: '12px',
    alignContent: 'start',
    overflow: 'auto',
    flex: 1,
    minHeight: 0
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 8px 8px',
    borderRadius: '6px',
    border: '1px solid transparent',
    cursor: 'default',
    userSelect: 'none',
    textAlign: 'center',
    minWidth: 0,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      '& [data-card-check]': { opacity: 1 }
    }
  },
  cardSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Selected,
      border: `1px solid ${tokens.colorBrandStroke1}`
    }
  },
  cardCheckbox: {
    position: 'absolute',
    top: '4px',
    left: '4px',
    opacity: 0,
    transition: 'opacity 0.1s ease'
  },
  cardCheckboxVisible: { opacity: 1 },
  cardIcon: { fontSize: '34px', marginTop: '4px' },
  cardName: {
    width: '100%',
    fontSize: '11.5px',
    lineHeight: 1.3,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    wordBreak: 'break-word'
  },
  cardMeta: {
    fontSize: '10px',
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%'
  }
});

function entryKey(entry: SftpEntry): string {
  return entry.path || entry.name;
}

function SortHeader({
  label,
  sortKey,
  sort,
  onToggle,
  align = 'start',
  testId
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onToggle: (key: SortKey) => void;
  align?: 'start' | 'end';
  testId: string;
}) {
  const styles = useStyles();
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <button
      type="button"
      className={mergeClasses(styles.sortButton, align === 'end' && styles.sortEnd)}
      onClick={() => onToggle(sortKey)}
      aria-sort={ariaSort}
      data-testid={testId}
      title={`按${label}排序`}
    >
      <span>{label}</span>
      {active &&
        (sort.direction === 'asc' ? (
          <ArrowUpRegular className={styles.sortIcon} />
        ) : (
          <ArrowDownRegular className={styles.sortIcon} />
        ))}
    </button>
  );
}

function SelectionCheckbox({
  checked,
  mixed,
  onChange,
  testId,
  ariaLabel
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  ariaLabel: string;
}) {
  const styles = useStyles();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={ariaLabel}
      data-testid={testId}
      className={mergeClasses(styles.checkbox, (checked || mixed) && styles.checkboxChecked)}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      {mixed ? (
        <span className={styles.dash} />
      ) : checked ? (
        <CheckmarkRegular style={{ fontSize: '11px' }} />
      ) : null}
    </button>
  );
}

export interface FileTableProps {
  entries: SftpEntry[];
  sort: SortState;
  selection: ReadonlySet<string>;
  compact: boolean;
  viewMode: 'list' | 'grid';
  /** Show the containing directory under the name (recursive search results). */
  showPaths?: boolean;
  onToggleSort: (key: SortKey) => void;
  onSelect: (
    entry: SftpEntry,
    index: number,
    modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) => void;
  onSelectOnly: (entry: SftpEntry) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpen: (entry: SftpEntry) => void;
  onDownload: (entry: SftpEntry) => void;
  onContextMenu: (event: ReactMouseEvent, entry: SftpEntry) => void;
  onOpenMenu: (event: ReactMouseEvent, entry: SftpEntry) => void;
}

export function FileTable({
  entries,
  sort,
  selection,
  compact,
  viewMode,
  showPaths = false,
  onToggleSort,
  onSelect,
  onSelectOnly,
  onSelectAll,
  onClearSelection,
  onOpen,
  onDownload,
  onContextMenu,
  onOpenMenu
}: FileTableProps) {
  const styles = useStyles();
  const allSelected = entries.length > 0 && entries.every((entry) => selection.has(entryKey(entry)));
  const someSelected = entries.some((entry) => selection.has(entryKey(entry)));

  const handleRowClick = useCallback(
    (entry: SftpEntry, index: number, event: ReactMouseEvent) => {
      onSelect(entry, index, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
    },
    [onSelect]
  );

  const handleRowContext = useCallback(
    (entry: SftpEntry, event: ReactMouseEvent) => {
      event.preventDefault();
      if (!selection.has(entryKey(entry))) onSelectOnly(entry);
      onContextMenu(event, entry);
    },
    [onContextMenu, onSelectOnly, selection]
  );

  if (viewMode === 'grid') {
    return (
      <div className={styles.root} data-testid="file-grid">
        <div className={styles.grid}>
          {entries.map((entry) => {
            const key = entryKey(entry);
            const selected = selection.has(key);
            return (
              <div
                key={key}
                role="gridcell"
                tabIndex={-1}
                aria-selected={selected}
                className={mergeClasses(styles.card, selected && styles.cardSelected)}
                onClick={(event) => handleRowClick(entry, 0, event)}
                onDoubleClick={() => onOpen(entry)}
                onContextMenu={(event) => handleRowContext(entry, event)}
                data-testid="file-card"
                data-file-name={entry.name}
                title={entry.path || entry.name}
              >
                <div
                  className={mergeClasses(styles.cardCheckbox, selected && styles.cardCheckboxVisible)}
                  data-card-check
                >
                  <SelectionCheckbox
                    checked={selected}
                    onChange={() => onSelect(entry, 0, { ctrlKey: true, metaKey: false, shiftKey: false })}
                    testId="file-card-select"
                    ariaLabel={`选择 ${entry.name}`}
                  />
                </div>
                <FileIcon entry={entry} size={36} className={styles.cardIcon} />
                <span className={styles.cardName}>{entry.name}</span>
                <span className={styles.cardMeta}>
                  {isDirectory(entry) ? describeEntryType(entry) : formatBytes(entry.size)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="file-table" role="table" aria-label="远程目录内容">
      <div className={styles.headerRow} role="row">
        <div className={styles.cellCheck} role="columnheader">
          <SelectionCheckbox
            checked={allSelected}
            mixed={!allSelected && someSelected}
            onChange={(next) => (next ? onSelectAll() : onClearSelection())}
            testId="select-all"
            ariaLabel={allSelected ? '取消全选' : '全选'}
          />
        </div>
        <div role="columnheader">
          <SortHeader label="名称" sortKey="name" sort={sort} onToggle={onToggleSort} testId="sort-name" />
        </div>
        <div role="columnheader" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <SortHeader label="大小" sortKey="size" sort={sort} onToggle={onToggleSort} align="end" testId="sort-size" />
        </div>
        <div role="columnheader">
          <SortHeader label="修改时间" sortKey="mtime" sort={sort} onToggle={onToggleSort} testId="sort-mtime" />
        </div>
        <div role="columnheader">
          <SortHeader label="权限" sortKey="mode" sort={sort} onToggle={onToggleSort} testId="sort-mode" />
        </div>
        <div role="columnheader">
          <span className={styles.headerLabel}>所有者</span>
        </div>
        <div role="columnheader" aria-label="操作" />
      </div>
      <div
        className={styles.body}
        role="rowgroup"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClearSelection();
        }}
      >
        {entries.map((entry, index) => {
          const key = entryKey(entry);
          const selected = selection.has(key);
          const dir = isDirectory(entry);
          return (
            <div
              key={key}
              role="row"
              tabIndex={0}
              aria-selected={selected}
              className={mergeClasses(styles.row, compact && styles.rowCompact, selected && styles.rowSelected)}
              onClick={(event) => handleRowClick(entry, index, event)}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={(event) => handleRowContext(entry, event)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpen(entry);
                else if (event.key === ' ') {
                  event.preventDefault();
                  onSelect(entry, index, { ctrlKey: true, metaKey: false, shiftKey: false });
                }
              }}
              data-testid="file-row"
              data-file-name={entry.name}
              data-file-path={entry.path || undefined}
              data-file-type={dir ? 'directory' : entry.type}
            >
              <div className={styles.cellCheck}>
                <SelectionCheckbox
                  checked={selected}
                  onChange={() => onSelect(entry, index, { ctrlKey: true, metaKey: false, shiftKey: false })}
                  testId="select-row"
                  ariaLabel={`选择 ${entry.name}`}
                />
              </div>
              <div className={styles.nameCell}>
                <span className={styles.iconBox}>
                  <FileIcon entry={entry} size={16} />
                </span>
                <span className={styles.nameWrap}>
                  <span className={styles.name} data-testid="file-name" title={entry.path || entry.name}>
                    {entry.name}
                  </span>
                  {showPaths ? (
                    <span className={styles.linkTarget} title={`所在目录：${remoteParent(entry.path)}`}>
                      {remoteParent(entry.path)}
                    </span>
                  ) : (
                    entry.type === 'symlink' &&
                    entry.linkTarget && (
                      <span className={styles.linkTarget} title={`链接目标：${entry.linkTarget}`}>
                        → {entry.linkTarget}
                      </span>
                    )
                  )}
                </span>
              </div>
              <div className={styles.sizeCell} data-testid="file-size" title={dir ? undefined : `${entry.size} 字节`}>
                {dir ? '—' : formatBytes(entry.size)}
              </div>
              <div
                className={styles.timeCell}
                data-testid="file-modified"
                title={entry.mtime ? new Date(entry.mtime).toLocaleString('zh-CN') : ''}
              >
                {formatEntryTime(entry.mtime)}
              </div>
              <div className={styles.modeCell} data-testid="file-mode" title={permissionSummary(entry)}>
                {octalPermissions(entry.mode)}
              </div>
              <div className={styles.ownerCell} data-testid="file-owner" title={entry.owner ?? String(entry.uid ?? '')}>
                {entry.owner ?? entry.group ?? (entry.uid ? String(entry.uid) : '—')}
              </div>
              <div className={styles.actions} data-row-actions style={selected ? { opacity: 1 } : undefined}>
                {!dir && (
                  <Tooltip content="下载" relationship="label">
                    <Button
                      appearance="subtle"
                      size="small"
                      className={styles.rowMenuButton}
                      icon={<ArrowDownloadRegular />}
                      aria-label={`下载 ${entry.name}`}
                      data-testid="file-download"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDownload(entry);
                      }}
                    />
                  </Tooltip>
                )}
                <Tooltip content="更多操作" relationship="label">
                  <Button
                    appearance="subtle"
                    size="small"
                    className={styles.rowMenuButton}
                    icon={<MoreHorizontalRegular />}
                    aria-label={`${entry.name} 的更多操作`}
                    data-testid="file-more"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenMenu(event, entry);
                    }}
                  />
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
