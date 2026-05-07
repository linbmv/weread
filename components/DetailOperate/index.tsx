import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '@/components/popover';
import { BookDetailMenu } from '@/components/DetailMenu';
import {
  EVENT_NAME,
  getCurrentBookDetail,
  getPageNum,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
  syncHook,
} from '@/lib/subscribe';
import { type ReaderAnnotation, getAnnotationBlock, getReaderAnnotations } from '@/lib/readerAnnotations';
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_FONT_SIZE,
  DEFAULT_READER_PAGE_GAP_RATIO,
  DEFAULT_READER_SCROLL_PADDING_X,
  MAX_READER_FONT_SIZE,
  MAX_READER_PAGE_GAP_RATIO,
  MAX_READER_SCROLL_PADDING_X,
  MIN_READER_FONT_SIZE,
  MIN_READER_PAGE_GAP_RATIO,
  MIN_READER_SCROLL_PADDING_X,
  type ReaderFontSetting,
  type ReaderPageTurnEffect,
  type ReaderReadingMode,
  type ReaderTheme,
  applyReaderFont,
  applyReaderFontSize,
  applyReaderTheme,
  emitReaderSettingChange,
  getStoredReaderFont,
  getStoredReaderFontSize,
  getStoredReaderPageGapRatio,
  getStoredReaderPageTurnEffect,
  getStoredReaderReadingMode,
  getStoredReaderScrollPaddingX,
  getStoredReaderTheme,
  saveReaderFont,
  saveReaderFontSize,
  saveReaderPageGapRatio,
  saveReaderPageTurnEffect,
  saveReaderReadingMode,
  saveReaderScrollPaddingX,
  saveReaderTheme,
} from '@/lib/readerSettings';
import {
  OcticonBookmark,
  OcticonFont,
  OcticonMarker,
  OcticonMenu,
  OcticonMoon,
  OcticonNote,
  OcticonReadingMode,
  OcticonSun,
  OcticonUnderline,
  OcticonWave,
  OcticonWriteNote,
} from '@/components/Octicon';
import './index.scss';

type FontCategory = 'all' | 'canger' | 'fangzheng' | 'other';

type ReaderControlPanelType = 'font' | 'menu' | 'note' | 'setting';

interface BrowserLocalFont {
  family?: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
  blob?: () => Promise<Blob>;
}

const FONT_CATEGORY_ITEMS: { key: FontCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'canger', label: '仓耳' },
  { key: 'fangzheng', label: '方正' },
  { key: 'other', label: '其他' },
];

const PAGE_TURN_EFFECT_OPTIONS: { key: ReaderPageTurnEffect; label: string }[] = [
  { key: 'jump', label: '无' },
  { key: 'fade', label: '渐隐' },
  { key: 'scroll', label: '滚动' },
];

const READING_MODE_OPTIONS: { key: ReaderReadingMode; label: string }[] = [
  { key: 'paged', label: '双栏阅读' },
  { key: 'scroll', label: '上下滚动阅读' },
];

const FONT_SIZE_SLIDER_THUMB_SIZE = 26;

const FONT_SIZE_SLIDER_THUMB_RADIUS = FONT_SIZE_SLIDER_THUMB_SIZE / 2;

const FONT_SIZE_APPLY_DELAY = 300;

const SPACING_APPLY_DELAY = 300;

const PANEL_OFFSET = 8;

const PANEL_VIEWPORT_MARGIN = 16;

const PANEL_MOTION_DURATION = 140;

type ReaderControlPanelMotion = 'enter' | 'exit' | 'idle' | 'switch';

let readerSessionSystemFonts: ReaderFontSetting[] = [];

const clampReaderFontSize = (value: number): number => {
  return Math.min(Math.max(value, MIN_READER_FONT_SIZE), MAX_READER_FONT_SIZE);
};

const CHINESE_FONT_KEYWORDS = [
  'SimSun',
  'SimHei',
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'FangSong',
  'KaiTi',
  'STSong',
  'STKaiti',
  'STHeiti',
  'STFangsong',
  'PingFang',
  'Hiragino Sans GB',
  'Noto Sans CJK',
  'Source Han',
  'Songti',
  'Heiti',
  'Kaiti',
  'Yuanti',
  'WenQuanYi',
  'DengXian',
  'YouYuan',
  'LiSu',
  'Founder',
  'FZ',
];

const CHINESE_CHAR_PATTERN = /[\u4e00-\u9fff]/;

