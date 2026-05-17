import type { ReaderFontSetting } from '@/lib/readerSettings';

export type FontCategory = 'all' | 'canger' | 'fangzheng' | 'other';

export interface BrowserLocalFont {
  family?: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
  blob?: () => Promise<Blob>;
}

export const FONT_CATEGORY_ITEMS: { key: FontCategory; labelKey: string }[] = [
  { key: 'all', labelKey: 'font.category.all' },
  { key: 'canger', labelKey: 'font.category.canger' },
  { key: 'fangzheng', labelKey: 'font.category.fangzheng' },
  { key: 'other', labelKey: 'font.category.other' },
];

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

export const normalizeLocalFonts = async (fonts: BrowserLocalFont[]): Promise<ReaderFontSetting[]> => {
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

export const getFontCategory = (font: ReaderFontSetting): FontCategory => {
  if (font.source === 'default') return 'other';
  const text = getFontSearchText(font);
  if (text.includes('仓耳') || /Canger|Tsanger/i.test(text)) return 'canger';
  if (text.includes('方正') || /FangZheng|Founder|\bFZ/i.test(text)) return 'fangzheng';
  return 'other';
};

export const mergeReaderFonts = (...fontLists: ReaderFontSetting[][]): ReaderFontSetting[] => {
  const fontMap = new Map<string, ReaderFontSetting>();
  fontLists.flat().forEach((font) => {
    fontMap.set(font.id, font);
  });
  return Array.from(fontMap.values());
};
