import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Routes } from './router/index';
import { closeDB, initDB, resumeDB } from './store';
import { GlobalFallback } from '@/components/GlobalFallback';
import { Loading } from '@/components/Loading';
import './styles/view-transition.scss';

export const App = (): JSX.Element => {
  const [dbReady, setDbReady] = useState(false);
  // Guards against React 19 Strict Mode's double-invoked effect: the first
  // mount kicks off initDB(), the synthetic unmount must NOT tear it down,
  // and the remount must await the SAME in-flight init promise — not flip
  // dbReady early, which would let routes mount before hydration completes
  // and let DB-touching components issue reads against half-hydrated state.
  const initPromiseRef = useRef<Promise<unknown> | null>(null);

  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      resumeDB();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!initPromiseRef.current) {
      initPromiseRef.current = initDB().catch(() => false);
    }
    initPromiseRef.current.finally(() => {
      if (!cancelled) setDbReady(true);
    });

    document.addEventListener('visibilitychange', onVisibilityChange, false);

    // Close the DB on real page unload, not on component unmount. SPA route
    // changes and Strict-Mode unmount/remount cycles must keep the database
    // alive; otherwise any in-flight saveReaderProgress / pagehide handlers
    // would hit a torn-down worker and stall on the 60s pending timeout.
    const onPageHide = (): void => closeDB();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [onVisibilityChange]);
  if (!dbReady) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loading />
        <GlobalFallback />
      </div>
    );
  }
  return (
    <div className="w-full h-full">
      <Routes />
      <GlobalFallback />
    </div>
  );
};
