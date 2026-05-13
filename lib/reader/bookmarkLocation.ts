import type { ReaderAnnotation, ReaderBookmarkDraft } from '@/lib/readerAnnotations';
import type { ReaderLayout } from '@/lib/reader/readerLayout';

const READER_BOOKMARK_EXCERPT_LENGTH = 100;

export const normalizeBookmarkText = (value: string): string => value.replace(/\s+/gu, ' ').trim();

export const createBookmarkExcerpt = (value: string): string => {
  const text = normalizeBookmarkText(value);
  if (text.length <= READER_BOOKMARK_EXCERPT_LENGTH) return text;
  return `${text.slice(0, READER_BOOKMARK_EXCERPT_LENGTH)}...`;
};

const rectIntersects = (
  rect: DOMRect,
  bounds: { bottom: number; left: number; right: number; top: number },
): boolean => {
  return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
};

interface ReaderBookmarkTextCandidate {
  element: HTMLElement;
  left: number;
  startOffset: number;
  top: number;
}

const getFirstVisibleTextCandidate = (
  element: HTMLElement,
  bounds: { bottom: number; left: number; right: number; top: number },
): ReaderBookmarkTextCandidate | undefined => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offsetBase = 0;
  let best: ReaderBookmarkTextCandidate | undefined;

  try {
    let node = walker.nextNode() as Text | null;
    while (node) {
      const value = node.data || '';
      for (let offset = 0; offset < value.length; offset++) {
        if (!value[offset]?.trim()) continue;
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);

        const rects = Array.from(range.getClientRects());
        for (const rect of rects) {
          if (rect.width <= 0 || rect.height <= 0 || !rectIntersects(rect, bounds)) continue;
          const top = Math.max(rect.top, bounds.top);
          const left = Math.max(rect.left, bounds.left);
          if (!best || top < best.top || (top === best.top && left < best.left)) {
            best = {
              element,
              left,
              startOffset: offsetBase + offset,
              top,
            };
          }
        }
      }

      offsetBase += value.length;
      node = walker.nextNode() as Text | null;
    }
  } finally {
    range.detach();
  }

  return best;
};

export const createPageBookmarkDraft = ({
  flow,
  layout,
  page,
  viewport,
}: {
  flow: HTMLElement | null;
  layout: ReaderLayout;
  page: number;
  viewport: HTMLElement | null;
}): ReaderBookmarkDraft | undefined => {
  if (!flow || !viewport || !Number.isFinite(page)) return undefined;

  const viewportRect = viewport.getBoundingClientRect();
  const pageWidth = layout.pageWidth || viewport.clientWidth / 2;
  const leftPageBounds = {
    bottom: viewportRect.bottom,
    left: viewportRect.left,
    right: Math.min(viewportRect.right, viewportRect.left + pageWidth),
    top: viewportRect.top,
  };
  let firstTextCandidate: ReaderBookmarkTextCandidate | undefined;
  let firstBlock: { element: HTMLElement; left: number; top: number } | undefined;

  flow.querySelectorAll<HTMLElement>('.reader-content-block[data-reader-block-id]').forEach((element) => {
    if (element.classList.contains('reader-content-image')) return;
    if (!normalizeBookmarkText(element.textContent || '')) return;

    const visibleRects = Array.from(element.getClientRects()).filter((rect) => {
      return rect.width > 0 && rect.height > 0 && rectIntersects(rect, leftPageBounds);
    });
    if (visibleRects.length === 0) return;

    const textCandidate = getFirstVisibleTextCandidate(element, leftPageBounds);
    if (
      textCandidate &&
      (!firstTextCandidate ||
        textCandidate.top < firstTextCandidate.top ||
        (textCandidate.top === firstTextCandidate.top && textCandidate.left < firstTextCandidate.left))
    ) {
      firstTextCandidate = textCandidate;
    }

    visibleRects.forEach((rect) => {
      if (!firstBlock || rect.top < firstBlock.top || (rect.top === firstBlock.top && rect.left < firstBlock.left)) {
        firstBlock = { element, left: rect.left, top: rect.top };
      }
    });
  });

  const target = firstTextCandidate || (firstBlock ? { ...firstBlock, startOffset: 0 } : undefined);
  if (!target) return undefined;
  const blockId = target.element.dataset.readerBlockId;
  const text = createBookmarkExcerpt((target.element.textContent || '').slice(target.startOffset));
  if (!blockId || !text) return undefined;
  const titleIdValue = Number(target.element.dataset.readerTitleId);

  return {
    blockId,
    page,
    startOffset: target.startOffset,
    text,
    titleId: Number.isFinite(titleIdValue) ? titleIdValue : undefined,
  };
};

const getTextOffsetRect = (element: HTMLElement, offset: number): DOMRect | undefined => {
  const textLength = element.textContent?.length ?? 0;
  if (textLength <= 0) return undefined;
  const targetOffset = Math.min(Math.max(Math.floor(offset), 0), textLength - 1);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offsetBase = 0;

  try {
    let node = walker.nextNode() as Text | null;
    while (node) {
      const value = node.data || '';
      const nextOffsetBase = offsetBase + value.length;
      if (targetOffset >= offsetBase && targetOffset < nextOffsetBase) {
        const nodeOffset = targetOffset - offsetBase;
        range.setStart(node, nodeOffset);
        range.setEnd(node, Math.min(nodeOffset + 1, value.length));
        return Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0);
      }
      offsetBase = nextOffsetBase;
      node = walker.nextNode() as Text | null;
    }
  } finally {
    range.detach();
  }

  return undefined;
};

export const resolveRenderedBookmarkPage = ({
  annotation,
  chapterStartPages,
  flow,
  layout,
}: {
  annotation: ReaderAnnotation;
  chapterStartPages: Record<number, number>;
  flow: HTMLElement | null;
  layout: ReaderLayout;
}): number | undefined => {
  if (!flow || layout.pageStep <= 0 || annotation.type !== 'bookmark') return undefined;
  if (!annotation.blockId) return undefined;
  const blockElement = flow.querySelector<HTMLElement>(
    `.reader-content-block[data-reader-block-id="${CSS.escape(annotation.blockId)}"]`,
  );
  if (!blockElement) return undefined;

  const rect = getTextOffsetRect(blockElement, annotation.startOffset) ?? blockElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const flowRect = flow.getBoundingClientRect();
  const localPage = Math.max(0, Math.floor((rect.left - flowRect.left + layout.pageStep * 0.08) / layout.pageStep));
  const titleIdValue = Number(blockElement.dataset.readerTitleId);
  const chapterStart = Number.isFinite(titleIdValue) ? chapterStartPages[titleIdValue] : undefined;
  if (chapterStart === undefined) return undefined;
  return chapterStart + localPage;
};
