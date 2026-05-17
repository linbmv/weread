import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
import { BookDetailMenu } from '@/components/DetailMenu';
import { EVENT_NAME, setReaderControlPanelActive, syncHook } from '@/lib/subscribe';
import { OcticonFont, OcticonMenu, OcticonMoon, OcticonNote, OcticonReadingMode, OcticonSun } from '@/components/Octicon';
import { ReaderFontControlPanel } from '@/components/DetailOperate/ReaderFontControlPanel';
import { ReaderNotePanel } from '@/components/DetailOperate/ReaderNotePanel';
import { ReaderControlPanelLayer } from '@/components/DetailOperate/ReaderControlPanelLayer';
import { ReaderControlTooltip } from '@/components/DetailOperate/ReaderControlTooltip';
import { ReaderSettingControlPanel } from '@/components/DetailOperate/ReaderSettingControlPanel';
import { ReaderThemeControl } from '@/components/DetailOperate/ReaderThemeControl';
import { t } from '@/locales';
import { type ReaderTheme, applyReaderTheme, getStoredReaderTheme, saveReaderTheme } from '@/lib/readerSettings';
import {
  READER_CONTROL_PANEL_MOTION_DURATION,
  type ReaderControlPanelMotion,
  type ReaderControlPanelType,
} from '@/components/DetailOperate/controlPanelTypes';
import './index.scss';

const ReaderMenuIcon = (): React.JSX.Element => <OcticonMenu />;

const ReaderNoteIcon = (): React.JSX.Element => <OcticonNote />;

const ReaderSettingIcon = (): React.JSX.Element => <OcticonReadingMode />;

const ReaderFontIcon = (): React.JSX.Element => <OcticonFont />;

const ReaderSunIcon = (): React.JSX.Element => <OcticonSun />;

const ReaderMoonIcon = (): React.JSX.Element => <OcticonMoon />;

const MOBILE_CONTROL_BUTTONS: Array<{
  Icon: () => React.JSX.Element;
  label: string;
  panel: ReaderControlPanelType;
}> = [
  { Icon: ReaderMenuIcon, label: 'reader.contents', panel: 'menu' },
  { Icon: ReaderNoteIcon, label: 'reader.notes', panel: 'note' },
  { Icon: ReaderSettingIcon, label: 'reader.reading_settings', panel: 'setting' },
  { Icon: ReaderFontIcon, label: 'reader.font', panel: 'font' },
];

const READER_MOBILE_CONTROL_PANEL_FADE_DURATION = 180;

const READER_MOBILE_PANEL_DRAG_HANDLE_HEIGHT = 58;

const READER_MOBILE_PANEL_CLOSE_RATIO = 0.5;

const READER_MOBILE_PANEL_SCROLLABLE_SELECTOR =
  '.reader-menu-scroll-area, .reader-note-panel-list, .reader-setting-control-panel-wrapper';

