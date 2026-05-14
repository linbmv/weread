import type { ReaderBlock, TextSyntaxTree } from '@/lib/transformText';
import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import { db } from '@/store';
import { recordReaderReadingTime } from '@/lib/readerReadingTime';
import { READER_PROGRESS_STORE_NAME } from '@/lib/readerStoreNames';
import { clampRatio } from '@/lib/utils';

export interface ReaderLocator {
  bookId: string;
  page: number;
  blockId?: string;
  blockPageOffset?: number;
  blockScrollRatio?: number;
  titleId?: number;
  textBefore?: string;
  textAfter?: string;
  globalProgress?: number;
  lastReadAt?: number;
  readPercent?: number;
  totalReadingMs?: number;
  totalPageCount?: number;
  visiblePages?: number;
  readingMode?: 'paged' | 'scroll';
  updatedAt: number;
}

// V2 stores progress records in IndexedDB; the public store name intentionally has no version suffix.
const STORAGE_KEY = 'weread-reader-progress';

const clampPage = (page: number, totalPage: number): number => {
  return Math.min(Math.max(page, 0), Math.max(totalPage, 0));
};

const normalizeVisiblePages = (value?: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value || 1));
};

const getPagedReadPercent = (page: number, totalPage: number, visiblePages = 1): number => {
  const totalPageCount = Math.max(totalPage + 1, 1);
  const readPages = Math.min(Math.max(page, 0) + normalizeVisiblePages(visiblePages), totalPageCount);
  return Math.floor((readPages / totalPageCount) * 100);
};

const getScrollReadPercent = (globalProgress: number): number => {
  return Math.floor(clampRatio(globalProgress) * 100);
};

let progressMapCache: Record<string, ReaderLocator> = {};

const readProgressMap = (): Record<string, ReaderLocator> => {
  return progressMapCache;
};

const writeProgressMap = (value: Record<string, ReaderLocator>): void => {
  progressMapCache = value;
};

const persistReaderProgress = (locator: ReaderLocator): void => {
  void db.update<ReaderLocator>({
    data: locator,
    storeName: STORAGE_KEY,
  });
};

const getBlockPageEnd = (textSyntaxTree: TextSyntaxTree, blockId: string): number | undefined => {
  return textSyntaxTree.blockIdPageEnd?.[blockId] ?? textSyntaxTree.blockIdPage[blockId];
};

const getBlockTextQuote = (block: ReaderBlock | undefined): Pick<ReaderLocator, 'textAfter' | 'textBefore'> => {
  if (!block) return {};
  return {
    textAfter: block.text.slice(-80),
    textBefore: block.text.slice(0, 80),
  };
};

const getBlockGlobalProgress = (
  block: ReaderBlock | undefined,
  textSyntaxTree: TextSyntaxTree,
  ratio: number,
): number => {
  if (!block || textSyntaxTree.rawText.length <= 0) return 0;
  const blockLength = Math.max(block.end - block.start, 1);
  return clampRatio((block.start + blockLength * clampRatio(ratio)) / textSyntaxTree.rawText.length);
};

const getBlockPageOffset = (
  block: ReaderBlock | undefined,
  textSyntaxTree: TextSyntaxTree,
  ratio: number,
): number | undefined => {
  if (!block) return undefined;
  const startPage = textSyntaxTree.blockIdPage[block.id];
  if (startPage === undefined) return undefined;
  const endPage = getBlockPageEnd(textSyntaxTree, block.id) ?? startPage;
  return Math.round(clampRatio(ratio) * Math.max(endPage - startPage, 0));
};

const getBlockPage = (block: ReaderBlock | undefined, textSyntaxTree: TextSyntaxTree, ratio: number): number => {
  if (!block) return 0;
  const startPage = textSyntaxTree.blockIdPage[block.id];
  if (startPage === undefined) {
    const titlePage = block.titleId === undefined ? undefined : textSyntaxTree.titleIdPage[block.titleId];
    return typeof titlePage === 'number' ? titlePage : 0;
  }
  return clampPage(startPage + (getBlockPageOffset(block, textSyntaxTree, ratio) ?? 0), textSyntaxTree.totalPage || 0);
};

