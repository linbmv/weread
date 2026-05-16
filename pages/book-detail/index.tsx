import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type NavigateFunction, useNavigate, useParams } from 'react-router-dom';
import { debounce } from 'ranuts/utils';
import { getBookById } from '@/store/books';
import type { BookInfo } from '@/store/books';
import type { ReaderBlock, TextSyntaxTree } from '@/lib/transformText';
import { ROUTE_PATH } from '@/router';
import { startSpaViewTransition } from '@/lib/navigation';
import { BookDetailOperate, MobileBookDetailOperate } from '@/components/DetailOperate';
import { clearBookDetailMenuSearchState } from '@/components/DetailMenu';
import {
  EVENT_NAME,
  getCurrentBookDetail,
  getPageNum,
  getReaderNavigationTarget,
  getReaderSearchHighlight,
  getTextSyntaxTree,
  setCurrentBookDetail,
  setPageNum,
  setReaderNavigationTarget,
  setTextSyntaxTree,
  syncHook,
} from '@/lib/subscribe';
import type { ReaderNavigationTarget } from '@/lib/subscribe';
import { resumeDB } from '@/store';
import { DEVICE_ENUM, useCheckDevice } from '@/lib/hooks';
import { useSyncHookEvents } from '@/lib/useSyncHookEvents';
import { Loading } from '@/components/Loading';
import { OcticonChevronLeft, OcticonChevronRight } from '@/components/Octicon';
import { t } from '@/locales';
import {
  DEFAULT_READER_PAGE_TURN_EFFECT,
  READER_SETTING_CHANGE_EVENT,
  type ReaderPageTurnEffect,
  type ReaderReadingMode,
  getStoredReaderPageGapRatio,
  getStoredReaderPageTurnEffect,
  getStoredReaderReadingMode,
  getStoredReaderScrollPaddingX,
} from '@/lib/readerSettings';
import {
  type ReaderAnnotation,
  deleteReaderAnnotation,
  getReaderBookmarkForPage,
  saveReaderBookmark,
  updateReaderBookmarkPage,
} from '@/lib/readerAnnotations';
import { releaseBookResourceUrls } from '@/lib/bookResources';
import {
  type ReaderLocator,
  createReaderLocator,
  getReaderProgress,
  resolveReaderLocatorPage,
  saveReaderProgress,
} from '@/lib/readerProgress';
import {
  type ChapterLayoutFingerprint,
  type ChapterPagination,
  clearChapterPaginationCache,
  estimateChapterPageCount,
  getCachedChapterPagination,
  measureChapterPagination,
  setCachedChapterPagination,
} from '@/lib/chapterPagination';
import {
  buildPageTitleId,
  getChapterBlocks,
  getFirstTitleId,
  getPageTitle,
  getReaderProgressTitleId,
  getScrollInitialTitleId,
  getTitleIdByPage,
  getTitlePage,
  hasCompleteChapterStartPages,
  isEmptyHeadingTitleBlocks,
  isValidTitleId,
} from '@/lib/reader/chapterStructure';
import {
  type ReaderLayout,
  areChapterImagesReadyForPagination,
  buildChapterLayoutFingerprint,
  chapterFingerprintEqual,
  getInitialPageWidth,
  getPagedSpreadStartPage,
  getVisiblePageCount,
} from '@/lib/reader/readerLayout';
import { getCachedTextSyntaxTree } from '@/lib/reader/textSyntaxTreeCache';
import { createPageBookmarkDraft, resolveRenderedBookmarkPage } from '@/lib/reader/bookmarkLocation';
import { preventReaderContextMenu } from '@/lib/reader/selectionUtils';
import { useReaderAnnotationsForBook } from '@/lib/reader/useReaderAnnotationsForBook';
import { useReaderSelectionOverlay } from '@/lib/reader/useReaderSelectionOverlay';
import { useReaderAnnotationActions } from '@/lib/reader/useReaderAnnotationActions';
import { useReaderReadingTimeTracker } from '@/lib/reader/useReaderReadingTimeTracker';
import { renderReaderBlock } from '@/components/Reader/ReaderBlock';
import { ReaderCopyToast, ReaderNoteModal, ReaderSelectionMenu } from '@/components/Reader/ReaderSelectionMenu';
import { ReaderPageBookmarkControl } from '@/components/Reader/ReaderPageBookmark';
import { ReaderScrollContent } from '@/components/Reader/ReaderScrollContent';
import 'ranui/icon';
import 'ranui/input';
import './index.scss';

const BOOK_DETAIL_UI_EVENTS = [
  EVENT_NAME.SET_CURRENT_BOOK_DETAIL,
  EVENT_NAME.SET_READER_NAVIGATION_TARGET,
  EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT,
  EVENT_NAME.SET_TEXT_SYNTAX_TREE,
] as const;

const MOBILE_BOOK_DETAIL_UI_EVENTS = [
  EVENT_NAME.SET_CURRENT_BOOK_DETAIL,
  EVENT_NAME.SET_READER_NAVIGATION_TARGET,
  EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT,
  EVENT_NAME.SET_TEXT_SYNTAX_TREE,
] as const;

const BOOK_DETAIL_PAGE_EVENTS = [EVENT_NAME.SET_CURRENT_BOOK_PAGE] as const;

const MOBILE_ICON_STYLE = {
  '--ran-icon-font-size': '36px',
  '--ran-icon-color': 'var(--icon-color-1)',
};

const useReaderBookId = (): string | undefined => {
  const { bookId } = useParams<{ bookId: string }>();
  return bookId;
};

const ReaderPagePreviousIcon = (): React.JSX.Element => <OcticonChevronLeft className="reader-page-nav-icon" />;

const ReaderPageNextIcon = (): React.JSX.Element => <OcticonChevronRight className="reader-page-nav-icon" />;

interface ReaderPagedContentProps {
  textSyntaxTree: TextSyntaxTree;
  pageNum: number;
  visiblePages: 1 | 2;
  bookId?: string;
  className?: string;
  pageTurnEffect?: ReaderPageTurnEffect;
  style?: CSSProperties;
  navigationTarget?: ReaderNavigationTarget;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
}

const hasRecordChanged = (prev: Record<string, number>, next: Record<string, number>): boolean => {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;
  return nextKeys.some((key) => prev[key] !== next[key]);
};

const hasArrayChanged = (prev: number[], next: number[]): boolean => {
  if (prev.length !== next.length) return true;
  return next.some((value, index) => prev[index] !== value);
};

const runPageTurn = (effect: ReaderPageTurnEffect, update: () => void): void => {
  if (typeof document === 'undefined') {
    update();
    return;
  }

  const viewTransitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };

  if (effect !== 'fade' || !viewTransitionDocument.startViewTransition) {
    update();
    return;
  }

  const transition = viewTransitionDocument.startViewTransition(() => {
    update();
  });
  void transition.finished.catch(() => undefined);
};

