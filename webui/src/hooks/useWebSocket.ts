import { useRef, useCallback, useEffect } from 'react';
import { WS_ENDPOINT } from '../config';
import type { ServerMessage, ConnectionStatus, SendMessagePayload } from '../types';

interface UseWebSocketOptions {
  callsign: string;
  passcode: string;
  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onConnectError: (errorMsg: string) => void;
  /** Connect immediately on mount when true (used by ChatScreen). */
  autoConnect?: boolean;
}

interface UseWebSocketResult {
  connect: () => void;
  disconnect: () => void;
  sendMessage: (text: string) => void;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

export function useWebSocket({
  callsign,
  passcode,
  onMessage,
  onStatusChange,
  onConnectError,
  autoConnect = false,
}: UseWebSocketOptions): UseWebSocketResult {
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIntentionalCloseRef = useRef(false);

  // Keep stable refs to callbacks so they don't invalidate connect()
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  const onConnectErrorRef = useRef(onConnectError);
  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;
  onConnectErrorRef.current = onConnectError;

  const clearRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const openSocket = useCallback((url: string) => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      onStatusChangeRef.current('connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as ServerMessage;
        onMessageRef.current(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (isIntentionalCloseRef.current) {
        onStatusChangeRef.current('disconnected');
        return;
      }

      // 4xxx codes are application-level rejections from the $connect Lambda
      if (event.code >= 4000 && event.code < 5000) {
        onConnectErrorRef.current('連線被拒絕，請確認暱稱或密碼是否正確。');
        onStatusChangeRef.current('disconnected');
        return;
      }

      // First close on retry count 0 with unclean close = initial connection failed
      if (retryCountRef.current === 0 && !event.wasClean) {
        onConnectErrorRef.current('無法連線，請確認密碼是否正確或稍後再試。');
        onStatusChangeRef.current('disconnected');
        return;
      }

      if (retryCountRef.current < MAX_RETRIES) {
        onStatusChangeRef.current('reconnecting');
        const delay = Math.min(BASE_DELAY_MS * 2 ** retryCountRef.current, MAX_DELAY_MS);
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          openSocket(url);
        }, delay);
      } else {
        onStatusChangeRef.current('disconnected');
      }
    };

    ws.onerror = () => {
      // always followed by onclose; handled there
    };
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      isIntentionalCloseRef.current = true;
      wsRef.current.close();
      isIntentionalCloseRef.current = false;
    }
    clearRetryTimer();
    retryCountRef.current = 0;
    isIntentionalCloseRef.current = false;

    const url = `${WS_ENDPOINT}?callsign=${encodeURIComponent(callsign)}&passcode=${encodeURIComponent(passcode)}`;
    onStatusChangeRef.current('connecting');
    openSocket(url);
  }, [callsign, passcode, openSocket]);

  const disconnect = useCallback(() => {
    isIntentionalCloseRef.current = true;
    clearRetryTimer();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload: SendMessagePayload = { action: 'sendMessage', text };
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      isIntentionalCloseRef.current = true;
      clearRetryTimer();
      wsRef.current?.close();
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connect, disconnect, sendMessage };
}
