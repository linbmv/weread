import { useCallback, useEffect, useRef, useState } from 'react';
import { GLOBAL_FALLBACK_EVENT } from '@/lib/globalFallback';
import type { GlobalFallbackPayload, GlobalFallbackTone } from '@/lib/globalFallback';
import './index.scss';

interface GlobalFallbackState {
  exiting: boolean;
  id: number;
  message: string;
  tone: GlobalFallbackTone;
}

const DEFAULT_FALLBACK_DURATION = 2600;
const FALLBACK_EXIT_ANIMATION_MS = 180;

export const GlobalFallback = (): React.JSX.Element | null => {
  const [state, setState] = useState<GlobalFallbackState | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const removeTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback((): void => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (removeTimerRef.current) {
      window.clearTimeout(removeTimerRef.current);
      removeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onFallback = (event: Event) => {
      const payload = (event as CustomEvent<GlobalFallbackPayload>).detail;
      if (!payload?.message) return;
      clearTimers();
      const duration = Math.max(800, payload.duration ?? DEFAULT_FALLBACK_DURATION);
      setState({
        exiting: false,
        id: Date.now(),
        message: payload.message,
        tone: payload.tone || 'info',
      });
      hideTimerRef.current = window.setTimeout(() => {
        setState((current) => (current ? { ...current, exiting: true } : current));
        removeTimerRef.current = window.setTimeout(() => {
          setState(null);
          removeTimerRef.current = null;
        }, FALLBACK_EXIT_ANIMATION_MS);
        hideTimerRef.current = null;
      }, duration);
    };

    window.addEventListener(GLOBAL_FALLBACK_EVENT, onFallback);
    return () => {
      window.removeEventListener(GLOBAL_FALLBACK_EVENT, onFallback);
      clearTimers();
    };
  }, [clearTimers]);

  if (!state) return null;

  return (
    <div className="global-fallback-layer" role="status" aria-live="polite">
      <div
        className="global-fallback-message"
        data-state={state.exiting ? 'exiting' : 'visible'}
        data-tone={state.tone}
        key={state.id}
      >
        {state.message}
      </div>
    </div>
  );
};