const FONT_NAME_IDS = new Set([1, 4, 16]);

const getFontLabel = (font: BrowserLocalFont): string => {
  const labels = [font.fullName, font.family, font.postscriptName].filter(Boolean) as string[];
  return (
    labels.find((label) => CHINESE_CHAR_PATTERN.test(label)) ||
    font.family ||
    font.fullName ||
    font.postscriptName ||
    ''
  );
};

const getFontSearchText = (font: BrowserLocalFont | ReaderFontSetting): string => {
  if ('label' in font) {
    return `${font.label} ${font.family}`;
  }
  return `${font.family || ''} ${font.fullName || ''} ${font.postscriptName || ''}`;
};

const isChineseFont = (font: BrowserLocalFont): boolean => {
  const text = getFontSearchText(font);
  const lowerText = text.toLowerCase();
  return (
    CHINESE_CHAR_PATTERN.test(text) ||
    CHINESE_FONT_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()))
  );
};

const readTag = (view: DataView, offset: number): string => {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
};

const decodeUtf16Be = (view: DataView, offset: number, length: number): string => {
  const chars: number[] = [];
  for (let index = 0; index + 1 < length; index += 2) {
    chars.push(view.getUint16(offset + index, false));
  }
  return String.fromCharCode(...chars);
};

const decodeFontName = (view: DataView, offset: number, length: number, platformId: number): string => {
  if (platformId === 0 || platformId === 3) {
    return decodeUtf16Be(view, offset, length);
  }

  const bytes = new Uint8Array(view.buffer, offset, length);
  try {
    return new TextDecoder(platformId === 1 ? 'macintosh' : 'utf-8').decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
};

const getTableRecord = (
  view: DataView,
  sfntOffset: number,
  tableName: string,
): { offset: number; length: number } | undefined => {
  if (sfntOffset + 12 > view.byteLength) return undefined;

  const tableCount = view.getUint16(sfntOffset + 4, false);
  for (let index = 0; index < tableCount; index++) {
    const recordOffset = sfntOffset + 12 + index * 16;
    if (recordOffset + 16 > view.byteLength) return undefined;
    if (readTag(view, recordOffset) === tableName) {
      return {
        offset: view.getUint32(recordOffset + 8, false),
        length: view.getUint32(recordOffset + 12, false),
      };
    }
  }

  return undefined;
};

const findFirstChineseFontName = (arrayBuffer: ArrayBuffer): string => {
  const view = new DataView(arrayBuffer);
  const sfntOffset = readTag(view, 0) === 'ttcf' && view.byteLength >= 16 ? view.getUint32(12, false) : 0;
  const nameTable = getTableRecord(view, sfntOffset, 'name');
  if (!nameTable || nameTable.offset + 6 > view.byteLength) return '';

  const recordCount = view.getUint16(nameTable.offset + 2, false);
  const stringStorageOffset = nameTable.offset + view.getUint16(nameTable.offset + 4, false);

  for (let index = 0; index < recordCount; index++) {
    const recordOffset = nameTable.offset + 6 + index * 12;
    if (recordOffset + 12 > view.byteLength) return '';

    const platformId = view.getUint16(recordOffset, false);
    const nameId = view.getUint16(recordOffset + 6, false);
    const length = view.getUint16(recordOffset + 8, false);
    const valueOffset = stringStorageOffset + view.getUint16(recordOffset + 10, false);

    if (!FONT_NAME_IDS.has(nameId) || valueOffset + length > view.byteLength) continue;

    const value = decodeFontName(view, valueOffset, length, platformId).replace(/\0/g, '').trim();
    if (CHINESE_CHAR_PATTERN.test(value)) return value;
  }

  return '';
};

const getLocalFontDisplayName = async (font: BrowserLocalFont): Promise<string> => {
  if (!font.blob) return '';

  try {
    const blob = await font.blob();
    return findFirstChineseFontName(await blob.arrayBuffer());
  } catch {
    return '';
  }
};

const normalizeLocalFonts = async (fonts: BrowserLocalFont[]): Promise<ReaderFontSetting[]> => {
  const fontMap = new Map<string, ReaderFontSetting>();
  const resolvedFonts = await Promise.all(
    fonts.map(async (font) => {
      const parsedLabel = isChineseFont(font) ? await getLocalFontDisplayName(font) : '';
      const label = (parsedLabel || getFontLabel(font)).trim();
      return { font, label };
    }),
  );

  resolvedFonts.forEach(({ font, label }) => {
    if (!label) return;
    const searchText = `${label} ${getFontSearchText(font)}`;
    const lowerSearchText = searchText.toLowerCase();
    const shouldShow =
      CHINESE_CHAR_PATTERN.test(searchText) ||
      CHINESE_FONT_KEYWORDS.some((keyword) => lowerSearchText.includes(keyword.toLowerCase()));

    if (!shouldShow && !isChineseFont(font)) return;

    const family = (font.family || label).trim();
    const key = family.toLowerCase();
    if (fontMap.has(key)) return;
    fontMap.set(key, {
      id: `system-${key}`,
      label,
      family,
      source: 'system',
    });
  });

  return Array.from(fontMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
};

const getFontCategory = (font: ReaderFontSetting): FontCategory => {
  if (font.source === 'default') return 'other';
  const text = getFontSearchText(font);
  if (text.includes('仓耳') || /Canger|Tsanger/i.test(text)) return 'canger';
  if (text.includes('方正') || /FangZheng|Founder|\bFZ/i.test(text)) return 'fangzheng';
  return 'other';
};

const mergeReaderFonts = (...fontLists: ReaderFontSetting[][]): ReaderFontSetting[] => {
  const fontMap = new Map<string, ReaderFontSetting>();
  fontLists.flat().forEach((font) => {
    fontMap.set(font.id, font);
  });
  return Array.from(fontMap.values());
};

const ReaderMenuIcon = (): React.JSX.Element => <OcticonMenu />;

const ReaderNoteIcon = (): React.JSX.Element => <OcticonNote />;

const ReaderSettingIcon = (): React.JSX.Element => <OcticonReadingMode />;

const ReaderFontIcon = (): React.JSX.Element => <OcticonFont />;

const ReaderSunIcon = (): React.JSX.Element => <OcticonSun />;

const ReaderMoonIcon = (): React.JSX.Element => <OcticonMoon />;

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

  // mode 切换时立即提交未决保存，并重新读取双侧 storage
  useEffect(() => {
    flushPendingApply();
    setPageGapRatio(getStoredReaderPageGapRatio());
    setScrollPaddingX(getStoredReaderScrollPaddingX());
  }, [readingMode, flushPendingApply]);

  // unmount 时提交未决保存，避免拖动尾巴丢失
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

const ReaderSettingControlPanel = (): React.JSX.Element => {
  const pageTurnOptionRef = useRef<HTMLDivElement>(null);
  const readingModeOptionRef = useRef<HTMLDivElement>(null);
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);
  const [readingMode, setReadingMode] = useState<ReaderReadingMode>(getStoredReaderReadingMode);

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
      setReadingMode(mode);
      saveReaderReadingMode(mode);
      emitReaderSettingChange();
      syncHook.call(EVENT_NAME.CLOSE_POPOVER);
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

const ReaderFontControlPanel = (): React.JSX.Element => {
  const accessButtonRef = useRef<HTMLButtonElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const fontGridRef = useRef<HTMLDivElement>(null);
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
      setFontAccessMessage('需要 localhost 或 HTTPS');
      return;
    }

    const queryLocalFonts = (window as Window & { queryLocalFonts?: () => Promise<BrowserLocalFont[]> })
      .queryLocalFonts;

    if (!queryLocalFonts) {
      setFontAccessMessage('当前浏览器不支持本地字体访问');
      return;
    }

    setIsLoadingFonts(true);
    setFontAccessMessage('正在请求字体权限...');

    try {
      const fonts = await queryLocalFonts.call(window);
      const localFonts = await normalizeLocalFonts(fonts);
      readerSessionSystemFonts = localFonts;
      setSystemFonts(localFonts);
      setFontAccessMessage(localFonts.length > 0 ? '' : '未找到中文系统字体');
    } catch {
      setFontAccessMessage('未授权访问系统字体');
    } finally {
      setIsLoadingFonts(false);
    }
  }, []);

  useEffect(() => {
    const accessButton = accessButtonRef.current;
    if (!accessButton) return;
    const onClick = () => {
      void requestSystemFonts();
    };
    accessButton.addEventListener('click', onClick);
    return () => {
      accessButton.removeEventListener('click', onClick);
    };
  }, [requestSystemFonts]);

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
        <div className="reader-font-panel-title">字号大小</div>
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
            aria-label="字号大小"
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
          <div className="reader-font-panel-title">字体</div>
          <div className="reader-font-action-area">
            {fontAccessMessage && <span className="reader-font-access-message">{fontAccessMessage}</span>}
            <button ref={accessButtonRef} className="reader-font-access-button" disabled={isLoadingFonts} type="button">
              {isLoadingFonts ? '获取中...' : '获取系统字体'}
            </button>
          </div>
        </div>

        <div className="reader-font-category-tabs" role="tablist" aria-label="字体分类" ref={categoryRef}>
          {fontCategories.map((item) => (
            <button
              className={`reader-font-category-tab ${activeCategory === item.key ? 'is-active' : ''}`}
              data-font-category={item.key}
              key={item.key}
              type="button"
            >
              {item.label}[{item.count}]
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
                title={font.label}
                type="button"
              >
                {font.label}
              </button>
            ))
          ) : (
            <div className="reader-font-empty">暂无字体</div>
          )}
        </div>
      </div>
    </div>
  );
};

