import type { ServerMessage } from '../types';

interface Props {
  message: ServerMessage;
  isOwn: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

const AVATAR_COLORS = [
  '#B8CDD9', '#9BB8C9', '#A8C4B8', '#B8C5D9', '#C4B8D9',
  '#B8D9C4', '#D9C4B8', '#C4D9B8', '#B8D9D9', '#D9B8C4',
];

function avatarColor(callsign: string): string {
  let hash = 0;
  for (let i = 0; i < callsign.length; i++) {
    hash = callsign.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

export default function MessageItem({ message, isOwn }: Props) {
  if (message.type === 'system') {
    const eventLabel = message.event === 'user_joined' ? '已加入聊天室' : '已離開聊天室';
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
        <span style={{ fontSize: 11, color: '#9AABB4', fontWeight: 400 }}>
          {message.callsign} {eventLabel}
        </span>
      </div>
    );
  }

  const time = formatTime(message.timestamp);
  const initial = message.callsign.charAt(0).toUpperCase();
  const bgColor = avatarColor(message.callsign);

  if (isOwn) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, maxWidth: '70%' }}>
          <div
            style={{
              backgroundColor: '#C8DDEA',
              borderRadius: '14px 0 14px 14px',
              padding: '10px 12px',
              color: '#2F3C46',
              fontSize: 14,
              lineHeight: 1.4,
              wordBreak: 'break-word',
            }}
          >
            {message.text}
          </div>
          {time && (
            <span style={{ fontSize: 10, color: '#B8C4CC' }}>{time}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, maxWidth: '80%' }}>
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          backgroundColor: bgColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>{initial}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: '#6F7D87', fontWeight: 500 }}>{message.callsign}</span>
        <div
          style={{
            backgroundColor: '#EBF0F4',
            borderRadius: '0 14px 14px 14px',
            padding: '10px 12px',
            color: '#2F3C46',
            fontSize: 14,
            lineHeight: 1.4,
            wordBreak: 'break-word',
          }}
        >
          {message.text}
        </div>
        {time && (
          <span style={{ fontSize: 10, color: '#B8C4CC' }}>{time}</span>
        )}
      </div>
    </div>
  );
}
