import { clearChapterPaginationCache } from '@/lib/chapterPagination';
import { deleteReaderAnnotationsForBook } from '@/lib/readerAnnotations';
import { deleteReaderProgress } from '@/lib/readerProgress';

export const clearReaderBookData = (bookId?: string | null): void => {
  if (!bookId) return;
  deleteReaderProgress(bookId);
  deleteReaderAnnotationsForBook(bookId);
  clearChapterPaginationCache(bookId);
};