const ReaderPagedContent = ({
  textSyntaxTree,
  pageNum,
  visiblePages,
  bookId,
  className,
  pageTurnEffect = DEFAULT_READER_PAGE_TURN_EFFECT,
  style,
  navigationTarget,
  onClick,
  onTouchEnd,
  onTouchStart,
}: ReaderPagedContentProps): React.JSX.Element => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLElement>(null);
  const annotations = useReaderAnnotationsForBook(bookId);
  const {
    clearSelection,
    copySelection,
    menuState: selectionMenuState,
    overlayRef: selectionOverlayRef,
  } = useReaderSelectionOverlay(flowRef, annotations);
  const {
    annotationColors,
    handleApplyAnnotation,
    handleCancelNote,
    handleDeleteAnnotation,
    handleDeleteNote,
    handleOpenNote,
    handleSaveNote,
    handleSearchSelection,
    handleSelectColor,
    noteEditorState,
  } = useReaderAnnotationActions({ bookId, clearSelection, selectionMenuState });
  const pendingLocatorRef = useRef<ReaderLocator | null>(null);
  const visiblePagesRef = useRef(visiblePages);
  const measureFrameRef = useRef<number | null>(null);
  const contentMeasureFrameRef = useRef<number | null>(null);
  const paginationMeasureFrameRef = useRef<number | null>(null);
  const settledMeasureTimerRef = useRef<number | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<ReaderLayout>({ pageWidth: 0, pageGap: 0, pageStep: 0, pageHeight: 0 });
  const [fingerprint, setFingerprint] = useState<ChapterLayoutFingerprint>(() =>
    buildChapterLayoutFingerprint({ pageWidth: 0, pageGap: 0, pageStep: 0, pageHeight: 0 }),
  );
  const [chapterPaginations, setChapterPaginations] = useState<Map<number, ChapterPagination>>(() => new Map());
  const [contentMeasureRevision, setContentMeasureRevision] = useState(0);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const [bookmarkLayerElement, setBookmarkLayerElement] = useState<HTMLElement | null>(null);

  const blocks = textSyntaxTree.blocks;
  const blocksByTitleId = textSyntaxTree.blocksByTitleId;
  const readerSearchHighlight = getReaderSearchHighlight();
  const searchKeyword = readerSearchHighlight.hasResult ? readerSearchHighlight.keyword : '';
  const annotationsByBlockId = useMemo(() => {
    const map = new Map<string, ReaderAnnotation[]>();
    annotations.forEach((annotation) => {
      if (annotation.type === 'bookmark') return;
      const list = map.get(annotation.blockId);
      if (list) list.push(annotation);
      else map.set(annotation.blockId, [annotation]);
    });
    return map;
  }, [annotations]);
  const currentBookmark = useMemo(() => {
    if (!bookId) return undefined;
    const spreadStart = getPagedSpreadStartPage(pageNum, visiblePages);
    for (let offset = 0; offset < visiblePages; offset += 1) {
      const bookmark = getReaderBookmarkForPage(bookId, spreadStart + offset);
      if (bookmark) return bookmark;
    }
    return undefined;
  }, [annotations, bookId, pageNum, visiblePages]);

  useLayoutEffect(() => {
    const nextElement = viewportRef.current?.closest<HTMLElement>('.book-info-container') ?? viewportRef.current;
    setBookmarkLayerElement((prev) => (prev === nextElement ? prev : nextElement));
  }, []);

  const showCopyToast = useCallback(() => {
    if (copyToastTimerRef.current) {
      window.clearTimeout(copyToastTimerRef.current);
    }
    setCopyToastVisible(true);
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToastVisible(false);
      copyToastTimerRef.current = null;
    }, 1400);
  }, [visiblePages]);

  const handleCopySelection = useCallback(() => {
    const copyResult = copySelection();
    clearSelection();
    copyResult.then((copied) => {
      if (copied) showCopyToast();
    });
  }, [clearSelection, copySelection, showCopyToast]);

  const addCurrentPageBookmark = useCallback(() => {
    if (!bookId) return;
    const spreadStart = getPagedSpreadStartPage(pageNum, visiblePages);
    for (let offset = 0; offset < visiblePages; offset += 1) {
      if (getReaderBookmarkForPage(bookId, spreadStart + offset)) return;
    }

    const draft = createPageBookmarkDraft({
      flow: flowRef.current,
      layout,
      page: spreadStart,
      viewport: viewportRef.current,
    });
    if (draft) {
      saveReaderBookmark(bookId, draft);
    }
  }, [bookId, layout, pageNum, visiblePages]);

  const togglePageBookmark = useCallback(() => {
    if (!bookId) return;
    if (currentBookmark) {
      deleteReaderAnnotation(bookId, currentBookmark.id);
      return;
    }
    addCurrentPageBookmark();
  }, [addCurrentPageBookmark, bookId, currentBookmark, visiblePages]);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.ADD_READER_PAGE_BOOKMARK, addCurrentPageBookmark);
    return () => {
      syncHook.off(EVENT_NAME.ADD_READER_PAGE_BOOKMARK, addCurrentPageBookmark);
    };
  }, [addCurrentPageBookmark]);

  const titleIdSequence = useMemo(() => {
    if (textSyntaxTree.sequences.length > 0) {
      return textSyntaxTree.sequences.map((s) => s.titleId);
    }
    return textSyntaxTree.titleIdTitle.map((_, i) => i);
  }, [textSyntaxTree.sequences, textSyntaxTree.titleIdTitle]);

  const { chapterStartPages, totalPage } = useMemo(() => {
    const starts: Record<number, number> = {};
    if (fingerprint.pageWidth <= 0 || fingerprint.pageHeight <= 0 || titleIdSequence.length === 0) {
      return { chapterStartPages: starts, totalPage: 0 };
    }
    const isTwoColumn = visiblePages === 2;
    let acc = 0;
    for (const tid of titleIdSequence) {
      if (isTwoColumn && acc % 2 !== 0) acc += 1;
      starts[tid] = acc;
      const chapterBlocks = blocksByTitleId.get(tid) ?? [];
      // 空卷标题章节由 getChapterBlocks 合并到下一章渲染，自身不占 globalPage
      if (isEmptyHeadingTitleBlocks(chapterBlocks)) continue;
      const cp = chapterPaginations.get(tid);
      if (cp) {
        acc += cp.chapterPageCount;
      } else if (chapterBlocks.length === 0) {
        acc += 1;
      } else {
        acc += estimateChapterPageCount(chapterBlocks, fingerprint);
      }
    }
    return { chapterStartPages: starts, totalPage: Math.max(0, acc - 1) };
  }, [titleIdSequence, chapterPaginations, blocksByTitleId, fingerprint, visiblePages]);

  const { currentTitleId, currentLocalPage } = useMemo(() => {
    if (titleIdSequence.length === 0) {
      return { currentTitleId: undefined as number | undefined, currentLocalPage: 0 };
    }
    if (!hasCompleteChapterStartPages(titleIdSequence, chapterStartPages)) {
      const fallbackTitleId =
        getReaderProgressTitleId(bookId, textSyntaxTree) ?? getTitleIdByPage(textSyntaxTree, pageNum);
      const currentTitleId = titleIdSequence.includes(fallbackTitleId) ? fallbackTitleId : titleIdSequence[0];
      const fallbackStart = textSyntaxTree.titleIdPage[currentTitleId] ?? 0;
      return {
        currentLocalPage: Math.max(0, pageNum - fallbackStart),
        currentTitleId,
      };
    }
    let titleId: number = titleIdSequence[0];
    let localPage = 0;
    for (let i = 0; i < titleIdSequence.length; i++) {
      const tid = titleIdSequence[i];
      const start = chapterStartPages[tid] ?? 0;
      const nextStart =
        i + 1 < titleIdSequence.length ? (chapterStartPages[titleIdSequence[i + 1]] ?? totalPage + 1) : totalPage + 1;
      if (pageNum >= start && pageNum < nextStart) {
        return { currentTitleId: tid, currentLocalPage: Math.max(0, pageNum - start) };
      }
      if (i === titleIdSequence.length - 1) {
        titleId = tid;
        localPage = Math.max(0, pageNum - start);
      }
    }
    return { currentTitleId: titleId, currentLocalPage: localPage };
  }, [bookId, pageNum, textSyntaxTree, titleIdSequence, chapterStartPages, totalPage]);

  const currentChapterBlocks = useMemo(() => {
    if (currentTitleId === undefined) return [] as ReaderBlock[];
    return getChapterBlocks(textSyntaxTree, currentTitleId);
  }, [textSyntaxTree, currentTitleId]);
  const currentChapterBlockIds = useMemo(
    () => new Set(currentChapterBlocks.map((block) => block.id)),
    [currentChapterBlocks],
  );
  const currentChapterImageCount = useMemo(
    () => currentChapterBlocks.filter((block) => block.type === 'image').length,
    [currentChapterBlocks],
  );

  const currentChapterPagination = currentTitleId !== undefined ? chapterPaginations.get(currentTitleId) : undefined;
  const safeLocalPage = currentChapterPagination
    ? Math.min(Math.max(0, currentLocalPage), Math.max(0, currentChapterPagination.chapterPageCount - 1))
    : Math.max(0, currentLocalPage);
  const chapterStartsComplete = hasCompleteChapterStartPages(titleIdSequence, chapterStartPages);

  useLayoutEffect(() => {
    const spreadStart = getPagedSpreadStartPage(pageNum, visiblePages);
    if (spreadStart !== pageNum) {
      setPageNum(spreadStart);
    }
  }, [pageNum, visiblePages]);

  const getCurrentLocator = useCallback((): ReaderLocator | undefined => {
    if (!bookId) return undefined;
    const currentTree = getTextSyntaxTree();
    if (!currentTree.rawText || currentTree.blocks.length === 0) return undefined;
    return createReaderLocator({
      bookId,
      page: getPageNum(),
      textSyntaxTree: currentTree,
      visiblePages,
    });
  }, [bookId, visiblePages]);

  const rememberCurrentLocator = useCallback(() => {
    const locator = getCurrentLocator();
    if (locator) {
      pendingLocatorRef.current = locator;
    }
  }, [getCurrentLocator]);

  const clearPendingLocator = useCallback(() => {
    pendingLocatorRef.current = null;
  }, []);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.CLEAR_READER_PENDING_LOCATOR, clearPendingLocator);
    return () => {
      syncHook.off(EVENT_NAME.CLEAR_READER_PENDING_LOCATOR, clearPendingLocator);
    };
  }, [clearPendingLocator]);

  const runMeasureLayout = useCallback(() => {
    const viewport = viewportRef.current;
    const flow = flowRef.current;
    if (!viewport || !flow) return;

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (viewportWidth < 30 || viewportHeight < 30) return;

    const pageGap = visiblePages === 2 ? Math.floor(viewportWidth * getStoredReaderPageGapRatio()) : 0;
    const pageWidth = visiblePages === 2 ? Math.floor((viewportWidth - pageGap) / 2) : viewportWidth;
    const pageStep = pageWidth + pageGap;
    const nextLayout: ReaderLayout = { pageWidth, pageGap, pageStep, pageHeight: viewportHeight };

    flow.style.setProperty('--reader-page-width', `${pageWidth}px`);
    flow.style.setProperty('--reader-page-gap', `${pageGap}px`);
    flow.style.setProperty('--reader-page-height', `${viewportHeight}px`);
    flow.style.width = `${pageWidth}px`;

    setLayout((prev) => {
      if (
        prev.pageWidth === pageWidth &&
        prev.pageGap === pageGap &&
        prev.pageStep === pageStep &&
        prev.pageHeight === viewportHeight
      ) {
        return prev;
      }
      return nextLayout;
    });

    const nextFingerprint = buildChapterLayoutFingerprint(nextLayout);
    setFingerprint((prev) => (chapterFingerprintEqual(prev, nextFingerprint) ? prev : nextFingerprint));
  }, [visiblePages]);

  const scheduleMeasureLayout = useCallback(
    ({ includeSettledPass = false, rememberLocator = false } = {}) => {
      if (rememberLocator && !pendingLocatorRef.current) {
        rememberCurrentLocator();
      }

      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
      }
      measureFrameRef.current = window.requestAnimationFrame(() => {
        measureFrameRef.current = null;
        runMeasureLayout();
      });

      if (includeSettledPass) {
        if (settledMeasureTimerRef.current !== null) {
          window.clearTimeout(settledMeasureTimerRef.current);
        }
        settledMeasureTimerRef.current = window.setTimeout(() => {
          settledMeasureTimerRef.current = null;
          if (measureFrameRef.current !== null) {
            window.cancelAnimationFrame(measureFrameRef.current);
          }
          measureFrameRef.current = window.requestAnimationFrame(() => {
            measureFrameRef.current = null;
            runMeasureLayout();
          });
        }, 180);
      }
    },
    [rememberCurrentLocator, runMeasureLayout],
  );

  const scheduleContentPaginationMeasure = useCallback(() => {
    if (currentTitleId === undefined) return;
    clearChapterPaginationCache(bookId, currentTitleId);
    setChapterPaginations((prev) => {
      if (!prev.has(currentTitleId)) return prev;
      const next = new Map(prev);
      next.delete(currentTitleId);
      return next;
    });

    if (contentMeasureFrameRef.current !== null) {
      window.cancelAnimationFrame(contentMeasureFrameRef.current);
    }
    contentMeasureFrameRef.current = window.requestAnimationFrame(() => {
      contentMeasureFrameRef.current = null;
      setContentMeasureRevision((revision) => revision + 1);
      scheduleMeasureLayout({ includeSettledPass: true });
    });
  }, [bookId, currentTitleId, scheduleMeasureLayout]);

  const fingerprintRef = useRef(fingerprint);

  // 章节级测量：currentTitleId / fingerprint / layout.pageStep / 当前章 blocks 变化时
  // fingerprint 变化时同步在本 effect 内清空旧分页 state，避免 useEffect 异步清空与 layoutEffect 测量之间的时序竞争
  useLayoutEffect(() => {
    if (paginationMeasureFrameRef.current !== null) {
      window.cancelAnimationFrame(paginationMeasureFrameRef.current);
      paginationMeasureFrameRef.current = null;
    }
    if (currentTitleId === undefined) return;
    if (layout.pageStep <= 0) return;
    const flow = flowRef.current;
    if (!flow) return;

    const fingerprintChanged = !chapterFingerprintEqual(fingerprintRef.current, fingerprint);
    if (fingerprintChanged) {
      fingerprintRef.current = fingerprint;
    }

    const restoreCachedPaginationBase = fingerprintChanged
      ? () => {
          const base = new Map<number, ChapterPagination>();
          for (const tid of titleIdSequence) {
            const tidCached = getCachedChapterPagination(bookId, tid, fingerprint);
            if (tidCached) base.set(tid, tidCached);
          }
          return base;
        }
      : undefined;

    if (!areChapterImagesReadyForPagination(flow, currentChapterImageCount)) {
      clearChapterPaginationCache(bookId, currentTitleId);
      setChapterPaginations((prev) => {
        const current = prev.get(currentTitleId);
        if (!current || current.chapterPageCount > 1 || currentChapterImageCount <= 1) {
          if (!fingerprintChanged) return prev;
          return prev.size === 0 ? prev : restoreCachedPaginationBase ? restoreCachedPaginationBase() : new Map();
        }
        const next = restoreCachedPaginationBase ? restoreCachedPaginationBase() : new Map(prev);
        next.delete(currentTitleId);
        return next;
      });
      return;
    }

    const cached = getCachedChapterPagination(bookId, currentTitleId, fingerprint);
    if (cached) {
      setChapterPaginations((prev) => {
        if (!fingerprintChanged && prev.get(currentTitleId) === cached) return prev;
        const base = restoreCachedPaginationBase ? restoreCachedPaginationBase() : new Map(prev);
        base.set(currentTitleId, cached);
        return base;
      });
      return;
    }

    if (fingerprintChanged) {
      setChapterPaginations((prev) => {
        if (prev.size === 0) return prev;
        return restoreCachedPaginationBase ? restoreCachedPaginationBase() : new Map();
      });
    }

    if (paginationMeasureFrameRef.current !== null) {
      window.cancelAnimationFrame(paginationMeasureFrameRef.current);
    }
    paginationMeasureFrameRef.current = window.requestAnimationFrame(() => {
      paginationMeasureFrameRef.current = null;
      const currentFlow = flowRef.current;
      if (!currentFlow || currentFlow !== flow) return;
      const result = measureChapterPagination(currentFlow, layout.pageStep);
      if (!result) return;
      setCachedChapterPagination(bookId, currentTitleId, fingerprint, result);
      setChapterPaginations((prev) => {
        const base = restoreCachedPaginationBase ? restoreCachedPaginationBase() : new Map(prev);
        base.set(currentTitleId, result);
        return base;
      });
    });
  }, [
    bookId,
    currentTitleId,
    layout.pageStep,
    fingerprint,
    currentChapterBlocks,
    contentMeasureRevision,
    currentChapterImageCount,
  ]);

  // 同步章节级分页结果到 textSyntaxTree（消费侧依赖）
  useEffect(() => {
    if (!textSyntaxTree.rawText) return;
    if (titleIdSequence.length === 0) return;
    if (!chapterStartsComplete) return;

    const blockIdPage: Record<string, number> = {};
    const blockIdPageEnd: Record<string, number> = {};
    const titleIdPage: Record<string, number> = {};
    titleIdSequence.forEach((tid) => {
      const start = chapterStartPages[tid] ?? 0;
      titleIdPage[tid] = start;
      const cp = chapterPaginations.get(tid);
      if (!cp) return;
      const chapterBlocks = blocksByTitleId.get(tid) ?? [];
      for (const block of chapterBlocks) {
        const localStart = cp.blockIdLocalPage[block.id];
        if (localStart === undefined) continue;
        const localEnd = cp.blockIdLocalPageEnd[block.id] ?? localStart;
        blockIdPage[block.id] = start + localStart;
        blockIdPageEnd[block.id] = start + localEnd;
      }
    });
    const pageTitleId = buildPageTitleId(totalPage + 1, titleIdPage);
    if (titleIdSequence.length > 1 && pageTitleId.length <= 1) {
      return;
    }

    const currentTree = getTextSyntaxTree();
    if (currentTree.rawText !== textSyntaxTree.rawText || currentTree.blocks !== textSyntaxTree.blocks) return;

    const shouldUpdate =
      currentTree.totalPage !== totalPage ||
      hasRecordChanged(currentTree.blockIdPage, blockIdPage) ||
      hasRecordChanged(currentTree.blockIdPageEnd, blockIdPageEnd) ||
      hasRecordChanged(currentTree.titleIdPage, titleIdPage) ||
      hasArrayChanged(currentTree.pageTitleId, pageTitleId);
    if (!shouldUpdate) return;

    setTextSyntaxTree({
      ...currentTree,
      totalPage,
      blockIdPage,
      blockIdPageEnd,
      titleIdPage,
      pageTitleId,
    });
  }, [
    chapterPaginations,
    chapterStartPages,
    chapterStartsComplete,
    totalPage,
    titleIdSequence,
    blocksByTitleId,
    textSyntaxTree.blocks,
    textSyntaxTree.rawText,
  ]);

  // pendingLocator 处理：定位到 locator 指向的精确页
  useEffect(() => {
    const locator = pendingLocatorRef.current;
    if (!locator) return;
    if (bookId && locator.bookId !== bookId) return;
    if (titleIdSequence.length === 0) return;

    const block = locator.blockId ? blocks.find((b) => b.id === locator.blockId) : undefined;
    const targetTitleId = block?.titleId ?? locator.titleId;
    if (targetTitleId === undefined || !blocksByTitleId.has(targetTitleId)) {
      pendingLocatorRef.current = null;
      return;
    }

    if (currentTitleId !== targetTitleId) {
      const targetStart = chapterStartPages[targetTitleId];
      if (targetStart !== undefined && getPageNum() !== targetStart) {
        setPageNum(targetStart);
      }
      // 空卷标题章节会被合并到下一非空章节渲染，自身永远不会成为 currentTitleId；跳一次即清理 pending，避免反复触发
      const targetBlocks = blocksByTitleId.get(targetTitleId) ?? [];
      if (isEmptyHeadingTitleBlocks(targetBlocks)) {
        pendingLocatorRef.current = null;
      }
      return;
    }

    if (!chapterPaginations.has(currentTitleId)) return;

    const targetPage = getPagedSpreadStartPage(resolveReaderLocatorPage(locator, getTextSyntaxTree()), visiblePages);
    pendingLocatorRef.current = null;
    if (getPageNum() !== targetPage) {
      setPageNum(targetPage);
    }
    if (bookId) {
      saveReaderProgress(
        createReaderLocator({
          bookId,
          page: targetPage,
          textSyntaxTree: getTextSyntaxTree(),
          visiblePages,
        }),
      );
    }
  }, [
    bookId,
    blocks,
    blocksByTitleId,
    chapterPaginations,
    chapterStartPages,
    currentTitleId,
    titleIdSequence,
    visiblePages,
  ]);

  // 初次进入：取存储的 locator 进入 pendingLocator
  useLayoutEffect(() => {
    if (!bookId || !textSyntaxTree.rawText) return;
    pendingLocatorRef.current = getReaderProgress(bookId) || null;
  }, [bookId, textSyntaxTree.rawText]);

  // 搜索/目录跳转：navigationTarget 转 pendingLocator，由统一定位逻辑兜底跨章
  const navigationRevisionRef = useRef(0);
  useEffect(() => {
    if (!navigationTarget || navigationTarget.revision <= 0) return;
    if (navigationRevisionRef.current === navigationTarget.revision) return;
    navigationRevisionRef.current = navigationTarget.revision;
    if (!navigationTarget.blockId && navigationTarget.titleId === undefined) return;
    const block = navigationTarget.blockId ? blocks.find((b) => b.id === navigationTarget.blockId) : undefined;
    const ratio =
      block && typeof navigationTarget.matchStart === 'number' && Number.isFinite(navigationTarget.matchStart)
        ? Math.min(Math.max(navigationTarget.matchStart / Math.max(block.text.length, 1), 0), 1)
        : undefined;
    const blockStartPage = block ? textSyntaxTree.blockIdPage[block.id] : undefined;
    const blockEndPage = block ? (textSyntaxTree.blockIdPageEnd[block.id] ?? blockStartPage) : undefined;
    const blockPageOffset =
      typeof navigationTarget.blockPageOffset === 'number' && Number.isFinite(navigationTarget.blockPageOffset)
        ? navigationTarget.blockPageOffset
        : typeof navigationTarget.page === 'number' &&
            Number.isFinite(navigationTarget.page) &&
            blockStartPage !== undefined
          ? Math.min(
              Math.max(navigationTarget.page - blockStartPage, 0),
              Math.max((blockEndPage ?? blockStartPage) - blockStartPage, 0),
            )
          : undefined;
    pendingLocatorRef.current = {
      bookId: bookId ?? '',
      page: navigationTarget.page ?? 0,
      blockId: navigationTarget.blockId,
      blockPageOffset,
      titleId: navigationTarget.titleId,
      blockScrollRatio: ratio,
      updatedAt: Date.now(),
    };
  }, [navigationTarget, bookId, blocks, textSyntaxTree.blockIdPage, textSyntaxTree.blockIdPageEnd]);

  // totalPage 收缩时把越界的 pageNum 拉回范围内
  useEffect(() => {
    if (totalPage <= 0) return;
    const currentPage = getPageNum();
    if (currentPage > totalPage) {
      setPageNum(totalPage);
    }
  }, [totalPage]);

  // visiblePages / blocks 改变时重新测量
  useLayoutEffect(() => {
    if (visiblePagesRef.current !== visiblePages) {
      rememberCurrentLocator();
      visiblePagesRef.current = visiblePages;
    }
    scheduleMeasureLayout();
  }, [blocks, rememberCurrentLocator, scheduleMeasureLayout, visiblePages]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      scheduleMeasureLayout({ rememberLocator: true });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scheduleMeasureLayout]);

  useEffect(() => {
    if (!document.fonts) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        scheduleMeasureLayout({ rememberLocator: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scheduleMeasureLayout]);

  useEffect(() => {
    const refreshLayout = () => {
      rememberCurrentLocator();
      scheduleContentPaginationMeasure();
      scheduleMeasureLayout({ includeSettledPass: true });
    };
    window.addEventListener(READER_SETTING_CHANGE_EVENT, refreshLayout);
    return () => {
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, refreshLayout);
    };
  }, [rememberCurrentLocator, scheduleContentPaginationMeasure, scheduleMeasureLayout]);

  useEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
      }
      if (contentMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(contentMeasureFrameRef.current);
      }
      if (paginationMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(paginationMeasureFrameRef.current);
        paginationMeasureFrameRef.current = null;
      }
      if (settledMeasureTimerRef.current !== null) {
        window.clearTimeout(settledMeasureTimerRef.current);
      }
      if (copyToastTimerRef.current !== null) {
        window.clearTimeout(copyToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (pendingLocatorRef.current) return;
      const locator = getCurrentLocator();
      if (locator) {
        saveReaderProgress(locator);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    getCurrentLocator,
    pageNum,
    textSyntaxTree.blockIdPage,
    textSyntaxTree.blockIdPageEnd,
    textSyntaxTree.rawText,
    textSyntaxTree.totalPage,
  ]);

  useEffect(() => {
    const saveProgress = () => {
      const locator = getCurrentLocator();
      if (locator) {
        saveReaderProgress(locator);
      }
    };
    window.addEventListener('pagehide', saveProgress);
    return () => {
      window.removeEventListener('pagehide', saveProgress);
    };
  }, [getCurrentLocator]);

  useEffect(() => {
    const flushProgress = () => {
      const locator = getCurrentLocator();
      if (locator) {
        saveReaderProgress(locator);
      }
    };
    syncHook.tap(EVENT_NAME.FLUSH_READER_PROGRESS, flushProgress);
    return () => {
      syncHook.off(EVENT_NAME.FLUSH_READER_PROGRESS, flushProgress);
    };
  }, [getCurrentLocator]);

  useEffect(() => {
    if (!bookId) return;
    if (currentTitleId === undefined || !currentChapterPagination || layout.pageStep <= 0) return;
    const flow = flowRef.current;
    if (!flow) return;

    annotations
      .filter(
        (annotation) =>
          annotation.type === 'bookmark' &&
          (annotation.titleId === currentTitleId || currentChapterBlockIds.has(annotation.blockId)),
      )
      .forEach((annotation) => {
        const nextPage = resolveRenderedBookmarkPage({
          annotation,
          chapterStartPages,
          flow,
          layout,
        });
        if (nextPage !== undefined && annotation.page !== nextPage) {
          updateReaderBookmarkPage(bookId, annotation.id, nextPage);
        }
      });
  }, [
    annotations,
    bookId,
    chapterStartPages,
    currentChapterBlockIds,
    currentChapterPagination,
    currentTitleId,
    layout,
    visiblePages,
  ]);

  const contentStyle = useMemo(() => {
    const pageWidth = layout.pageWidth || getInitialPageWidth(visiblePages);
    return {
      '--reader-page-width': `${pageWidth}px`,
      '--reader-page-gap': `${layout.pageGap}px`,
      '--reader-page-height': `${layout.pageHeight}px`,
      transform:
        layout.pageStep > 0 ? `translate3d(-${safeLocalPage * layout.pageStep}px, 0, 0)` : 'translate3d(0, 0, 0)',
      width: `${pageWidth}px`,
    } as CSSProperties;
  }, [layout, safeLocalPage, visiblePages]);

  const viewportStyle = useMemo(() => ({ ...style }) as CSSProperties, [style]);

  const renderedBlocks = useMemo(
    () =>
      currentChapterBlocks.map((block) =>
        renderReaderBlock(block, {
          annotations: annotationsByBlockId.get(block.id) || [],
          bookId,
          onImageSettled: scheduleContentPaginationMeasure,
          searchKeyword,
          shouldHighlight: Boolean(searchKeyword) && block.text.includes(searchKeyword),
        }),
      ),
    [
      annotationsByBlockId,
      bookId,
      currentChapterBlocks,
      readerSearchHighlight.revision,
      scheduleContentPaginationMeasure,
      searchKeyword,
    ],
  );
  const bookmarkControl =
    bookmarkLayerElement
      ? createPortal(
          <ReaderPageBookmarkControl active={Boolean(currentBookmark)} onToggle={togglePageBookmark} />,
          bookmarkLayerElement,
        )
      : null;

  return (
    <>
      {bookmarkControl}
      <div
        className={`reader-page-window ${className || ''}`}
        data-page-turn-effect={pageTurnEffect}
        onClick={onClick}
        onTouchEnd={onTouchEnd}
        onTouchStart={onTouchStart}
        ref={viewportRef}
        style={viewportStyle}
      >
        <article className="reader-content-text reader-column-flow" ref={flowRef} style={contentStyle}>
          <div className="reader-selection-overlay" ref={selectionOverlayRef} aria-hidden="true"></div>
          {renderedBlocks}
        </article>
        <ReaderSelectionMenu
          state={selectionMenuState}
          selectedColors={annotationColors}
          onApplyAnnotation={handleApplyAnnotation}
          onCopy={handleCopySelection}
          onDeleteAnnotation={handleDeleteAnnotation}
          onDeleteNote={handleDeleteNote}
          onOpenNote={handleOpenNote}
          onSearchSelection={handleSearchSelection}
          onSelectColor={handleSelectColor}
        />
        <ReaderNoteModal state={noteEditorState} onCancel={handleCancelNote} onSave={handleSaveNote} />
        <ReaderCopyToast visible={copyToastVisible} />
      </div>
    </>
  );
};

