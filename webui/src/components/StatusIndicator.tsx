import type { ConnectionStatus } from '../types';

interface Props {
  status: ConnectionStatus;
}

const statusConfig: Record<ConnectionStatus, { dot: string; label: string; color: string }> = {
  connected:    { dot: '#6FA67A', label: '已連線',   color: '#6FA67A' },
  connecting:   { dot: '#B8C4CC', label: '連線中…',  color: '#6F7D87' },
  reconnecting: { dot: '#D4A855', label: '重新連線…', color: '#D4A855' },
  disconnected: { dot: '#C97C7C', label: '已斷線',   color: '#C97C7C' },
};

export default function StatusIndicator({ status }: Props) {
  const cfg = statusConfig[status];
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`連線狀態：${cfg.label}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: cfg.dot,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 500, color: cfg.color }}>
        {cfg.label}
      </span>
    </div>
  );
}
