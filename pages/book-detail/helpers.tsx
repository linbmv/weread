// Pure helpers extracted from pages/book-detail/index.tsx to keep the main
// component file manageable. These functions own no React state and are safe
// to import standalone (no side effects on import).

import { type NavigateFunction, useParams } from 'react-router-dom';
import type React from 'react';
import { OcticonChevronLeft, OcticonChevronRight } from '@/components/Octicon';
import { ROUTE_PATH } from '@/router';
import {
  getCurrentBookDetail,
  getTextSyntaxTree,
  setCurrentBookDetail,
  setTextSyntaxTree,
} from '@/lib/subscribe';
import { resumeDB } from '@/store';
import { getBookById } from '@/store/books';
import type { BookInfo } from '@/store/books';
import type { ReaderPageTurnEffect } from '@/lib/readerSettings';
import { getCachedTextSyntaxTree } from '@/lib/reader/textSyntaxTreeCache';

export const MOBILE_ICON_STYLE = {
  '--ran-icon-font-size': '36px',
  '--ran-icon-color': 'var(--icon-color-1)',
};

export const useReaderBookId = (): string | undefined => {
  const { bookId } = useParams<{ bookId: string }>();
  return bookId;
};

export const ReaderPagePreviousIcon = (): React.JSX.Element => (
  <OcticonChevronLeft className="reader-page-nav-icon" />
);

export const ReaderPageNextIcon = (): React.JSX.Element => (
  <OcticonChevronRight className="reader-page-nav-icon" />
);

export const hasRecordChanged = (prev: Record<string, number>, next: Record<string, number>): boolean => {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;
  return nextKeys.some((key) => prev[key] !== next[key]);
};

export const hasArrayChanged = (prev: number[], next: number[]): boolean => {
  if (prev.length !== next.length) return true;
  return next.some((value, index) => prev[index] !== value);
};

export const runPageTurn = (effect: ReaderPageTurnEffect, update: () => void): void => {
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

const LOAD_BOOK_DETAIL_MAX_RETRIES = 3;
const LOAD_BOOK_DETAIL_RETRY_BASE_DELAY_MS = 200;

export const loadBookDetailById = (
  id: string | undefined,
  navigate: NavigateFunction,
  attempt: number = 0,
): void => {
  if (!id) return;
  getBookById<BookInfo>(id)
    .then((res) => {
      if (res.error) {
        // Bounded retries: a corrupted IndexedDB used to spin the main thread
        // here in an infinite recursion. Cap retries and bail to /home so the
        // UI stays responsive.
        if (attempt >= LOAD_BOOK_DETAIL_MAX_RETRIES) {
          console.error('Failed to load book detail after retries:', res.message);
          navigate(ROUTE_PATH.HOME, { replace: true });
          return;
        }
        const delay = LOAD_BOOK_DETAIL_RETRY_BASE_DELAY_MS * 2 ** attempt;
        resumeDB()
          .then((resumed) => {
            if (!resumed) {
              window.setTimeout(() => loadBookDetailById(id, navigate, attempt + 1), delay);
              return;
            }
            loadBookDetailById(id, navigate, attempt + 1);
          })
          .catch(() => {
            window.setTimeout(() => loadBookDetailById(id, navigate, attempt + 1), delay);
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