const findBlockByPage = (textSyntaxTree: TextSyntaxTree, page: number): ReaderBlock | undefined => {
  const blocks = textSyntaxTree.blocks || [];
  let nearestBlock: ReaderBlock | undefined;
  let nearestPage = -1;

  for (const block of blocks) {
    const startPage = textSyntaxTree.blockIdPage[block.id];
    if (startPage === undefined) continue;
    const endPage = getBlockPageEnd(textSyntaxTree, block.id) ?? startPage;

    if (startPage <= page && page <= endPage) {
      return block;
    }

    if (startPage <= page && startPage > nearestPage) {
      nearestBlock = block;
      nearestPage = startPage;
    }
  }

  return nearestBlock || blocks[0];
};

export const getReaderScrollAnchorY = (): number => {
  if (typeof window === 'undefined') return 0;
  return Math.min(Math.max(window.innerHeight * 0.28, 120), 220);
};

const findScrollAnchorElement = (
  contentElement: HTMLElement,
  anchorY: number,
): { element: HTMLElement; ratio: number } | undefined => {
  // Fast path: ask the browser which element is at anchorY (O(1) hit-test) and
  // walk to the nearest [data-reader-block-id]. Avoids reading bounding rects
  // for every block in long chapters (was the dominant cost during scroll save).
  if (typeof document !== 'undefined') {
    const containerRect = contentElement.getBoundingClientRect();
    const probeX = containerRect.left + containerRect.width / 2;
    const hit = document.elementFromPoint(probeX, anchorY);
    if (hit instanceof Element) {
      const block = hit.closest<HTMLElement>('[data-reader-block-id]');
      if (block && contentElement.contains(block)) {
        const rect = block.getBoundingClientRect();
        if (rect.height > 0) {
          return { element: block, ratio: clampRatio((anchorY - rect.top) / rect.height) };
        }
      }
    }
  }

  // Fallback: when anchorY lands in a paragraph gap or outside any block (e.g.
  // start/end of chapter), pick the nearest block by linear scan.
  const blockElements = Array.from(contentElement.querySelectorAll<HTMLElement>('[data-reader-block-id]'));
  let fallbackElement: HTMLElement | undefined;
  let fallbackRatio = 0;

  for (const element of blockElements) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) continue;

    if (rect.top <= anchorY && rect.bottom >= anchorY) {
      return {
        element,
        ratio: clampRatio((anchorY - rect.top) / rect.height),
      };
    }

    if (rect.top > anchorY) {
      return { element, ratio: 0 };
    }

    fallbackElement = element;
    fallbackRatio = 1;
  }

  return fallbackElement ? { element: fallbackElement, ratio: fallbackRatio } : undefined;
};

const findBlockByQuote = (
  textSyntaxTree: TextSyntaxTree,
  locator: Pick<ReaderLocator, 'textAfter' | 'textBefore'>,
): ReaderBlock | undefined => {
  const before = locator.textBefore?.trim();
  const after = locator.textAfter?.trim();
  if (!before && !after) return undefined;

  return textSyntaxTree.blocks.find((block) => {
    const beforeMatched = before ? block.text.includes(before) : true;
    const afterMatched = after ? block.text.includes(after) : true;
    return beforeMatched && afterMatched;
  });
};