const writePanelClipboardText = async (text: string): Promise<boolean> => {
  if (!text) return false;

  try {
    const clipboard = window.navigator.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {}

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};

const getAnnotationPanelLabel = (annotation: ReaderAnnotation): string => {
  if (annotation.type === 'note' && annotation.noteText) return annotation.noteText;
  return annotation.text;
};

const formatReaderNoteCopyDate = (value: number): string => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const ReaderAnnotationMarkerPanelIcon = (): React.JSX.Element => <OcticonMarker />;

const ReaderAnnotationWavePanelIcon = (): React.JSX.Element => <OcticonWave />;

const ReaderAnnotationUnderlinePanelIcon = (): React.JSX.Element => <OcticonUnderline />;

const ReaderAnnotationNotePanelIcon = (): React.JSX.Element => <OcticonWriteNote />;

const ReaderAnnotationBookmarkPanelIcon = (): React.JSX.Element => <OcticonBookmark />;

const getAnnotationTypeIcon = (annotation: ReaderAnnotation): React.JSX.Element => {
  if (annotation.type === 'bookmark') return <ReaderAnnotationBookmarkPanelIcon />;
  if (annotation.type === 'note') return <ReaderAnnotationNotePanelIcon />;
  if (annotation.type === 'wave') return <ReaderAnnotationWavePanelIcon />;
  if (annotation.type === 'underline') return <ReaderAnnotationUnderlinePanelIcon />;
  return <ReaderAnnotationMarkerPanelIcon />;
};

const ReaderNotePanel = (): React.JSX.Element => {
  const [revision, setRevision] = useState(0);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const bookDetail = getCurrentBookDetail();
  const textSyntaxTree = getTextSyntaxTree();
  const annotations = useMemo(() => getReaderAnnotations(bookDetail?.id), [bookDetail?.id, revision]);

  const blockIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    textSyntaxTree.blocks.forEach((block, index) => {
      map.set(block.id, index);
    });
    return map;
  }, [textSyntaxTree.blocks]);

  const groups = useMemo(() => {
    const titleOrder = new Map<number, number>();
    textSyntaxTree.sequences.forEach((sequence, index) => {
      titleOrder.set(sequence.titleId, index);
    });

    const grouped = new Map<number, ReaderAnnotation[]>();
    annotations.forEach((annotation) => {
      const block = getAnnotationBlock(textSyntaxTree, annotation);
      const titleId = annotation.titleId ?? block?.titleId ?? 0;
      const list = grouped.get(titleId);
      if (list) list.push(annotation);
      else grouped.set(titleId, [annotation]);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => (titleOrder.get(a[0]) ?? a[0]) - (titleOrder.get(b[0]) ?? b[0]))
      .map(([titleId, items]) => ({
        items: [...items].sort((a, b) => {
          const blockA = blockIndexMap.get(a.blockId) ?? 0;
          const blockB = blockIndexMap.get(b.blockId) ?? 0;
          return blockA - blockB || a.startOffset - b.startOffset || a.createdAt - b.createdAt;
        }),
        title: textSyntaxTree.titleIdTitle[titleId] || '正文',
        titleId,
      }));
  }, [annotations, blockIndexMap, textSyntaxTree]);

  const jumpToAnnotation = useCallback(
    (annotation: ReaderAnnotation) => {
      const block = getAnnotationBlock(textSyntaxTree, annotation);
      const titleId = annotation.titleId ?? block?.titleId ?? 0;
      const page =
        typeof annotation.page === 'number' && Number.isFinite(annotation.page)
          ? annotation.page
          : (textSyntaxTree.blockIdPage[annotation.blockId] ?? textSyntaxTree.titleIdPage[titleId] ?? getPageNum());

      setReaderNavigationTarget({
        blockId: annotation.blockId,
        matchStart: annotation.startOffset,
        page,
        revision: Date.now(),
        titleId,
      });
      if (Number.isFinite(page) && getPageNum() !== page) {
        setPageNum(page);
      }
      syncHook.call(EVENT_NAME.CLOSE_POPOVER);
    },
    [textSyntaxTree],
  );

  const copyAllNotes = useCallback(() => {
    if (annotations.length === 0) return;
    const lines: string[] = [`《${bookDetail?.title || '未命名书籍'}》 ${annotations.length}个笔记`];
    groups.forEach((group) => {
      lines.push(group.title);
      group.items.forEach((annotation) => {
        if (annotation.type === 'note' && annotation.noteText) {
          lines.push(
            `◆ ${formatReaderNoteCopyDate(annotation.createdAt)}发表想法 ${annotation.noteText} 原文：${annotation.text}`,
          );
          return;
        }
        lines.push(`◆ ${getAnnotationPanelLabel(annotation)}`);
      });
    });

    void writePanelClipboardText(lines.join('\n')).then((success) => {
      if (!success) return;
      setCopyToastVisible(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopyToastVisible(false);
        copyTimerRef.current = null;
      }, 1200);
    });
  }, [annotations.length, bookDetail?.title, groups]);

  useEffect(() => {
    const update = () => setRevision((prev) => prev + 1);
    syncHook.tap(EVENT_NAME.SET_READER_ANNOTATIONS, update);
    syncHook.tap(EVENT_NAME.SET_TEXT_SYNTAX_TREE, update);
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, update);
    return () => {
      syncHook.off(EVENT_NAME.SET_READER_ANNOTATIONS, update);
      syncHook.off(EVENT_NAME.SET_TEXT_SYNTAX_TREE, update);
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, update);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const copyToast =
    copyToastVisible && typeof document !== 'undefined'
      ? createPortal(<div className="reader-copy-toast">复制成功</div>, document.body)
      : null;

  return (
    <>
      {copyToast}
      <div className="reader-note-panel-wrapper">
        <div className="reader-note-panel-title">笔记</div>
        {annotations.length === 0 ? (
          <div className="reader-note-panel-empty">暂无笔记</div>
        ) : (
          <div className="reader-note-panel-list">
            {groups.map((group) => (
              <div className="reader-note-panel-group" key={group.titleId}>
                <div className="reader-note-panel-group-title">{group.title}</div>
                {group.items.map((annotation) => (
                  <button
                    className="reader-note-panel-item"
                    key={annotation.id}
                    type="button"
                    onClick={() => jumpToAnnotation(annotation)}
                  >
                    <span className="reader-note-panel-type-icon">{getAnnotationTypeIcon(annotation)}</span>
                    <span className="reader-note-panel-item-content">
                      <span className="reader-note-panel-item-text">{getAnnotationPanelLabel(annotation)}</span>
                      {annotation.type === 'note' && annotation.noteText ? (
                        <span className="reader-note-panel-item-quote">{annotation.text}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <button
          className="reader-note-panel-copy"
          disabled={annotations.length === 0}
          type="button"
          onClick={copyAllNotes}
        >
          复制全部笔记 · {annotations.length}
        </button>
      </div>
    </>
  );
};

const ReaderThemeControl = (): React.JSX.Element => {
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

    syncHook.call(EVENT_NAME.CLOSE_POPOVER);

    if (viewTransitionDocument.startViewTransition && !prefersReducedMotion) {
      viewTransitionDocument.startViewTransition(applyNextTheme);
      return;
    }

    applyNextTheme();
  };

  return (
    <button
      aria-label={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'}
      className="reader-control-button reader-theme-control"
      title={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'}
      type="button"
      onClick={toggleTheme}
    >
      {theme === 'dark' ? <ReaderSunIcon /> : <ReaderMoonIcon />}
    </button>
  );
};

interface ReaderControlPanelLayerProps {
  anchorElement: HTMLElement | null;
  children: React.ReactNode;
  motion: ReaderControlPanelMotion;
  motionId: number;
  panelType: ReaderControlPanelType | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
}

const ReaderControlPanelLayer = ({
  anchorElement,
  children,
  motion,
  motionId,
  panelType,
  panelRef,
}: ReaderControlPanelLayerProps): React.JSX.Element | null => {
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);

  const updatePosition = useCallback(() => {
    const panelElement = panelRef.current;
    if (!panelType || !anchorElement || !panelElement) return false;

    const anchorRect = anchorElement.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    const panelWidth = panelElement.offsetWidth || panelRect.width;
    const panelHeight = panelElement.offsetHeight || panelRect.height;
    if (panelWidth <= 1 || panelHeight <= 1) {
      setPanelPosition(null);
      return false;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, viewportWidth - panelWidth - PANEL_VIEWPORT_MARGIN);
    const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, viewportHeight - panelHeight - PANEL_VIEWPORT_MARGIN);
    const left = Math.min(Math.max(anchorRect.left - panelWidth - PANEL_OFFSET, PANEL_VIEWPORT_MARGIN), maxLeft);
    const top = Math.min(Math.max(anchorRect.top, PANEL_VIEWPORT_MARGIN), maxTop);

    setPanelPosition((prev) => (prev?.left === left && prev.top === top ? prev : { left, top }));
    return true;
  }, [anchorElement, panelRef, panelType]);

  useLayoutEffect(() => {
    if (!panelType) return;
    setPanelPosition(null);

    let firstFrame = 0;
    let secondFrame = 0;
    if (!updatePosition()) {
      firstFrame = window.requestAnimationFrame(() => {
        if (!updatePosition()) {
          secondFrame = window.requestAnimationFrame(updatePosition);
        }
      });
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [motionId, panelType, updatePosition]);

  useEffect(() => {
    if (!panelType) return;

    const onResize = () => {
      updatePosition();
    };

    window.addEventListener('resize', onResize);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && panelRef.current) {
      observer = new ResizeObserver(updatePosition);
      observer.observe(panelRef.current);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [panelRef, panelType, updatePosition]);

  if (!panelType) return null;

  return (
    <div className="reader-control-panel-layer">
      <div
        className="reader-control-panel"
        data-motion={motion}
        data-motion-id={motionId}
        data-reader-control-panel={panelType}
        ref={panelRef}
        style={
          {
            left: `${panelPosition?.left ?? 0}px`,
            top: `${panelPosition?.top ?? 0}px`,
            visibility: panelPosition ? 'visible' : 'hidden',
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
};

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
    }, PANEL_MOTION_DURATION);
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
    };
  }, [clearPanelCloseTimer]);

  useEffect(() => {
    if (!renderedPanel || panelMotion === 'exit' || panelMotion === 'idle') return;
    const timer = window.setTimeout(() => {
      setPanelMotion('idle');
    }, PANEL_MOTION_DURATION);
    return () => {
      window.clearTimeout(timer);
    };
  }, [panelMotion, panelMotionId, renderedPanel]);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.CLOSE_POPOVER, closePanel);
    return () => {
      syncHook.off(EVENT_NAME.CLOSE_POPOVER, closePanel);
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
        <button
          aria-label="打开目录"
          aria-expanded={activePanel === 'menu'}
          className="reader-control-button reader-menu-control"
          ref={menuButtonRef}
          title="目录"
          type="button"
          onClick={() => togglePanel('menu')}
        >
          <ReaderMenuIcon />
        </button>

        <button
          aria-label="打开笔记"
          aria-expanded={activePanel === 'note'}
          className="reader-control-button reader-note-control"
          ref={noteButtonRef}
          title="笔记"
          type="button"
          onClick={() => togglePanel('note')}
        >
          <ReaderNoteIcon />
        </button>

        <button
          aria-label="打开阅读设置"
          aria-expanded={activePanel === 'setting'}
          className="reader-control-button reader-setting-control"
          ref={settingButtonRef}
          title="阅读设置"
          type="button"
          onClick={() => togglePanel('setting')}
        >
          <ReaderSettingIcon />
        </button>

        <button
          aria-label="打开字体设置"
          aria-expanded={activePanel === 'font'}
          className="reader-control-button reader-font-control"
          ref={fontButtonRef}
          title="字体"
          type="button"
          onClick={() => togglePanel('font')}
        >
          <ReaderFontIcon />
        </button>

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

export const MobileBookDetailOperate = (): React.JSX.Element => {
  return (
    <div className="cursor-pointer">
      <Popover placement="top" trigger="click" overlay={<BookDetailMenu />}>
        <div className="reader-mobile-menu-trigger bg-front-bg-color-3 rounded-4xl flex items-center justify-center cursor-pointer">
          <ReaderMenuIcon />
        </div>
      </Popover>
    </div>
  );
};
