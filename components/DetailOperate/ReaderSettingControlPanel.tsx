import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_READER_PAGE_GAP_RATIO,
  DEFAULT_READER_SCROLL_PADDING_X,
  MAX_READER_PAGE_GAP_RATIO,
  MAX_READER_SCROLL_PADDING_X,
  MIN_READER_PAGE_GAP_RATIO,
  MIN_READER_SCROLL_PADDING_X,
  type ReaderFirstLineIndent,
  type ReaderPageTurnEffect,
  type ReaderReadingMode,
  applyReaderFirstLineIndent,
  emitReaderSettingChange,
  getStoredReaderFirstLineIndent,
  getStoredReaderPageGapRatio,
  getStoredReaderPageTurnEffect,
  getStoredReaderReadingMode,
  getStoredReaderScrollPaddingX,
  saveReaderFirstLineIndent,
  saveReaderPageGapRatio,
  saveReaderPageTurnEffect,
  saveReaderReadingMode,
  saveReaderScrollPaddingX,
} from '@/lib/readerSettings';
import { EVENT_NAME, syncHook } from '@/lib/subscribe';

const PAGE_TURN_EFFECT_OPTIONS: { key: ReaderPageTurnEffect; label: string }[] = [
  { key: 'jump', label: '无' },
  { key: 'fade', label: '渐隐' },
  { key: 'scroll', label: '滚动' },
];

const READING_MODE_OPTIONS: { key: ReaderReadingMode; label: string }[] = [
  { key: 'paged', label: '双栏阅读' },
  { key: 'scroll', label: '上下滚动阅读' },
];

const FIRST_LINE_INDENT_OPTIONS: { key: ReaderFirstLineIndent; label: string }[] = [
  { key: 'none', label: '首行顶格' },
  { key: 'indent', label: '首行缩进' },
];

const FONT_SIZE_SLIDER_THUMB_SIZE = 26;

const FONT_SIZE_SLIDER_THUMB_RADIUS = FONT_SIZE_SLIDER_THUMB_SIZE / 2;

const SPACING_APPLY_DELAY = 300;

interface ReaderSpacingControlProps {
  readingMode: ReaderReadingMode;
}

