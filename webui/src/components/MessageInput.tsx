import { useState, useRef } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const MAX_LENGTH = 1000;

export default function MessageInput({ onSend, disabled = false }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isOverLimit = text.length > MAX_LENGTH;
  const canSend = text.trim().length > 0 && !disabled && !isOverLimit;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        backgroundColor: '#FFFFFF',
        borderTop: '1px solid #E8EDF0',
        flexShrink: 0,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={MAX_LENGTH + 1}
        placeholder="輸入訊息…"
        disabled={disabled}
        aria-label="訊息輸入框"
        style={{
          flex: 1,
          height: 40,
          backgroundColor: '#F3F6F8',
          border: `1px solid ${isOverLimit ? '#C97C7C' : '#D8E1E8'}`,
          borderRadius: 22,
          padding: '0 16px',
          fontSize: 14,
          color: '#2F3C46',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => {
          if (!isOverLimit) e.target.style.borderColor = '#7D9AAE';
        }}
        onBlur={(e) => {
          if (!isOverLimit) e.target.style.borderColor = '#D8E1E8';
        }}
      />
      <button
        onClick={handleSend}
        disabled={!canSend}
        aria-label="送出訊息"
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: canSend ? '#7D9AAE' : '#D8E1E8',
          cursor: canSend ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#68879C'; }}
        onMouseLeave={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7D9AAE'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M2 12l20-10-10 20-2-8-8-2z" fill="#FFFFFF" />
        </svg>
      </button>
    </div>
  );
}
