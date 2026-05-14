import { useEffect } from 'react';
import { syncHook } from '@/lib/subscribe';
import type { EVENT_NAME } from '@/lib/subscribe';

export const useSyncHookEvents = (events: readonly EVENT_NAME[], handler: () => void): void => {
  useEffect(() => {
    events.forEach((event) => syncHook.tap(event, handler));
    return () => {
      events.forEach((event) => syncHook.off(event, handler));
    };
  }, [events, handler]);
};