const pre = (num: number = 1) => {
  const pageNum: number = getPageNum();
  if (pageNum === 0) return;
  const currentSpreadStart = getPagedSpreadStartPage(pageNum, num);
  runPageTurn(getStoredReaderPageTurnEffect(), () => {
    syncHook.call(EVENT_NAME.CLEAR_READER_PENDING_LOCATOR);
    setPageNum(Math.max(currentSpreadStart - num, 0));
  });
};

const next = (num: number = 1) => {
  const pageNum: number = getPageNum();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const size: number = textSyntaxTree?.totalPage || 0;
  const currentSpreadStart = getPagedSpreadStartPage(pageNum, num);
  runPageTurn(getStoredReaderPageTurnEffect(), () => {
    syncHook.call(EVENT_NAME.CLEAR_READER_PENDING_LOCATOR);
    setPageNum(Math.min(currentSpreadStart + num, size));
  });
};

const loadBookDetailById = (id: string | undefined, navigate: NavigateFunction): void => {
  if (!id) return;
  getBookById<BookInfo>(id)
    .then((res) => {
      if (res.error) {
        resumeDB().then(() => {
          loadBookDetailById(id, navigate);
        });
        return;
      }

      if (!res.data?.document) {
        navigate(ROUTE_PATH.HOME, { replace: true });
        return;
      }

      const currentBook = getCurrentBookDetail();
      const nextTree = getCachedTextSyntaxTree(res.data);
      const currentTree = getTextSyntaxTree();
      const bookChanged =
        currentBook?.id !== res.data.id ||
        currentBook?.modifyTime !== res.data.modifyTime ||
        currentBook?.fingerprint !== res.data.fingerprint;
      const treeChanged =
        currentTree.rawText !== nextTree.rawText ||
        currentTree.blocks !== nextTree.blocks ||
        currentTree.sequences !== nextTree.sequences;

      if (bookChanged) {
        setCurrentBookDetail(res.data);
      }
      if (treeChanged) {
        setTextSyntaxTree(nextTree);
      }
    })
    .catch((error) => {
      console.log('error', error);
      navigate(ROUTE_PATH.HOME, { replace: true });
    });
};

