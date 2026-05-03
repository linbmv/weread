import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { debounce, getQuery } from 'ranuts/utils';
import { getBookById } from '@/store/books';
import { transformTextToExpectedFormat } from '@/lib/transformText';
import type { BookInfo } from '@/store/books';
import type { ReaderBlock, TextSyntaxTree } from '@/lib/transformText';
import { ROUTE_PATH } from '@/router';
import { startSpaViewTransition } from '@/lib/navigation';
import { BookDetailOperate, MobileBookDetailOperate } from '@/components/DetailOperate';
import { clearBookDetailMenuSearchState, requestBookDetailMenuSearch } from '@/components/DetailMenu';
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
import { Loading } from '@/components/Loading';
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
  DEFAULT_READER_ANNOTATION_COLOR,
  READER_ANNOTATION_COLORS,
  type ReaderAnnotation,
  type ReaderAnnotationDraft,
  type ReaderStyleAnnotationType,
  deleteReaderAnnotation,
  deleteReaderAnnotations,
  getReaderAnnotations,
  getStoredReaderAnnotationColor,
  saveReaderAnnotation,
  saveReaderAnnotationColor,
  updateReaderAnnotation,
} from '@/lib/readerAnnotations';
import { findKeywordSentenceMatches } from '@/lib/searchText';
import {
  createReaderLocator,
  createReaderScrollLocator,
  getReaderProgress,
  resolveReaderLocatorPage,
  saveReaderProgress,
} from '@/lib/readerProgress';
import type { ReaderLocator } from '@/lib/readerProgress';
import {
  type ChapterLayoutFingerprint,
  type ChapterPagination,
  estimateChapterPageCount,
  getCachedChapterPagination,
  measureChapterPagination,
  setCachedChapterPagination,
} from '@/lib/chapterPagination';
import 'ranui/icon';
import 'ranui/input';
import './index.scss';

const MOBILE_ICON_STYLE = {
  '--ran-icon-font-size': '36px',
  '--ran-icon-color': 'var(--icon-color-1)',
};

const ReaderPagePreviousIcon = (): React.JSX.Element => (
  <svg className="reader-page-nav-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m15 18l-6-6l6-6"
    />
  </svg>
);

const ReaderPageNextIcon = (): React.JSX.Element => (
  <svg className="reader-page-nav-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m9 18l6-6l-6-6"
    />
  </svg>
);

type ReaderAnnotationColorMap = Record<ReaderStyleAnnotationType, string>;

const getStoredReaderAnnotationColorMap = (): ReaderAnnotationColorMap => ({
  marker: getStoredReaderAnnotationColor('marker'),
  underline: getStoredReaderAnnotationColor('underline'),
  wave: getStoredReaderAnnotationColor('wave'),
});

const isEditableSelectionTarget = (target: EventTarget | null): boolean => {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
};

const isReaderControlSelectionTarget = (target: EventTarget | null): boolean => {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '.reader-note-modal-layer, .reader-page-title-label, .reader-scroll-chapter-nav, .reader-page-nav-button, .reader-selection-menu, .readerControls, button, a, r-icon',
      ),
    )
  );
};

const preventReaderContextMenu = (e: React.MouseEvent<HTMLElement>): void => {
  if (isEditableSelectionTarget(e.target)) return;
  e.preventDefault();
};

const getSelectionContainerNode = (node: Node | null): Node | null => {
  return node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
};

const isSelectionInContainer = (selection: Selection, container: HTMLElement): boolean => {
  const anchorNode = getSelectionContainerNode(selection.anchorNode);
  const focusNode = getSelectionContainerNode(selection.focusNode);
  return Boolean(
    (anchorNode && container.contains(anchorNode)) ||
      (focusNode && container.contains(focusNode)),
  );
};

const DEFAULT_READER_FONT_SIZE = 18;