export const BookDetailOperate = (): React.JSX.Element => {
  const controlsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelCloseTimerRef = useRef<number | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const settingButtonRef = useRef<HTMLButtonElement>(null);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const [activePanel, setActivePanel] = useState<ReaderControlPanelType | null>(null);
  const [renderedPanel, setRenderedPanel] = useState<ReaderControlPanelType | null>(null);
  const [panelMotion, setPanelMotion] = useState<ReaderControlPanelMotion>('enter');
  const [panelMotionId, setPanelMotionId] = useState(0);
  const isPanelActive = Boolean(activePanel);

  const clearPanelCloseTimer = useCallback(() => {
    if (panelCloseTimerRef.current) {
      window.clearTimeout(panelCloseTimerRef.current);
      panelCloseTimerRef.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    clearPanelCloseTimer();
    setActivePanel(null);
    setPanelMotion('exit');
    setPanelMotionId((prev) => prev + 1);
    panelCloseTimerRef.current = window.setTimeout(() => {
      setRenderedPanel(null);
      panelCloseTimerRef.current = null;
    }, READER_CONTROL_PANEL_MOTION_DURATION);
  }, [clearPanelCloseTimer]);

  const openPanel = useCallback(
    (panel: ReaderControlPanelType) => {
      clearPanelCloseTimer();
      setRenderedPanel(panel);
      setPanelMotion(activePanel ? 'switch' : 'enter');
      setPanelMotionId((prev) => prev + 1);
      setActivePanel(panel);
    },
    [activePanel, clearPanelCloseTimer],
  );

  const togglePanel = useCallback(
    (panel: ReaderControlPanelType) => {
      if (activePanel === panel) {
        closePanel();
        return;
      }

      openPanel(panel);
    },
    [activePanel, closePanel, openPanel],
  );

  const getPanelAnchorElement = (panel: ReaderControlPanelType | null): HTMLElement | null => {
    if (panel === 'menu') return menuButtonRef.current;
    if (panel === 'note') return noteButtonRef.current;
    if (panel === 'setting') return settingButtonRef.current;
    if (panel === 'font') return fontButtonRef.current;
    return null;
  };

  useEffect(() => {
    return () => {
      clearPanelCloseTimer();
      setReaderControlPanelActive(false);
    };
  }, [clearPanelCloseTimer]);

  useEffect(() => {
    setReaderControlPanelActive(isPanelActive);
    return () => {
      setReaderControlPanelActive(false);
    };
  }, [isPanelActive]);

  useEffect(() => {
    if (!renderedPanel || panelMotion === 'exit' || panelMotion === 'idle') return;
    const timer = window.setTimeout(() => {
      setPanelMotion('idle');
    }, READER_CONTROL_PANEL_MOTION_DURATION);
    return () => {
      window.clearTimeout(timer);
    };
  }, [panelMotion, panelMotionId, renderedPanel]);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.CLOSE_READER_CONTROL_PANEL, closePanel);
    return () => {
      syncHook.off(EVENT_NAME.CLOSE_READER_CONTROL_PANEL, closePanel);
    };
  }, [closePanel]);

  useEffect(() => {
    const openMenuSearchPanel = () => {
      openPanel('menu');
    };
    syncHook.tap(EVENT_NAME.OPEN_READER_MENU_SEARCH, openMenuSearchPanel);
    return () => {
      syncHook.off(EVENT_NAME.OPEN_READER_MENU_SEARCH, openMenuSearchPanel);
    };
  }, [openPanel]);

  useEffect(() => {
    if (!activePanel) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (controlsRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closePanel();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [activePanel, closePanel]);

  const panelContent = useMemo(() => {
    if (renderedPanel === 'menu') return <BookDetailMenu />;
    if (renderedPanel === 'note') return <ReaderNotePanel />;
    if (renderedPanel === 'setting') return <ReaderSettingControlPanel />;
    if (renderedPanel === 'font') return <ReaderFontControlPanel />;
    return null;
  }, [renderedPanel]);

  return (
    <>
      <div className="readerControls" ref={controlsRef}>
        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label={t('reader.open_contents')}
            aria-expanded={activePanel === 'menu'}
            className="reader-control-button reader-menu-control"
            ref={menuButtonRef}
            type="button"
            onClick={() => togglePanel('menu')}
          >
            <ReaderMenuIcon />
          </button>
          <ReaderControlTooltip label={t('reader.contents')} />
        </div>

        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label={t('reader.open_notes')}
            aria-expanded={activePanel === 'note'}
            className="reader-control-button reader-note-control"
            ref={noteButtonRef}
            type="button"
            onClick={() => togglePanel('note')}
          >
            <ReaderNoteIcon />
          </button>
          <ReaderControlTooltip label={t('reader.notes')} />
        </div>

        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label={t('reader.open_reading_settings')}
            aria-expanded={activePanel === 'setting'}
            className="reader-control-button reader-setting-control"
            ref={settingButtonRef}
            type="button"
            onClick={() => togglePanel('setting')}
          >
            <ReaderSettingIcon />
          </button>
          <ReaderControlTooltip label={t('reader.reading_settings')} />
        </div>

        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label={t('reader.open_font_settings')}
            aria-expanded={activePanel === 'font'}
            className="reader-control-button reader-font-control"
            ref={fontButtonRef}
            type="button"
            onClick={() => togglePanel('font')}
          >
            <ReaderFontIcon />
          </button>
          <ReaderControlTooltip label={t('reader.font')} />
        </div>

        <ReaderThemeControl />
      </div>
      <ReaderControlPanelLayer
        anchorElement={getPanelAnchorElement(activePanel || renderedPanel)}
        motion={panelMotion}
        motionId={panelMotionId}
        panelType={renderedPanel}
        panelRef={panelRef}
      >
        {panelContent}
      </ReaderControlPanelLayer>
    </>
  );
};

const MobileReaderThemeButton = ({ onBeforeToggle }: { onBeforeToggle: () => void }): React.JSX.Element => {
  const [theme, setTheme] = useState<ReaderTheme>(getStoredReaderTheme);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    onBeforeToggle();
    setTheme(nextTheme);
    saveReaderTheme(nextTheme);
    applyReaderTheme(nextTheme);
  };

  return (
    <button
      aria-label={theme === 'dark' ? t('reader.light') : t('reader.dark')}
      className="reader-mobile-menu-button"
      type="button"
      onClick={toggleTheme}
    >
      {theme === 'dark' ? <ReaderSunIcon /> : <ReaderMoonIcon />}
    </button>
  );
};

