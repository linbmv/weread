import { hydrateReaderSettingCache, persistReaderSetting, readCachedReaderSetting } from '@/lib/readerSettingStore';

export type ReaderTheme = 'light' | 'dark';

export type ReaderFontSource = 'default' | 'system';

export type ReaderPageTurnEffect = 'fade' | 'jump' | 'scroll';

export type ReaderReadingMode = 'paged' | 'scroll';

export type ReaderFirstLineIndent = 'none' | 'indent';

export interface ReaderFontSetting {
  id: string;
  label: string;
  family: string;
  source: ReaderFontSource;
}

export const DEFAULT_READER_FONT_SIZE = 18;

export const MIN_READER_FONT_SIZE = 16;

export const MAX_READER_FONT_SIZE = 36;

export const DEFAULT_READER_PAGE_TURN_EFFECT: ReaderPageTurnEffect = 'jump';

export const DEFAULT_READER_READING_MODE: ReaderReadingMode = 'paged';

export const DEFAULT_READER_FIRST_LINE_INDENT: ReaderFirstLineIndent = 'none';

export const DEFAULT_READER_PAGE_GAP_RATIO = 1 / 9;

export const MIN_READER_PAGE_GAP_RATIO = 1 / 50;

export const MAX_READER_PAGE_GAP_RATIO = 9 / 50;

export const DEFAULT_READER_SCROLL_PADDING_X = 100;

export const MIN_READER_SCROLL_PADDING_X = 30;

export const MAX_READER_SCROLL_PADDING_X = 240;

export const READER_SETTING_CHANGE_EVENT = 'reader-setting-change';

export const DEFAULT_READER_FONT_FAMILY =
  'PingFang SC, -apple-system, SF UI Text, Lucida Grande, STheiti, Microsoft YaHei, sans-serif';

export const DEFAULT_READER_FONT: ReaderFontSetting = {
  id: 'default',
  label: 'Default',
  family: DEFAULT_READER_FONT_FAMILY,
  source: 'default',
};

const READER_THEME_STORAGE_KEY = 'weread-reader-theme';

const READER_FONT_STORAGE_KEY = 'weread-reader-font';

const READER_FONT_SIZE_STORAGE_KEY = 'weread-reader-font-size';

const READER_PAGE_TURN_EFFECT_STORAGE_KEY = 'weread-reader-page-turn-effect';

const READER_READING_MODE_STORAGE_KEY = 'weread-reader-reading-mode';

const READER_FIRST_LINE_INDENT_STORAGE_KEY = 'weread-reader-first-line-indent';

const READER_PAGE_GAP_RATIO_STORAGE_KEY = 'weread-reader-page-gap-ratio';

const READER_SCROLL_PADDING_X_STORAGE_KEY = 'weread-reader-scroll-padding-x';

const READER_FONT_FALLBACK = DEFAULT_READER_FONT_FAMILY;

let readerSettingChangeTimer: number | undefined;

const canUseDOM = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

const readStorage = (key: string): string | null => {
  return readCachedReaderSetting(key);
};

const writeStorage = (key: string, value: string): void => {
  persistReaderSetting(key, value);
};

const clampFontSize = (value: number): number => {
  return Math.min(Math.max(value, MIN_READER_FONT_SIZE), MAX_READER_FONT_SIZE);
};

const normalizePageTurnEffect = (value: unknown): ReaderPageTurnEffect => {
  return value === 'jump' || value === 'scroll' || value === 'fade' ? value : DEFAULT_READER_PAGE_TURN_EFFECT;
};

const normalizeReadingMode = (value: unknown): ReaderReadingMode => {
  return value === 'scroll' || value === 'paged' ? value : DEFAULT_READER_READING_MODE;
};

const normalizeFirstLineIndent = (value: unknown): ReaderFirstLineIndent => {
  return value === 'indent' ? 'indent' : DEFAULT_READER_FIRST_LINE_INDENT;
};

const getLineHeight = (fontSize: number): number => {
  return Math.round(fontSize * (40 / DEFAULT_READER_FONT_SIZE));
};

const getParagraphGap = (fontSize: number): number => {
  return 20 + Math.max(0, Math.floor((fontSize - 20) / 3));
};

const formatFontFamily = (family: string): string => {
  const value = family.trim();
  if (!value) return READER_FONT_FALLBACK;
  if (value === DEFAULT_READER_FONT_FAMILY) return DEFAULT_READER_FONT_FAMILY;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}", ${READER_FONT_FALLBACK}`;
};

