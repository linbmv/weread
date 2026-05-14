import { clearChapterPaginationCache } from '@/lib/chapterPagination';
import { deleteReaderAnnotationsForBook } from '@/lib/readerAnnotations';
import { deleteReaderBookStatus } from '@/lib/readerBookStatus';
import { deleteReaderProgress } from '@/lib/readerProgress';
import { deleteReaderReadingTimeForBook } from '@/lib/readerReadingTime';

export const clearReaderBookData = async (bookId?: string | null): Promise<void> => {
  if (!bookId) return;
  clearChapterPaginationCache(bookId);
  await Promise.all([
    deleteReaderProgress(bookId),
    deleteReaderAnnotationsForBook(bookId),
    deleteReaderReadingTimeForBook(bookId),
    deleteReaderBookStatus(bookId),
  ]);
};