export const MobileBookDetailOperate = (): React.JSX.Element => {
  const panelCloseTimerRef = useRef<number | null>(null);
  const panelMotionTimerRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchDragEnabledRef = useRef(false);
  const [activePanel, setActivePanel] = useState<ReaderControlPanelType | null>(null);
  const [renderedPanel, setRenderedPanel] = useState<ReaderControlPanelType | null>(null);
  const [pendingPanel, setPendingPanel] = useState<ReaderControlPanelType | null>(null);
  const [panelMotion, setPanelMotion] = useState<ReaderControlPanelMotion>('enter');
  const [panelMotionId, setPanelMotionId] = useState(0);
  const [panelDragY, setPanelDragY] = useState(0);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);

  const clearPanelTimers = useCallback(() => {
    if (panelCloseTimerRef.current) {
      window.clearTimeout(panelCloseTimerRef.current);
      panelCloseTimerRef.current = null;
    }
    if (panelMotionTimerRef.current) {
      window.clearTimeout(panelMotionTimerRef.current);
      panelMotionTimerRef.current = null;
    }
  }, []);

  const openPanelImmediately = useCallback(
    (panel: ReaderControlPanelType) => {
      clearPanelTimers();
      setReaderControlPanelActive(true);
      touchStartYRef.current = null;
      touchDragEnabledRef.current = false;
      setPanelDragY(0);
      setIsDraggingPanel(false);
      setPendingPanel(null);
      setRenderedPanel(panel);
      setActivePanel(panel);
      setPanelMotion('enter');
      setPanelMotionId((prev) => prev + 1);
    },
    [clearPanelTimers],
  );

  const closePanel = useCallback(
    (nextPanel: ReaderControlPanelType | null = null, motion: ReaderControlPanelMotion = 'exit') => {
      clearPanelTimers();
      touchStartYRef.current = null;
      touchDragEnabledRef.current = false;
      setIsDraggingPanel(false);
      setPendingPanel(nextPanel);
      setActivePanel(null);
      setPanelMotion(motion);
      setPanelMotionId((prev) => prev + 1);
      const closeDuration =
        motion === 'fade-exit' ? READER_MOBILE_CONTROL_PANEL_FADE_DURATION : READER_CONTROL_PANEL_MOTION_DURATION;
      panelCloseTimerRef.current = window.setTimeout(() => {
        panelCloseTimerRef.current = null;
        if (nextPanel) {
          setRenderedPanel(nextPanel);
          setPendingPanel(null);
          setActivePanel(nextPanel);
          setPanelMotion('enter');
          setPanelMotionId((prev) => prev + 1);
          return;
        }
        setRenderedPanel(null);
        setPendingPanel(null);
        setPanelDragY(0);
      }, closeDuration);
    },
    [clearPanelTimers],
  );

  const togglePanel = useCallback(
    (panel: ReaderControlPanelType) => {
      if (activePanel === panel) {
        closePanel();
        return;
      }
      if (renderedPanel) {
        closePanel(panel);
        return;
      }
      openPanelImmediately(panel);
    },
    [activePanel, closePanel, openPanelImmediately, renderedPanel],
  );

  const closeActivePanel = useCallback(() => {
    if (renderedPanel) {
      closePanel();
    }
  }, [closePanel, renderedPanel]);

  const fadeOutActivePanel = useCallback(() => {
    if (renderedPanel) {
      closePanel(null, 'fade-exit');
    }
  }, [closePanel, renderedPanel]);

  const closeMobileChrome = useCallback(() => {
    syncHook.call(EVENT_NAME.CLOSE_MOBILE_READER_CHROME);
  }, []);

  useEffect(() => {
    return () => {
      clearPanelTimers();
      setReaderControlPanelActive(false);
    };
  }, [clearPanelTimers]);

  useEffect(() => {
    setReaderControlPanelActive(Boolean(renderedPanel));
    return () => {
      setReaderControlPanelActive(false);
    };
  }, [renderedPanel]);

  useEffect(() => {
    if (!renderedPanel || panelMotion !== 'enter') return;
    panelMotionTimerRef.current = window.setTimeout(() => {
      setPanelMotion('idle');
      panelMotionTimerRef.current = null;
    }, READER_CONTROL_PANEL_MOTION_DURATION);
    return () => {
      if (panelMotionTimerRef.current) {
        window.clearTimeout(panelMotionTimerRef.current);
        panelMotionTimerRef.current = null;
      }
    };
  }, [panelMotion, panelMotionId, renderedPanel]);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.CLOSE_READER_CONTROL_PANEL, closeActivePanel);
    return () => {
      syncHook.off(EVENT_NAME.CLOSE_READER_CONTROL_PANEL, closeActivePanel);
    };
  }, [closeActivePanel]);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.CLOSE_MOBILE_READER_CONTROL_PANEL_FADE, fadeOutActivePanel);
    return () => {
      syncHook.off(EVENT_NAME.CLOSE_MOBILE_READER_CONTROL_PANEL_FADE, fadeOutActivePanel);
    };
  }, [fadeOutActivePanel]);

  useEffect(() => {
    const openMenuSearchPanel = () => {
      if (activePanel === 'menu') return;
      if (renderedPanel) {
        closePanel('menu');
        return;
      }
      openPanelImmediately('menu');
    };
    syncHook.tap(EVENT_NAME.OPEN_READER_MENU_SEARCH, openMenuSearchPanel);
    return () => {
      syncHook.off(EVENT_NAME.OPEN_READER_MENU_SEARCH, openMenuSearchPanel);
    };
  }, [activePanel, closePanel, openPanelImmediately, renderedPanel]);

  const panelContent = useMemo(() => {
    if (renderedPanel === 'menu') return <BookDetailMenu />;
    if (renderedPanel === 'note') return <ReaderNotePanel />;
    if (renderedPanel === 'setting') return <ReaderSettingControlPanel />;
    if (renderedPanel === 'font') return <ReaderFontControlPanel />;
    return null;
  }, [renderedPanel]);

  const stopPanelEventPropagation = (event: SyntheticEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const preventLayerScroll = (event: React.TouchEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  const isPanelScrollableTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest(READER_MOBILE_PANEL_SCROLLABLE_SELECTOR));

  const onPanelTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const clientY = event.touches[0]?.clientY;
    if (clientY === undefined || (renderedPanel !== 'menu' && renderedPanel !== 'note')) {
      touchStartYRef.current = null;
      touchDragEnabledRef.current = false;
      return;
    }

    const panelTop = event.currentTarget.getBoundingClientRect().top;
    touchDragEnabledRef.current = clientY - panelTop <= READER_MOBILE_PANEL_DRAG_HANDLE_HEIGHT;
    touchStartYRef.current = touchDragEnabledRef.current ? clientY : null;
  };

  const onPanelTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const startY = touchStartYRef.current;
    if (startY === null || !touchDragEnabledRef.current) {
      if (!isPanelScrollableTarget(event.target) && event.cancelable) {
        event.preventDefault();
      }
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const currentY = event.touches[0]?.clientY ?? startY;
    const nextDragY = Math.max(currentY - startY, 0);
    setPanelDragY(nextDragY);
    setIsDraggingPanel(true);
  };

  const onPanelTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    touchDragEnabledRef.current = false;
    setIsDraggingPanel(false);
    if (startY === null) return;

    const endY = event.changedTouches[0]?.clientY ?? startY;
    const dragY = Math.max(endY - startY, panelDragY, 0);
    if (dragY >= window.innerHeight * READER_MOBILE_PANEL_CLOSE_RATIO) {
      closePanel();
      return;
    }

    setPanelDragY(0);
  };

  return (
    <>
      <div className="reader-mobile-menu">
        {MOBILE_CONTROL_BUTTONS.map(({ Icon, label, panel }) => {
          const isActive = activePanel === panel || pendingPanel === panel;
          return (
            <button
              aria-label={t(label)}
              aria-expanded={activePanel === panel}
              className={`reader-mobile-menu-button ${isActive ? 'is-active' : ''}`}
              key={panel}
              type="button"
              onClick={() => togglePanel(panel)}
            >
              <Icon />
            </button>
          );
        })}
        <MobileReaderThemeButton onBeforeToggle={closeActivePanel} />
      </div>

      {renderedPanel ? (
        <div
          className="reader-mobile-panel-layer"
          onClick={closeMobileChrome}
          onTouchMove={preventLayerScroll}
          onWheel={preventLayerScroll}
        >
          <div
            className={`reader-mobile-control-panel ${isDraggingPanel ? 'is-dragging' : ''}`}
            data-motion={panelMotion}
            data-motion-id={panelMotionId}
            data-reader-control-panel={renderedPanel}
            style={{ '--reader-mobile-panel-drag-y': `${panelDragY}px` } as CSSProperties}
            onClick={stopPanelEventPropagation}
            onTouchEnd={onPanelTouchEnd}
            onTouchMove={onPanelTouchMove}
            onTouchStart={onPanelTouchStart}
            onWheel={stopPanelEventPropagation}
          >
            {panelContent}
          </div>
        </div>
      ) : null}
    </>
  );
};
