import type { ReaderAnnotation, ReaderAnnotationDraft, ReaderStyleAnnotationType } from '@/lib/readerAnnotations';
import { createAnnotationDraft, getRelatedStyleAnnotationIds } from '@/lib/reader/annotationRendering';

export const isEditableSelectionTarget = (target: EventTarget | null): boolean => {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
};

export const isReaderControlSelectionTarget = (target: EventTarget | null): boolean => {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '.reader-note-modal-layer, .reader-page-title-label, .reader-scroll-chapter-nav, .reader-page-nav-button, .reader-selection-menu, .readerControls, button, a, r-icon',
      ),
    )
  );
};

export const preventReaderContextMenu = (e: React.MouseEvent<HTMLElement>): void => {
  if (isEditableSelectionTarget(e.target)) return;
  e.preventDefault();
};

export const getSelectionContainerNode = (node: Node | null): Node | null => {
  return node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
};

export const isSelectionInContainer = (selection: Selection, container: HTMLElement): boolean => {
  const anchorNode = getSelectionContainerNode(selection.anchorNode);
  const focusNode = getSelectionContainerNode(selection.focusNode);
  return Boolean((anchorNode && container.contains(anchorNode)) || (focusNode && container.contains(focusNode)));
};

export const DEFAULT_READER_FONT_SIZE = 18;

const resolveFontSize = (target: Element, fallback: number): number => {
  const value = Number.parseFloat(window.getComputedStyle(target).fontSize);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const getSelectionFallbackFontSize = (range: Range, container: HTMLElement): number => {
  const node = getSelectionContainerNode(range.commonAncestorContainer);
  const element = node instanceof Element ? node : null;
  const block = element?.closest<HTMLElement>('.reader-content-block');
  const target = block && container.contains(block) ? block : container;
  return resolveFontSize(target, DEFAULT_READER_FONT_SIZE);
};

export const getBlockFontSize = (block: HTMLElement, cache: Map<HTMLElement, number>, fallback: number): number => {
  const cached = cache.get(block);
  if (cached !== undefined) return cached;
  const resolved = resolveFontSize(block, fallback);
  cache.set(block, resolved);
  return resolved;
};

export interface ClientRectLike {
  height: number;
  left: number;
  top: number;
  width: number;
}

export const getRectProbeElement = (rect: ClientRectLike, container: HTMLElement): Element | null => {
  const probeX = rect.width >= 2 ? rect.left + rect.width / 2 : rect.left + 1;
  const probeY = rect.top + rect.height / 2;
  const target = document.elementFromPoint(probeX, probeY);
  return target instanceof Element && container.contains(target) ? target : null;
};

export const getRectFontSize = (
  rect: ClientRectLike,
  container: HTMLElement,
  fallback: number,
  cache: Map<HTMLElement, number>,
): number => {
  const target = getRectProbeElement(rect, container);
  if (!target) return fallback;
  const block = target.closest<HTMLElement>('.reader-content-block');
  if (!block || !container.contains(block)) return fallback;
  return getBlockFontSize(block, cache, fallback);
};

export const getSelectionClipRect = (container: HTMLElement): DOMRect => {
  return (
    container.closest<HTMLElement>('.reader-page-window')?.getBoundingClientRect() ?? container.getBoundingClientRect()
  );
};

export interface CaretPoint {
  node: Node;
  offset: number;
}

export const getCaretAtPoint = (x: number, y: number): CaretPoint | null => {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
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

export const buildOrderedRange = (
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

export interface PointerSelectionState {
  pointerId: number;
  anchorNode: Node;
  anchorOffset: number;
  capturedTarget: HTMLElement;
  focusNode: Node;
  focusOffset: number;
  lastClientX: number;
  lastClientY: number;
}

export interface ReaderSelectionMenuState {
  annotation?: ReaderAnnotation;
  bottom: number;
  drafts: ReaderAnnotationDraft[];
  hasFormat: boolean;
  left: number;
  mode: 'annotation' | 'selection';
  noteAnnotation?: ReaderAnnotation;
  placement: 'bottom' | 'top';
  styleAnnotation?: ReaderAnnotation;
  styleAnnotationIds?: string[];
  text: string;
  top: number;
}

export interface ReaderSelectionOverlayState {
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

export const getSelectionDrafts = (range: Range, container: HTMLElement): ReaderAnnotationDraft[] => {
  const blockElements = Array.from(
    container.querySelectorAll<HTMLElement>('.reader-content-block[data-reader-block-id]'),
  );
  const drafts: ReaderAnnotationDraft[] = [];

  blockElements.forEach((blockElement) => {
    if (!rangeIntersectsBlockElement(range, blockElement)) return;

    const blockText = blockElement.textContent || '';
    const startsInBlock = blockElement.contains(range.startContainer);
    const endsInBlock = blockElement.contains(range.endContainer);
    const startOffset = startsInBlock ? getTextOffsetInBlock(blockElement, range.startContainer, range.startOffset) : 0;
    const endOffset = endsInBlock
      ? getTextOffsetInBlock(blockElement, range.endContainer, range.endOffset)
      : blockText.length;
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

export const getVisibleSelectionRects = (range: Range, container: HTMLElement): ClientRectLike[] => {
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

export const READER_SELECTION_MENU_HEIGHT = 62;

export const READER_SELECTION_COLOR_PICKER_HEIGHT = 54;

export const READER_SELECTION_MENU_GAP = 12;

export const getReaderMenuTopBoundary = (): number => {
  const scrollHeader = document.querySelector<HTMLElement>('.reader-scroll-mode-header');
  if (!scrollHeader) return 12;
  const rect = scrollHeader.getBoundingClientRect();
  return Math.max(rect.bottom + READER_SELECTION_MENU_GAP, 12);
};

export const getReaderSelectionMenuTopHeight = (hasColorPicker = false): number => {
  return (
    READER_SELECTION_MENU_HEIGHT +
    (hasColorPicker ? READER_SELECTION_COLOR_PICKER_HEIGHT : 0) +
    READER_SELECTION_MENU_GAP
  );
};

export const getReaderSelectionMenuPlacement = (top: number, hasColorPicker = false): 'bottom' | 'top' => {
  return top - getReaderSelectionMenuTopHeight(hasColorPicker) < getReaderMenuTopBoundary() ? 'bottom' : 'top';
};

export const getSelectionMenuState = (range: Range, container: HTMLElement): ReaderSelectionMenuState | null => {
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

export const getAnnotationMenuState = (
  styleAnnotation: ReaderAnnotation | undefined,
  noteAnnotation: ReaderAnnotation | undefined,
  targetElement: HTMLElement,
  annotations: ReaderAnnotation[] = [],
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
    styleAnnotationIds: styleAnnotation ? getRelatedStyleAnnotationIds(styleAnnotation, annotations) : undefined,
    text: annotation.text,
    top: topAnchor,
  };
};

export const writeClipboardText = async (text: string): Promise<boolean> => {
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

export type ReaderAnnotationColorMap = Record<ReaderStyleAnnotationType, string>;
