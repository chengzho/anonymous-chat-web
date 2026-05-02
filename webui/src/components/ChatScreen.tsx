import { useState, useCallback } from 'react';
import type { ServerMessage, ConnectionStatus } from '../types';
import { useWebSocket } from '../hooks/useWebSocket';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import StatusIndicator from './StatusIndicator';

interface Props {
  callsign: string;
  passcode: string;
  onDisconnect: () => void;
}

export default function ChatScreen({ callsign, passcode, onDisconnect }: Props) {
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const handleMessage = useCallback((msg: ServerMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleStatusChange = useCallback((s: ConnectionStatus) => {
    setStatus(s);
    if (s === 'disconnected') {
      // stay on chat screen, show disconnected state
    }
  }, []);

  const handleConnectError = useCallback(() => {
    // On chat screen the connect error just surfaces as "disconnected"
    setStatus('disconnected');
  }, []);

  const { sendMessage } = useWebSocket({
    callsign,
    passcode,
    onMessage: handleMessage,
    onStatusChange: handleStatusChange,
    onConnectError: handleConnectError,
    autoConnect: true,
  });

  const isInputDisabled = status !== 'connected';

  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: '#F3F6F8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Mobile: full-height. Desktop: centered card via CSS class */}
      <div
        style={{
          width: '100%',
          maxWidth: 800,
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 4px 24px rgba(47,60,70,0.08)',
        }}
        className="chat-card"
      >
        {/* Header */}
        <header
          style={{
            height: 56,
            backgroundColor: '#FFFFFF',
            borderBottom: '1px solid #E8EDF0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            flexShrink: 0,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#2F3C46' }}>
            匿名聊天室
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusIndicator status={status} />
            {status === 'disconnected' && (
              <button
                onClick={onDisconnect}
                style={{
                  fontSize: 12,
                  color: '#6F7D87',
                  background: 'none',
                  border: '1px solid #D8E1E8',
                  borderRadius: 6,
                  padding: '3px 8px',
                  cursor: 'pointer',
                }}
              >
                返回
              </button>
            )}
          </div>
        </header>

        {/* Messages */}
        <MessageList messages={messages} currentCallsign={callsign} />

        {/* Input */}
        <MessageInput onSend={sendMessage} disabled={isInputDisabled} />
      </div>
    </div>
  );
}
