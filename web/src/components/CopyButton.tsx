import { Button, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, CopyRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { copyText } from '../lib/format';
import { useAppStore } from '../store/app';

interface CopyButtonProps {
  value: string;
  label?: string;
  tooltip?: string;
  successMessage?: string;
  quiet?: boolean;
  appearance?: 'secondary' | 'subtle' | 'primary' | 'outline' | 'transparent';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  className?: string;
}

export function CopyButton({
  value,
  label,
  tooltip = '复制',
  successMessage = '已复制到剪贴板',
  quiet = true,
  appearance,
  size = 'small',
  disabled,
  className
}: CopyButtonProps) {
  const notify = useAppStore((state) => state.notify);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleClick = async () => {
    const success = await copyText(value);
    if (success) {
      setCopied(true);
      notify('success', successMessage);
    } else {
      notify('error', '复制失败', '浏览器拒绝了剪贴板访问。');
    }
  };

  return (
    <Tooltip content={copied ? '已复制' : tooltip} relationship="label">
      <Button
        appearance={appearance ?? (quiet ? 'subtle' : 'secondary')}
        size={size}
        icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
        onClick={() => void handleClick()}
        aria-label={tooltip}
        disabled={disabled}
        className={className}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
