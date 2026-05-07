import { Index } from 'flexsearch';
import { findKeywordSentenceMatches } from '@/lib/searchText';
import { getErrorMessage } from '@/lib/utils';

interface BookRecord {
  id: string;
  title: string;
  author: string;
  document?: { rawText?: string; version?: number };
  [key: string]: unknown;
}

interface SearchPayload {
  keyword: string;
  searchType: 'title' | 'author' | 'content';
  limit?: number;
}

interface BookSearchHit extends BookRecord {
  matchedText: string[];
}

interface ExecuteOptions<T = unknown> {
  store: IDBObjectStore;
  database: IDBDatabase;
  data: T;
  operationId: string;
}

interface DBStrategy {
  execute(options: ExecuteOptions): void | Promise<void>;
}

type OperationType = 'search' | 'add' | 'put' | 'getAll' | 'get' | 'delete';

const STORE_NAME = 'books_info';

const DEFAULT_CONTENT_SEARCH_LIMIT = 50;

const MATCHED_TEXT_LIMIT = 5;

const isValidBook = (book: unknown): book is BookRecord => {
  if (!book || typeof book !== 'object') return false;
  const candidate = book as BookRecord;
  return candidate.document?.version === 1;
};

const buildSearchHit = (book: BookRecord, keyword: string): BookSearchHit => {
  const rawText = book.document?.rawText || '';
  const matchedText = rawText
    ? findKeywordSentenceMatches(rawText, keyword)
        .slice(0, MATCHED_TEXT_LIMIT)
        .map((match) => match.sentence)
    : [];
  return { ...book, matchedText };
};

const postSuccess = <T>(operationId: string, data: T): void => {
  self.postMessage({ status: 'success', code: 0, data, error: false, operationId });
};

const postError = (operationId: string, message: string, data: unknown = null): void => {
  self.postMessage({ status: 'error', code: 1, data, error: true, message, operationId });
};

let contentIndex: Index | undefined;
let contentIndexedIds = new Set<string>();
let contentIndexBuilding: Promise<void> | null = null;

const createContentIndex = (): Index => {
  return new Index({
    encoder: 'CJK',
    tokenize: 'forward',
    cache: 100,
    resolution: 9,
  });
};

const indexBookContent = (book: BookRecord): void => {
  if (!contentIndex) return;
  const rawText = book.document?.rawText;
  if (!rawText) return;
  if (contentIndexedIds.has(book.id)) {
    contentIndex.update(book.id, rawText);
  } else {
    contentIndex.add(book.id, rawText);
    contentIndexedIds.add(book.id);
  }
};

const removeBookFromIndex = (id: string): void => {
  if (!contentIndex || !contentIndexedIds.has(id)) return;
  contentIndex.remove(id);
  contentIndexedIds.delete(id);
};

const ensureContentIndex = (database: IDBDatabase): Promise<void> => {
  if (contentIndex) return Promise.resolve();
  if (contentIndexBuilding) return contentIndexBuilding;

  contentIndexBuilding = new Promise<void>((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const index = createContentIndex();
      const indexedIds = new Set<string>();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const value = cursor.value;
          if (isValidBook(value) && value.document?.rawText) {
            try {
              index.add(value.id, value.document.rawText);
              indexedIds.add(value.id);
            } catch (error) {
              console.error('Failed to index book', value.id, getErrorMessage(error));
            }
          }
          cursor.continue();
          return;
        }

        contentIndex = index;
        contentIndexedIds = indexedIds;
        resolve();
      };

      request.onerror = () => {
        contentIndexBuilding = null;
        reject(new Error(request.error?.message || 'Failed to build search index'));
      };
    } catch (error) {
      contentIndexBuilding = null;
      reject(error instanceof Error ? error : new Error(getErrorMessage(error)));
    }
  });

  contentIndexBuilding.catch(() => {
    contentIndexBuilding = null;
  });
  return contentIndexBuilding;
};

const fetchBooksByIds = (database: IDBDatabase, ids: string[]): Promise<BookRecord[]> => {
  if (ids.length === 0) return Promise.resolve([]);
  return new Promise<BookRecord[]>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const results: BookRecord[] = [];
    let pending = ids.length;

    const finish = (): void => resolve(results);
    const onItemSettled = (): void => {
      pending--;
      if (pending <= 0) finish();
    };

    ids.forEach((id) => {
      const request = store.get(id);
      request.onsuccess = () => {
        if (isValidBook(request.result)) {
          results.push(request.result);
        }
        onItemSettled();
      };
      request.onerror = () => onItemSettled();
    });
  });
};

class SearchStrategy implements DBStrategy {
  async execute({ store, database, data, operationId }: ExecuteOptions<SearchPayload>): Promise<void> {
    const { keyword, searchType, limit = DEFAULT_CONTENT_SEARCH_LIMIT } = data;
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      postSuccess(operationId, []);
      return;
    }

    if (searchType === 'content') {
      try {
        await ensureContentIndex(database);
        if (!contentIndex) {
          postError(operationId, 'Content index unavailable', []);
          return;
        }
        const ids = (await contentIndex.searchAsync(trimmedKeyword, { limit })) as Array<string | number>;
        const stringIds = ids.map((id) => String(id));
        const books = await fetchBooksByIds(database, stringIds);
        const hits = books.map((book) => {
          const hit = buildSearchHit(book, trimmedKeyword);
          return { ...projectBookForList(hit), matchedText: hit.matchedText };
        });
        postSuccess(operationId, hits);
      } catch (error) {
        postError(operationId, getErrorMessage(error, 'Search failed'), []);
      }
      return;
    }

