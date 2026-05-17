import type { TextSyntaxTree } from '@/lib/transformText';
import {
  EVENT_NAME,
  getPageNum,
  getReaderNavigationTarget,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
  syncHook,
} from '@/lib/subscribe';
import { getReaderBookmarkForPage } from '@/lib/readerAnnotations';
import { getReaderProgress } from '@/lib/readerProgress';
import { getStoredReaderReadingMode } from '@/lib/readerSettings';
import { t } from '@/locales';

export const turnToCatalogueTitle = (event: Event): void => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-reader-catalog-bookmark]')) return;
  const index = target.closest<HTMLElement>('[data-title-id]')?.dataset.titleId || '';
  const titleId = Number(index);
  if (!Number.isFinite(titleId)) return;
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const page = textSyntaxTree?.titleIdPage[index];
  setReaderNavigationTarget({ page, revision: Date.now(), titleId });
  if (page !== undefined) {
    if (!document.startViewTransition) {
      setPageNum(page);
      return;
    }
    document.startViewTransition(() => {
      setPageNum(page);
    });
  }
  syncHook.call(EVENT_NAME.CLOSE_READER_CONTROL_PANEL);
};

export const getCurrentTitleId = (bookId: string | undefined, textSyntaxTree: TextSyntaxTree): number | undefined => {
  const pageTitleId = textSyntaxTree.pageTitleId[getPageNum()] ?? textSyntaxTree.pageTitleId[0];
  const progress = getReaderProgress(bookId);
  const progressTitleId = progress?.titleId;
  const navigationTarget = getReaderNavigationTarget();
  if (getStoredReaderReadingMode() === 'scroll') {
    if (navigationTarget.titleId !== undefined && (!progress || navigationTarget.revision >= progress.updatedAt)) {
      return navigationTarget.titleId;
    }
    if (progressTitleId !== undefined) {
      return progressTitleId;
    }
  }
  return pageTitleId;
};

export const getCatalogueReadPercent = (
  bookId: string | undefined,
  currentTitleId: number | undefined,
): number | undefined => {
  const progress = getReaderProgress(bookId);
  if (!progress || progress.titleId !== currentTitleId) return undefined;
  if (typeof progress.readPercent !== 'number' || !Number.isFinite(progress.readPercent)) return undefined;
  const percent = Math.min(Math.max(Math.floor(progress.readPercent), 0), 100);
  return percent >= 1 ? percent : undefined;
};

export const isCurrentPageBookmarked = (bookId: string | undefined): boolean => {
  return Boolean(getReaderBookmarkForPage(bookId, getPageNum()));
};

export const formatReadingDuration = (durationMs: number | undefined): string => {
  const totalMinutes = Math.max(0, Math.floor((durationMs || 0) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const duration =
    hours > 0 ? t('common.duration_hours_minutes', [hours, minutes]) : t('common.duration_minutes', [minutes]);
  return t('catalogue.reading_duration_value', [duration]);
};
