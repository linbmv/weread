import { useState } from 'react';
import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import { type ReaderTheme, applyReaderTheme, getStoredReaderTheme, saveReaderTheme } from '@/lib/readerSettings';
import { OcticonMoon, OcticonSun } from '@/components/Octicon';
import { ReaderControlTooltip } from '@/components/DetailOperate/ReaderControlTooltip';
import { t } from '@/locales';

const ReaderSunIcon = (): React.JSX.Element => <OcticonSun />;

const ReaderMoonIcon = (): React.JSX.Element => <OcticonMoon />;

export const ReaderThemeControl = (): React.JSX.Element => {
  const [theme, setTheme] = useState<ReaderTheme>(getStoredReaderTheme);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const applyNextTheme = () => {
      setTheme(nextTheme);
      saveReaderTheme(nextTheme);
      applyReaderTheme(nextTheme);
    };
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const viewTransitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };

    syncHook.call(EVENT_NAME.CLOSE_READER_CONTROL_PANEL);

    if (viewTransitionDocument.startViewTransition && !prefersReducedMotion) {
      viewTransitionDocument.startViewTransition(applyNextTheme);
      return;
    }

    applyNextTheme();
  };

  return (
    <div className="reader-tooltip-container reader-control-tooltip-container">
      <button
        aria-label={theme === 'dark' ? t('reader.light') : t('reader.dark')}
        className="reader-control-button reader-theme-control"
        type="button"
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <ReaderSunIcon /> : <ReaderMoonIcon />}
      </button>
      <ReaderControlTooltip label={theme === 'dark' ? t('reader.light') : t('reader.dark')} />
    </div>
  );
};
