import { Tab, TabList, makeStyles } from '@fluentui/react-components';
import { HistoryRegular, ReceiptRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/StatusPill';
import { useEventConnection } from '../../events';
import { AuditLogTab } from './AuditLogTab';
import { SessionLogsTab } from './SessionLogsTab';

const useStyles = makeStyles({
  tabs: { marginTop: '-4px' }
});

type LogTab = 'audit' | 'sessions';

export default function LogsPage() {
  const styles = useStyles();
  const [tab, setTab] = useState<LogTab>('audit');
  const eventStatus = useEventConnection((state) => state.status);

  const liveBadge =
    eventStatus === 'online' ? (
      <StatusPill tone="success" dot>
        实时事件已连接
      </StatusPill>
    ) : eventStatus === 'connecting' ? (
      <StatusPill tone="warning" dot>
        正在连接事件流…
      </StatusPill>
    ) : (
      <StatusPill tone="danger" dot>
        事件流已断开
      </StatusPill>
    );

  return (
    <div className="view-scroll">
      <div className="page">
        <PageHeader
          eyebrow="Observability"
          title="日志与审计"
          subtitle="连接、传输、隧道与安全事件的可追溯时间线，以及终端会话输出记录。"
          badge={liveBadge}
        />

        <TabList
          selectedValue={tab}
          onTabSelect={(_, data) => setTab(data.value as LogTab)}
          className={styles.tabs}
          data-testid="logs-tabs"
        >
          <Tab value="audit" icon={<ReceiptRegular />} data-testid="logs-tab-audit">
            审计日志
          </Tab>
          <Tab value="sessions" icon={<HistoryRegular />} data-testid="logs-tab-sessions">
            会话记录
          </Tab>
        </TabList>

        {tab === 'audit' ? <AuditLogTab /> : <SessionLogsTab />}
      </div>
    </div>
  );
}

export type { LogTab };
