import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReaderAnnotation } from '@/lib/readerAnnotations';
import {
  type ReaderLocator,
  createReaderScrollLocator,
  getReaderScrollAnchorY,
  saveReaderProgress,
} from '@/lib/readerProgress';
import type { TextSyntaxTree } from '@/lib/transformText';
import {
  EVENT_NAME,
  getReaderControlPanelActive,
  getReaderNavigationTarget,
  getReaderSearchHighlight,
  setReaderNavigationTarget,
  syncHook,
} from '@/lib/subscribe';
import { getChapterBlocks, getChapterTitleIds, getFirstTitleId, isValidTitleId } from '@/lib/reader/chapterStructure';
import { useReaderAnnotationsForBook } from '@/lib/reader/useReaderAnnotationsForBook';
import { useReaderSelectionOverlay } from '@/lib/reader/useReaderSelectionOverlay';
import { useReaderAnnotationActions } from '@/lib/reader/useReaderAnnotationActions';
import { renderReaderBlock } from '@/components/Reader/ReaderBlock';
import { ReaderCopyToast, ReaderNoteModal, ReaderSelectionMenu } from '@/components/Reader/ReaderSelectionMenu';
import { t } from '@/locales';

export interface ReaderScrollContentProps {
  textSyntaxTree: TextSyntaxTree;
  titleId: number;
  bookId?: string;
  allowAutoSave?: boolean;
  navigationRevision?: number;
  onNavigateTitle: (titleId: number) => void;
  progressLocator?: ReaderLocator;
  targetBlockId?: string;
  targetBlockPageOffset?: number;
  targetPage?: number;
  targetBlockRatio?: number;
}

const createScrollTargetLocator = ({
  blockPageOffset,
  blockId,
  bookId,
  page,
  ratio,
  textSyntaxTree,
}: {
  blockPageOffset?: number;
  blockId: string;
  bookId?: string;
  page?: number;
  ratio: number;
  textSyntaxTree: TextSyntaxTree;
}): ReaderLocator | undefined => {
  if (!bookId) return undefined;
  const block = textSyntaxTree.blocks.find((item) => item.id === blockId);
  if (!block) return undefined;

  const safeRatio = Math.min(Math.max(ratio, 0), 1);
  const startPage = textSyntaxTree.blockIdPage[block.id];
  const endPage = textSyntaxTree.blockIdPageEnd[block.id] ?? startPage;
  const rawPage =
    startPage === undefined
      ? block.titleId === undefined
        ? 0
        : (textSyntaxTree.titleIdPage[block.titleId] ?? 0)
      : startPage + Math.round(safeRatio * Math.max((endPage ?? startPage) - startPage, 0));
  const safePage = Math.min(
    Math.max(typeof page === 'number' && Number.isFinite(page) ? page : rawPage, 0),
    Math.max(textSyntaxTree.totalPage || 0, 0),
  );
  const resolvedBlockPageOffset =
    startPage === undefined
      ? undefined
      : Math.min(
          Math.max(
            typeof blockPageOffset === 'number' && Number.isFinite(blockPageOffset)
              ? blockPageOffset
              : safePage - startPage,
            0,
          ),
          Math.max((endPage ?? startPage) - startPage, 0),
        );
  const blockLength = Math.max(block.end - block.start, 1);
  const globalProgress =
    textSyntaxTree.rawText.length > 0
      ? Math.min(Math.max((block.start + blockLength * safeRatio) / textSyntaxTree.rawText.length, 0), 1)
      : 0;

  return {
    blockId: block.id,
    blockPageOffset: resolvedBlockPageOffset,
    blockScrollRatio: safeRatio,
    bookId,
    globalProgress,
    page: safePage,
    readingMode: 'scroll',
    textAfter: block.text.slice(-80),
    textBefore: block.text.slice(0, 80),
    titleId: block.titleId,
    updatedAt: Date.now(),
  };
};

