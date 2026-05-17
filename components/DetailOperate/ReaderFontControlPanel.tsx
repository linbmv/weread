import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_FONT_SIZE,
  MAX_READER_FONT_SIZE,
  MIN_READER_FONT_SIZE,
  type ReaderFontSetting,
  applyReaderFont,
  applyReaderFontSize,
  emitReaderSettingChange,
  getStoredReaderFont,
  getStoredReaderFontSize,
  saveReaderFont,
  saveReaderFontSize,
} from '@/lib/readerSettings';
import {
  type BrowserLocalFont,
  FONT_CATEGORY_ITEMS,
  type FontCategory,
  getFontCategory,
  mergeReaderFonts,
  normalizeLocalFonts,
} from '@/components/DetailOperate/fontPanelUtils';
import { t } from '@/locales';

const FONT_SIZE_SLIDER_THUMB_SIZE = 26;

const FONT_SIZE_SLIDER_THUMB_RADIUS = FONT_SIZE_SLIDER_THUMB_SIZE / 2;

const FONT_SIZE_APPLY_DELAY = 300;

const LOCAL_FONT_FILE_PATTERN = /\.(?:otf|ttf|woff|woff2)$/i;

let readerSessionSystemFonts: ReaderFontSetting[] = [];

const isMobileFontAccessViewport = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 760px)').matches;
};

const getLocalFontLabel = (fileName: string): string => {
  return fileName.replace(/\.(?:otf|ttf|woff|woff2)$/i, '').trim() || fileName;
};

const getReaderFontLabel = (font: ReaderFontSetting): string => {
  return font.id === DEFAULT_READER_FONT.id ? t('font.default') : font.label;
};

const loadLocalFontFiles = async (files: File[]): Promise<ReaderFontSetting[]> => {
  const loadedFonts: ReaderFontSetting[] = [];
  const timestamp = Date.now();

  for (const [index, file] of files.entries()) {
    if (!LOCAL_FONT_FILE_PATTERN.test(file.name)) continue;
    const label = getLocalFontLabel(file.name);
    const family = `WereadLocalFont-${timestamp}-${index}`;
    try {
      const fontFace = new FontFace(family, await file.arrayBuffer());
      await fontFace.load();
      document.fonts.add(fontFace);
      loadedFonts.push({
        id: `system-${family}`,
        label,
        family,
        source: 'system',
      });
    } catch {
      // Ignore unsupported or broken font files in the selected folder.
    }
  }

  return loadedFonts;
};

const clampReaderFontSize = (value: number): number => {
  return Math.min(Math.max(value, MIN_READER_FONT_SIZE), MAX_READER_FONT_SIZE);
};

