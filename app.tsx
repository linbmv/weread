import React, { useCallback, useEffect } from 'react';
import { Routes } from './router/index';
import { closeDB, initDB, resumeDB } from './store';
import { GlobalFallback } from '@/components/GlobalFallback';
import 'ranui/button';
import './styles/view-transition.scss';
import '@khmyznikov/pwa-install';

export const App = (): React.JSX.Element => {
  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      resumeDB();
    }
  }, []);
  const createPwaInstall = () => {
    const pwaInstall = document.createElement('pwa-install');
    pwaInstall.setAttribute('manifest-url', '/weread/manifest.json');
    pwaInstall.setAttribute('name', 'weread');
    pwaInstall.setAttribute('description', 'Progressive web application');
    pwaInstall.setAttribute('icon', '/weread/read.svg');
    document.body.appendChild(pwaInstall);
    return () => {
      document.body.removeChild(pwaInstall);
    };
  };
  useEffect(() => {
    initDB();
    const removePwaInstall = createPwaInstall();
    document.addEventListener('visibilitychange', onVisibilityChange, false);
    return () => {
      closeDB();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      removePwaInstall();
    };
  }, []);
  return (
    <div className="w-full h-full">
      <Routes />
      <GlobalFallback />
    </div>
  );
};