export const getStoredReaderTheme = (): ReaderTheme => {
  return readStorage(READER_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
};

export const saveReaderTheme = (theme: ReaderTheme): void => {
  writeStorage(READER_THEME_STORAGE_KEY, theme);
};

export const applyReaderTheme = (theme: ReaderTheme): void => {
  if (!canUseDOM()) return;
  if (theme === 'dark') {
    document.documentElement.setAttribute('theme', 'dark');
    return;
  }
  document.documentElement.removeAttribute('theme');
};

export const getStoredReaderFont = (): ReaderFontSetting => {
  const value = readStorage(READER_FONT_STORAGE_KEY);
  if (!value) return DEFAULT_READER_FONT;
  try {
    const font = JSON.parse(value) as Partial<ReaderFontSetting>;
    if (font.id && font.label && typeof font.family === 'string') {
      if (font.id === DEFAULT_READER_FONT.id && font.source !== 'system') {
        return DEFAULT_READER_FONT;
      }
      return {
        id: font.id,
        label: font.label,
        family: font.family,
        source: font.source === 'system' ? 'system' : 'default',
      };
    }
  } catch {
    return DEFAULT_READER_FONT;
  }
  return DEFAULT_READER_FONT;
};

export const saveReaderFont = (font: ReaderFontSetting): void => {
  writeStorage(READER_FONT_STORAGE_KEY, JSON.stringify(font));
};

export const applyReaderFont = (font: ReaderFontSetting): void => {
  if (!canUseDOM()) return;
  document.documentElement.style.setProperty('--reader-font-family', formatFontFamily(font.family));
};

export const getStoredReaderFontSize = (): number => {
  const storedValue = readStorage(READER_FONT_SIZE_STORAGE_KEY);
  if (!storedValue) return DEFAULT_READER_FONT_SIZE;
  const value = Number(storedValue);
  if (!Number.isFinite(value)) return DEFAULT_READER_FONT_SIZE;
  return clampFontSize(value);
};

export const saveReaderFontSize = (fontSize: number): void => {
  writeStorage(READER_FONT_SIZE_STORAGE_KEY, `${clampFontSize(fontSize)}`);
};

export const getStoredReaderPageTurnEffect = (): ReaderPageTurnEffect => {
  return normalizePageTurnEffect(readStorage(READER_PAGE_TURN_EFFECT_STORAGE_KEY));
};

export const saveReaderPageTurnEffect = (effect: ReaderPageTurnEffect): void => {
  writeStorage(READER_PAGE_TURN_EFFECT_STORAGE_KEY, normalizePageTurnEffect(effect));
};

export const getStoredReaderReadingMode = (): ReaderReadingMode => {
  return normalizeReadingMode(readStorage(READER_READING_MODE_STORAGE_KEY));
};

export const saveReaderReadingMode = (mode: ReaderReadingMode): void => {
  writeStorage(READER_READING_MODE_STORAGE_KEY, normalizeReadingMode(mode));
};

export const getStoredReaderFirstLineIndent = (): ReaderFirstLineIndent => {
  return normalizeFirstLineIndent(readStorage(READER_FIRST_LINE_INDENT_STORAGE_KEY));
};

export const saveReaderFirstLineIndent = (value: ReaderFirstLineIndent): void => {
  writeStorage(READER_FIRST_LINE_INDENT_STORAGE_KEY, normalizeFirstLineIndent(value));
};

export const applyReaderFirstLineIndent = (value: ReaderFirstLineIndent): void => {
  if (!canUseDOM()) return;
  document.documentElement.style.setProperty(
    '--reader-paragraph-text-indent',
    normalizeFirstLineIndent(value) === 'indent' ? '2em' : '0',
  );
};

const clampPageGapRatio = (value: number): number => {
  return Math.min(Math.max(value, MIN_READER_PAGE_GAP_RATIO), MAX_READER_PAGE_GAP_RATIO);
};

const clampScrollPaddingX = (value: number): number => {
  return Math.min(Math.max(value, MIN_READER_SCROLL_PADDING_X), MAX_READER_SCROLL_PADDING_X);
};

export const getStoredReaderPageGapRatio = (): number => {
  const stored = readStorage(READER_PAGE_GAP_RATIO_STORAGE_KEY);
  if (!stored) return DEFAULT_READER_PAGE_GAP_RATIO;
  const value = Number(stored);
  if (!Number.isFinite(value)) return DEFAULT_READER_PAGE_GAP_RATIO;
  return clampPageGapRatio(value);
};

export const saveReaderPageGapRatio = (value: number): void => {
  writeStorage(READER_PAGE_GAP_RATIO_STORAGE_KEY, `${clampPageGapRatio(value)}`);
};

export const getStoredReaderScrollPaddingX = (): number => {
  const stored = readStorage(READER_SCROLL_PADDING_X_STORAGE_KEY);
  if (!stored) return DEFAULT_READER_SCROLL_PADDING_X;
  const value = Number(stored);
  if (!Number.isFinite(value)) return DEFAULT_READER_SCROLL_PADDING_X;
  return clampScrollPaddingX(value);
};

export const saveReaderScrollPaddingX = (value: number): void => {
  writeStorage(READER_SCROLL_PADDING_X_STORAGE_KEY, `${Math.round(clampScrollPaddingX(value))}`);
};

export const applyReaderFontSize = (fontSize: number): void => {
  if (!canUseDOM()) return;
  const normalizedFontSize = clampFontSize(fontSize);
  document.documentElement.style.setProperty('--reader-font-size', `${normalizedFontSize}px`);
  document.documentElement.style.setProperty('--reader-line-height', `${getLineHeight(normalizedFontSize)}px`);
  document.documentElement.style.setProperty('--reader-paragraph-gap', `${getParagraphGap(normalizedFontSize)}px`);
};

export const emitReaderSettingChange = (): void => {
  if (!canUseDOM()) return;
  if (readerSettingChangeTimer) {
    window.clearTimeout(readerSettingChangeTimer);
  }
  readerSettingChangeTimer = window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(READER_SETTING_CHANGE_EVENT));
  }, 120);
};

export const bootstrapReaderSettings = (): void => {
  if (!canUseDOM()) return;
  applyReaderTheme(getStoredReaderTheme());
  applyReaderFont(getStoredReaderFont());
  applyReaderFontSize(getStoredReaderFontSize());
  applyReaderFirstLineIndent(getStoredReaderFirstLineIndent());
};

export const hydrateReaderSettings = async (): Promise<void> => {
  await hydrateReaderSettingCache();
  bootstrapReaderSettings();
  emitReaderSettingChange();
};
