import { useEffect, useRef } from 'react';
import { EVENT_NAME, getReaderControlPanelActive, syncHook } from '@/lib/subscribe';
import { addReaderReadingTime } from '@/lib/readerProgress';
import type { ReaderReadingMode } from '@/lib/readerSettings';

const READER_ACTIVE_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

const READER_READING_TIME_FLUSH_INTERVAL_MS = 30 * 1000;

const getPerformanceNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const getPerformanceWallTime = (performanceNow: number): number => {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)) {
    return Math.round(performance.timeOrigin + performanceNow);
  }
  return Date.now();
};

export const useReaderReadingTimeTracker = (
  bookId: string | undefined,
  enabled: boolean,
  readingMode: ReaderReadingMode,
): void => {
  const stateRef = useRef({
    lastActiveAt: 0,
    lastTickAt: 0,
    running: false,
  });
  const contentVisibleRef = useRef(true);

  useEffect(() => {
    if (!bookId || !enabled) return;

    const isReadingBlocked = () => getReaderControlPanelActive() || !contentVisibleRef.current;

    // markActivity may fire on every wheel/scroll/touchstart event during active reading.
    // Cache panel/visibility checks on the hot path; refresh immediately on panel events.
    const BLOCK_CHECK_INTERVAL_MS = 250;
    let lastBlockCheckAt = -BLOCK_CHECK_INTERVAL_MS;
    let cachedBlocked = false;
    const getCachedBlocked = (now: number): boolean => {
      if (now - lastBlockCheckAt < BLOCK_CHECK_INTERVAL_MS) return cachedBlocked;
      lastBlockCheckAt = now;
      cachedBlocked = isReadingBlocked();
      return cachedBlocked;
    };
    const invalidateBlockedCache = (): void => {
      lastBlockCheckAt = -BLOCK_CHECK_INTERVAL_MS;
    };

    const flush = (now = getPerformanceNow()) => {
      const state = stateRef.current;
      if (!state.running || state.lastTickAt <= 0 || state.lastActiveAt <= 0) return;

      const activeUntil = state.lastActiveAt + READER_ACTIVE_IDLE_TIMEOUT_MS;
      const endAt = Math.min(now, activeUntil);
      const duration = endAt - state.lastTickAt;
      if (duration > 0) {
        addReaderReadingTime(bookId, duration, {
          endedAt: getPerformanceWallTime(endAt),
          startedAt: getPerformanceWallTime(state.lastTickAt),
        });
        state.lastTickAt = endAt;
      }
      if (now >= activeUntil) {
        state.running = false;
      }
    };

    const markActivity = () => {
      const now = getPerformanceNow();
      if (getCachedBlocked(now)) {
        pause();
        return;
      }
      const state = stateRef.current;
      if (state.running && now >= state.lastActiveAt + READER_ACTIVE_IDLE_TIMEOUT_MS) {
        flush(now);
      }
      state.lastActiveAt = now;
      if (document.visibilityState !== 'visible') return;
      if (!state.running) {
        state.running = true;
        state.lastTickAt = now;
      }
    };

    const pause = () => {
      flush(getPerformanceNow());
      stateRef.current.running = false;
    };

    const flushActiveReadingTime = () => {
      invalidateBlockedCache();
      if (isReadingBlocked()) {
        pause();
        return;
      }
      flush(getPerformanceNow());
    };

    const onVisibilityChange = () => {
      invalidateBlockedCache();
      if (document.visibilityState === 'visible') {
        markActivity();
        return;
      }
      pause();
    };

    const onControlPanelActiveChange = () => {
      invalidateBlockedCache();
      if (isReadingBlocked()) {
        pause();
        return;
      }
      markActivity();
    };

    let intersectionObserver: IntersectionObserver | undefined;
    const observeReaderContent = () => {
      if (typeof IntersectionObserver === 'undefined') return;
      const target = document.querySelector<HTMLElement>('.reader-content-text');
      if (!target) return;
      intersectionObserver?.disconnect();
      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          contentVisibleRef.current = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
          if (!contentVisibleRef.current) {
            pause();
            return;
          }
          markActivity();
        },
        { threshold: [0, 0.01] },
      );
      intersectionObserver.observe(target);
    };

    markActivity();
    const observeFrame = window.requestAnimationFrame(observeReaderContent);
    const timer = window.setInterval(flushActiveReadingTime, READER_READING_TIME_FLUSH_INTERVAL_MS);
    window.addEventListener('click', markActivity, true);
    window.addEventListener('keydown', markActivity, true);
    window.addEventListener('pointerdown', markActivity, true);
    window.addEventListener('scroll', markActivity, { capture: true, passive: true });
    window.addEventListener('touchstart', markActivity, { capture: true, passive: true });
    window.addEventListener('wheel', markActivity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', markActivity);
    syncHook.tap(EVENT_NAME.SET_READER_CONTROL_PANEL_ACTIVE, onControlPanelActiveChange);

    return () => {
      window.cancelAnimationFrame(observeFrame);
      intersectionObserver?.disconnect();
      window.clearInterval(timer);
      pause();
      window.removeEventListener('click', markActivity, true);
      window.removeEventListener('keydown', markActivity, true);
      window.removeEventListener('pointerdown', markActivity, true);
      window.removeEventListener('scroll', markActivity, true);
      window.removeEventListener('touchstart', markActivity, true);
      window.removeEventListener('wheel', markActivity, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', markActivity);
      syncHook.off(EVENT_NAME.SET_READER_CONTROL_PANEL_ACTIVE, onControlPanelActiveChange);
      stateRef.current = {
        lastActiveAt: 0,
        lastTickAt: 0,
        running: false,
      };
    };
  }, [bookId, enabled, readingMode]);
};