export const createReaderLocator = ({
  bookId,
  page,
  textSyntaxTree,
  visiblePages,
}: {
  bookId: string;
  page: number;
  textSyntaxTree: TextSyntaxTree;
  visiblePages?: number;
}): ReaderLocator => {
  const safePage = clampPage(page, textSyntaxTree.totalPage || 0);
  const normalizedVisiblePages = normalizeVisiblePages(visiblePages);
  const block = findBlockByPage(textSyntaxTree, safePage);
  const startPage = block ? (textSyntaxTree.blockIdPage[block.id] ?? safePage) : safePage;
  const endPage = block ? (getBlockPageEnd(textSyntaxTree, block.id) ?? startPage) : startPage;
  const blockPageOffset = block ? clampPage(safePage - startPage, endPage - startPage) : undefined;
  const blockScrollRatio = block ? clampRatio((blockPageOffset ?? 0) / Math.max(endPage - startPage, 1)) : undefined;
  const globalProgress = textSyntaxTree.totalPage > 0 ? safePage / textSyntaxTree.totalPage : 0;
  const totalPageCount = Math.max((textSyntaxTree.totalPage || 0) + 1, 1);

  return {
    bookId,
    blockId: block?.id,
    blockPageOffset,
    blockScrollRatio,
    globalProgress,
    page: safePage,
    readPercent: getPagedReadPercent(safePage, textSyntaxTree.totalPage || 0, normalizedVisiblePages),
    readingMode: 'paged',
    titleId: block?.titleId,
    totalPageCount,
    updatedAt: Date.now(),
    visiblePages: normalizedVisiblePages,
    ...getBlockTextQuote(block),
  };
};

export const createReaderScrollLocator = ({
  anchorY,
  bookId,
  contentElement,
  textSyntaxTree,
}: {
  anchorY?: number;
  bookId: string;
  contentElement: HTMLElement | null;
  textSyntaxTree: TextSyntaxTree;
}): ReaderLocator | undefined => {
  if (!contentElement) return undefined;
  const resolvedAnchorY = typeof anchorY === 'number' && Number.isFinite(anchorY) ? anchorY : getReaderScrollAnchorY();
  const anchor = findScrollAnchorElement(contentElement, resolvedAnchorY);
  const blockId = anchor?.element.dataset.readerBlockId;
  const block = blockId ? textSyntaxTree.blocks.find((item) => item.id === blockId) : undefined;
  if (!block) return undefined;

  const blockScrollRatio = clampRatio(anchor?.ratio ?? 0);
  const globalProgress = getBlockGlobalProgress(block, textSyntaxTree, blockScrollRatio);
  return {
    blockId: block.id,
    blockPageOffset: getBlockPageOffset(block, textSyntaxTree, blockScrollRatio),
    blockScrollRatio,
    bookId,
    globalProgress,
    page: getBlockPage(block, textSyntaxTree, blockScrollRatio),
    readPercent: getScrollReadPercent(globalProgress),
    readingMode: 'scroll',
    titleId: block.titleId,
    totalPageCount: Math.max((textSyntaxTree.totalPage || 0) + 1, 1),
    updatedAt: Date.now(),
    ...getBlockTextQuote(block),
  };
};

export const resolveReaderLocatorPage = (locator: ReaderLocator, textSyntaxTree: TextSyntaxTree): number => {
  const totalPage = textSyntaxTree.totalPage || 0;
  const exactBlock = locator.blockId ? textSyntaxTree.blocks.find((block) => block.id === locator.blockId) : undefined;
  const block = exactBlock || findBlockByQuote(textSyntaxTree, locator);

  if (block) {
    const startPage = textSyntaxTree.blockIdPage[block.id];
    if (startPage !== undefined) {
      const endPage = getBlockPageEnd(textSyntaxTree, block.id) ?? startPage;
      const offset =
        locator.blockPageOffset ??
        Math.round(clampRatio(locator.blockScrollRatio ?? 0) * Math.max(endPage - startPage, 0));
      return clampPage(startPage + offset, totalPage);
    }
    if (exactBlock) {
      const titlePage = block.titleId === undefined ? undefined : textSyntaxTree.titleIdPage[block.titleId];
      return clampPage(typeof titlePage === 'number' ? titlePage : locator.page, totalPage);
    }
  }

  if (typeof locator.globalProgress === 'number' && Number.isFinite(locator.globalProgress)) {
    return clampPage(Math.round(locator.globalProgress * totalPage), totalPage);
  }

  return clampPage(locator.page, totalPage);
};

