import type { ReaderBlock } from '@/lib/transformText';

export interface ChapterPagination {
  chapterPageCount: number;
  blockIdLocalPage: Record<string, number>;
  blockIdLocalPageEnd: Record<string, number>;
  estimated: boolean;
}

export interface ChapterLayoutFingerprint {
  firstLineIndent: string;
  fontFamily: string;
  fontSize: number;
  pageWidth: number;
  pageHeight: number;
  pageGap: number;
  paragraphGap: number;
  lineHeight: number;
}

const CACHE_LIMIT = 256;

const cache = new Map<string, ChapterPagination>();

const fingerprintToString = (f: ChapterLayoutFingerprint): string => {
  return `${f.fontFamily}|${f.fontSize}|${f.firstLineIndent}|${f.pageWidth}|${f.pageHeight}|${f.pageGap}|${f.paragraphGap}|${f.lineHeight}`;
};

const buildCacheKey = (bookId: string, titleId: number, fingerprint: ChapterLayoutFingerprint): string => {
  return `${bookId}|${titleId}|${fingerprintToString(fingerprint)}`;
};

export const getCachedChapterPagination = (
  bookId: string | undefined,
  titleId: number,
  fingerprint: ChapterLayoutFingerprint,
): ChapterPagination | undefined => {
  if (!bookId) return undefined;
  const key = buildCacheKey(bookId, titleId, fingerprint);
  const value = cache.get(key);
  if (value === undefined) return undefined;
  // Refresh recency: re-insert to move the entry to the end.
  cache.delete(key);
  cache.set(key, value);
  return value;
};

export const setCachedChapterPagination = (
  bookId: string | undefined,
  titleId: number,
  fingerprint: ChapterLayoutFingerprint,
  pagination: ChapterPagination,
): void => {
  if (!bookId) return;
  const key = buildCacheKey(bookId, titleId, fingerprint);
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, pagination);
};

export const clearChapterPaginationCache = (bookId?: string, titleId?: number): void => {
  if (!bookId) {
    cache.clear();
    return;
  }
  const prefix = titleId === undefined ? `${bookId}|` : `${bookId}|${titleId}|`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

export const estimateChapterPageCount = (
  blocks: readonly ReaderBlock[],
  fingerprint: ChapterLayoutFingerprint,
): number => {
  const { fontSize, pageWidth, pageHeight, lineHeight, paragraphGap } = fingerprint;
  const usableHeight = Math.max(pageHeight, lineHeight);
  const linesPerPage = Math.max(1, Math.floor(usableHeight / Math.max(lineHeight, 1)));
  const charsPerLine = Math.max(1, Math.floor(pageWidth / Math.max(fontSize, 1)));
  const charsPerPage = linesPerPage * charsPerLine;
  if (charsPerPage <= 0) return 1;

  let blockBudget = 0;
  for (const block of blocks) {
    if (block.type === 'image') {
      blockBudget += usableHeight + paragraphGap;
      continue;
    }
    const lines = Math.max(1, Math.ceil(Math.max(block.text.length, 1) / charsPerLine));
    blockBudget += lines * lineHeight + paragraphGap;
  }
  const heightPerPage = linesPerPage * lineHeight;
  const pages = Math.ceil(blockBudget / Math.max(heightPerPage, 1));
  return Math.max(1, pages);
};

interface ElementPageRange {
  start: number;
  end: number;
}

const measureElementPageRange = (
  element: HTMLElement,
  flowRect: DOMRect,
  pageStep: number,
  lastPage: number,
): ElementPageRange | null => {
  const rects = Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;
  const pages = rects.map((rect) => {
    const relativeLeft = rect.left - flowRect.left;
    const candidate = Math.floor((relativeLeft + pageStep * 0.08) / pageStep);
    return Math.min(Math.max(candidate, 0), Math.max(lastPage, 0));
  });
  return { start: Math.min(...pages), end: Math.max(...pages) };
};

export const measureChapterPagination = (flow: HTMLElement, pageStep: number): ChapterPagination | null => {
  if (pageStep <= 0) return null;
  const scrollWidth = flow.scrollWidth;
  if (scrollWidth <= 0) return null;
  const chapterPageCount = Math.max(1, Math.ceil(scrollWidth / pageStep));
  const lastPage = chapterPageCount - 1;
  const blockIdLocalPage: Record<string, number> = {};
  const blockIdLocalPageEnd: Record<string, number> = {};
  const flowRect = flow.getBoundingClientRect();

  flow.querySelectorAll<HTMLElement>('[data-reader-block-id]').forEach((element) => {
    const blockId = element.dataset.readerBlockId;
    if (!blockId) return;
    const range = measureElementPageRange(element, flowRect, pageStep, lastPage);
    if (!range) return;
    blockIdLocalPage[blockId] = range.start;
    blockIdLocalPageEnd[blockId] = range.end;
  });

  return {
    chapterPageCount,
    blockIdLocalPage,
    blockIdLocalPageEnd,
    estimated: false,
  };
};
