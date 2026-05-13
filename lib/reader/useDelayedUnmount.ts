import { useEffect, useRef, useState } from 'react';

const READER_OVERLAY_UNMOUNT_DELAY_MS = 140;

// Keeps an overlay (selection menu / note modal) mounted briefly after `state`
// becomes null so the CSS close animation can run, then unmounts.
export const useDelayedUnmount = <T,>(state: T | null): { renderState: T | null; isClosing: boolean } => {
  const [renderState, setRenderState] = useState<T | null>(state);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (state) {
      setRenderState(state);
      setIsClosing(false);
      return;
    }
    if (!renderState) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setRenderState(null);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, READER_OVERLAY_UNMOUNT_DELAY_MS);
  }, [renderState, state]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return { renderState, isClosing };
};