export const ReaderFontControlPanel = (): React.JSX.Element => {
  const categoryRef = useRef<HTMLDivElement>(null);
  const fontGridRef = useRef<HTMLDivElement>(null);
  const localFontInputRef = useRef<HTMLInputElement>(null);
  const fontSizeSliderRef = useRef<HTMLDivElement>(null);
  const fontSizeApplyTimerRef = useRef<number | null>(null);
  const isDraggingFontSizeRef = useRef(false);
  const fontSizeSliderWidthRef = useRef(0);
  const [fontSize, setFontSize] = useState(DEFAULT_READER_FONT_SIZE);
  const [fontSizeSliderWidth, setFontSizeSliderWidth] = useState(0);
  const [selectedFont, setSelectedFont] = useState<ReaderFontSetting>(DEFAULT_READER_FONT);
  const [systemFonts, setSystemFonts] = useState<ReaderFontSetting[]>(readerSessionSystemFonts);
  const [activeCategory, setActiveCategory] = useState<FontCategory>('all');
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [fontAccessMessage, setFontAccessMessage] = useState('');
  const [isDraggingFontSize, setIsDraggingFontSize] = useState(false);
  const [isMobileFontAccess, setIsMobileFontAccess] = useState(isMobileFontAccessViewport);

  useEffect(() => {
    const storedFont = getStoredReaderFont();
    const storedFontSize = getStoredReaderFontSize();
    const normalizedFontSize = clampReaderFontSize(storedFontSize);
    setSelectedFont(storedFont);
    setFontSize(normalizedFontSize);
    if (normalizedFontSize !== storedFontSize) {
      saveReaderFontSize(normalizedFontSize);
    }
    const nextSystemFonts =
      storedFont.source === 'system'
        ? mergeReaderFonts(readerSessionSystemFonts, [storedFont])
        : readerSessionSystemFonts;
    readerSessionSystemFonts = nextSystemFonts;
    setSystemFonts(nextSystemFonts);
  }, []);

  useEffect(() => {
    return () => {
      if (fontSizeApplyTimerRef.current) {
        window.clearTimeout(fontSizeApplyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 760px)');
    const updateMobileFontAccess = () => {
      setIsMobileFontAccess(media.matches);
    };
    updateMobileFontAccess();
    media.addEventListener('change', updateMobileFontAccess);
    return () => {
      media.removeEventListener('change', updateMobileFontAccess);
    };
  }, []);

  useEffect(() => {
    const input = localFontInputRef.current;
    if (!input) return;
    if (isMobileFontAccess) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      return;
    }
    input.removeAttribute('webkitdirectory');
    input.removeAttribute('directory');
  }, [isMobileFontAccess]);

  const fontOptions = useMemo(() => {
    const optionMap = new Map<string, ReaderFontSetting>();
    optionMap.set(DEFAULT_READER_FONT.id, DEFAULT_READER_FONT);
    systemFonts.forEach((font) => optionMap.set(font.id, font));
    if (selectedFont.source === 'system') {
      optionMap.set(selectedFont.id, selectedFont);
    }
    return Array.from(optionMap.values());
  }, [selectedFont, systemFonts]);

  const fontCategories = useMemo(() => {
    return FONT_CATEGORY_ITEMS.map((item) => {
      const count =
        item.key === 'all'
          ? fontOptions.length
          : fontOptions.filter((font) => getFontCategory(font) === item.key).length;
      return { ...item, count };
    });
  }, [fontOptions]);

  const visibleFonts = useMemo(() => {
    if (activeCategory === 'all') return fontOptions;
    return fontOptions.filter((font) => getFontCategory(font) === activeCategory);
  }, [activeCategory, fontOptions]);

  const scheduleApplyFontSize = useCallback((nextFontSize: number) => {
    if (fontSizeApplyTimerRef.current) {
      window.clearTimeout(fontSizeApplyTimerRef.current);
    }
    fontSizeApplyTimerRef.current = window.setTimeout(() => {
      saveReaderFontSize(nextFontSize);
      applyReaderFontSize(nextFontSize);
      emitReaderSettingChange();
    }, FONT_SIZE_APPLY_DELAY);
  }, []);

  const setMeasuredFontSizeSliderWidth = useCallback((width: number) => {
    const normalizedWidth = Math.max(Math.round(width), 0);
    if (Math.abs(normalizedWidth - fontSizeSliderWidthRef.current) >= 1) {
      fontSizeSliderWidthRef.current = normalizedWidth;
      setFontSizeSliderWidth(normalizedWidth);
    }
    return fontSizeSliderWidthRef.current;
  }, []);

  const updateFontSizeSliderWidth = useCallback(() => {
    const slider = fontSizeSliderRef.current;
    if (!slider) return fontSizeSliderWidthRef.current;
    return setMeasuredFontSizeSliderWidth(slider.clientWidth);
  }, [setMeasuredFontSizeSliderWidth]);

  const updateFontSizeByClientX = useCallback(
    (clientX: number) => {
      const slider = fontSizeSliderRef.current;
      if (!slider) return;
      const rect = slider.getBoundingClientRect();
      const width = setMeasuredFontSizeSliderWidth(slider.clientWidth);
      const activeWidth = Math.max(width - FONT_SIZE_SLIDER_THUMB_SIZE, 1);
      const scale = width > 0 && rect.width > 0 ? rect.width / width : 1;
      const localClientX = (clientX - rect.left) / scale;
      const ratio = Math.min(Math.max((localClientX - FONT_SIZE_SLIDER_THUMB_RADIUS) / activeWidth, 0), 1);
      const nextFontSize = Math.round(MIN_READER_FONT_SIZE + ratio * (MAX_READER_FONT_SIZE - MIN_READER_FONT_SIZE));
      setFontSize(nextFontSize);
      scheduleApplyFontSize(nextFontSize);
    },
    [scheduleApplyFontSize, setMeasuredFontSizeSliderWidth],
  );

  const onSelectFont = useCallback((font: ReaderFontSetting) => {
    setSelectedFont(font);
    saveReaderFont(font);
    applyReaderFont(font);
    emitReaderSettingChange();
  }, []);

  const requestSystemFonts = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setFontAccessMessage(t('font.requires_secure_context'));
      return;
    }

    const queryLocalFonts = (window as Window & { queryLocalFonts?: () => Promise<BrowserLocalFont[]> })
      .queryLocalFonts;

    if (!queryLocalFonts) {
      setFontAccessMessage(t('font.unsupported_local_access'));
      return;
    }

    setIsLoadingFonts(true);
    setFontAccessMessage(t('font.requesting_permission'));

    try {
      const fonts = await queryLocalFonts.call(window);
      const localFonts = await normalizeLocalFonts(fonts);
      readerSessionSystemFonts = localFonts;
      setSystemFonts(localFonts);
      setFontAccessMessage(localFonts.length > 0 ? '' : t('font.no_chinese_system_fonts'));
    } catch {
      setFontAccessMessage(t('font.permission_denied'));
    } finally {
      setIsLoadingFonts(false);
    }
  }, []);

  const requestLocalFonts = useCallback(() => {
    setFontAccessMessage('');
    localFontInputRef.current?.click();
  }, []);

  const onLocalFontInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length === 0) return;

    setIsLoadingFonts(true);
    setFontAccessMessage(t('font.loading_local'));
    try {
      const localFonts = await loadLocalFontFiles(files);
      const nextFonts = mergeReaderFonts(readerSessionSystemFonts, localFonts);
      readerSessionSystemFonts = nextFonts;
      setSystemFonts(nextFonts);
      setFontAccessMessage(localFonts.length > 0 ? '' : t('font.no_loadable_fonts'));
    } finally {
      setIsLoadingFonts(false);
    }
  }, []);

  const requestFontAccess = isMobileFontAccess ? requestLocalFonts : requestSystemFonts;

  useEffect(() => {
    const categoryElement = categoryRef.current;
    if (!categoryElement) return;
    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-font-category]');
      const category = button?.dataset.fontCategory as FontCategory | undefined;
      if (category) {
        setActiveCategory(category);
      }
    };
    categoryElement.addEventListener('click', onClick);
    return () => {
      categoryElement.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const fontGridElement = fontGridRef.current;
    if (!fontGridElement) return;
    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-font-id]');
      const fontId = button?.dataset.fontId;
      const font = fontOptions.find((item) => item.id === fontId);
      if (font) {
        onSelectFont(font);
      }
    };
    fontGridElement.addEventListener('click', onClick);
    return () => {
      fontGridElement.removeEventListener('click', onClick);
    };
  }, [fontOptions, onSelectFont]);

  useEffect(() => {
    const sliderElement = fontSizeSliderRef.current;
    if (!sliderElement) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingFontSizeRef.current) return;
      updateFontSizeByClientX(e.clientX);
    };
    const onPointerUp = () => {
      isDraggingFontSizeRef.current = false;
      setIsDraggingFontSize(false);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      isDraggingFontSizeRef.current = true;
      setIsDraggingFontSize(true);
      updateFontSizeByClientX(e.clientX);
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
  }, [updateFontSizeByClientX]);

  useEffect(() => {
    const sliderElement = fontSizeSliderRef.current;
    if (!sliderElement) return;

    const updateWidth = () => {
      updateFontSizeSliderWidth();
    };

    const intervalId = window.setInterval(() => {
      if (updateFontSizeSliderWidth() > 0) {
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
  }, [updateFontSizeSliderWidth]);

  const fontSizeProgressRatio =
    (clampReaderFontSize(fontSize) - MIN_READER_FONT_SIZE) / (MAX_READER_FONT_SIZE - MIN_READER_FONT_SIZE);
  const defaultFontSizeProgressRatio =
    (DEFAULT_READER_FONT_SIZE - MIN_READER_FONT_SIZE) / (MAX_READER_FONT_SIZE - MIN_READER_FONT_SIZE);
  const fontSizeActiveWidth = Math.max(fontSizeSliderWidth - FONT_SIZE_SLIDER_THUMB_SIZE, 0);
  const fontSizeThumbX = FONT_SIZE_SLIDER_THUMB_RADIUS + fontSizeActiveWidth * fontSizeProgressRatio;
  const fontSizeProgressWidth = Math.min(fontSizeSliderWidth, fontSizeThumbX + FONT_SIZE_SLIDER_THUMB_RADIUS + 4);
  const defaultFontSizeDotX = FONT_SIZE_SLIDER_THUMB_RADIUS + fontSizeActiveWidth * defaultFontSizeProgressRatio;

  return (
    <div className="reader-font-control-panel-wrapper">
      <div className="reader-font-size-section">
        <div className="reader-font-panel-title">{t('font.size')}</div>
        <div
          className={`font-panel-content-size-wrapper ${isDraggingFontSize ? 'is-dragging' : ''}`}
          style={
            {
              '--reader-font-size-default-dot-x': `${defaultFontSizeDotX}px`,
              '--reader-font-size-progress-width': `${fontSizeProgressWidth || FONT_SIZE_SLIDER_THUMB_SIZE}px`,
              '--reader-font-size-thumb-x': `${fontSizeThumbX}px`,
            } as React.CSSProperties
          }
        >
          <div
            className="reader_font_control_slider_wrapper font-panel-content-size-slider"
            ref={fontSizeSliderRef}
            role="slider"
            aria-label={t('font.size')}
            aria-valuemin={MIN_READER_FONT_SIZE}
            aria-valuemax={MAX_READER_FONT_SIZE}
            aria-valuenow={fontSize}
          >
            <div className="reader_font_control_slider_track">
              <div className="reader_font_control_slider_track_progress"></div>
              <div className="reader_font_control_slider_track_pre"></div>
              <div className="reader_font_control_slider_track_post"></div>
              <div className="reader_font_control_slider_default_dot"></div>
              <div className="reader_font_control_slider_dot">
                <span>{fontSize}px</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="reader-font-family-section">
        <div className="reader-font-panel-heading">
          <div className="reader-font-panel-title">{t('font.family')}</div>
          <div className="reader-font-action-area">
            {fontAccessMessage && <span className="reader-font-access-message">{fontAccessMessage}</span>}
            <button
              className="reader-font-access-button"
              disabled={isLoadingFonts}
              type="button"
              onClick={() => {
                void requestFontAccess();
              }}
            >
              {isLoadingFonts ? t('common.loading') : isMobileFontAccess ? t('font.load_local') : t('font.get_system')}
            </button>
            <input
              ref={localFontInputRef}
              accept=".otf,.ttf,.woff,.woff2"
              className="reader-font-local-input"
              multiple
              type="file"
              onChange={onLocalFontInputChange}
            />
          </div>
        </div>

        <div className="reader-font-category-tabs" role="tablist" aria-label={t('font.category')} ref={categoryRef}>
          {fontCategories.map((item) => (
            <button
              className={`reader-font-category-tab ${activeCategory === item.key ? 'is-active' : ''}`}
              data-font-category={item.key}
              key={item.key}
              type="button"
            >
              {t(item.labelKey)}[{item.count}]
            </button>
          ))}
        </div>

        <div className="reader-font-grid" ref={fontGridRef}>
          {visibleFonts.length > 0 ? (
            visibleFonts.map((font) => (
              <button
                className={`reader-font-option ${selectedFont.id === font.id ? 'is-active' : ''}`}
                data-font-id={font.id}
                key={font.id}
                style={{
                  fontFamily: font.family || undefined,
                }}
                title={getReaderFontLabel(font)}
                type="button"
              >
                {getReaderFontLabel(font)}
              </button>
            ))
          ) : (
            <div className="reader-font-empty">{t('font.no_fonts')}</div>
          )}
        </div>
      </div>
    </div>
  );
};
