import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  parsePreviewChatId,
  type OutgoingButtonLike,
  type PreviewEvent,
} from '@chatbot/model';
import { ru } from '@/i18n/ru';

export type PreviewConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type PreviewChatItem =
  | { id: number; role: 'bot'; kind: 'text'; text: string }
  | { id: number; role: 'bot'; kind: 'question'; text: string; buttons: OutgoingButtonLike[] }
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'system'; text: string; blockId: string | null };

interface StartAckSuccess {
  chatId: string;
  sessionId?: string;
}

interface AckError {
  error: string;
}

type StartAck = StartAckSuccess | AckError;
type ActionAck = { ok: true } | AckError;

const MAX_INPUT_LENGTH = 4096;
const MAX_CALLBACK_DATA_LENGTH = 64;

function sessionStorageKey(projectId: string): string {
  return `preview-session:${projectId}`;
}

function readSavedSessionId(projectId: string): string | null {
  try {
    return sessionStorage.getItem(sessionStorageKey(projectId));
  } catch {
    return null;
  }
}

function saveSessionId(projectId: string, sessionId: string): void {
  try {
    sessionStorage.setItem(sessionStorageKey(projectId), sessionId);
  } catch {
    // В приватном режиме или без storage продолжаем без сохранения
  }
}

export interface UsePreviewOptions {
  projectId: string;
  enabled: boolean;
  onCurrentBlock?: (blockId: string | null) => void;
  onErrorBlock?: (blockId: string | null) => void;
}

export interface UsePreviewResult {
  status: PreviewConnectionStatus;
  error: string | null;
  messages: PreviewChatItem[];
  variables: Record<string, string>;
  currentBlockId: string | null;
  errorBlockId: string | null;
  sendInput: (text: string) => boolean;
  pressButton: (button: OutgoingButtonLike) => void;
  restart: () => void;
}