const resolveFontSize = (target: Element, fallback: number): number => {
  const value = Number.parseFloat(window.getComputedStyle(target).fontSize);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getSelectionFallbackFontSize = (range: Range, container: HTMLElement): number => {
  const node = getSelectionContainerNode(range.commonAncestorContainer);
  const element = node instanceof Element ? node : null;
  const block = element?.closest<HTMLElement>('.reader-content-block');
  const target = block && container.contains(block) ? block : container;
  return resolveFontSize(target, DEFAULT_READER_FONT_SIZE);
};

const getBlockFontSize = (
  block: HTMLElement,
  cache: Map<HTMLElement, number>,
  fallback: number,
): number => {
  const cached = cache.get(block);
  if (cached !== undefined) return cached;
  const resolved = resolveFontSize(block, fallback);
  cache.set(block, resolved);
  return resolved;
};

interface ClientRectLike {
  height: number;
  left: number;
  top: number;
  width: number;
}

const getRectFontSize = (
  rect: ClientRectLike,
  container: HTMLElement,
  fallback: number,
  cache: Map<HTMLElement, number>,
): number => {
  const probeX = rect.width >= 2 ? rect.left + rect.width / 2 : rect.left + 1;
  const probeY = rect.top + rect.height / 2;
  const target = document.elementFromPoint(probeX, probeY);
  if (!(target instanceof Element) || !container.contains(target)) return fallback;
  const block = target.closest<HTMLElement>('.reader-content-block');
  if (!block || !container.contains(block)) return fallback;
  return getBlockFontSize(block, cache, fallback);
};

const getRectProbeElement = (rect: ClientRectLike, container: HTMLElement): Element | null => {
  const probeX = rect.width >= 2 ? rect.left + rect.width / 2 : rect.left + 1;
  const probeY = rect.top + rect.height / 2;
  const target = document.elementFromPoint(probeX, probeY);
  return target instanceof Element && container.contains(target) ? target : null;
};

const getSelectionClipRect = (container: HTMLElement): DOMRect => {
  return container.closest<HTMLElement>('.reader-page-window')?.getBoundingClientRect() ?? container.getBoundingClientRect();
};

interface CaretPoint {
  node: Node;
  offset: number;
}

const getCaretAtPoint = (x: number, y: number): CaretPoint | null => {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
};

const buildOrderedRange = (
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number,
): Range => {
  const anchorProbe = document.createRange();
  anchorProbe.setStart(anchorNode, anchorOffset);
  anchorProbe.setEnd(anchorNode, anchorOffset);
  const focusProbe = document.createRange();
  focusProbe.setStart(focusNode, focusOffset);
  focusProbe.setEnd(focusNode, focusOffset);

  const range = document.createRange();
  if (anchorProbe.compareBoundaryPoints(Range.START_TO_START, focusProbe) <= 0) {
    range.setStart(anchorNode, anchorOffset);
    range.setEnd(focusNode, focusOffset);
  } else {
    range.setStart(focusNode, focusOffset);
    range.setEnd(anchorNode, anchorOffset);
  }
  return range;
};

interface PointerSelectionState {
  pointerId: number;
  anchorNode: Node;
  anchorOffset: number;
  capturedTarget: HTMLElement;
  focusNode: Node;
  focusOffset: number;
  lastClientX: number;
  lastClientY: number;
}

interface ReaderSelectionMenuState {
  annotation?: ReaderAnnotation;
  bottom: number;
  drafts: ReaderAnnotationDraft[];
  hasFormat: boolean;
  left: number;
  mode: 'annotation' | 'selection';
  noteAnnotation?: ReaderAnnotation;
  placement: 'bottom' | 'top';
  styleAnnotation?: ReaderAnnotation;
  text: string;
  top: number;
}

interface ReaderSelectionOverlayState {
  clearSelection: () => void;
  copySelection: () => Promise<boolean>;
  menuState: ReaderSelectionMenuState | null;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

const getTextOffsetInBlock = (blockElement: HTMLElement, node: Node, offset: number): number => {
  const blockTextLength = blockElement.textContent?.length || 0;
  if (node !== blockElement && !blockElement.contains(node)) return 0;

  const range = document.createRange();
  range.selectNodeContents(blockElement);
  try {
    range.setEnd(node, offset);
    return Math.min(Math.max(range.toString().length, 0), blockTextLength);
  } catch {
    return blockTextLength;
  }
};

const rangeIntersectsBlock = (range: Range, blockRange: Range): boolean => {
  return (
    range.compareBoundaryPoints(Range.END_TO_START, blockRange) > 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, blockRange) < 0
  );
};

const rangeIntersectsBlockElement = (range: Range, blockElement: HTMLElement): boolean => {
  try {
    return range.intersectsNode(blockElement);
  } catch {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(blockElement);
    return rangeIntersectsBlock(range, blockRange);
  }
};

const getSelectionDrafts = (range: Range, container: HTMLElement): ReaderAnnotationDraft[] => {
  const blockElements = Array.from(container.querySelectorAll<HTMLElement>('.reader-content-block[data-reader-block-id]'));
  const drafts: ReaderAnnotationDraft[] = [];

  blockElements.forEach((blockElement) => {
    if (!rangeIntersectsBlockElement(range, blockElement)) return;

    const blockText = blockElement.textContent || '';
    const startsInBlock = blockElement.contains(range.startContainer);
    const endsInBlock = blockElement.contains(range.endContainer);
    const startOffset = startsInBlock ? getTextOffsetInBlock(blockElement, range.startContainer, range.startOffset) : 0;
    const endOffset = endsInBlock ? getTextOffsetInBlock(blockElement, range.endContainer, range.endOffset) : blockText.length;
    const start = Math.min(Math.max(startOffset, 0), blockText.length);
    const end = Math.min(Math.max(endOffset, 0), blockText.length);
    if (start === end) return;

    drafts.push({
      blockId: blockElement.dataset.readerBlockId || '',
      endOffset: Math.max(start, end),
      startOffset: Math.min(start, end),
      text: blockText,
      titleId: blockElement.dataset.readerTitleId ? Number(blockElement.dataset.readerTitleId) : undefined,
    });
  });

  return drafts.filter((draft) => draft.blockId && draft.text.slice(draft.startOffset, draft.endOffset).trim());
};

const getVisibleSelectionRects = (range: Range, container: HTMLElement): ClientRectLike[] => {
  const clipRect = getSelectionClipRect(container);
  const rects = Array.from(range.getClientRects());
  const visibleRects: ClientRectLike[] = [];

  rects.forEach((rect) => {
    if (rect.width <= 0 || rect.height <= 0) return;

    const clippedLeft = Math.max(rect.left, clipRect.left);
    const clippedRight = Math.min(rect.right, clipRect.right);
    const clippedTop = Math.max(rect.top, clipRect.top);
    const clippedBottom = Math.min(rect.bottom, clipRect.bottom);
    const clippedWidth = clippedRight - clippedLeft;
    const clippedHeight = clippedBottom - clippedTop;
    if (clippedWidth <= 0 || clippedHeight <= 0) return;

    const clippedRect = {
      height: clippedHeight,
      left: clippedLeft,
      top: clippedTop,
      width: clippedWidth,
    };
    if (isReaderControlSelectionTarget(getRectProbeElement(clippedRect, container))) return;
    visibleRects.push(clippedRect);
  });

  return visibleRects;
};

const READER_SELECTION_MENU_HEIGHT = 62;

const READER_SELECTION_COLOR_PICKER_HEIGHT = 54;

const READER_SELECTION_MENU_GAP = 12;

const getReaderMenuTopBoundary = (): number => {
  const scrollHeader = document.querySelector<HTMLElement>('.reader-scroll-mode-header');
  if (!scrollHeader) return 12;
  const rect = scrollHeader.getBoundingClientRect();
  return Math.max(rect.bottom + READER_SELECTION_MENU_GAP, 12);
};

const getReaderSelectionMenuTopHeight = (hasColorPicker = false): number => {
  return READER_SELECTION_MENU_HEIGHT + (hasColorPicker ? READER_SELECTION_COLOR_PICKER_HEIGHT : 0) + READER_SELECTION_MENU_GAP;
};

const getReaderSelectionMenuPlacement = (top: number, hasColorPicker = false): 'bottom' | 'top' => {
  return top - getReaderSelectionMenuTopHeight(hasColorPicker) < getReaderMenuTopBoundary() ? 'bottom' : 'top';
};

const getSelectionMenuState = (range: Range, container: HTMLElement): ReaderSelectionMenuState | null => {
  const text = range.toString();
  if (!text.trim()) return null;

  const visibleRects = getVisibleSelectionRects(range, container);
  if (visibleRects.length === 0) return null;
  const drafts = getSelectionDrafts(range, container);
  if (drafts.length === 0) return null;

  const left = Math.min(...visibleRects.map((rect) => rect.left));
  const right = Math.max(...visibleRects.map((rect) => rect.left + rect.width));
  const top = Math.min(...visibleRects.map((rect) => rect.top));
  const bottom = Math.max(...visibleRects.map((rect) => rect.top + rect.height));
  const topAnchor = top - READER_SELECTION_MENU_GAP;
  const bottomAnchor = bottom + READER_SELECTION_MENU_GAP;
  return {
    bottom: bottomAnchor,
    drafts,
    hasFormat: false,
    left: Math.min(Math.max((left + right) / 2, 24), window.innerWidth - 24),
    mode: 'selection',
    placement: getReaderSelectionMenuPlacement(topAnchor),
    text,
    top: topAnchor,
  };
};

const createAnnotationDraft = (annotation: ReaderAnnotation, blockText = annotation.text): ReaderAnnotationDraft => ({
  blockId: annotation.blockId,
  endOffset: annotation.endOffset,
  startOffset: annotation.startOffset,
  text: blockText,
  titleId: annotation.titleId,
});

const getAnnotationMenuState = (
  styleAnnotation: ReaderAnnotation | undefined,
  noteAnnotation: ReaderAnnotation | undefined,
  targetElement: HTMLElement,
): ReaderSelectionMenuState | null => {
  const rects = Array.from(targetElement.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;
  const annotation = styleAnnotation || noteAnnotation;
  if (!annotation) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const topAnchor = top - READER_SELECTION_MENU_GAP;
  const bottomAnchor = bottom + READER_SELECTION_MENU_GAP;
  const blockText =
    targetElement.closest<HTMLElement>('.reader-content-block[data-reader-block-id]')?.textContent || annotation.text;
  return {
    annotation,
    bottom: bottomAnchor,
    drafts: [createAnnotationDraft(styleAnnotation || noteAnnotation!, blockText)],
    hasFormat: Boolean(styleAnnotation),
    left: Math.min(Math.max((left + right) / 2, 24), window.innerWidth - 24),
    mode: 'annotation',
    noteAnnotation,
    placement: getReaderSelectionMenuPlacement(topAnchor, Boolean(styleAnnotation)),
    styleAnnotation,
    text: annotation.text,
    top: topAnchor,
  };
};

const writeClipboardText = async (text: string): Promise<boolean> => {
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

const useReaderSelectionOverlay = (
  containerRef: React.RefObject<HTMLElement | null>,
  annotations: ReaderAnnotation[] = [],
): ReaderSelectionOverlayState => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const pointerRef = useRef<PointerSelectionState | null>(null);
  const annotationsRef = useRef(annotations);
  const suppressSelectionUpdateUntilRef = useRef(0);
  const [menuState, setMenuState] = useState<ReaderSelectionMenuState | null>(null);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  const clearOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (overlay?.firstChild) {
      overlay.replaceChildren();
    }
    setMenuState(null);
  }, []);

  const renderRange = useCallback(
    (range: Range | null, options: { showMenu?: boolean } = {}) => {
      const { showMenu = true } = options;
      const container = containerRef.current;
      const overlay = overlayRef.current;
      if (!container || !overlay) return;

      if (!range || range.collapsed) {
        if (overlay.firstChild) overlay.replaceChildren();
        setMenuState(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const fallbackFontSize = getSelectionFallbackFontSize(range, container);
      const blockFontSizeCache = new Map<HTMLElement, number>();

      const rects = getVisibleSelectionRects(range, container);
      const existingCount = overlay.children.length;
      let renderedRectCount = 0;
      let fragment: DocumentFragment | null = null;

      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        const fontSize = getRectFontSize(rect, container, fallbackFontSize, blockFontSizeCache);
        const visualHeight = Math.min(rect.height, fontSize + 2);
        const top = rect.top - containerRect.top + (rect.height - visualHeight) / 2;
        const left = rect.left - containerRect.left;

        let highlight: HTMLDivElement;
        if (renderedRectCount < existingCount) {
          highlight = overlay.children[renderedRectCount] as HTMLDivElement;
        } else {
          highlight = document.createElement('div');
          highlight.className = 'reader-selection-overlay-rect';
          if (!fragment) fragment = document.createDocumentFragment();
          fragment.appendChild(highlight);
        }
        highlight.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${visualHeight}px`;
        renderedRectCount++;
      }

      if (fragment) {
        overlay.appendChild(fragment);
      }
      while (overlay.children.length > renderedRectCount) {
        overlay.lastElementChild?.remove();
      }
      const nextMenuState = showMenu ? getSelectionMenuState(range, container) : null;
      setMenuState(nextMenuState);
    },
    [containerRef],
  );

  const renderFromSelection = useCallback(() => {
    if (pointerRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const selection = window.getSelection();
    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !isSelectionInContainer(selection, container)
    ) {
      clearOverlay();
      return;
    }
    renderRange(selection.getRangeAt(0));
  }, [clearOverlay, containerRef, renderRange]);

  const updateFromPointer = useCallback((showMenu = false): Range | null => {
    const state = pointerRef.current;
    const container = containerRef.current;
    if (!state || !container) return null;

    const caret = getCaretAtPoint(state.lastClientX, state.lastClientY);
    let focusNode = state.focusNode;
    let focusOffset = state.focusOffset;
    if (caret && container.contains(caret.node)) {
      focusNode = caret.node;
      focusOffset = caret.offset;
      state.focusNode = focusNode;
      state.focusOffset = focusOffset;
    }

    const range = buildOrderedRange(state.anchorNode, state.anchorOffset, focusNode, focusOffset);

    renderRange(range, { showMenu });
    return range;
  }, [containerRef, renderRange]);

  const scheduleSelectionUpdate = useCallback(() => {
    if (Date.now() < suppressSelectionUpdateUntilRef.current) return;
    if (selectionFrameRef.current !== null) return;
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      selectionFrameRef.current = null;
      renderFromSelection();
    });
  }, [renderFromSelection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (isEditableSelectionTarget(target)) return;
      if (isReaderControlSelectionTarget(target)) return;
      const annotationElement = target.closest<HTMLElement>('[data-reader-annotation-id]');
      if (annotationElement && container.contains(annotationElement)) {
        const styleAnnotationId = annotationElement.dataset.readerStyleAnnotationId;
        const noteAnnotationId = annotationElement.dataset.readerNoteAnnotationId;
        const styleAnnotation = styleAnnotationId
          ? annotationsRef.current.find((item) => item.id === styleAnnotationId)
          : undefined;
        const noteAnnotation = noteAnnotationId
          ? annotationsRef.current.find((item) => item.id === noteAnnotationId)
          : undefined;
        const nextMenuState = getAnnotationMenuState(styleAnnotation, noteAnnotation, annotationElement);
        suppressSelectionUpdateUntilRef.current = Date.now() + 120;
        window.getSelection()?.removeAllRanges();
        clearOverlay();
        setMenuState(nextMenuState);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const caret = getCaretAtPoint(e.clientX, e.clientY);
      if (!caret || !container.contains(caret.node)) return;

      let anchorNode: Node = caret.node;
      let anchorOffset = caret.offset;
      if (e.shiftKey) {
        const sel = window.getSelection();
        if (sel?.anchorNode && container.contains(sel.anchorNode)) {
          anchorNode = sel.anchorNode;
          anchorOffset = sel.anchorOffset;
        }
      }

      pointerRef.current = {
        pointerId: e.pointerId,
        anchorNode,
        anchorOffset,
        capturedTarget: target as HTMLElement,
        focusNode: anchorNode,
        focusOffset: anchorOffset,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
      };

      suppressSelectionUpdateUntilRef.current = Date.now() + 600;
      window.getSelection()?.removeAllRanges();
      clearOverlay();

      try {
        (target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}

      e.preventDefault();

      if (e.shiftKey) updateFromPointer(false);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const state = pointerRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      state.lastClientX = e.clientX;
      state.lastClientY = e.clientY;

      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = window.requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        updateFromPointer(false);
      });
    };

    const finishPointer = (e: PointerEvent) => {
      const state = pointerRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      state.lastClientX = e.clientX;
      state.lastClientY = e.clientY;
      suppressSelectionUpdateUntilRef.current = Date.now() + 120;
      const finalRange = updateFromPointer(true);

      try {
        state.capturedTarget.releasePointerCapture(e.pointerId);
      } catch {}
      pointerRef.current = null;
      if (!finalRange) {
        scheduleSelectionUpdate();
      }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', finishPointer);
    container.addEventListener('pointercancel', finishPointer);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', finishPointer);
      container.removeEventListener('pointercancel', finishPointer);
    };
  }, [clearOverlay, containerRef, scheduleSelectionUpdate, updateFromPointer]);

  useEffect(() => {
    document.addEventListener('selectionchange', scheduleSelectionUpdate);
    window.addEventListener('resize', scheduleSelectionUpdate);
    window.addEventListener(READER_SETTING_CHANGE_EVENT, scheduleSelectionUpdate);
    return () => {
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      if (selectionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
      }
      document.removeEventListener('selectionchange', scheduleSelectionUpdate);
      window.removeEventListener('resize', scheduleSelectionUpdate);
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, scheduleSelectionUpdate);
      clearOverlay();
    };
  }, [clearOverlay, scheduleSelectionUpdate]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    clearOverlay();
  }, [clearOverlay]);

  const copySelection = useCallback(async () => {
    const selection = window.getSelection();
    const text =
      selection && selection.rangeCount > 0 && !selection.isCollapsed && containerRef.current
        ? selection.toString()
        : menuState?.text;
    return writeClipboardText(text || '');
  }, [containerRef, menuState?.text]);

  return { clearSelection, copySelection, menuState, overlayRef };
};

interface ReaderLayout {
  pageWidth: number;
  pageGap: number;
  pageStep: number;
  pageHeight: number;
}

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

interface ReaderScrollContentProps {
  textSyntaxTree: TextSyntaxTree;
  titleId: number;
  bookId?: string;
  navigationRevision?: number;
  onNavigateTitle: (titleId: number) => void;
  progressLocator?: ReaderLocator;
  targetBlockId?: string;
  targetBlockRatio?: number;
}

interface ReaderSelectionMenuProps {
  onApplyAnnotation: (type: ReaderStyleAnnotationType, color?: string) => ReaderAnnotation[];
  onDeleteAnnotation: (annotationIds?: string[]) => void;
  onDeleteNote: () => void;
  onOpenNote: () => void;
  onSearchSelection: (keyword: string) => void;
  onSelectColor: (type: ReaderStyleAnnotationType, color: string) => void;
  selectedColors: ReaderAnnotationColorMap;
  state: ReaderSelectionMenuState | null;
  onCopy: () => void;
}

interface ReaderNoteEditorState {
  annotation?: ReaderAnnotation;
  drafts: ReaderAnnotationDraft[];
  noteText: string;
  quote: string;
}

interface ReaderNoteModalProps {
  onCancel: () => void;
  onSave: (noteText: string) => void;
  state: ReaderNoteEditorState | null;
}

const SelectionCopyIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none">
      <path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z" />
      <path
        fill="currentColor"
        d="M19 2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2zm-4 6H5v12h10zm-5 7a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm9-11H9v2h6a2 2 0 0 1 2 2v8h2zm-7 7a1 1 0 0 1 .117 1.993L12 13H8a1 1 0 0 1-.117-1.993L8 11z"
      />
    </g>
  </svg>
);

const SelectionMarkerIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="4" fill="rgba(117, 119, 120, 1)" />
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M5 19l7-14 7 14M7 15h10"
    />
  </svg>
);

const SelectionWavyIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m6 16l6-12l6 12M8 12h8M4 21c1.1 0 1.1-1 2.3-1s1.1 1 2.3 1c1.1 0 1.1-1 2.3-1c1.1 0 1.1 1 2.3 1c1.1 0 1.1-1 2.3-1c1.1 0 1.1 1 2.3 1c1.1 0 1.1-1 2.3-1"
    />
  </svg>
);

const SelectionUnderlineIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M4 20h16M6 16l6-12l6 12M8 12h8"
    />
  </svg>
);

const SelectionNoteIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M13 21h8m.174-14.188a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
    />
  </svg>
);

const SelectionSearchIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path d="m21 21l-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </g>
  </svg>
);

const SelectionClearFormatIcon = (): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21m-7.752-9.91l8.828 8.828"
    />
  </svg>
);

const formatAnnotationTime = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}`;
};

const ReaderSelectionMenu = ({
  state,
  onApplyAnnotation,
  onCopy,
  onDeleteAnnotation,
  onDeleteNote,
  onOpenNote,
  onSearchSelection,
  onSelectColor,
  selectedColors,
}: ReaderSelectionMenuProps): React.JSX.Element | null => {
  const [appliedSelectionType, setAppliedSelectionType] = useState<ReaderStyleAnnotationType | null>(null);
  const [appliedAnnotationIds, setAppliedAnnotationIds] = useState<string[]>([]);
  const [renderState, setRenderState] = useState<ReaderSelectionMenuState | null>(state);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setAppliedSelectionType(null);
    setAppliedAnnotationIds([]);
  }, [state?.annotation?.id, state?.bottom, state?.left, state?.mode, state?.placement, state?.text, state?.top]);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (state) {
      setRenderState(state);
      setIsClosing(false);
      return;
    }
    if (!renderState) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setRenderState(null);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 140);
  }, [renderState, state]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const currentState = state || renderState;
  if (!currentState) return null;

  const keepSelection = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const applyAnnotation = (type: ReaderStyleAnnotationType) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setAppliedSelectionType(type);
    setAppliedAnnotationIds(onApplyAnnotation(type).map((annotation) => annotation.id));
  };

  const openNote = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenNote();
  };

  const searchSelection = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSearchSelection(currentState.text);
  };

  const deleteAnnotation = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteAnnotation(appliedAnnotationIds.length > 0 ? appliedAnnotationIds : undefined);
  };

  const deleteNote = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteNote();
  };

  const selectColor = (color: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeStyleType) return;
    onSelectColor(activeStyleType, color);
    if (appliedSelectionType) {
      setAppliedAnnotationIds(onApplyAnnotation(appliedSelectionType, color).map((annotation) => annotation.id));
    }
  };

  const stateStyleType = currentState.styleAnnotation?.type;
  const activeStyleType: ReaderStyleAnnotationType | null =
    appliedSelectionType || (stateStyleType && stateStyleType !== 'note' ? stateStyleType : null);
  const showColorPicker = Boolean(activeStyleType);
  const showClearFormat = currentState.hasFormat || appliedAnnotationIds.length > 0;
  const placement =
    currentState.placement === 'top' && currentState.top - getReaderSelectionMenuTopHeight(showColorPicker) < getReaderMenuTopBoundary()
      ? 'bottom'
      : currentState.placement;
  const note = currentState.noteAnnotation;

  return (
    <>
      {note?.noteText ? (
        <div
          className={`reader-selection-note-card ${isClosing ? 'is-closing' : ''}`}
          onMouseDown={keepSelection}
          onPointerDown={keepSelection}
        >
          <div className="reader-selection-note-card-bg">
            <div className="reader-selection-note-card-time">{formatAnnotationTime(note.updatedAt || note.createdAt)}</div>
            <div className="reader-selection-note-card-content">{note.noteText}</div>
            <div className="reader-selection-note-card-actions">
              <button className="reader-selection-note-card-delete" type="button" onClick={deleteNote}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={`reader-selection-menu ${isClosing ? 'is-closing' : ''}`}
        data-placement={placement}
        style={{ left: currentState.left, top: placement === 'top' ? currentState.top : currentState.bottom }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={keepSelection}
        onPointerDown={keepSelection}
      >
      {showColorPicker ? (
        <div className="reader-selection-color-container">
          {READER_ANNOTATION_COLORS.map((color) => (
            <button
              aria-label={`选择颜色 ${color}`}
              className="reader-selection-color-item"
              key={color}
              style={{ background: color }}
              type="button"
              onClick={selectColor(color)}
            >
                {activeStyleType && selectedColors[activeStyleType] === color ? (
                  <span className="reader-selection-color-selected"></span>
                ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <button className="reader-selection-menu-item" type="button" onClick={onCopy}>
        <SelectionCopyIcon />
        <span>复制</span>
      </button>
      <button
        className={`reader-selection-menu-item ${activeStyleType === 'marker' ? 'is-selected' : ''}`}
        type="button"
        onClick={applyAnnotation('marker')}
      >
        <SelectionMarkerIcon />
        <span>马克笔</span>
      </button>
      <button
        className={`reader-selection-menu-item ${activeStyleType === 'wave' ? 'is-selected' : ''}`}
        type="button"
        onClick={applyAnnotation('wave')}
      >
        <SelectionWavyIcon />
        <span>波浪线</span>
      </button>
      <button
        className={`reader-selection-menu-item ${activeStyleType === 'underline' ? 'is-selected' : ''}`}
        type="button"
        onClick={applyAnnotation('underline')}
      >
        <SelectionUnderlineIcon />
        <span>直线</span>
      </button>
      <button className="reader-selection-menu-item second-item" type="button" onClick={openNote}>
        <SelectionNoteIcon />
        <span>写想法</span>
      </button>
      <button className="reader-selection-menu-item second-item" type="button" onClick={searchSelection}>
        <SelectionSearchIcon />
        <span>查询</span>
      </button>
      {showClearFormat && (
        <button className="reader-selection-menu-item second-item" type="button" onClick={deleteAnnotation}>
          <SelectionClearFormatIcon />
          <span>清除格式</span>
        </button>
      )}
      </div>
    </>
  );
};

const ReaderCopyToast = ({
  placement = 'top',
  visible,
}: {
  placement?: 'center' | 'top';
  visible: boolean;
}): React.JSX.Element | null => {
  if (!visible) return null;
  return <div className={`reader-copy-toast ${placement === 'center' ? 'is-center' : ''}`}>已复制到剪切版</div>;
};

const ReaderNoteModal = ({ state, onCancel, onSave }: ReaderNoteModalProps): React.JSX.Element | null => {
  const [value, setValue] = useState('');
  const [renderState, setRenderState] = useState<ReaderNoteEditorState | null>(state);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (state) setValue(state.noteText || '');
  }, [state]);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (state) {
      setRenderState(state);
      setIsClosing(false);
      return;
    }
    if (!renderState) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setRenderState(null);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 140);
  }, [renderState, state]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const currentState = state || renderState;
  if (!currentState) return null;

  const trimmedValue = value.trim();

  return (
    <div className={`reader-note-modal-layer ${isClosing ? 'is-closing' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="reader-note-modal">
        <button className="reader-note-modal-close" aria-label="关闭" type="button" onClick={onCancel}>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M18 6L6 18M6 6l12 12"
            />
          </svg>
        </button>
        <div className="reader-note-modal-title">写想法</div>
        <div className="reader-note-modal-quote">{currentState.quote}</div>
        <textarea
          autoFocus
          className="reader-note-modal-input"
          maxLength={1000}
          placeholder="写下你的想法"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="reader-note-modal-actions">
          <button
            className="reader-note-modal-button is-primary"
            disabled={!trimmedValue}
            type="button"
            onClick={() => onSave(trimmedValue)}
          >
            发布
          </button>
        </div>
      </div>
    </div>
  );
};

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

const getPageTitle = (textSyntaxTree: TextSyntaxTree, pageNum: number): string => {
  const titleId = textSyntaxTree.pageTitleId[pageNum] ?? textSyntaxTree.pageTitleId[0] ?? 0;
  return textSyntaxTree.titleIdTitle[titleId] || '';
};

const getFirstTitleId = (textSyntaxTree: TextSyntaxTree): number => {
  return textSyntaxTree.sequences[0]?.titleId ?? (textSyntaxTree.titleIdTitle.length > 0 ? 0 : 0);
};

const isValidTitleId = (textSyntaxTree: TextSyntaxTree, titleId: number | undefined): titleId is number => {
  return typeof titleId === 'number' && titleId >= 0 && titleId < textSyntaxTree.titleIdTitle.length;
};

const getTitleIdByPage = (textSyntaxTree: TextSyntaxTree, pageNum: number): number => {
  const titleId = textSyntaxTree.pageTitleId[pageNum] ?? textSyntaxTree.pageTitleId[0];
  return isValidTitleId(textSyntaxTree, titleId) ? titleId : getFirstTitleId(textSyntaxTree);
};

const getReaderProgressTitleId = (bookId: string | undefined, textSyntaxTree: TextSyntaxTree): number | undefined => {
  const titleId = getReaderProgress(bookId)?.titleId;
  return isValidTitleId(textSyntaxTree, titleId) ? titleId : undefined;
};

const getScrollInitialTitleId = (
  bookId: string | undefined,
  pageNum: number,
  textSyntaxTree: TextSyntaxTree,
): number => {
  if (pageNum > 0) return getTitleIdByPage(textSyntaxTree, pageNum);
  return getReaderProgressTitleId(bookId, textSyntaxTree) ?? getTitleIdByPage(textSyntaxTree, pageNum);
};

const getVisiblePageCount = (currentDevice: DEVICE_ENUM): 1 | 2 => {
  return currentDevice === DEVICE_ENUM.DESKTOP ? 2 : 1;
};

const getInitialPageWidth = (visiblePages: 1 | 2): number => {
  if (typeof window === 'undefined') return visiblePages === 2 ? 640 : 360;
  if (visiblePages === 2) return Math.min(Math.max(Math.floor(window.innerWidth * 0.32), 520), 760);
  return Math.min(Math.max(window.innerWidth - 64, 280), 720);
};

const buildChapterLayoutFingerprint = (layout: ReaderLayout): ChapterLayoutFingerprint => {
  let fontFamily = '';
  let fontSize = 18;
  let lineHeight = 40;
  let paragraphGap = 20;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const style = window.getComputedStyle(root);
    fontFamily = style.getPropertyValue('--reader-font-family').trim();
    const sizeValue = Number.parseFloat(style.getPropertyValue('--reader-font-size'));
    if (Number.isFinite(sizeValue) && sizeValue > 0) fontSize = sizeValue;
    const lineHeightValue = Number.parseFloat(style.getPropertyValue('--reader-line-height'));
    if (Number.isFinite(lineHeightValue) && lineHeightValue > 0) lineHeight = lineHeightValue;
    const paragraphGapValue = Number.parseFloat(style.getPropertyValue('--reader-paragraph-gap'));
    if (Number.isFinite(paragraphGapValue) && paragraphGapValue >= 0) paragraphGap = paragraphGapValue;
  }
  return {
    fontFamily,
    fontSize,
    pageWidth: layout.pageWidth,
    pageHeight: layout.pageHeight,
    pageGap: layout.pageGap,
    paragraphGap,
    lineHeight,
  };
};

const chapterFingerprintEqual = (a: ChapterLayoutFingerprint, b: ChapterLayoutFingerprint): boolean =>
  a.fontFamily === b.fontFamily &&
  a.fontSize === b.fontSize &&
  a.pageWidth === b.pageWidth &&
  a.pageHeight === b.pageHeight &&
  a.pageGap === b.pageGap &&
  a.paragraphGap === b.paragraphGap &&
  a.lineHeight === b.lineHeight;

const buildPageTitleId = (pageCount: number, titleIdPage: Record<string, number>, firstTitleId = 0): number[] => {
  const orderedTitles = Object.entries(titleIdPage)
    .map(([titleId, page]) => ({ titleId: Number(titleId), page }))
    .filter((item) => Number.isFinite(item.titleId))
    .sort((a, b) => a.page - b.page || a.titleId - b.titleId);

  return Array.from({ length: pageCount }, (_, page) => {
    let currentTitleId = orderedTitles[0]?.titleId ?? firstTitleId;
    orderedTitles.forEach((item) => {
      if (item.page <= page) {
        currentTitleId = item.titleId;
      }
    });
    return currentTitleId;
  });
};

const renderHighlightedText = (text: string, keyword: string): React.ReactNode => {
  if (!keyword) return text;

  const nodes: React.ReactNode[] = [];
  let fromIndex = 0;

  findKeywordSentenceMatches(text, keyword).forEach((sentenceMatch, sentenceIndex) => {
    if (sentenceMatch.start > fromIndex) {
      nodes.push(text.slice(fromIndex, sentenceMatch.start));
    }

    const sentenceNodes: React.ReactNode[] = [];
    let sentenceFromIndex = 0;
    let matchIndex = sentenceMatch.sentence.indexOf(keyword, sentenceFromIndex);

    while (matchIndex !== -1) {
      if (matchIndex > sentenceFromIndex) {
        sentenceNodes.push(sentenceMatch.sentence.slice(sentenceFromIndex, matchIndex));
      }
      sentenceNodes.push(
        <span className="reader-search-match-highlight" key={`${sentenceIndex}-${matchIndex}`}>
          {sentenceMatch.sentence.slice(matchIndex, matchIndex + keyword.length)}
        </span>,
      );
      sentenceFromIndex = matchIndex + keyword.length;
      matchIndex = sentenceMatch.sentence.indexOf(keyword, sentenceFromIndex);
    }

    if (sentenceFromIndex < sentenceMatch.sentence.length) {
      sentenceNodes.push(sentenceMatch.sentence.slice(sentenceFromIndex));
    }

    nodes.push(
      <mark className="reader-search-sentence-highlight" key={`${sentenceMatch.start}-${sentenceIndex}`}>
        {sentenceNodes}
      </mark>,
    );
    fromIndex = sentenceMatch.end;
  });

  if (fromIndex < text.length) {
    nodes.push(text.slice(fromIndex));
  }

  return nodes;
};

interface ReaderAnnotationSegment {
  end: number;
  noteAnnotation?: ReaderAnnotation;
  start: number;
  styleAnnotation?: ReaderAnnotation;
}

const getBlockAnnotationSegments = (text: string, annotations: ReaderAnnotation[]): ReaderAnnotationSegment[] => {
  if (annotations.length === 0) return [{ start: 0, end: text.length }];

  const points = new Set<number>([0, text.length]);
  const normalizedAnnotations = annotations
    .map((annotation) => ({
      ...annotation,
      endOffset: Math.min(Math.max(annotation.endOffset, 0), text.length),
      startOffset: Math.min(Math.max(annotation.startOffset, 0), text.length),
    }))
    .filter((annotation) => {
      if (annotation.startOffset >= annotation.endOffset) return false;
      return text.slice(annotation.startOffset, annotation.endOffset) === annotation.text;
    });

  normalizedAnnotations.forEach((annotation) => {
    points.add(annotation.startOffset);
    points.add(annotation.endOffset);
  });

  const sortedPoints = Array.from(points).sort((a, b) => a - b);
  const segments: ReaderAnnotationSegment[] = [];

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const start = sortedPoints[i];
    const end = sortedPoints[i + 1];
    if (start === end) continue;
    const styleAnnotation = normalizedAnnotations
      .filter((annotation) => annotation.type !== 'note' && annotation.startOffset < end && annotation.endOffset > start)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const noteAnnotation = normalizedAnnotations
      .filter((annotation) => annotation.type === 'note' && annotation.startOffset < end && annotation.endOffset > start)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    segments.push({ end, noteAnnotation, start, styleAnnotation });
  }

  return segments.length > 0 ? segments : [{ start: 0, end: text.length }];
};

const getAnnotationClassName = ({
  noteAnnotation,
  styleAnnotation,
}: Pick<ReaderAnnotationSegment, 'noteAnnotation' | 'styleAnnotation'>): string => {
  const classNames = ['reader-annotation'];
  if (styleAnnotation) {
    classNames.push(`reader-annotation-${styleAnnotation.type}`);
  }
  if (noteAnnotation) {
    classNames.push('reader-annotation-note');
  }
  return classNames.join(' ');
};

const hasAnnotationSegment = (segment: ReaderAnnotationSegment): boolean => {
  return Boolean(segment.styleAnnotation || segment.noteAnnotation);
};

const getPrimaryAnnotation = (segment: ReaderAnnotationSegment): ReaderAnnotation | undefined => {
  return segment.styleAnnotation || segment.noteAnnotation;
};

const getSegmentKey = (segment: ReaderAnnotationSegment, index: number): string => {
  return `${segment.styleAnnotation?.id || 'plain'}-${segment.noteAnnotation?.id || 'note-empty'}-${segment.start}-${index}`;
};

const renderTextWithAnnotations = (
  text: string,
  annotations: ReaderAnnotation[],
  searchKeyword: string,
  shouldHighlight: boolean,
): React.ReactNode => {
  if (annotations.length === 0) {
    return shouldHighlight ? renderHighlightedText(text, searchKeyword) : text;
  }

  return getBlockAnnotationSegments(text, annotations).map((segment, index) => {
    const segmentText = text.slice(segment.start, segment.end);
    const content = shouldHighlight && segmentText.includes(searchKeyword)
      ? renderHighlightedText(segmentText, searchKeyword)
      : segmentText;
    if (!hasAnnotationSegment(segment)) return <span key={`plain-${segment.start}-${index}`}>{content}</span>;

    const primaryAnnotation = getPrimaryAnnotation(segment);
    const annotationColor = segment.styleAnnotation?.color || segment.noteAnnotation?.color;

    return (
      <span
        className={getAnnotationClassName(segment)}
        data-reader-annotation-id={primaryAnnotation?.id}
        data-reader-note-annotation-id={segment.noteAnnotation?.id}
        data-reader-style-annotation-id={segment.styleAnnotation?.id}
        key={getSegmentKey(segment, index)}
        style={{ '--reader-annotation-color': annotationColor } as CSSProperties}
      >
        {content}
      </span>
    );
  });
};

const renderReaderBlock = (
  block: ReaderBlock,
  {
    annotations = [],
    searchKeyword,
    shouldHighlight,
  }: {
    annotations?: ReaderAnnotation[];
    searchKeyword: string;
    shouldHighlight: boolean;
  },
): React.ReactNode => {
  const content = renderTextWithAnnotations(block.text, annotations, searchKeyword, shouldHighlight);

  if (block.type === 'heading') {
    return (
      <h2
        className={`reader-content-block reader-content-heading reader-content-heading-level-${block.level || 1} ${
          block.breakBefore ? 'reader-content-heading-break-before' : ''
        }`}
        data-reader-block-id={block.id}
        data-reader-title-id={block.titleId}
        key={block.id}
      >
        {content}
      </h2>
    );
  }

  return (
    <p
      className="reader-content-block reader-content-paragraph"
      data-reader-block-id={block.id}
      data-reader-title-id={block.titleId}
      key={block.id}
    >
      {content}
    </p>
  );
};

const getChapterTitleIds = (textSyntaxTree: TextSyntaxTree): number[] => {
  if (textSyntaxTree.sequences.length > 0) {
    return textSyntaxTree.sequences.map((item) => item.titleId);
  }
  return textSyntaxTree.titleIdTitle.map((_, index) => index);
};

const getTitleBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  return textSyntaxTree.blocks.filter((block) => block.titleId === titleId);
};

const isEmptyHeadingTitleBlocks = (blocks: ReaderBlock[]): boolean => {
  return blocks.length > 0 && blocks.every((block) => block.type === 'heading');
};

const getTitleSequenceIndex = (textSyntaxTree: TextSyntaxTree, titleId: number): number => {
  return textSyntaxTree.sequences.findIndex((item) => item.titleId === titleId);
};

const shouldAttachPreviousVolumeTitle = (previousBlocks: ReaderBlock[], currentBlocks: ReaderBlock[]): boolean => {
  if (!isEmptyHeadingTitleBlocks(previousBlocks) || currentBlocks.length === 0) return false;
  return previousBlocks.some((block) => block.level === 2);
};

const getForwardMergedTitleBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  const index = getTitleSequenceIndex(textSyntaxTree, titleId);
  const mergedBlocks: ReaderBlock[] = [];
  if (index < 0) return mergedBlocks;

  for (let i = index; i < textSyntaxTree.sequences.length; i++) {
    const blocks = getTitleBlocks(textSyntaxTree, textSyntaxTree.sequences[i].titleId);
    if (blocks.length === 0) continue;
    mergedBlocks.push(...blocks);
    if (!isEmptyHeadingTitleBlocks(blocks)) break;
  }

  return mergedBlocks;
};

const getPreviousEmptyHeadingBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  const index = getTitleSequenceIndex(textSyntaxTree, titleId);
  const blocks: ReaderBlock[] = [];
  if (index <= 0) return blocks;

  for (let i = index - 1; i >= 0; i--) {
    const previousBlocks = getTitleBlocks(textSyntaxTree, textSyntaxTree.sequences[i].titleId);
    if (!isEmptyHeadingTitleBlocks(previousBlocks)) break;
    blocks.unshift(...previousBlocks);
  }

  return blocks;
};

const getChapterBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  const blocks = getTitleBlocks(textSyntaxTree, titleId);

  if (isEmptyHeadingTitleBlocks(blocks)) {
    const mergedBlocks = getForwardMergedTitleBlocks(textSyntaxTree, titleId);
    if (mergedBlocks.length > blocks.length) return mergedBlocks;
  }

  const previousBlocks = getPreviousEmptyHeadingBlocks(textSyntaxTree, titleId);
  if (shouldAttachPreviousVolumeTitle(previousBlocks, blocks)) {
    return [...previousBlocks, ...blocks];
  }

  return blocks.length > 0 ? blocks : textSyntaxTree.blocks;
};

const getTitlePage = (textSyntaxTree: TextSyntaxTree, titleId: number): number => {
  const page = Number(textSyntaxTree.titleIdPage[titleId]);
  return Number.isFinite(page) ? page : getPageNum();
};

const getScrollRestoreAnchorY = (): number => {
  return Math.min(Math.max(window.innerHeight * 0.28, 120), 220);
};

const createScrollTargetLocator = ({
  blockId,
  bookId,
  ratio,
  textSyntaxTree,
}: {
  blockId: string;
  bookId?: string;
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
        : textSyntaxTree.titleIdPage[block.titleId] ?? 0
      : startPage + Math.round(safeRatio * Math.max((endPage ?? startPage) - startPage, 0));
  const page = Math.min(Math.max(rawPage, 0), Math.max(textSyntaxTree.totalPage || 0, 0));
  const blockLength = Math.max(block.end - block.start, 1);
  const globalProgress =
    textSyntaxTree.rawText.length > 0
      ? Math.min(Math.max((block.start + blockLength * safeRatio) / textSyntaxTree.rawText.length, 0), 1)
      : 0;

  return {
    blockId: block.id,
    blockScrollRatio: safeRatio,
    bookId,
    globalProgress,
    page,
    readingMode: 'scroll',
    textAfter: block.text.slice(-80),
    textBefore: block.text.slice(0, 80),
    titleId: block.titleId,
    updatedAt: Date.now(),
  };
};

const useReaderAnnotationActions = ({
  bookId,
  clearSelection,
  selectionMenuState,
}: {
  bookId?: string;
  clearSelection: () => void;
  selectionMenuState: ReaderSelectionMenuState | null;
}) => {
  const [annotationColors, setAnnotationColors] = useState<ReaderAnnotationColorMap>(getStoredReaderAnnotationColorMap);
  const [noteEditorState, setNoteEditorState] = useState<ReaderNoteEditorState | null>(null);

  useEffect(() => {
    const styleAnnotation = selectionMenuState?.styleAnnotation;
    if (styleAnnotation?.color && styleAnnotation.type !== 'note') {
      setAnnotationColors((prev) => ({ ...prev, [styleAnnotation.type]: styleAnnotation.color }));
    }
  }, [selectionMenuState?.styleAnnotation]);

  const handleSelectColor = useCallback(
    (type: ReaderStyleAnnotationType, color: string) => {
      setAnnotationColors((prev) => ({ ...prev, [type]: color }));
      saveReaderAnnotationColor(color, type);
      if (bookId && selectionMenuState?.styleAnnotation) {
        updateReaderAnnotation(bookId, selectionMenuState.styleAnnotation.id, { color });
      }
    },
    [bookId, selectionMenuState?.styleAnnotation],
  );

  const handleApplyAnnotation = useCallback(
    (type: ReaderStyleAnnotationType, color?: string) => {
      if (!bookId || !selectionMenuState) return [];
      const nextColor = color || annotationColors[type];
      const appliedAnnotations: ReaderAnnotation[] = [];

      if (selectionMenuState.styleAnnotation) {
        selectionMenuState.drafts.forEach((draft) => {
          const annotation = saveReaderAnnotation(bookId, draft, type, nextColor, undefined, selectionMenuState.styleAnnotation?.id);
          if (annotation) appliedAnnotations.push(annotation);
        });
      } else {
        selectionMenuState.drafts.forEach((draft) => {
          const annotation = saveReaderAnnotation(bookId, draft, type, nextColor);
          if (annotation) appliedAnnotations.push(annotation);
        });
      }
      return appliedAnnotations;
    },
    [annotationColors, bookId, selectionMenuState],
  );

  const handleDeleteAnnotation = useCallback((annotationIds?: string[]) => {
    if (bookId && annotationIds?.length) {
      deleteReaderAnnotations(bookId, annotationIds);
    } else if (bookId && selectionMenuState?.styleAnnotation) {
      deleteReaderAnnotation(bookId, selectionMenuState.styleAnnotation.id);
    }
    clearSelection();
  }, [bookId, clearSelection, selectionMenuState?.styleAnnotation]);

  const handleDeleteNote = useCallback(() => {
    if (bookId && selectionMenuState?.noteAnnotation) {
      deleteReaderAnnotation(bookId, selectionMenuState.noteAnnotation.id);
    }
    clearSelection();
  }, [bookId, clearSelection, selectionMenuState?.noteAnnotation]);

  const handleOpenNote = useCallback(() => {
    if (!selectionMenuState) return;
    setNoteEditorState({
      annotation: selectionMenuState.noteAnnotation,
      drafts: selectionMenuState.drafts,
      noteText: selectionMenuState.noteAnnotation?.noteText || '',
      quote: (selectionMenuState.noteAnnotation?.text || selectionMenuState.text).trim(),
    });
  }, [selectionMenuState]);

  const handleSearchSelection = useCallback(
    (keyword: string) => {
      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) return;
      requestBookDetailMenuSearch(normalizedKeyword);
      clearSelection();
    },
    [clearSelection],
  );

  const handleCancelNote = useCallback(() => {
    setNoteEditorState(null);
    clearSelection();
  }, [clearSelection]);

  const handleSaveNote = useCallback(
    (noteText: string) => {
      if (!bookId || !noteEditorState) return;

      if (noteEditorState.annotation) {
        updateReaderAnnotation(bookId, noteEditorState.annotation.id, {
          color: DEFAULT_READER_ANNOTATION_COLOR,
          noteText,
        });
      } else {
        noteEditorState.drafts.forEach((draft) => {
          saveReaderAnnotation(bookId, draft, 'note', DEFAULT_READER_ANNOTATION_COLOR, noteText);
        });
      }
      setNoteEditorState(null);
      clearSelection();
    },
    [bookId, clearSelection, noteEditorState],
  );

  return {
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
  };
};

const ReaderScrollContent = ({
  textSyntaxTree,
  titleId,
  bookId,
  navigationRevision,
  onNavigateTitle,
  progressLocator,
  targetBlockId,
  targetBlockRatio,
}: ReaderScrollContentProps): React.JSX.Element => {
  const contentRef = useRef<HTMLElement>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>(() => getReaderAnnotations(bookId));
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
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const readerSearchHighlight = getReaderSearchHighlight();
  const searchKeyword = readerSearchHighlight.hasResult ? readerSearchHighlight.keyword : '';
  const titleIds = useMemo(() => getChapterTitleIds(textSyntaxTree), [textSyntaxTree]);
  const currentTitleId = isValidTitleId(textSyntaxTree, titleId) ? titleId : getFirstTitleId(textSyntaxTree);
  const currentTitleIndex = Math.max(titleIds.indexOf(currentTitleId), 0);
  const previousTitleId = titleIds[currentTitleIndex - 1];
  const nextTitleId = titleIds[currentTitleIndex + 1];
  const blocks = useMemo(() => getChapterBlocks(textSyntaxTree, currentTitleId), [currentTitleId, textSyntaxTree]);
  const annotationsByBlockId = useMemo(() => {
    const map = new Map<string, ReaderAnnotation[]>();
    annotations.forEach((annotation) => {
      const list = map.get(annotation.blockId);
      if (list) list.push(annotation);
      else map.set(annotation.blockId, [annotation]);
    });
    return map;
  }, [annotations]);

  useEffect(() => {
    const updateAnnotations = () => {
      setAnnotations(getReaderAnnotations(bookId));
    };
    updateAnnotations();
    syncHook.tap(EVENT_NAME.SET_READER_ANNOTATIONS, updateAnnotations);
    return () => {
      syncHook.off(EVENT_NAME.SET_READER_ANNOTATIONS, updateAnnotations);
    };
  }, [bookId]);

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

  const saveScrollLocator = useCallback(() => {
    if (!bookId) return;
    const locator = createReaderScrollLocator({
      bookId,
      contentElement: contentRef.current,
      textSyntaxTree,
    });
    if (locator) {
      saveReaderProgress(locator);
    }
  }, [bookId, textSyntaxTree]);

  const restoreScrollBlock = useCallback((blockId: string, ratio: number, align: 'anchor' | 'center', onRestored?: () => void) => {
    window.requestAnimationFrame(() => {
      const targetElement = contentRef.current?.querySelector<HTMLElement>(`[data-reader-block-id="${blockId}"]`);
      if (!targetElement) return;
      const rect = targetElement.getBoundingClientRect();
      const targetAnchorY = align === 'center' ? window.innerHeight / 2 : getScrollRestoreAnchorY();
      const targetTop = Math.max(window.scrollY + rect.top + rect.height * Math.min(Math.max(ratio, 0), 1) - targetAnchorY, 0);
      window.scrollTo({ behavior: 'auto', top: targetTop });
      onRestored?.();
    });
  }, []);

  const saveScrollTargetLocator = useCallback(
    (blockId: string, ratio: number) => {
      const locator = createScrollTargetLocator({
        blockId,
        bookId,
        ratio,
        textSyntaxTree,
      });
      if (locator) {
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
        restoreScrollBlock(targetBlockId, ratio, 'center', () => {
          saveScrollTargetLocator(targetBlockId, ratio);
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

    window.scrollTo({ behavior: 'auto', top: 0 });
  }, [
    currentTitleId,
    navigationRevision,
    progressLocator?.blockId,
    progressLocator?.blockScrollRatio,
    progressLocator?.titleId,
    progressLocator?.updatedAt,
    restoreScrollBlock,
    saveScrollTargetLocator,
    targetBlockId,
    targetBlockRatio,
  ]);

  useEffect(() => {
    if (!bookId) return;
    let timer: number | undefined;

    const scheduleSave = () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(saveScrollLocator, 180);
    };

    window.addEventListener('scroll', scheduleSave, { passive: true });
    window.addEventListener('resize', scheduleSave);
    window.addEventListener('pagehide', saveScrollLocator);
    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      saveScrollLocator();
      window.removeEventListener('scroll', scheduleSave);
      window.removeEventListener('resize', scheduleSave);
      window.removeEventListener('pagehide', saveScrollLocator);
    };
  }, [bookId, saveScrollLocator]);

  const renderedBlocks = useMemo(
    () =>
      blocks.map((block) =>
        renderReaderBlock(block, {
          annotations: annotationsByBlockId.get(block.id) || [],
          searchKeyword,
          shouldHighlight: Boolean(searchKeyword) && block.text.includes(searchKeyword),
        }),
      ),
    [annotationsByBlockId, blocks, readerSearchHighlight.revision, searchKeyword],
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
          上一章
        </button>
      )}
      {renderedBlocks}
      {nextTitleId !== undefined && (
        <button
          className="reader-scroll-chapter-nav reader-scroll-next-chapter"
          type="button"
          onClick={() => onNavigateTitle(nextTitleId)}
        >
          下一章
        </button>
      )}
    </article>
  );
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
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>(() => getReaderAnnotations(bookId));
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
  const settledMeasureTimerRef = useRef<number | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<ReaderLayout>({ pageWidth: 0, pageGap: 0, pageStep: 0, pageHeight: 0 });
  const [fingerprint, setFingerprint] = useState<ChapterLayoutFingerprint>(() =>
    buildChapterLayoutFingerprint({ pageWidth: 0, pageGap: 0, pageStep: 0, pageHeight: 0 }),
  );
  const [chapterPaginations, setChapterPaginations] = useState<Map<number, ChapterPagination>>(() => new Map());
  const [copyToastVisible, setCopyToastVisible] = useState(false);

  const blocks = textSyntaxTree.blocks;
  const blocksByTitleId = textSyntaxTree.blocksByTitleId;
  const readerSearchHighlight = getReaderSearchHighlight();
  const searchKeyword = readerSearchHighlight.hasResult ? readerSearchHighlight.keyword : '';
  const annotationsByBlockId = useMemo(() => {
    const map = new Map<string, ReaderAnnotation[]>();
    annotations.forEach((annotation) => {
      const list = map.get(annotation.blockId);
      if (list) list.push(annotation);
      else map.set(annotation.blockId, [annotation]);
    });
    return map;
  }, [annotations]);

  useEffect(() => {
    const updateAnnotations = () => {
      setAnnotations(getReaderAnnotations(bookId));
    };
    updateAnnotations();
    syncHook.tap(EVENT_NAME.SET_READER_ANNOTATIONS, updateAnnotations);
    return () => {
      syncHook.off(EVENT_NAME.SET_READER_ANNOTATIONS, updateAnnotations);
    };
  }, [bookId]);

  const showCopyToast = useCallback(() => {
    if (visiblePages !== 2) return;
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
    let titleId: number = titleIdSequence[0];
    let localPage = 0;
    for (let i = 0; i < titleIdSequence.length; i++) {
      const tid = titleIdSequence[i];
      const start = chapterStartPages[tid] ?? 0;
      const nextStart =
        i + 1 < titleIdSequence.length
          ? chapterStartPages[titleIdSequence[i + 1]] ?? totalPage + 1
          : totalPage + 1;
      if (pageNum >= start && pageNum < nextStart) {
        return { currentTitleId: tid, currentLocalPage: Math.max(0, pageNum - start) };
      }
      if (i === titleIdSequence.length - 1) {
        titleId = tid;
        localPage = Math.max(0, pageNum - start);
      }
    }
    return { currentTitleId: titleId, currentLocalPage: localPage };
  }, [pageNum, titleIdSequence, chapterStartPages, totalPage]);

  const currentChapterBlocks = useMemo(() => {
    if (currentTitleId === undefined) return [] as ReaderBlock[];
    return getChapterBlocks(textSyntaxTree, currentTitleId);
  }, [textSyntaxTree, currentTitleId]);

  const currentChapterPagination =
    currentTitleId !== undefined ? chapterPaginations.get(currentTitleId) : undefined;
  const safeLocalPage = currentChapterPagination
    ? Math.min(Math.max(0, currentLocalPage), Math.max(0, currentChapterPagination.chapterPageCount - 1))
    : Math.max(0, currentLocalPage);

  const getCurrentLocator = useCallback((): ReaderLocator | undefined => {
    if (!bookId) return undefined;
    const currentTree = getTextSyntaxTree();
    if (!currentTree.rawText || currentTree.blocks.length === 0) return undefined;
    return createReaderLocator({
      bookId,
      page: getPageNum(),
      textSyntaxTree: currentTree,
    });
  }, [bookId]);

  const rememberCurrentLocator = useCallback(() => {
    const locator = getCurrentLocator();
    if (locator) {
      pendingLocatorRef.current = locator;
    }
  }, [getCurrentLocator]);

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

  const fingerprintRef = useRef(fingerprint);

  // 章节级测量：currentTitleId / fingerprint / layout.pageStep / 当前章 blocks 变化时
  // fingerprint 变化时同步在本 effect 内清空旧分页 state，避免 useEffect 异步清空与 layoutEffect 测量之间的时序竞争
  useLayoutEffect(() => {
    if (currentTitleId === undefined) return;
    if (layout.pageStep <= 0) return;
    const flow = flowRef.current;
    if (!flow) return;

    const fingerprintChanged = !chapterFingerprintEqual(fingerprintRef.current, fingerprint);
    if (fingerprintChanged) {
      fingerprintRef.current = fingerprint;
    }

    const cached = getCachedChapterPagination(bookId, currentTitleId, fingerprint);
    if (cached) {
      setChapterPaginations((prev) => {
        if (!fingerprintChanged && prev.get(currentTitleId) === cached) return prev;
        const base = fingerprintChanged ? new Map<number, ChapterPagination>() : new Map(prev);
        base.set(currentTitleId, cached);
        return base;
      });
      return;
    }

    const result = measureChapterPagination(flow, layout.pageStep);
    if (!result) {
      if (fingerprintChanged) {
        setChapterPaginations((prev) => (prev.size === 0 ? prev : new Map()));
      }
      return;
    }
    setCachedChapterPagination(bookId, currentTitleId, fingerprint, result);
    setChapterPaginations((prev) => {
      const base = fingerprintChanged ? new Map<number, ChapterPagination>() : new Map(prev);
      base.set(currentTitleId, result);
      return base;
    });
  }, [bookId, currentTitleId, layout.pageStep, fingerprint, currentChapterBlocks]);

  // 同步章节级分页结果到 textSyntaxTree（消费侧依赖）
  useEffect(() => {
    if (!textSyntaxTree.rawText) return;
    if (titleIdSequence.length === 0) return;

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

    const targetPage = resolveReaderLocatorPage(locator, getTextSyntaxTree());
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
    const block = navigationTarget.blockId
      ? blocks.find((b) => b.id === navigationTarget.blockId)
      : undefined;
    const ratio =
      block && typeof navigationTarget.matchStart === 'number' && Number.isFinite(navigationTarget.matchStart)
        ? Math.min(Math.max(navigationTarget.matchStart / Math.max(block.text.length, 1), 0), 1)
        : undefined;
    pendingLocatorRef.current = {
      bookId: bookId ?? '',
      page: navigationTarget.page ?? 0,
      blockId: navigationTarget.blockId,
      titleId: navigationTarget.titleId,
      blockScrollRatio: ratio,
      updatedAt: Date.now(),
    };
  }, [navigationTarget, bookId, blocks]);

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
      scheduleMeasureLayout({ includeSettledPass: true, rememberLocator: true });
    };
    window.addEventListener(READER_SETTING_CHANGE_EVENT, refreshLayout);
    return () => {
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, refreshLayout);
    };
  }, [scheduleMeasureLayout]);

  useEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
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

  const contentStyle = useMemo(() => {
    const pageWidth = layout.pageWidth || getInitialPageWidth(visiblePages);
    return {
      '--reader-page-width': `${pageWidth}px`,
      '--reader-page-gap': `${layout.pageGap}px`,
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
          searchKeyword,
          shouldHighlight: Boolean(searchKeyword) && block.text.includes(searchKeyword),
        }),
      ),
    [annotationsByBlockId, currentChapterBlocks, readerSearchHighlight.revision, searchKeyword],
  );

  return (
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
  );
};

const pre = (num: number = 1) => {
  const pageNum: number = getPageNum();
  if (pageNum === 0) return;
  runPageTurn(getStoredReaderPageTurnEffect(), () => {
    setPageNum(Math.max(pageNum - num, 0));
  });
};

const next = (num: number = 1) => {
  const pageNum: number = getPageNum();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const size: number = textSyntaxTree?.totalPage || 0;
  runPageTurn(getStoredReaderPageTurnEffect(), () => {
    setPageNum(Math.min(pageNum + num, size));
  });
};

export const BookDetail = (): React.JSX.Element => {
  const [currentDevice] = useCheckDevice();
  const { id } = getQuery();
  const bookId = typeof id === 'string' ? id : undefined;

  useEffect(() => {
    return () => {
      clearBookDetailMenuSearchState(bookId);
    };
  }, [bookId]);

  if (currentDevice === DEVICE_ENUM.MOBILE) return <MobileBookDetail />;
  if (currentDevice === DEVICE_ENUM.DESKTOP) return <DesktopBookDetail />;
  return <Loading />;
};

export const DesktopBookDetail = (): React.JSX.Element => {
  const { id } = getQuery();
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
  const [scrollTitleId, setScrollTitleId] = useState(0);

  const updateUI = useMemo(
    () =>
      debounce(() => {
        update((prev) => prev + 1);
      }, 16),
    [],
  );

  const updatePageUI = useCallback(() => {
    flushSync(() => {
      update((prev) => prev + 1);
    });
  }, []);

  const getTitle = () => {
    const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
    const pageNum: number = getPageNum();
    return getPageTitle(textSyntaxTree, pageNum);
  };

  const toHome = () => {
    if (!id) return;
    startSpaViewTransition(() => {
      navigate(ROUTE_PATH.HOME);
    });
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

  const getBookDetailById = (id?: string) => {
    if (!id) return;
    getBookById<BookInfo>(id)
      .then((res) => {
        if (res.error) {
          resumeDB().then(() => {
            getBookDetailById(id);
          });
        } else {
          setCurrentBookDetail(res.data);
          const { content, title } = res.data;
          const textSyntaxTree: TextSyntaxTree = transformTextToExpectedFormat({
            content,
            title,
          });
          setTextSyntaxTree(textSyntaxTree);
        }
      })
      .catch((error) => {
        console.log('error', error);
        navigate(ROUTE_PATH.HOME, { replace: true });
      });
  };

  useEffect(() => {
    const { id } = getQuery();
    if (id) {
      getBookDetailById(id);
    }
  }, []);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateUI);
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updatePageUI);
    syncHook.tap(EVENT_NAME.SET_READER_NAVIGATION_TARGET, updateUI);
    syncHook.tap(EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT, updateUI);
    syncHook.tap(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateUI);
    return () => {
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateUI);
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updatePageUI);
      syncHook.off(EVENT_NAME.SET_READER_NAVIGATION_TARGET, updateUI);
      syncHook.off(EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT, updateUI);
      syncHook.off(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateUI);
    };
  }, [updatePageUI, updateUI]);

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
  const hasKnownPagedTotalPage = textSyntaxTree.totalPage > 0 || textSyntaxTree.pageTitleId.length > 0;
  const isFirstPagedPage = pageNum <= 0;
  const isLastPagedPage =
    hasKnownPagedTotalPage && pageNum >= Math.max(0, textSyntaxTree.totalPage - (getVisiblePageCount(DEVICE_ENUM.DESKTOP) - 1));
  const scrollProgressLocator = getReaderProgress(id || undefined);
  const scrollNavigationBlock = readerNavigationTarget.blockId
    ? textSyntaxTree.blocks.find((item) => item.id === readerNavigationTarget.blockId)
    : undefined;
  const scrollNavigationTitleId = isValidTitleId(textSyntaxTree, readerNavigationTarget.titleId)
    ? readerNavigationTarget.titleId
    : scrollNavigationBlock?.titleId;
  const hasActiveScrollNavigation =
    readerNavigationTarget.revision > 0 && scrollNavigationTitleId === scrollTitleId;
  const scrollTargetBlockId = hasActiveScrollNavigation ? readerNavigationTarget.blockId : undefined;
  const scrollTargetBlockRatio =
    hasActiveScrollNavigation &&
    scrollNavigationBlock &&
    typeof readerNavigationTarget.matchStart === 'number' &&
    Number.isFinite(readerNavigationTarget.matchStart)
      ? Math.min(Math.max(readerNavigationTarget.matchStart / Math.max(scrollNavigationBlock.text.length, 1), 0), 1)
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
            <div>
              <a className="text-text-color-2 font-normal cursor-pointer hover:text-text-color-1" onClick={toHome}>
                {t('home')}
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
              bookId={id || undefined}
              navigationRevision={hasActiveScrollNavigation ? readerNavigationTarget.revision : 0}
              onNavigateTitle={navigateScrollTitle}
              progressLocator={scrollProgressLocator}
              targetBlockId={scrollTargetBlockId}
              targetBlockRatio={scrollTargetBlockRatio}
              textSyntaxTree={textSyntaxTree}
              titleId={scrollTitleId}
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
          <div>
            <a className="text-text-color-2 font-normal cursor-pointer hover:text-text-color-1" onClick={toHome}>
              {t('home')}
            </a>
          </div>
        </div>
        <div
          ref={ref}
          style={{
            viewTransitionName: `book-info-${id}`,
          }}
          className="bg-front-bg-color-3 rounded-2xl flex-grow pt-7 px-16 flex flex-col text-base book-info-container"
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
  const { id } = getQuery();
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);

  const updateUI = useMemo(
    () =>
      debounce(() => {
        update((prev) => prev + 1);
      }, 16),
    [],
  );

  const updatePageUI = useCallback(() => {
    flushSync(() => {
      update((prev) => prev + 1);
    });
  }, []);

  const getBookDetailById = (id?: string) => {
    if (!id) return;
    getBookById<BookInfo>(id)
      .then((res) => {
        if (res.error) {
          resumeDB().then(() => {
            getBookDetailById(id);
          });
        } else {
          setCurrentBookDetail(res.data);
          const { content, title } = res.data;
          const textSyntaxTree: TextSyntaxTree = transformTextToExpectedFormat({
            content,
            title,
          });
          setTextSyntaxTree(textSyntaxTree);
        }
      })
      .catch((error) => {
        console.log('error', error);
        navigate(ROUTE_PATH.HOME, { replace: true });
      });
  };

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

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    const { clientX } = e;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const relativeX = clientX - left;
    if (!width) return;
    if (relativeX < width / 4) {
      pre();
      setIsTouch(false);
    } else if (relativeX > (width / 4) * 3) {
      next();
      setIsTouch(false);
    } else {
      setIsTouch(!isTouch);
    }
  };

  const back = () => {
    startSpaViewTransition(() => {
      navigate(-1);
    });
  };

  useEffect(() => {
    const { id } = getQuery();
    if (id) {
      getBookDetailById(id);
    }
  }, []);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateUI);
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updatePageUI);
    syncHook.tap(EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT, updateUI);
    syncHook.tap(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateUI);
    return () => {
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateUI);
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updatePageUI);
      syncHook.off(EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT, updateUI);
      syncHook.off(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateUI);
    };
  }, [updatePageUI, updateUI]);

  useEffect(() => {
    const updatePageTurnEffect = () => {
      setPageTurnEffect(getStoredReaderPageTurnEffect());
    };
    window.addEventListener(READER_SETTING_CHANGE_EVENT, updatePageTurnEffect);
    return () => {
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, updatePageTurnEffect);
    };
  }, []);

  if (textSyntaxTree.rawText.length === 0 || textSyntaxTree.blocks.length === 0) {
    return (
      <div
        className="reader-user-select-disabled w-screen h-screen bg-front-bg-color-1 flex items-center justify-center"
        style={{ viewTransitionName: id ? `book-info-${id}` : undefined }}
      >
        <Loading />
      </div>
    );
  }

  return (
    <div className="reader-user-select-disabled" onContextMenu={preventReaderContextMenu}>
      <div
        className="w-screen h-screen bg-front-bg-color-1"
        ref={ref}
        style={{
          viewTransitionName: `book-info-${id}`,
        }}
      >
        <div className="w-full h-full p-8 relative">
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
          <div
            className="absolute bottom-0 left-0 transition-all w-full flex items-center justify-between px-4 bg-front-bg-color-3 overflow-hidden z-20"
            style={{
              height: isTouch ? 'calc(var(--spacing) * 14)' : '0px',
            }}
          >
            <MobileBookDetailOperate />
          </div>
          <div className="text-right text-text-color-2 text-base absolute bottom-8 right-8 z-10">
            {pageNum + 1} / {totalPage + 1}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetail;
