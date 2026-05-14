import React, { useCallback, useEffect } from 'react';
import { Routes } from './router/index';
import { closeDB, initDB, resumeDB } from './store';
import { GlobalFallback } from '@/components/GlobalFallback';
import { Loading } from '@/components/Loading';
import 'ranui/button';
import './styles/view-transition.scss';

export const App = (): React.JSX.Element => {
  const [dbReady, setDbReady] = React.useState(false);
  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      resumeDB();
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    initDB()
      .catch(() => false)
      .finally(() => {
        if (!cancelled) {
          setDbReady(true);
        }
      });
    document.addEventListener('visibilitychange', onVisibilityChange, false);
    return () => {
      cancelled = true;
      closeDB();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
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