// Хук Socket.IO-сеанса превью сценария (namespace /preview, path /api/socket.io)
export function usePreview({
  projectId,
  enabled,
  onCurrentBlock,
  onErrorBlock,
}: UsePreviewOptions): UsePreviewResult {
  const [status, setStatus] = useState<PreviewConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<PreviewChatItem[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null);
  const [errorBlockId, setErrorBlockId] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const counterRef = useRef(0);
  const connectedOnceRef = useRef(false);
  const onCurrentBlockRef = useRef(onCurrentBlock);
  const onErrorBlockRef = useRef(onErrorBlock);

  onCurrentBlockRef.current = onCurrentBlock;
  onErrorBlockRef.current = onErrorBlock;

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return counterRef.current;
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setStatus('idle');
      setError(null);
      setMessages([]);
      setVariables({});
      setCurrentBlockId(null);
      setErrorBlockId(null);
      return;
    }

    setStatus('connecting');
    setError(null);
    setMessages([]);
    setVariables({});
    setCurrentBlockId(null);
    setErrorBlockId(null);

    const socket = io('/preview', {
      path: '/api/socket.io',
      withCredentials: true,
    });
    socketRef.current = socket;
    connectedOnceRef.current = false;

    const handleConnect = () => {
      if (socketRef.current !== socket) return;
      const isReconnect = connectedOnceRef.current;
      connectedOnceRef.current = true;
      if (isReconnect) {
        // На переподключении: сбрасываем чат и добавляем системную строку
        setMessages([
          {
            id: (counterRef.current += 1),
            role: 'system',
            text: ru.preview.sessionRestartedAfterReconnect,
            blockId: null,
          },
        ]);
        setVariables({});
        setCurrentBlockId(null);
        setErrorBlockId(null);
        onCurrentBlockRef.current?.(null);
        onErrorBlockRef.current?.(null);
      }
      const savedSessionId = readSavedSessionId(projectId);
      const payload = savedSessionId ? { projectId, sessionId: savedSessionId } : { projectId };
      socket.emit('start', payload, (ack?: StartAck) => {
        if (socketRef.current !== socket) return;
        if (!ack || 'error' in ack) {
          setStatus('error');
          setError(ack && 'error' in ack ? ack.error : ru.preview.startError);
          return;
        }
        const resolvedSessionId = ack.sessionId ?? parsePreviewChatId(ack.chatId)?.sessionId;
        if (resolvedSessionId) {
          saveSessionId(projectId, resolvedSessionId);
        }
        setStatus('connected');
        setError(null);
      });
    };

    const handleDisconnect = () => {
      setStatus('disconnected');
      setCurrentBlockId(null);
      setErrorBlockId(null);
      onCurrentBlockRef.current?.(null);
      onErrorBlockRef.current?.(null);
    };

    const handleConnectError = () => {
      setStatus('error');
      setError(ru.preview.startError);
    };

    const handlePreviewEvent = (event: PreviewEvent) => {
      switch (event.type) {
        case 'message': {
          const msg = event.message;
          if (msg.kind === 'system') {
            const blockId = msg.blockId ?? null;
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'system', text: msg.text, blockId },
            ]);
            if (blockId) {
              setErrorBlockId(blockId);
              onErrorBlockRef.current?.(blockId);
            }
          } else if (msg.kind === 'question') {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'bot',
                kind: 'question',
                text: msg.text,
                buttons: msg.buttons,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'bot', kind: 'text', text: msg.text },
            ]);
          }
          break;
        }
        case 'system': {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: event.text, blockId: event.blockId },
          ]);
          if (event.blockId) {
            setErrorBlockId(event.blockId);
            onErrorBlockRef.current?.(event.blockId);
          }
          break;
        }
        case 'currentBlock': {
          setCurrentBlockId(event.blockId);
          onCurrentBlockRef.current?.(event.blockId);
          break;
        }
        case 'variables': {
          setVariables(event.variables);
          break;
        }
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('preview', handlePreviewEvent);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('preview', handlePreviewEvent);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [projectId, enabled, nextId]);

  const sendInput = useCallback(
    (rawText: string): boolean => {
      const text = rawText.trim();
      if (!text) return false;
      if (text.length > MAX_INPUT_LENGTH) {
        setError(ru.preview.tooLong);
        return false;
      }
      const socket = socketRef.current;
      if (!socket) return false;

      setError(null);
      setErrorBlockId(null);
      onErrorBlockRef.current?.(null);
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
      socket.emit('input', { text }, (ack?: ActionAck) => {
        if (socketRef.current !== socket) return;
        if (ack && 'error' in ack) {
          setError(ack.error || ru.preview.sendError);
        }
      });
      return true;
    },
    [nextId],
  );

  const pressButton = useCallback(
    (button: OutgoingButtonLike) => {
      if (button.callbackData.length > MAX_CALLBACK_DATA_LENGTH) return;
      const socket = socketRef.current;
      if (!socket) return;

      setError(null);
      setErrorBlockId(null);
      onErrorBlockRef.current?.(null);
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: button.label }]);
      socket.emit('button', { callbackData: button.callbackData }, (ack?: ActionAck) => {
        if (socketRef.current !== socket) return;
        if (ack && 'error' in ack) {
          setError(ack.error || ru.preview.sendError);
        }
      });
    },
    [nextId],
  );

  const restart = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;

    setError(null);
    setMessages([]);
    setVariables({});
    setCurrentBlockId(null);
    setErrorBlockId(null);
    onCurrentBlockRef.current?.(null);
    onErrorBlockRef.current?.(null);

    socket.emit('restart', (ack?: ActionAck) => {
      if (socketRef.current !== socket) return;
      if (ack && 'error' in ack) {
        setError(ack.error || ru.preview.restartError);
      }
    });
  }, []);

  return {
    status,
    error,
    messages,
    variables,
    currentBlockId,
    errorBlockId,
    sendInput,
    pressButton,
    restart,
  };
}
