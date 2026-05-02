import { useState, useCallback } from 'react';
import type { ConnectionStatus } from '../types';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ServerMessage } from '../types';

const CALLSIGN_PATTERN = /^[a-zA-Z0-9_]{1,20}$/;

interface Props {
  onEnterChat: (callsign: string, passcode: string) => void;
}

export default function WelcomeScreen({ onEnterChat }: Props) {
  const [nickname, setNickname] = useState('');
  const [passcode, setPasscode] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [connectError, setConnectError] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const isConnecting = status === 'connecting';

  const handleStatusChange = useCallback((s: ConnectionStatus) => {
    setStatus(s);
    if (s === 'connected') {
      onEnterChat(nickname, passcode);
    }
  }, [nickname, passcode, onEnterChat]);

  const handleConnectError = useCallback((msg: string) => {
    setConnectError(msg);
    setStatus('disconnected');
  }, []);

  // noop — welcome screen doesn't render incoming messages
  const handleMessage = useCallback((_msg: ServerMessage) => {}, []);

  const { connect } = useWebSocket({
    callsign: nickname,
    passcode,
    onMessage: handleMessage,
    onStatusChange: handleStatusChange,
    onConnectError: handleConnectError,
  });

  const validate = (): boolean => {
    let valid = true;
    setNicknameError('');
    setPasscodeError('');
    setConnectError('');

    if (!nickname) {
      setNicknameError('請輸入暱稱');
      valid = false;
    } else if (!CALLSIGN_PATTERN.test(nickname)) {
      setNicknameError('暱稱僅限 1–20 個英數字或底線');
      valid = false;
    }

    if (!passcode) {
      setPasscodeError('請輸入進入密碼');
      valid = false;
    }

    return valid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    connect();
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: '#F3F6F8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
          padding: '40px 40px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
        className="welcome-card"
      >
        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              margin: '0 0 8px',
              fontSize: 'clamp(24px, 6vw, 32px)',
              fontWeight: 700,
              color: '#2F3C46',
              letterSpacing: 2,
            }}
          >
            匿名聊天室
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: '#6F7D87' }}>
            安靜、即時、無需註冊
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Nickname */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="nickname" style={{ fontSize: 13, fontWeight: 500, color: '#2F3C46' }}>
              暱稱
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setNicknameError(''); setConnectError(''); }}
              placeholder="輸入暱稱"
              autoComplete="username"
              disabled={isConnecting}
              aria-describedby={nicknameError ? 'nickname-error' : undefined}
              aria-invalid={!!nicknameError}
              style={{
                height: 44,
                border: `1px solid ${nicknameError ? '#C97C7C' : '#D8E1E8'}`,
                borderRadius: 8,
                padding: '0 12px',
                fontSize: 14,
                color: '#2F3C46',
                backgroundColor: '#FFFFFF',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { if (!nicknameError) e.target.style.borderColor = '#7D9AAE'; }}
              onBlur={(e) => { if (!nicknameError) e.target.style.borderColor = '#D8E1E8'; }}
            />
            {nicknameError && (
              <span id="nickname-error" role="alert" style={{ fontSize: 12, color: '#C97C7C' }}>
                {nicknameError}
              </span>
            )}
          </div>

          {/* Passcode */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="passcode" style={{ fontSize: 13, fontWeight: 500, color: '#2F3C46' }}>
              進入密碼
            </label>
            <input
              id="passcode"
              type="password"
              value={passcode}
              onChange={(e) => { setPasscode(e.target.value); setPasscodeError(''); setConnectError(''); }}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isConnecting}
              aria-describedby={passcodeError ? 'passcode-error' : undefined}
              aria-invalid={!!passcodeError}
              style={{
                height: 44,
                border: `1px solid ${passcodeError ? '#C97C7C' : '#D8E1E8'}`,
                borderRadius: 8,
                padding: '0 12px',
                fontSize: 14,
                color: '#2F3C46',
                backgroundColor: '#FFFFFF',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { if (!passcodeError) e.target.style.borderColor = '#7D9AAE'; }}
              onBlur={(e) => { if (!passcodeError) e.target.style.borderColor = '#D8E1E8'; }}
            />
            {passcodeError && (
              <span id="passcode-error" role="alert" style={{ fontSize: 12, color: '#C97C7C' }}>
                {passcodeError}
              </span>
            )}
          </div>

          {/* Connection error */}
          {connectError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: '#C97C7C', textAlign: 'center' }}>
              {connectError}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isConnecting}
            style={{
              height: 48,
              backgroundColor: isConnecting ? '#A8BDC9' : '#7D9AAE',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: isConnecting ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
              marginTop: 4,
            }}
            onMouseEnter={(e) => { if (!isConnecting) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#68879C'; }}
            onMouseLeave={(e) => { if (!isConnecting) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7D9AAE'; }}
          >
            {isConnecting ? '連線中…' : '進入聊天室'}
          </button>
        </form>
      </div>
    </div>
  );
}
