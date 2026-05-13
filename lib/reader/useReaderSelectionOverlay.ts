import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ReaderAnnotation } from '@/lib/readerAnnotations';
import { READER_SETTING_CHANGE_EVENT } from '@/lib/readerSettings';
import {
  type PointerSelectionState,
  type ReaderSelectionMenuState,
  type ReaderSelectionOverlayState,
  buildOrderedRange,
  getAnnotationMenuState,
  getCaretAtPoint,
  getRectFontSize,
  getSelectionFallbackFontSize,
  getSelectionMenuState,
  getVisibleSelectionRects,
  isEditableSelectionTarget,
  isReaderControlSelectionTarget,
  isSelectionInContainer,
  writeClipboardText,
} from '@/lib/reader/selectionUtils';

export const useReaderSelectionOverlay = (
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

  const updateFromPointer = useCallback(
    (showMenu = false): Range | null => {
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
    },
    [containerRef, renderRange],
  );

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
        const nextMenuState = getAnnotationMenuState(
          styleAnnotation,
          noteAnnotation,
          annotationElement,
          annotationsRef.current,
        );
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
