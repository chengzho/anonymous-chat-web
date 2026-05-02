import { useEffect, useRef } from 'react';
import type { ServerMessage } from '../types';
import MessageItem from './MessageItem';

interface Props {
  messages: ServerMessage[];
  currentCallsign: string;
}

export default function MessageList({ messages, currentCallsign }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        backgroundColor: '#F7F9FA',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '20px 16px 8px',
      }}
    >
      {messages.map((msg, idx) => (
        <MessageItem
          key={idx}
          message={msg}
          isOwn={msg.type === 'message' && msg.callsign === currentCallsign}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