export const BookDetail = (): React.JSX.Element => {
  const [currentDevice] = useCheckDevice();
  const bookId = useReaderBookId();

  useEffect(() => {
    return () => {
      clearBookDetailMenuSearchState(bookId);
      // Revoke any object URLs created while reading this book so the browser
      // can reclaim image memory after navigating away. Resources are still
      // persisted in IndexedDB and will be re-resolved on the next visit.
      releaseBookResourceUrls(bookId);
    };
  }, [bookId]);

  if (currentDevice === DEVICE_ENUM.MOBILE) return <MobileBookDetail />;
  if (currentDevice === DEVICE_ENUM.DESKTOP) return <DesktopBookDetail />;
  return <Loading />;
};

export const DesktopBookDetail = (): React.JSX.Element => {
  const id = useReaderBookId();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [_, update] = useState(0);
  const bookDetail: BookInfo | null = getCurrentBookDetail();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const pageNum: number = getPageNum();
  const readerNavigationTarget = getReaderNavigationTarget();
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);
  const [readingMode, setReadingMode] = useState<ReaderReadingMode>(getStoredReaderReadingMode);
  const [scrollPaddingX, setScrollPaddingX] = useState<number>(getStoredReaderScrollPaddingX);
  const [scrollTitleId, setScrollTitleId] = useState<number | undefined>(undefined);

  const updateUI = useMemo(
    () =>
      debounce(() => {
        update((prev) => prev + 1);
      }, 16),
    [],
  );

  const updatePageUI = useCallback(() => {
    update((prev) => prev + 1);
  }, []);

  const getTitle = () => {
    const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
    const pageNum: number = getPageNum();
    return getPageTitle(textSyntaxTree, pageNum);
  };

  const toHome = () => {
    if (!id) return;
    navigate(ROUTE_PATH.HOME);
  };

  const toShelf = () => {
    if (!id) return;
    navigate(ROUTE_PATH.SHELF);
  };

  const toBookHome = () => {
    const tree = getTextSyntaxTree();
    if (!tree.rawText || tree.blocks.length === 0) return;
    const firstTitleId = getFirstTitleId(tree);
    setReaderNavigationTarget({ page: 0, revision: Date.now(), titleId: firstTitleId });
    if (getPageNum() !== 0) {
      setPageNum(0);
    }
  };

  useEffect(() => {
    if (id) {
      loadBookDetailById(id, navigate);
    }
  }, [id, navigate]);

  useSyncHookEvents(BOOK_DETAIL_UI_EVENTS, updateUI);
  useSyncHookEvents(BOOK_DETAIL_PAGE_EVENTS, updatePageUI);

  useEffect(() => {
    const updateReaderSettings = () => {
      setPageTurnEffect(getStoredReaderPageTurnEffect());
      setReadingMode(getStoredReaderReadingMode());
      setScrollPaddingX(getStoredReaderScrollPaddingX());
    };
    window.addEventListener(READER_SETTING_CHANGE_EVENT, updateReaderSettings);
    return () => {
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, updateReaderSettings);
    };
  }, []);

  useLayoutEffect(() => {
    if (readingMode !== 'paged') return;
    window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [readingMode]);

  useEffect(() => {
    if (readingMode !== 'scroll') return;
    setScrollTitleId(getScrollInitialTitleId(id || undefined, pageNum, textSyntaxTree));
  }, [
    id,
    pageNum,
    readingMode,
    textSyntaxTree.pageTitleId,
    textSyntaxTree.rawText,
    textSyntaxTree.sequences,
    textSyntaxTree.titleIdTitle,
  ]);

  useEffect(() => {
    if (readingMode !== 'scroll' || readerNavigationTarget.revision <= 0) return;
    const block = readerNavigationTarget.blockId
      ? textSyntaxTree.blocks.find((item) => item.id === readerNavigationTarget.blockId)
      : undefined;
    const targetTitleId = isValidTitleId(textSyntaxTree, readerNavigationTarget.titleId)
      ? readerNavigationTarget.titleId
      : block?.titleId;
    if (isValidTitleId(textSyntaxTree, targetTitleId)) {
      setScrollTitleId(targetTitleId);
    }
  }, [
    readerNavigationTarget.blockId,
    readerNavigationTarget.revision,
    readerNavigationTarget.titleId,
    readingMode,
    textSyntaxTree.blocks,
    textSyntaxTree.titleIdTitle,
  ]);

  const navigateScrollTitle = useCallback(
    (targetTitleId: number) => {
      setScrollTitleId(targetTitleId);
      const targetPage = getTitlePage(textSyntaxTree, targetTitleId);
      setReaderNavigationTarget({ page: targetPage, revision: Date.now(), titleId: targetTitleId });
      if (getPageNum() !== targetPage) {
        setPageNum(targetPage);
      }
    },
    [textSyntaxTree],
  );

  const isScrollMode = readingMode === 'scroll';
  const isReaderReady = textSyntaxTree.rawText.length > 0 && textSyntaxTree.blocks.length > 0;
  useReaderReadingTimeTracker(id || undefined, isReaderReady, readingMode);
  const initialScrollTitleId =
    isScrollMode && isReaderReady ? getScrollInitialTitleId(id || undefined, pageNum, textSyntaxTree) : undefined;
  const effectiveScrollTitleId = isValidTitleId(textSyntaxTree, scrollTitleId)
    ? scrollTitleId
    : (initialScrollTitleId ?? getFirstTitleId(textSyntaxTree));
  const hasKnownPagedTotalPage = textSyntaxTree.totalPage > 0 || textSyntaxTree.pageTitleId.length > 0;
  const isFirstPagedPage = pageNum <= 0;
  const isLastPagedPage =
    hasKnownPagedTotalPage &&
    pageNum >= Math.max(0, textSyntaxTree.totalPage - (getVisiblePageCount(DEVICE_ENUM.DESKTOP) - 1));
  const scrollProgressLocator = getReaderProgress(id || undefined);
  const scrollNavigationBlock = readerNavigationTarget.blockId
    ? textSyntaxTree.blocks.find((item) => item.id === readerNavigationTarget.blockId)
    : undefined;
  const scrollNavigationTitleId = isValidTitleId(textSyntaxTree, readerNavigationTarget.titleId)
    ? readerNavigationTarget.titleId
    : scrollNavigationBlock?.titleId;
  const hasActiveScrollNavigation =
    readerNavigationTarget.revision > 0 && scrollNavigationTitleId === effectiveScrollTitleId;
  const scrollTargetBlockId = hasActiveScrollNavigation ? readerNavigationTarget.blockId : undefined;
  const scrollTargetBlockRatio =
    hasActiveScrollNavigation &&
    scrollNavigationBlock &&
    typeof readerNavigationTarget.matchStart === 'number' &&
    Number.isFinite(readerNavigationTarget.matchStart)
      ? Math.min(Math.max(readerNavigationTarget.matchStart / Math.max(scrollNavigationBlock.text.length, 1), 0), 1)
      : undefined;
  const scrollTargetBlockStartPage = scrollNavigationBlock
    ? textSyntaxTree.blockIdPage[scrollNavigationBlock.id]
    : undefined;
  const scrollTargetBlockEndPage = scrollNavigationBlock
    ? (textSyntaxTree.blockIdPageEnd[scrollNavigationBlock.id] ?? scrollTargetBlockStartPage)
    : undefined;
  const scrollTargetBlockPageOffset =
    hasActiveScrollNavigation &&
    typeof readerNavigationTarget.blockPageOffset === 'number' &&
    Number.isFinite(readerNavigationTarget.blockPageOffset)
      ? readerNavigationTarget.blockPageOffset
      : hasActiveScrollNavigation &&
          typeof readerNavigationTarget.page === 'number' &&
          Number.isFinite(readerNavigationTarget.page) &&
          scrollTargetBlockStartPage !== undefined
        ? Math.min(
            Math.max(readerNavigationTarget.page - scrollTargetBlockStartPage, 0),
            Math.max((scrollTargetBlockEndPage ?? scrollTargetBlockStartPage) - scrollTargetBlockStartPage, 0),
          )
        : undefined;
  const scrollTargetPage =
    hasActiveScrollNavigation &&
    typeof readerNavigationTarget.page === 'number' &&
    Number.isFinite(readerNavigationTarget.page)
      ? readerNavigationTarget.page
      : undefined;

  if (!isReaderReady) {
    return (
      <div
        className="reader-user-select-disabled w-screen h-screen bg-front-bg-color-1 flex items-center justify-center"
        style={{ viewTransitionName: id ? `book-info-${id}` : undefined }}
      >
        <Loading />
      </div>
    );
  }

  if (isScrollMode) {
    return (
      <div
        className="reader-scroll-mode-page reader-user-select-disabled bg-front-bg-color-1 relative"
        onContextMenu={preventReaderContextMenu}
      >
        <BookDetailOperate />
        <div className="reader-scroll-mode-inner">
          <div className="reader-scroll-mode-header">
            <div>
              <a className="text-text-color-2 font-medium hover:text-text-color-1 cursor-pointer" onClick={toBookHome}>
                {bookDetail?.title}
              </a>
            </div>
            <div className="flex items-center gap-5">
              <a className="text-text-color-2 font-normal cursor-pointer hover:text-text-color-1" onClick={toHome}>
                {t('home')}
              </a>
              <span className="readerTopBar_link_sep"></span>
              <a className="text-text-color-2 font-normal cursor-pointer hover:text-text-color-1" onClick={toShelf}>
                我的书架
              </a>
            </div>
          </div>
          <div
            className="reader-scroll-mode-container"
            ref={ref}
            style={
              {
                '--reader-scroll-padding-x': `${scrollPaddingX}px`,
                viewTransitionName: `book-info-${id}`,
              } as CSSProperties
            }
          >
            <ReaderScrollContent
              allowAutoSave={scrollTitleId === undefined || scrollTitleId === effectiveScrollTitleId}
              bookId={id || undefined}
              navigationRevision={hasActiveScrollNavigation ? readerNavigationTarget.revision : 0}
              onNavigateTitle={navigateScrollTitle}
              progressLocator={scrollProgressLocator}
              targetBlockId={scrollTargetBlockId}
              targetBlockPageOffset={scrollTargetBlockPageOffset}
              targetPage={scrollTargetPage}
              targetBlockRatio={scrollTargetBlockRatio}
              textSyntaxTree={textSyntaxTree}
              titleId={effectiveScrollTitleId}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="reader-user-select-disabled px-44 bg-front-bg-color-1 h-screen relative"
      onContextMenu={preventReaderContextMenu}
    >
      <div className="w-full h-full flex flex-col">
        <div className="h-16 flex items-center justify-between flex-row flex-nowrap shrink-0">
          <div>
            <a className="text-text-color-2 font-medium hover:text-text-color-1 cursor-pointer" onClick={toBookHome}>
              {bookDetail?.title}
            </a>
          </div>
          <div className="flex items-center gap-5">
            <a className="text-text-color-2 font-normal cursor-pointer hover:text-text-color-1" onClick={toHome}>
              {t('home')}
            </a>
            <span className="readerTopBar_link_sep"></span>
            <a className="text-text-color-2 font-normal cursor-pointer hover:text-text-color-1" onClick={toShelf}>
              我的书架
            </a>
          </div>
        </div>
        <div
          ref={ref}
          style={{
            viewTransitionName: `book-info-${id}`,
          }}
          className="bg-front-bg-color-3 rounded-2xl flex-grow pt-7 px-16 flex flex-col text-base book-info-container relative"
        >
          <div className="reader-page-title-label text-text-color-3 text-sm font-light">{getTitle()}</div>
          <ReaderPagedContent
            bookId={id || undefined}
            className="mt-5 cursor-auto font-normal tracking-wide text-text-color-1 text-lg leading-10 w-full"
            navigationTarget={readerNavigationTarget}
            pageNum={pageNum}
            pageTurnEffect={pageTurnEffect}
            style={{
              height: 'calc(100vh - var(--spacing) * 63)',
            }}
            textSyntaxTree={textSyntaxTree}
            visiblePages={getVisiblePageCount(DEVICE_ENUM.DESKTOP)}
          />
          <div className="h-16">
            <div className="flex justify-between items-center h-full">
              <div>
                {!isFirstPagedPage ? (
                  <div
                    className="reader-page-nav-button text-text-color-2 text-sm font-light border-1 border-border-color-1 pl-2 pr-3 rounded-4xl h-8 flex items-center justify-center cursor-pointer hover:bg-front-bg-color-2"
                    onClick={() => pre(2)}
                  >
                    <ReaderPagePreviousIcon />
                    <span>{t('previous_page')}</span>
                  </div>
                ) : null}
              </div>
              <div>
                {!isLastPagedPage ? (
                  <div
                    className="reader-page-nav-button text-text-color-2 text-sm font-light border-1 border-border-color-1 pr-2 pl-3 rounded-4xl h-8 flex items-center justify-center cursor-pointer hover:bg-front-bg-color-2"
                    onClick={() => next(2)}
                  >
                    <span>{t('next_page')}</span>
                    <ReaderPageNextIcon />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="h-14 w-full"></div>
      </div>
      <BookDetailOperate />
    </div>
  );
};

export const MobileBookDetail = (): React.JSX.Element => {
  const ref = useRef<HTMLDivElement>(null);
  const touchMoveRef = useRef<number>(0);
  const navigate = useNavigate();
  const [_, update] = useState(0);
  const [isTouch, setIsTouch] = useState(false);
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const totalPage: number = textSyntaxTree.totalPage;
  const pageNum: number = getPageNum();
  const readerNavigationTarget = getReaderNavigationTarget();
  const id = useReaderBookId();
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);
  const [readingMode, setReadingMode] = useState<ReaderReadingMode>(getStoredReaderReadingMode);
  const [scrollPaddingX, setScrollPaddingX] = useState<number>(getStoredReaderScrollPaddingX);
  const [scrollTitleId, setScrollTitleId] = useState<number | undefined>(undefined);

  const updateUI = useMemo(
    () =>
      debounce(() => {
        update((prev) => prev + 1);
      }, 16),
    [],
  );

  const updatePageUI = useCallback(() => {
    update((prev) => prev + 1);
  }, []);

  const touchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const { touches } = e;
    const { clientX } = touches[0];
    touchMoveRef.current = clientX;
  };

  const touchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const { changedTouches } = e;
    const { clientX } = changedTouches[0];
    const distance = clientX - touchMoveRef.current;
    if (Math.abs(distance) < 30) return;
    if (distance > 0) {
      pre();
    } else {
      next();
    }
  };

  const hideMobileChrome = useCallback(() => {
    setIsTouch(false);
    syncHook.call(EVENT_NAME.CLOSE_MOBILE_READER_CONTROL_PANEL_FADE);
  }, []);

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    const { clientX } = e;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const relativeX = clientX - left;
    if (!width) return;
    if (relativeX < width / 4) {
      pre();
      hideMobileChrome();
    } else if (relativeX > (width / 4) * 3) {
      next();
      hideMobileChrome();
    } else {
      if (isTouch) {
        hideMobileChrome();
        return;
      }
      setIsTouch(true);
    }
  };

  const back = () => {
    startSpaViewTransition(() => {
      navigate(-1);
    });
  };

  useEffect(() => {
    if (id) {
      loadBookDetailById(id, navigate);
    }
  }, [id, navigate]);

  useSyncHookEvents(MOBILE_BOOK_DETAIL_UI_EVENTS, updateUI);
  useSyncHookEvents(BOOK_DETAIL_PAGE_EVENTS, updatePageUI);

  useEffect(() => {
    const updateReaderSettings = () => {
      setPageTurnEffect(getStoredReaderPageTurnEffect());
      setReadingMode(getStoredReaderReadingMode());
      setScrollPaddingX(getStoredReaderScrollPaddingX());
    };
    window.addEventListener(READER_SETTING_CHANGE_EVENT, updateReaderSettings);
    return () => {
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, updateReaderSettings);
    };
  }, []);

  const isReaderReady = textSyntaxTree.rawText.length > 0 && textSyntaxTree.blocks.length > 0;
  useReaderReadingTimeTracker(id, isReaderReady, readingMode);

  useLayoutEffect(() => {
    if (readingMode !== 'paged') return;
    window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [readingMode]);

  useEffect(() => {
    if (readingMode !== 'scroll') return;
    setScrollTitleId(getScrollInitialTitleId(id || undefined, pageNum, textSyntaxTree));
  }, [
    id,
    pageNum,
    readingMode,
    textSyntaxTree.pageTitleId,
    textSyntaxTree.rawText,
    textSyntaxTree.sequences,
    textSyntaxTree.titleIdTitle,
  ]);

  useEffect(() => {
    if (readingMode !== 'scroll' || readerNavigationTarget.revision <= 0) return;
    const block = readerNavigationTarget.blockId
      ? textSyntaxTree.blocks.find((item) => item.id === readerNavigationTarget.blockId)
      : undefined;
    const targetTitleId = isValidTitleId(textSyntaxTree, readerNavigationTarget.titleId)
      ? readerNavigationTarget.titleId
      : block?.titleId;
    if (isValidTitleId(textSyntaxTree, targetTitleId)) {
      setScrollTitleId(targetTitleId);
    }
  }, [
    readerNavigationTarget.blockId,
    readerNavigationTarget.revision,
    readerNavigationTarget.titleId,
    readingMode,
    textSyntaxTree.blocks,
    textSyntaxTree.titleIdTitle,
  ]);

  const navigateScrollTitle = useCallback(
    (targetTitleId: number) => {
      setScrollTitleId(targetTitleId);
      const targetPage = getTitlePage(textSyntaxTree, targetTitleId);
      setReaderNavigationTarget({ page: targetPage, revision: Date.now(), titleId: targetTitleId });
      if (getPageNum() !== targetPage) {
        setPageNum(targetPage);
      }
    },
    [textSyntaxTree],
  );

  if (!isReaderReady) {
    return (
      <div
        className="reader-user-select-disabled w-screen h-screen bg-front-bg-color-1 flex items-center justify-center"
        style={{ viewTransitionName: id ? `book-info-${id}` : undefined }}
      >
        <Loading />
      </div>
    );
  }

  const isScrollMode = readingMode === 'scroll';
  const initialScrollTitleId =
    isScrollMode && isReaderReady ? getScrollInitialTitleId(id || undefined, pageNum, textSyntaxTree) : undefined;
  const effectiveScrollTitleId = isValidTitleId(textSyntaxTree, scrollTitleId)
    ? scrollTitleId
    : (initialScrollTitleId ?? getFirstTitleId(textSyntaxTree));
  const scrollProgressLocator = getReaderProgress(id || undefined);
  const scrollNavigationBlock = readerNavigationTarget.blockId
    ? textSyntaxTree.blocks.find((item) => item.id === readerNavigationTarget.blockId)
    : undefined;
  const scrollNavigationTitleId = isValidTitleId(textSyntaxTree, readerNavigationTarget.titleId)
    ? readerNavigationTarget.titleId
    : scrollNavigationBlock?.titleId;
  const hasActiveScrollNavigation =
    readerNavigationTarget.revision > 0 && scrollNavigationTitleId === effectiveScrollTitleId;
  const scrollTargetBlockId = hasActiveScrollNavigation ? readerNavigationTarget.blockId : undefined;
  const scrollTargetBlockRatio =
    hasActiveScrollNavigation &&
    scrollNavigationBlock &&
    typeof readerNavigationTarget.matchStart === 'number' &&
    Number.isFinite(readerNavigationTarget.matchStart)
      ? Math.min(Math.max(readerNavigationTarget.matchStart / Math.max(scrollNavigationBlock.text.length, 1), 0), 1)
      : undefined;
  const scrollTargetBlockStartPage = scrollNavigationBlock
    ? textSyntaxTree.blockIdPage[scrollNavigationBlock.id]
    : undefined;
  const scrollTargetBlockEndPage = scrollNavigationBlock
    ? (textSyntaxTree.blockIdPageEnd[scrollNavigationBlock.id] ?? scrollTargetBlockStartPage)
    : undefined;
  const scrollTargetBlockPageOffset =
    hasActiveScrollNavigation &&
    typeof readerNavigationTarget.blockPageOffset === 'number' &&
    Number.isFinite(readerNavigationTarget.blockPageOffset)
      ? readerNavigationTarget.blockPageOffset
      : hasActiveScrollNavigation &&
          typeof readerNavigationTarget.page === 'number' &&
          Number.isFinite(readerNavigationTarget.page) &&
          scrollTargetBlockStartPage !== undefined
        ? Math.min(
            Math.max(readerNavigationTarget.page - scrollTargetBlockStartPage, 0),
            Math.max((scrollTargetBlockEndPage ?? scrollTargetBlockStartPage) - scrollTargetBlockStartPage, 0),
          )
        : undefined;
  const scrollTargetPage =
    hasActiveScrollNavigation &&
    typeof readerNavigationTarget.page === 'number' &&
    Number.isFinite(readerNavigationTarget.page)
      ? readerNavigationTarget.page
      : undefined;

  if (isScrollMode) {
    return (
      <div className="reader-mobile-scroll-page reader-user-select-disabled" onContextMenu={preventReaderContextMenu}>
        <div className="reader-mobile-scroll-header">
          <button className="reader-mobile-back-button" type="button" onClick={back}>
            <r-icon name="more" className="rotate-90" style={MOBILE_ICON_STYLE}></r-icon>
          </button>
          <div className="reader-mobile-scroll-title">{getCurrentBookDetail()?.title}</div>
        </div>
        <div
          className="reader-mobile-scroll-container"
          ref={ref}
          style={
            {
              '--reader-scroll-padding-x': `${scrollPaddingX}px`,
              viewTransitionName: `book-info-${id}`,
            } as CSSProperties
          }
        >
          <ReaderScrollContent
            allowAutoSave={scrollTitleId === undefined || scrollTitleId === effectiveScrollTitleId}
            bookId={id || undefined}
            navigationRevision={hasActiveScrollNavigation ? readerNavigationTarget.revision : 0}
            onNavigateTitle={navigateScrollTitle}
            progressLocator={scrollProgressLocator}
            targetBlockId={scrollTargetBlockId}
            targetBlockPageOffset={scrollTargetBlockPageOffset}
            targetPage={scrollTargetPage}
            targetBlockRatio={scrollTargetBlockRatio}
            textSyntaxTree={textSyntaxTree}
            titleId={effectiveScrollTitleId}
          />
        </div>
        <div className="reader-mobile-bottom-bar is-visible">
          <MobileBookDetailOperate />
        </div>
      </div>
    );
  }

  return (
    <div className="reader-mobile-paged-page reader-user-select-disabled" onContextMenu={preventReaderContextMenu}>
      <div
        className="reader-mobile-paged-viewport w-screen h-screen bg-front-bg-color-1"
        ref={ref}
        style={{
          viewTransitionName: `book-info-${id}`,
        }}
      >
        <div className="reader-mobile-paged-shell w-full h-full p-8 relative">
          <div className="reader-mobile-page-title-label">{getPageTitle(textSyntaxTree, pageNum)}</div>
          <div
            className="absolute top-0 left-0 transition-all w-full flex items-center justify-between px-4 bg-front-bg-color-3 overflow-hidden"
            style={{
              height: isTouch ? 'calc(var(--spacing) * 14)' : '0px',
            }}
          >
            <r-icon name="more" className="cursor-pointer rotate-90" style={MOBILE_ICON_STYLE} onClick={back}></r-icon>
          </div>
          <ReaderPagedContent
            bookId={id || undefined}
            className="w-full h-full text-text-color-1 text-lg leading-10"
            navigationTarget={readerNavigationTarget}
            onClick={click}
            onTouchEnd={touchEnd}
            onTouchStart={touchStart}
            pageNum={pageNum}
            pageTurnEffect={pageTurnEffect}
            textSyntaxTree={textSyntaxTree}
            visiblePages={getVisiblePageCount(DEVICE_ENUM.MOBILE)}
          />
          <div className={`reader-mobile-bottom-bar ${isTouch ? 'is-visible' : ''}`}>
            <MobileBookDetailOperate />
          </div>
          <div className="reader-mobile-page-count text-right text-text-color-2 text-base absolute bottom-8 right-8 z-10">
            {pageNum + 1} / {totalPage + 1}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetail;