export const ReaderScrollContent = ({
  textSyntaxTree,
  titleId,
  bookId,
  allowAutoSave = true,
  navigationRevision,
  onNavigateTitle,
  progressLocator,
  targetBlockId,
  targetBlockPageOffset,
  targetPage,
  targetBlockRatio,
}: ReaderScrollContentProps): React.JSX.Element => {
  const contentRef = useRef<HTMLElement>(null);
  const annotations = useReaderAnnotationsForBook(bookId);
  const {
    clearSelection,
    copySelection,
    menuState: selectionMenuState,
    overlayRef: selectionOverlayRef,
  } = useReaderSelectionOverlay(contentRef, annotations);
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
  const copyToastTimerRef = useRef<number | null>(null);
  const consumedNavigationRevisionRef = useRef(0);
  const pinnedScrollTargetLocatorRef = useRef<ReaderLocator | null>(null);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const readerSearchHighlight = getReaderSearchHighlight();
  const searchKeyword = readerSearchHighlight.hasResult ? readerSearchHighlight.keyword : '';
  const titleIds = useMemo(() => getChapterTitleIds(textSyntaxTree), [textSyntaxTree]);
  const currentTitleId = isValidTitleId(textSyntaxTree, titleId) ? titleId : getFirstTitleId(textSyntaxTree);
  const currentTitleIndex = Math.max(titleIds.indexOf(currentTitleId), 0);
  const previousTitleId = titleIds[currentTitleIndex - 1];
  const nextTitleId = titleIds[currentTitleIndex + 1];
  const blocks = useMemo(() => getChapterBlocks(textSyntaxTree, currentTitleId), [currentTitleId, textSyntaxTree]);
  const isProgressWaitingForAnotherTitle =
    !navigationRevision &&
    Boolean(progressLocator?.blockId) &&
    progressLocator?.titleId !== undefined &&
    progressLocator.titleId !== currentTitleId;
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

  const showCopyToast = useCallback(() => {
    if (copyToastTimerRef.current) {
      window.clearTimeout(copyToastTimerRef.current);
    }
    setCopyToastVisible(true);
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToastVisible(false);
      copyToastTimerRef.current = null;
    }, 1400);
  }, []);

  const handleCopySelection = useCallback(() => {
    const copyResult = copySelection();
    clearSelection();
    copyResult.then((copied) => {
      if (copied) showCopyToast();
    });
  }, [clearSelection, copySelection, showCopyToast]);

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current) {
        window.clearTimeout(copyToastTimerRef.current);
      }
    };
  }, []);

  const saveScrollLocator = useCallback(
    (anchorY?: number) => {
      if (!bookId || !allowAutoSave || isProgressWaitingForAnotherTitle || getReaderControlPanelActive()) return;
      const locator = createReaderScrollLocator({
        anchorY,
        bookId,
        contentElement: contentRef.current,
        textSyntaxTree,
      });
      if (locator) {
        const pinnedLocator = pinnedScrollTargetLocatorRef.current;
        const shouldPreservePinnedPage =
          pinnedLocator &&
          pinnedLocator.blockId === locator.blockId &&
          pinnedLocator.titleId === locator.titleId &&
          Math.abs((pinnedLocator.blockScrollRatio ?? 0) - (locator.blockScrollRatio ?? 0)) <= 0.08 &&
          Number.isFinite(pinnedLocator.page);
        saveReaderProgress(
          shouldPreservePinnedPage
            ? {
                ...locator,
                blockPageOffset: pinnedLocator.blockPageOffset,
                blockScrollRatio: pinnedLocator.blockScrollRatio ?? locator.blockScrollRatio,
                globalProgress: pinnedLocator.globalProgress ?? locator.globalProgress,
                page: pinnedLocator.page,
                textAfter: pinnedLocator.textAfter ?? locator.textAfter,
                textBefore: pinnedLocator.textBefore ?? locator.textBefore,
              }
            : locator,
        );
      }
    },
    [allowAutoSave, bookId, isProgressWaitingForAnotherTitle, textSyntaxTree],
  );

  const saveScrollDefaultLocator = useCallback(() => {
    saveScrollLocator();
  }, [saveScrollLocator]);

  const restoreScrollBlock = useCallback(
    (blockId: string, ratio: number, align: 'anchor' | 'center', onRestored?: () => void) => {
      window.requestAnimationFrame(() => {
        const targetElement = contentRef.current?.querySelector<HTMLElement>(`[data-reader-block-id="${blockId}"]`);
        if (!targetElement) return;
        const rect = targetElement.getBoundingClientRect();
        const targetAnchorY = align === 'center' ? window.innerHeight / 2 : getReaderScrollAnchorY();
        const targetTop = Math.max(
          window.scrollY + rect.top + rect.height * Math.min(Math.max(ratio, 0), 1) - targetAnchorY,
          0,
        );
        window.scrollTo({ behavior: 'auto', top: targetTop });
        onRestored?.();
      });
    },
    [],
  );

  const saveScrollTargetLocator = useCallback(
    (blockId: string, ratio: number, page?: number, blockPageOffset?: number) => {
      const locator = createScrollTargetLocator({
        blockPageOffset,
        blockId,
        bookId,
        page,
        ratio,
        textSyntaxTree,
      });
      if (locator) {
        pinnedScrollTargetLocatorRef.current = locator;
        saveReaderProgress(locator);
      }
    },
    [bookId, textSyntaxTree],
  );

  useEffect(() => {
    if (navigationRevision && targetBlockId) {
      if (consumedNavigationRevisionRef.current !== navigationRevision) {
        consumedNavigationRevisionRef.current = navigationRevision;
        const ratio = targetBlockRatio ?? 0;
        restoreScrollBlock(targetBlockId, ratio, 'anchor', () => {
          saveScrollTargetLocator(targetBlockId, ratio, targetPage, targetBlockPageOffset);
          if (getReaderNavigationTarget().revision === navigationRevision) {
            setReaderNavigationTarget({ revision: 0 });
          }
        });
      }
      return;
    }

    if (progressLocator?.blockId && progressLocator.titleId === currentTitleId) {
      restoreScrollBlock(progressLocator.blockId, progressLocator.blockScrollRatio ?? 0, 'anchor');
      return;
    }

    if (!isProgressWaitingForAnotherTitle) {
      window.scrollTo({ behavior: 'auto', top: 0 });
    }
  }, [
    currentTitleId,
    isProgressWaitingForAnotherTitle,
    navigationRevision,
    progressLocator?.blockId,
    progressLocator?.blockScrollRatio,
    progressLocator?.titleId,
    progressLocator?.updatedAt,
    restoreScrollBlock,
    saveScrollTargetLocator,
    targetBlockPageOffset,
    targetBlockId,
    targetPage,
    targetBlockRatio,
  ]);

  useEffect(() => {
    const clearPinnedLocator = () => {
      pinnedScrollTargetLocatorRef.current = null;
    };
    const clearPinnedLocatorByKey = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
        clearPinnedLocator();
      }
    };
    window.addEventListener('wheel', clearPinnedLocator, { passive: true });
    window.addEventListener('touchmove', clearPinnedLocator, { passive: true });
    window.addEventListener('keydown', clearPinnedLocatorByKey);
    return () => {
      window.removeEventListener('wheel', clearPinnedLocator);
      window.removeEventListener('touchmove', clearPinnedLocator);
      window.removeEventListener('keydown', clearPinnedLocatorByKey);
    };
  }, []);

  useEffect(() => {
    if (!bookId || !allowAutoSave || isProgressWaitingForAnotherTitle) return;
    const frame = window.requestAnimationFrame(saveScrollDefaultLocator);
    return () => window.cancelAnimationFrame(frame);
  }, [allowAutoSave, bookId, currentTitleId, isProgressWaitingForAnotherTitle, saveScrollDefaultLocator]);

  useEffect(() => {
    if (!bookId || !allowAutoSave || isProgressWaitingForAnotherTitle) return;
    let timer: number | undefined;

    const scheduleSave = () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(saveScrollLocator, 180);
    };

    window.addEventListener('scroll', scheduleSave, { passive: true });
    window.addEventListener('resize', scheduleSave);
    window.addEventListener('pagehide', saveScrollDefaultLocator);
    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      window.removeEventListener('scroll', scheduleSave);
      window.removeEventListener('resize', scheduleSave);
      window.removeEventListener('pagehide', saveScrollDefaultLocator);
    };
  }, [allowAutoSave, bookId, isProgressWaitingForAnotherTitle, saveScrollDefaultLocator, saveScrollLocator]);

  const saveScrollDefaultLocatorRef = useRef(saveScrollDefaultLocator);
  saveScrollDefaultLocatorRef.current = saveScrollDefaultLocator;

  useLayoutEffect(() => {
    return () => {
      saveScrollDefaultLocatorRef.current();
    };
  }, []);

  useEffect(() => {
    const flushProgress = () => {
      saveScrollDefaultLocatorRef.current();
    };
    syncHook.tap(EVENT_NAME.FLUSH_READER_PROGRESS, flushProgress);
    return () => {
      syncHook.off(EVENT_NAME.FLUSH_READER_PROGRESS, flushProgress);
    };
  }, []);

  const renderedBlocks = useMemo(
    () =>
      blocks.map((block) =>
        renderReaderBlock(block, {
          annotations: annotationsByBlockId.get(block.id) || [],
          bookId,
          searchKeyword,
          shouldHighlight: Boolean(searchKeyword) && block.text.includes(searchKeyword),
        }),
      ),
    [annotationsByBlockId, blocks, bookId, readerSearchHighlight.revision, searchKeyword],
  );

  return (
    <article className="reader-content-text reader-scroll-content" ref={contentRef}>
      <div className="reader-selection-overlay" ref={selectionOverlayRef} aria-hidden="true"></div>
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
      <ReaderCopyToast placement="center" visible={copyToastVisible} />
      {previousTitleId !== undefined && (
        <button
          className="reader-scroll-chapter-nav reader-scroll-prev-chapter"
          type="button"
          onClick={() => onNavigateTitle(previousTitleId)}
        >
          {t('reader.previous_chapter')}
        </button>
      )}
      {renderedBlocks}
      {nextTitleId !== undefined && (
        <button
          className="reader-scroll-chapter-nav reader-scroll-next-chapter"
          type="button"
          onClick={() => onNavigateTitle(nextTitleId)}
        >
          {t('reader.next_chapter')}
        </button>
      )}
    </article>
  );
};