const ReaderSpacingControl = ({ readingMode }: ReaderSpacingControlProps): React.JSX.Element => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const sliderWidthRef = useRef(0);
  const applyTimerRef = useRef<number | null>(null);
  const pendingApplyRef = useRef<(() => void) | null>(null);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pageGapRatio, setPageGapRatio] = useState<number>(getStoredReaderPageGapRatio);
  const [scrollPaddingX, setScrollPaddingX] = useState<number>(getStoredReaderScrollPaddingX);

  const isPaged = readingMode === 'paged';
  const min = isPaged ? MIN_READER_PAGE_GAP_RATIO : MIN_READER_SCROLL_PADDING_X;
  const max = isPaged ? MAX_READER_PAGE_GAP_RATIO : MAX_READER_SCROLL_PADDING_X;
  const defaultValue = isPaged ? DEFAULT_READER_PAGE_GAP_RATIO : DEFAULT_READER_SCROLL_PADDING_X;
  const value = isPaged ? pageGapRatio : scrollPaddingX;
  const title = isPaged ? '页间距' : '内边距';
  const formatLabel = isPaged ? (v: number) => `${Math.round(v * 100)}%` : (v: number) => `${Math.round(v)}px`;

  const flushPendingApply = useCallback(() => {
    if (applyTimerRef.current) {
      window.clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    const apply = pendingApplyRef.current;
    pendingApplyRef.current = null;
    apply?.();
  }, []);

  const setMeasuredSliderWidth = useCallback((width: number) => {
    const normalized = Math.max(Math.round(width), 0);
    if (Math.abs(normalized - sliderWidthRef.current) >= 1) {
      sliderWidthRef.current = normalized;
      setSliderWidth(normalized);
    }
    return sliderWidthRef.current;
  }, []);

  const updateSliderWidth = useCallback(() => {
    const slider = sliderRef.current;
    if (!slider) return sliderWidthRef.current;
    return setMeasuredSliderWidth(slider.clientWidth);
  }, [setMeasuredSliderWidth]);

  const scheduleApply = useCallback((next: number, paged: boolean) => {
    if (applyTimerRef.current) {
      window.clearTimeout(applyTimerRef.current);
    }
    pendingApplyRef.current = () => {
      if (paged) {
        saveReaderPageGapRatio(next);
      } else {
        saveReaderScrollPaddingX(next);
      }
      emitReaderSettingChange();
    };
    applyTimerRef.current = window.setTimeout(() => {
      applyTimerRef.current = null;
      const apply = pendingApplyRef.current;
      pendingApplyRef.current = null;
      apply?.();
    }, SPACING_APPLY_DELAY);
  }, []);

  const updateByClientX = useCallback(
    (clientX: number) => {
      const slider = sliderRef.current;
      if (!slider) return;
      const rect = slider.getBoundingClientRect();
      const width = setMeasuredSliderWidth(slider.clientWidth);
      const activeWidth = Math.max(width - FONT_SIZE_SLIDER_THUMB_SIZE, 1);
      const scale = width > 0 && rect.width > 0 ? rect.width / width : 1;
      const localClientX = (clientX - rect.left) / scale;
      const ratio = Math.min(Math.max((localClientX - FONT_SIZE_SLIDER_THUMB_RADIUS) / activeWidth, 0), 1);
      const raw = min + ratio * (max - min);
      const next = isPaged ? raw : Math.round(raw);
      if (isPaged) {
        setPageGapRatio(next);
      } else {
        setScrollPaddingX(next);
      }
      scheduleApply(next, isPaged);
    },
    [isPaged, max, min, scheduleApply, setMeasuredSliderWidth],
  );

  useEffect(() => {
    flushPendingApply();
    setPageGapRatio(getStoredReaderPageGapRatio());
    setScrollPaddingX(getStoredReaderScrollPaddingX());
  }, [readingMode, flushPendingApply]);

  useEffect(() => {
    return () => {
      flushPendingApply();
    };
  }, [flushPendingApply]);

  useEffect(() => {
    const sliderElement = sliderRef.current;
    if (!sliderElement) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      updateByClientX(e.clientX);
    };
    const onPointerUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      updateByClientX(e.clientX);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerUp);
    };

    sliderElement.addEventListener('pointerdown', onPointerDown);
    return () => {
      sliderElement.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
  }, [updateByClientX]);

  useEffect(() => {
    const sliderElement = sliderRef.current;
    if (!sliderElement) return;

    const updateWidth = () => {
      updateSliderWidth();
    };

    const intervalId = window.setInterval(() => {
      if (updateSliderWidth() > 0) {
        window.clearInterval(intervalId);
      }
    }, 120);

    updateWidth();
    window.addEventListener('resize', updateWidth);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateWidth);
      observer.observe(sliderElement);
    }

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', updateWidth);
      observer?.disconnect();
    };
  }, [updateSliderWidth]);

  const range = max - min;
  const ratio = range > 0 ? Math.min(Math.max((value - min) / range, 0), 1) : 0;
  const defaultRatio = range > 0 ? Math.min(Math.max((defaultValue - min) / range, 0), 1) : 0;
  const activeWidth = Math.max(sliderWidth - FONT_SIZE_SLIDER_THUMB_SIZE, 0);
  const thumbX = FONT_SIZE_SLIDER_THUMB_RADIUS + activeWidth * ratio;
  const progressWidth = Math.min(sliderWidth, thumbX + FONT_SIZE_SLIDER_THUMB_RADIUS + 4);
  const defaultDotX = FONT_SIZE_SLIDER_THUMB_RADIUS + activeWidth * defaultRatio;

  return (
    <div className="reader-setting-section">
      <div className="reader-font-panel-title">{title}</div>
      <div
        className={`font-panel-content-size-wrapper ${isDragging ? 'is-dragging' : ''}`}
        style={
          {
            '--reader-font-size-default-dot-x': `${defaultDotX}px`,
            '--reader-font-size-progress-width': `${progressWidth || FONT_SIZE_SLIDER_THUMB_SIZE}px`,
            '--reader-font-size-thumb-x': `${thumbX}px`,
          } as React.CSSProperties
        }
      >
        <div
          aria-label={title}
          aria-valuemax={max}
          aria-valuemin={min}
          aria-valuenow={value}
          className="reader_font_control_slider_wrapper font-panel-content-size-slider"
          ref={sliderRef}
          role="slider"
        >
          <div className="reader_font_control_slider_track">
            <div className="reader_font_control_slider_track_progress"></div>
            <div className="reader_font_control_slider_default_dot"></div>
            <div className="reader_font_control_slider_dot">
              <span>{formatLabel(value)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ReaderSettingControlPanel = (): React.JSX.Element => {
  const pageTurnOptionRef = useRef<HTMLDivElement>(null);
  const readingModeOptionRef = useRef<HTMLDivElement>(null);
  const firstLineIndentOptionRef = useRef<HTMLDivElement>(null);
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);
  const [readingMode, setReadingMode] = useState<ReaderReadingMode>(getStoredReaderReadingMode);
  const [firstLineIndent, setFirstLineIndent] = useState<ReaderFirstLineIndent>(getStoredReaderFirstLineIndent);

  useEffect(() => {
    const optionElement = pageTurnOptionRef.current;
    if (!optionElement) return;

    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-page-turn-effect]');
      const effect = button?.dataset.pageTurnEffect as ReaderPageTurnEffect | undefined;
      if (!effect) return;
      setPageTurnEffect(effect);
      saveReaderPageTurnEffect(effect);
      emitReaderSettingChange();
    };

    optionElement.addEventListener('click', onClick);
    return () => {
      optionElement.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const optionElement = readingModeOptionRef.current;
    if (!optionElement) return;

    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-reading-mode]');
      const mode = button?.dataset.readingMode as ReaderReadingMode | undefined;
      if (!mode) return;
      syncHook.call(EVENT_NAME.FLUSH_READER_PROGRESS);
      setReadingMode(mode);
      saveReaderReadingMode(mode);
      emitReaderSettingChange();
      syncHook.call(EVENT_NAME.CLOSE_READER_CONTROL_PANEL);
    };

    optionElement.addEventListener('click', onClick);
    return () => {
      optionElement.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const optionElement = firstLineIndentOptionRef.current;
    if (!optionElement) return;

    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-first-line-indent]');
      const value = button?.dataset.firstLineIndent as ReaderFirstLineIndent | undefined;
      if (!value) return;
      setFirstLineIndent(value);
      saveReaderFirstLineIndent(value);
      applyReaderFirstLineIndent(value);
      emitReaderSettingChange();
    };

    optionElement.addEventListener('click', onClick);
    return () => {
      optionElement.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <div className="reader-setting-control-panel-wrapper">
      <div className="reader-setting-section">
        <div className="reader-font-panel-title">阅读模式</div>
        <div className="reader-reading-mode-options" ref={readingModeOptionRef}>
          {READING_MODE_OPTIONS.map((item) => (
            <button
              className={`reader-setting-option ${readingMode === item.key ? 'is-active' : ''}`}
              data-reading-mode={item.key}
              key={item.key}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting-section">
        <div className="reader-font-panel-title">首行缩进</div>
        <div className="reader-first-line-indent-options" ref={firstLineIndentOptionRef}>
          {FIRST_LINE_INDENT_OPTIONS.map((item) => (
            <button
              className={`reader-setting-option ${firstLineIndent === item.key ? 'is-active' : ''}`}
              data-first-line-indent={item.key}
              key={item.key}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting-section">
        <div className="reader-font-panel-title">翻页动画</div>
        <div className="reader-page-turn-options" ref={pageTurnOptionRef}>
          {PAGE_TURN_EFFECT_OPTIONS.map((item) => (
            <button
              className={`reader-setting-option ${pageTurnEffect === item.key ? 'is-active' : ''}`}
              data-page-turn-effect={item.key}
              key={item.key}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <ReaderSpacingControl readingMode={readingMode} />
    </div>
  );
};
