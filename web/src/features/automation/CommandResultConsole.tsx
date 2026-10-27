import { Spinner, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { CheckmarkCircleRegular, ErrorCircleRegular, WindowConsoleRegular } from '@fluentui/react-icons';
import type { ExecResult } from '@shared/types';
import { CONSOLE_COLORS } from '../workspace/terminal-theme';

/**
 * Dark, "terminal-like" console used by the command runner panel and the
 * 命令与片段 page. It intentionally keeps a dark surface in both app themes.
 */
const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderRadius: '10px',
    border: `1px solid ${CONSOLE_COLORS.border}`,
    background: CONSOLE_COLORS.background,
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 10px',
    borderBottom: `1px solid ${CONSOLE_COLORS.border}`,
    background: 'rgba(255, 255, 255, 0.035)',
    color: CONSOLE_COLORS.meta,
    fontSize: '11px',
    minHeight: '32px'
  },
  command: {
    flex: 1,
    minWidth: 0,
    color: CONSOLE_COLORS.foreground,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  prompt: { color: CONSOLE_COLORS.accent, marginRight: '6px' },
  metaGroup: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height: '20px',
    padding: '0 7px',
    borderRadius: '999px',
    fontSize: '10.5px',
    fontWeight: 600,
    border: '1px solid transparent',
    whiteSpace: 'nowrap'
  },
  pillSuccess: {
    color: CONSOLE_COLORS.success,
    background: 'rgba(80, 180, 115, 0.14)',
    border: '1px solid rgba(80, 180, 115, 0.32)'
  },
  pillDanger: {
    color: CONSOLE_COLORS.danger,
    background: 'rgba(220, 100, 100, 0.14)',
    border: '1px solid rgba(220, 100, 100, 0.32)'
  },
  pillNeutral: {
    color: CONSOLE_COLORS.meta,
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.1)'
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '10px 12px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: CONSOLE_COLORS.foreground
  },
  stdout: { color: CONSOLE_COLORS.stdout },
  stderr: { color: CONSOLE_COLORS.stderr },
  placeholder: {
    color: CONSOLE_COLORS.meta,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11.5px',
    fontFamily: tokens.fontFamilyBase
  },
  running: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: CONSOLE_COLORS.warning,
    fontFamily: tokens.fontFamilyBase,
    fontSize: '11.5px'
  },
  errorText: {
    color: CONSOLE_COLORS.danger,
    fontFamily: tokens.fontFamilyBase,
    fontSize: '11.5px',
    whiteSpace: 'pre-wrap'
  },
  muted: { color: CONSOLE_COLORS.meta }
});

export interface CommandResultConsoleProps {
  result: ExecResult | null;
  error?: string | null;
  running?: boolean;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

export function CommandResultConsole({
  result,
  error,
  running,
  placeholder = '运行命令后，标准输出与错误输出会显示在这里。',
  className,
  minHeight = 180
}: CommandResultConsoleProps) {
  const styles = useStyles();
  const exitCode = result?.exitCode ?? null;
  const failed = result != null && (exitCode !== 0 || Boolean(result.stderr));

  return (
    <div className={mergeClasses(styles.root, className)} data-testid="command-result">
      <div className={styles.header}>
        <WindowConsoleRegular style={{ flexShrink: 0, fontSize: 13 }} />
        <span className={styles.command} data-testid="command-result-command">
          {result ? (
            <>
              <span className={styles.prompt}>$</span>
              {result.command}
            </>
          ) : (
            <span className={styles.muted}>远程命令控制台</span>
          )}
        </span>
        <span className={styles.metaGroup}>
          {running && (
            <span className={styles.pill + ' ' + styles.pillNeutral}>
              <Spinner size="extra-tiny" /> 执行中
            </span>
          )}
          {result && !running && (
            <>
              {result.hostLabel && <span className={styles.muted}>{result.hostLabel}</span>}
              <span
                className={mergeClasses(
                  styles.pill,
                  exitCode === 0 ? styles.pillSuccess : exitCode === null ? styles.pillNeutral : styles.pillDanger
                )}
                data-testid="command-exit-code"
              >
                {exitCode === 0 ? <CheckmarkCircleRegular /> : <ErrorCircleRegular />}
                退出码 {exitCode ?? '—'}
              </span>
              <span className={styles.muted} data-testid="command-duration">
                {result.durationMs} ms
              </span>
              {result.truncated && <span className={styles.muted}>输出已截断</span>}
            </>
          )}
        </span>
      </div>
      <div className={styles.body} style={{ minHeight }}>
        {running && !result && (
          <div className={styles.running}>
            <Spinner size="tiny" /> 正在通过 SSH 执行命令…
          </div>
        )}
        {error && <div className={styles.errorText}>{error}</div>}
        {result && (
          <>
            {result.stdout ? (
              <span className={styles.stdout} data-testid="command-result-stdout">
                {result.stdout}
              </span>
            ) : (
              <span className={styles.muted}>（标准输出为空）</span>
            )}
            {result.stderr && (
              <>
                {result.stdout ? '\n' : ''}
                <span className={styles.stderr} data-testid="command-result-stderr">
                  {result.stderr}
                </span>
              </>
            )}
            {failed && !result.stderr && !result.stdout && <span className={styles.muted}>（无输出）</span>}
          </>
        )}
        {!running && !result && !error && <div className={styles.placeholder}>{placeholder}</div>}
      </div>
    </div>
  );
}
