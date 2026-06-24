import { createSignal } from 'ranuts/utils';
import type { BookInfo } from './books';
import { getAllBooks } from './books';
import { resumeDB } from './index';
import { getReaderProgress } from '@/lib/readerProgress';

const MAX_BOOK_LOAD_RETRIES = 3;

// 防止重复加载的标志
let isLoadingInProgress = false;

// 全局书架状态
export const [getBookShelf, setBookShelf] = createSignal<BookInfo[]>(
  [],
  { subscriber: 'bookshelf-change' }
);

// 全局加载状态
export const [getBookShelfLoading, setBookShelfLoading] = createSignal<boolean>(
  false,
  { subscriber: 'bookshelf-loading' }
);

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

// 排序书籍列表
export const sortBooksByRecent = (books: BookInfo[]): BookInfo[] => {
  return [...books].sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a));
};

// 从数据库加载书架数据（防止竞态条件）
export const loadBookShelf = async (): Promise<void> => {
  // 防止重复调用
  if (isLoadingInProgress || getBookShelfLoading()) {
    return;
  }

  isLoadingInProgress = true;
  setBookShelfLoading(true);
  let attempts = 0;

  while (attempts < MAX_BOOK_LOAD_RETRIES) {
    const result = await getAllBooks<BookInfo>();
    if (!result.error) {
      setBookShelf(sortBooksByRecent(result.data));
      setBookShelfLoading(false);
      isLoadingInProgress = false;
      return;
    }
    attempts += 1;
    try {
      await resumeDB();
    } catch {
      // Retry only; failures are reflected by an empty shelf.
    }
  }

  // 如果所有重试都失败，设置为空数组
  setBookShelf([]);
  setBookShelfLoading(false);
  isLoadingInProgress = false;
};

// 二分查找插入位置（用于优化添加书籍的性能）
const findInsertIndex = (books: BookInfo[], newBook: BookInfo): number => {
  const newTimestamp = getBookRecentTimestamp(newBook);
  let left = 0;
  let right = books.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const midTimestamp = getBookRecentTimestamp(books[mid]);

    if (midTimestamp > newTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
};

// 添加或更新书籍到书架（优化版：避免全量排序）
export const upsertBookInShelf = (book: BookInfo): void => {
  const currentBooks = getBookShelf();
  const index = currentBooks.findIndex((item) => item.id === book.id);

  if (index === -1) {
    // 新书籍：使用二分查找找到插入位置
    const insertIndex = findInsertIndex(currentBooks, book);
    const updatedBooks = [
      ...currentBooks.slice(0, insertIndex),
      book,
      ...currentBooks.slice(insertIndex)
    ];
    setBookShelf(updatedBooks);
  } else {
    // 更新现有书籍：检查时间戳是否变化
    const oldTimestamp = getBookRecentTimestamp(currentBooks[index]);
    const newTimestamp = getBookRecentTimestamp(book);

    if (oldTimestamp === newTimestamp) {
      // 时间戳未变，直接替换，不需要重新排序
      const updatedBooks = currentBooks.map((item) =>
        item.id === book.id ? book : item
      );
      setBookShelf(updatedBooks);
    } else {
      // 时间戳变化，需要重新排序
      const booksWithoutOld = currentBooks.filter((item) => item.id !== book.id);
      const insertIndex = findInsertIndex(booksWithoutOld, book);
      const updatedBooks = [
        ...booksWithoutOld.slice(0, insertIndex),
        book,
        ...booksWithoutOld.slice(insertIndex)
      ];
      setBookShelf(updatedBooks);
    }
  }
};

// 从书架移除书籍
export const removeBookFromShelf = (bookId: string): void => {
  const currentBooks = getBookShelf();
  setBookShelf(currentBooks.filter((book) => book.id !== bookId));
};

// 批量更新书架
export const updateBookShelf = (books: BookInfo[]): void => {
  setBookShelf(sortBooksByRecent(books));
};

// 刷新书架（重新排序）
export const refreshBookShelf = (): void => {
  const currentBooks = getBookShelf();
  setBookShelf(sortBooksByRecent(currentBooks));
};