export const getReaderProgress = (bookId?: string | null): ReaderLocator | undefined => {
  if (!bookId) return undefined;
  return readProgressMap()[bookId];
};

export const hydrateReaderProgress = async (): Promise<void> => {
  const result = await db.readByCursor<ReaderLocator>({ storeName: READER_PROGRESS_STORE_NAME });
  if (result.error) return;
  const nextMap: Record<string, ReaderLocator> = {};
  result.data.forEach((locator) => {
    if (locator?.bookId) {
      nextMap[locator.bookId] = locator;
    }
  });
  writeProgressMap(nextMap);
  syncHook.call(EVENT_NAME.SET_READER_PROGRESS);
};

export const addReaderReadingTime = (
  bookId: string | undefined | null,
  durationMs: number,
  options: { endedAt?: number; startedAt?: number } = {},
): void => {
  if (!bookId || !Number.isFinite(durationMs) || durationMs <= 0) return;
  const map = readProgressMap();
  const previous = map[bookId];
  const endedAt = Number.isFinite(options.endedAt) ? (options.endedAt as number) : Date.now();
  const nextDuration = recordReaderReadingTime({
    bookId,
    durationMs,
    endedAt,
    page: previous?.page,
    readingMode: previous?.readingMode,
    startedAt: Number.isFinite(options.startedAt) ? (options.startedAt as number) : endedAt - durationMs,
    titleId: previous?.titleId,
  });
  if (nextDuration <= 0) return;
  const next = {
    ...(previous || {
      bookId,
      page: 0,
      updatedAt: endedAt,
    }),
    lastReadAt: endedAt,
    totalReadingMs: Math.max(0, Math.round(previous?.totalReadingMs || 0)) + nextDuration,
  };
  map[bookId] = next;
  writeProgressMap(map);
  persistReaderProgress(next);
  syncHook.call(EVENT_NAME.SET_READER_PROGRESS);
};

export const deleteReaderProgress = async (bookId: string): Promise<void> => {
  const map = readProgressMap();
  if (!(bookId in map)) return;
  delete map[bookId];
  writeProgressMap(map);
  syncHook.call(EVENT_NAME.SET_READER_PROGRESS);
  await db.delete({ key: bookId, storeName: STORAGE_KEY });
};

export const restoreReaderProgressForBook = async ({
  bookId,
  progress,
}: {
  bookId: string;
  progress?: ReaderLocator;
}): Promise<void> => {
  const map = readProgressMap();
  if (!progress) {
    delete map[bookId];
    writeProgressMap(map);
    await db.delete({ key: bookId, storeName: STORAGE_KEY });
    syncHook.call(EVENT_NAME.SET_READER_PROGRESS);
    return;
  }
  const next: ReaderLocator = {
    ...progress,
    bookId,
    updatedAt: Number.isFinite(progress.updatedAt) ? progress.updatedAt : Date.now(),
  };
  map[bookId] = next;
  writeProgressMap(map);
  await db.update<ReaderLocator>({
    data: next,
    storeName: STORAGE_KEY,
  });
  syncHook.call(EVENT_NAME.SET_READER_PROGRESS);
};

export const saveReaderProgress = (locator: ReaderLocator): void => {
  if (!locator.bookId) return;
  const map = readProgressMap();
  const previous = map[locator.bookId];
  const next = {
    ...locator,
    lastReadAt: locator.lastReadAt ?? previous?.lastReadAt,
    totalReadingMs: locator.totalReadingMs ?? previous?.totalReadingMs,
    updatedAt: Date.now(),
  };
  map[locator.bookId] = next;
  writeProgressMap(map);
  persistReaderProgress(next);
  if (
    !previous ||
    previous.titleId !== locator.titleId ||
    previous.page !== locator.page ||
    previous.readPercent !== locator.readPercent ||
    previous.readingMode !== locator.readingMode ||
    previous.totalPageCount !== locator.totalPageCount
  ) {
    syncHook.call(EVENT_NAME.SET_READER_PROGRESS);
  }
};