    const request = store.openCursor();
    const lowerKeyword = trimmedKeyword.toLowerCase();
    const results: Record<string, unknown>[] = [];

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) {
        postSuccess(operationId, results);
        return;
      }
      const book = cursor.value;
      if (isValidBook(book)) {
        const haystack = searchType === 'title' ? book.title : book.author;
        if (haystack && haystack.toLowerCase().includes(lowerKeyword)) {
          results.push(projectBookForList(book));
        }
      }
      cursor.continue();
    };

    request.onerror = () => {
      postError(operationId, request.error?.message || 'Search failed', []);
    };
  }
}

class AddStrategy implements DBStrategy {
  execute({ store, data, operationId }: ExecuteOptions<{ bookInfo: BookRecord }>): void {
    const { bookInfo } = data;
    const request = store.add(bookInfo);
    const onSuccess = (): void => {
      request.removeEventListener('success', onSuccess);
      request.removeEventListener('error', onError);
      if (isValidBook(bookInfo)) indexBookContent(bookInfo);
      // Echo back only metadata; the multi-megabyte document is already
      // persisted in IndexedDB and would otherwise cross the worker boundary
      // a second time for no reason.
      postSuccess(operationId, projectBookForList(bookInfo));
    };
    const onError = (): void => {
      request.removeEventListener('success', onSuccess);
      request.removeEventListener('error', onError);
      postError(operationId, request.error?.message || 'add error');
    };
    request.addEventListener('success', onSuccess);
    request.addEventListener('error', onError);
  }
}

class PutStrategy implements DBStrategy {
  execute({ store, data, operationId }: ExecuteOptions<{ bookInfo: BookRecord }>): void {
    const { bookInfo } = data;
    const request = store.put(bookInfo);
    request.onsuccess = () => {
      if (isValidBook(bookInfo)) indexBookContent(bookInfo);
      postSuccess(operationId, projectBookForList(bookInfo));
    };
    request.onerror = () => {
      postError(operationId, request.error?.message || 'put error');
    };
  }
}

class DeleteStrategy implements DBStrategy {
  execute({ store, data, operationId }: ExecuteOptions<{ key: string }>): void {
    const { key } = data;
    const request = store.delete(key);
    request.onsuccess = () => {
      removeBookFromIndex(key);
      postSuccess(operationId, null);
    };
    request.onerror = () => {
      postError(operationId, request.error?.message || 'delete error');
    };
  }
}

// Strip large fields from a stored book record before sending it back to the
// main thread. The home screen only renders id/title/author/image, so the
// chapter HTML and rawText (often tens of megabytes for image-heavy EPUBs)
// would otherwise be cloned across the worker boundary just to be ignored.
// We keep the document version so isValidBook still accepts the trimmed
// record on the receiving side if it ever round-trips back.
const projectBookForList = (book: BookRecord): Record<string, unknown> => {
  const { document, ...rest } = book;
  return {
    ...rest,
    document: { version: document?.version ?? 1 },
  };
};

class GetAllStrategy implements DBStrategy {
  execute({ store, operationId }: ExecuteOptions): void {
    const request = store.getAll();
    request.onsuccess = () => {
      const data = (request.result as unknown[]).filter(isValidBook).map(projectBookForList);
      postSuccess(operationId, data);
    };
    request.onerror = () => {
      postError(operationId, request.error?.message || 'getAll error', []);
    };
  }
}

class GetStrategy implements DBStrategy {
  execute({ store, data, operationId }: ExecuteOptions<{ key: string }>): void {
    const request = store.get(data.key);
    request.onsuccess = () => {
      postSuccess(operationId, request.result);
    };
    request.onerror = () => {
      postError(operationId, request.error?.message || 'get error');
    };
  }
}

const strategyFactory: Record<OperationType, DBStrategy> = {
  search: new SearchStrategy(),
  add: new AddStrategy(),
  put: new PutStrategy(),
  getAll: new GetAllStrategy(),
  get: new GetStrategy(),
  delete: new DeleteStrategy(),
};

let cachedDB: IDBDatabase | null = null;
let cachedDBPromise: Promise<IDBDatabase> | null = null;

const getDatabase = (dbName: string): Promise<IDBDatabase> => {
  if (cachedDB) return Promise.resolve(cachedDB);
  if (cachedDBPromise) return cachedDBPromise;

  cachedDBPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => {
      cachedDBPromise = null;
      reject(request.error || new Error('Failed to open database'));
    };
    request.onsuccess = () => {
      cachedDB = request.result;
      cachedDBPromise = null;
      resolve(cachedDB);
    };
  });

  return cachedDBPromise;
};

interface WorkerInboundMessage {
  type: OperationType;
  data: unknown;
  dbName: string;
  storeName: string;
  operationId: string;
}

self.onmessage = async (e: MessageEvent<WorkerInboundMessage>) => {
  const { type, data, dbName, storeName, operationId } = e.data;
  try {
    const database = await getDatabase(dbName);
    const transaction = database.transaction(
      storeName,
      type === 'add' || type === 'put' || type === 'delete' ? 'readwrite' : 'readonly',
    );
    const store = transaction.objectStore(storeName);

    const strategy = strategyFactory[type];
    if (!strategy) {
      postError(operationId, 'Unknown operation type');
      return;
    }
    await strategy.execute({ store, database, data: data as never, operationId });
  } catch (error) {
    postError(operationId, getErrorMessage(error, 'Worker error'));
  }
};
