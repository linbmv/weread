import { useSyncExternalStore } from 'react';
import type { BookInfo } from './books';
import { addBook, deleteBookById, getAllBooks } from './books';
import type { IDBResult } from '@/lib/indexedDB';
import { resumeDB } from './index';
import { getReaderProgress } from '@/lib/readerProgress';

const MAX_BOOK_LOAD_RETRIES = 3;

export type BookShelfLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface BookShelfSnapshot {
  books: BookInfo[];
  error: string | null;
  hasLoaded: boolean;
  loadStatus: BookShelfLoadStatus;
}

const listeners = new Set<() => void>();

let snapshot: BookShelfSnapshot = {
  books: [],
  error: null,
  hasLoaded: false,
  loadStatus: 'idle',
};

let activeLoadPromise: Promise<void> | null = null;

const emitBookShelfChange = (): void => {
  listeners.forEach((listener) => listener());
};

const setBookShelfSnapshot = (next: BookShelfSnapshot): void => {
  snapshot = next;
  emitBookShelfChange();
};

const patchBookShelfSnapshot = (patch: Partial<BookShelfSnapshot>): void => {
  setBookShelfSnapshot({ ...snapshot, ...patch });
};

export const subscribeBookShelf = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getBookShelfSnapshot = (): BookShelfSnapshot => snapshot;

export const getBookShelfServerSnapshot = (): BookShelfSnapshot => snapshot;

export const useBookShelf = (): BookShelfSnapshot => {
  return useSyncExternalStore(subscribeBookShelf, getBookShelfSnapshot, getBookShelfServerSnapshot);
};

export const getBookShelf = (): BookInfo[] => snapshot.books;

export const getBookShelfLoading = (): boolean => snapshot.loadStatus === 'loading';

export const getBookShelfHasLoaded = (): boolean => snapshot.hasLoaded;

export const getBookShelfError = (): string | null => snapshot.error;

// 获取书籍的最近时间戳（用于排序）
export const getBookRecentTimestamp = (book: BookInfo): number => {
  const progress = getReaderProgress(book.id);
  return Math.max(
    progress?.updatedAt || 0,
    progress?.lastReadAt || 0,
    book.modifyTime || 0,
    book.createTime || 0
  );
};

// 排序书籍列表（稳定排序）
export const sortBooksByRecent = (books: BookInfo[]): BookInfo[] => {
  return [...books].sort((a, b) => {
    const timestampDiff = getBookRecentTimestamp(b) - getBookRecentTimestamp(a);
    if (timestampDiff !== 0) return timestampDiff;
    const titleDiff = (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN');
    if (titleDiff !== 0) return titleDiff;
    return a.id.localeCompare(b.id);
  });
};

// 按 ID 合并书籍列表
const mergeBookListsById = (baseBooks: BookInfo[], nextBooks: BookInfo[]): BookInfo[] => {
  const merged = new Map<string, BookInfo>();
  baseBooks.forEach((book) => {
    merged.set(book.id, book);
  });
  nextBooks.forEach((book) => {
    merged.set(book.id, book);
  });
  return sortBooksByRecent(Array.from(merged.values()));
};

// 合并书籍到书架（用于导入等增量更新）
export const mergeBookShelf = (books: BookInfo[]): void => {
  patchBookShelfSnapshot({
    books: mergeBookListsById(snapshot.books, books),
    error: null,
  });
};

// 从加载结果替换书架（保留加载期间的乐观更新）
export const replaceBookShelfFromLoad = (books: BookInfo[]): void => {
  const currentBookIds = new Set(snapshot.books.map((book) => book.id));
  const loadedBookIds = new Set(books.map((book) => book.id));
  const optimisticBooks = snapshot.books.filter((book) => !loadedBookIds.has(book.id) && currentBookIds.has(book.id));

  patchBookShelfSnapshot({
    books: sortBooksByRecent([...books, ...optimisticBooks]),
    error: null,
    hasLoaded: true,
    loadStatus: 'success',
  });
};

// 从数据库加载书架数据（防止竞态条件）
export const loadBookShelf = async (): Promise<void> => {
  if (activeLoadPromise) {
    return activeLoadPromise;
  }

  activeLoadPromise = (async () => {
    patchBookShelfSnapshot({ error: null, loadStatus: 'loading' });
    let attempts = 0;

    while (attempts < MAX_BOOK_LOAD_RETRIES) {
      const result = await getAllBooks<BookInfo>();
      if (!result.error) {
        replaceBookShelfFromLoad(result.data);
        return;
      }
      attempts += 1;
      try {
        await resumeDB();
      } catch {
        // Retry only; final failure keeps the current in-memory shelf.
      }
    }

    const fallbackMessage = 'Failed to load bookshelf';
    patchBookShelfSnapshot({
      books: snapshot.books,
      error: fallbackMessage,
      hasLoaded: snapshot.hasLoaded,
      loadStatus: 'error',
    });
  })().finally(() => {
    activeLoadPromise = null;
  });

  return activeLoadPromise;
};

// 添加或更新书籍到书架
export const upsertBookInShelf = (book: BookInfo): void => {
  const currentBooks = getBookShelf();
  const index = currentBooks.findIndex((item) => item.id === book.id);

  if (index === -1) {
    // 新书籍：直接添加并重排
    patchBookShelfSnapshot({
      books: sortBooksByRecent([book, ...currentBooks]),
    });
  } else {
    // 更新现有书籍
    const updatedBooks = currentBooks.map((item) =>
      item.id === book.id ? book : item
    );
    patchBookShelfSnapshot({
      books: sortBooksByRecent(updatedBooks),
    });
  }
};

// 从书架移除书籍
export const removeBookFromShelf = (bookId: string): void => {
  const currentBooks = getBookShelf();
  patchBookShelfSnapshot({ books: currentBooks.filter((book) => book.id !== bookId) });
};

// 添加书籍到书架（持久化 + 状态同步）
export const addBookToShelf = async (
  data: Parameters<typeof addBook>[0],
): Promise<IDBResult<BookInfo>> => {
  const result = await addBook(data);
  if (!result.error && result.data) {
    mergeBookShelf([result.data]);
  }
  return result;
};

// 从书架删除书籍（乐观更新 + 持久化）
export const deleteBookFromShelf = async (bookId: string): Promise<IDBResult<null>> => {
  const previousBooks = snapshot.books;
  patchBookShelfSnapshot({
    books: previousBooks.filter((book) => book.id !== bookId),
  });

  const result = await deleteBookById(bookId);
  if (result.error) {
    patchBookShelfSnapshot({
      books: previousBooks,
      error: result.message || 'Failed to delete book',
    });
  }
  return result;
};

// 批量更新书架
export const updateBookShelf = (books: BookInfo[]): void => {
  patchBookShelfSnapshot({
    books: sortBooksByRecent(books),
    error: null,
  });
};

// 刷新书架（重新排序）
export const refreshBookShelf = (): void => {
  const currentBooks = getBookShelf();
  patchBookShelfSnapshot({ books: sortBooksByRecent(currentBooks) });
};

// 监听阅读进度变化，自动刷新排序
if (typeof window !== 'undefined') {
  window.addEventListener('weread:reader-progress-change', () => {
    if (snapshot.books.length === 0) return;
    refreshBookShelf();
  });
}
