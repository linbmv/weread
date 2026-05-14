import { db } from '@/store/index';
import { deleteBookResources, persistBookResources, releaseBookResourceUrls } from '@/lib/bookResources';
import { createRandomId, getErrorMessage, sha256Hex } from '@/lib/utils';
import type { BookResourceRecord } from '@/lib/bookResources';
import type { IDBResult } from '@/lib/indexedDB';
import type { ReaderBookDocument, ReaderBookSourceType } from '@/lib/readerDocument';

export interface BookInfo {
  id: string;
  title: string;
  author: string;
  image: string;
  document: ReaderBookDocument;
  sourceType: ReaderBookSourceType;
  fingerprint?: string;
  createTime?: number;
  modifyTime?: number;
}

export interface SearchResult extends BookInfo {
  matchedText: string[];
}

const STORE_NAME_BOOKS_INFO_KEY = 'books_info';

const FINGERPRINT_SAMPLE_SIZE = 4096;

const PENDING_OPERATION_TIMEOUT_MS = 60_000;

export const BOOK_STORE_RESULT_REASON = {
  BOOK_ALREADY_EXISTS: 'book-already-exists',
} as const;

export type BookStoreResultReason = (typeof BOOK_STORE_RESULT_REASON)[keyof typeof BOOK_STORE_RESULT_REASON];

export const getBookFingerprint = async (data: {
  author: string;
  document: ReaderBookDocument;
  sourceType: ReaderBookSourceType;
  title: string;
}): Promise<string> => {
  const { author, document, sourceType, title } = data;
  const rawText = document.rawText || '';
  const sampleHead = rawText.slice(0, FINGERPRINT_SAMPLE_SIZE);
  const sampleTail = rawText.length > FINGERPRINT_SAMPLE_SIZE ? rawText.slice(-FINGERPRINT_SAMPLE_SIZE) : '';
  const seed = [sourceType, title, author, rawText.length, sampleHead, sampleTail].join('\u0000');
  return sha256Hex(seed);
};

const successResult = <T>(
  data: T,
  options: { message?: string; reason?: BookStoreResultReason } = {},
): IDBResult<T> => ({
  status: 'success',
  code: 0,
  data,
  error: false,
  message: options.message,
  reason: options.reason,
});

const errorResult = <T>(message: string, fallback?: T): IDBResult<T> => ({
  status: 'error',
  code: 1,
  data: fallback as T,
  error: true,
  message,
});

let dbWorker: Worker | null = null;
const pendingWorkerOperations = new Map<
  string,
  { resolve: (result: IDBResult<unknown>) => void; timer: number }
>();

interface WorkerResponseEnvelope<T> extends IDBResult<T> {
  operationId: string;
}

const handleWorkerMessage = (event: MessageEvent<WorkerResponseEnvelope<unknown>>): void => {
  const operationId = event.data?.operationId;
  if (!operationId) return;
  const pending = pendingWorkerOperations.get(operationId);
  if (!pending) return;
  pendingWorkerOperations.delete(operationId);
  clearTimeout(pending.timer);
  const { operationId: _operationId, ...rest } = event.data;
  pending.resolve(rest as IDBResult<unknown>);
};

const handleWorkerError = (event: ErrorEvent): void => {
  const message = event.message || 'Worker error';
  for (const [, pending] of pendingWorkerOperations) {
    clearTimeout(pending.timer);
    pending.resolve(errorResult(message));
  }
  pendingWorkerOperations.clear();
};

const getDBWorker = (): Worker => {
  if (!dbWorker) {
    dbWorker = new Worker(new URL('../workers/dbWorker.ts', import.meta.url), {
      type: 'module',
    });
    dbWorker.addEventListener('message', handleWorkerMessage);
    dbWorker.addEventListener('error', handleWorkerError);
  }
  return dbWorker;
};

export const terminateDBWorker = (): void => {
  if (dbWorker) {
    dbWorker.terminate();
    dbWorker = null;
  }
  for (const [, pending] of pendingWorkerOperations) {
    clearTimeout(pending.timer);
    pending.resolve(errorResult('Worker terminated'));
  }
  pendingWorkerOperations.clear();
};

const performWorkerOperation = <T = unknown>(
  type: string,
  data: Record<string, unknown> = {},
): Promise<IDBResult<T>> => {
  return new Promise((resolve) => {
    if (!db.database) {
      resolve(errorResult<T>('Database not initialized'));
      return;
    }

    const worker = getDBWorker();
    const operationId = createRandomId('op');

    const timer = window.setTimeout(() => {
      if (!pendingWorkerOperations.delete(operationId)) return;
      resolve(errorResult<T>('Worker operation timed out'));
    }, PENDING_OPERATION_TIMEOUT_MS);

    pendingWorkerOperations.set(operationId, {
      resolve: resolve as (result: IDBResult<unknown>) => void,
      timer,
    });

    try {
      worker.postMessage({
        type,
        data,
        dbName: db.database.name,
        storeName: STORE_NAME_BOOKS_INFO_KEY,
        operationId,
      });
    } catch (error) {
      if (!pendingWorkerOperations.delete(operationId)) return;
      clearTimeout(timer);
      resolve(errorResult<T>(getErrorMessage(error, 'Failed to dispatch worker message')));
    }
  });
};

export const addBook = async (data: {
  id?: string;
  fingerprint?: string;
  title: string;
  author?: string;
  image?: string;
  document: ReaderBookDocument;
  sourceType: ReaderBookSourceType;
  resources?: BookResourceRecord[];
  overwrite?: boolean;
}): Promise<IDBResult<BookInfo>> => {
  const {
    id: preferredId,
    fingerprint,
    title = '',
    author = '',
    image = '',
    document,
    sourceType,
    resources = [],
    overwrite = false,
  } = data;
  const computedFingerprint = fingerprint || (await getBookFingerprint({ author, document, sourceType, title }));
  const id = preferredId || computedFingerprint;

  const existing = await getBookById<BookInfo>(id);
  if (!overwrite && !existing.error && existing.data) {
    const {
      id: existingId,
      title: existingTitle,
      author: existingAuthor,
      image: existingImage,
      sourceType: existingSourceType,
      createTime,
      modifyTime,
    } = existing.data;
    return successResult(
      {
        id: existingId,
        title: existingTitle,
        author: existingAuthor,
        image: existingImage,
        sourceType: existingSourceType,
        fingerprint: existing.data.fingerprint,
        createTime,
        modifyTime,
        document: { version: 1 } as ReaderBookDocument,
      },
      { reason: BOOK_STORE_RESULT_REASON.BOOK_ALREADY_EXISTS },
    );
  }

  const now = Date.now();
  const bookInfo: BookInfo = {
    id,
    title,
    author,
    image,
    document,
    sourceType,
    fingerprint: computedFingerprint,
    createTime: overwrite && !existing.error && existing.data?.createTime ? existing.data.createTime : now,
    modifyTime: now,
  };

  if (overwrite) {
    releaseBookResourceUrls(id);
    try {
      await deleteBookResources(id);
    } catch (error) {
      console.error('Failed to delete old book resources:', getErrorMessage(error));
    }
  }

  if (resources.length > 0) {
    try {
      await persistBookResources(resources.map((record) => ({ ...record, bookId: id })));
    } catch (error) {
      console.error('Failed to persist book resources:', getErrorMessage(error));
    }
  }

  const addResult = await performWorkerOperation<BookInfo>(overwrite ? 'put' : 'add', { bookInfo });
  if (addResult.error) {
    // Race condition: another import added the same book between our get and add.
    const conflict = await getBookById<BookInfo>(id);
    if (!conflict.error && conflict.data) {
      const {
        id: conflictId,
        title: conflictTitle,
        author: conflictAuthor,
        image: conflictImage,
        sourceType: conflictSourceType,
        createTime,
        modifyTime,
      } = conflict.data;
      return successResult(
        {
          id: conflictId,
          title: conflictTitle,
          author: conflictAuthor,
          image: conflictImage,
          sourceType: conflictSourceType,
          fingerprint: conflict.data.fingerprint,
          createTime,
          modifyTime,
          document: { version: 1 } as ReaderBookDocument,
        },
        { reason: BOOK_STORE_RESULT_REASON.BOOK_ALREADY_EXISTS },
      );
    }
    return addResult;
  }
  // The worker returns a metadata-only projection on success; relay it.
  return addResult;
};

export const searchBooksByTitle = <T = unknown>(keyword: string): Promise<IDBResult<T[]>> => {
  return performWorkerOperation<T[]>('search', { keyword, searchType: 'title' });
};

export const searchBooksByAuthor = <T = unknown>(keyword: string): Promise<IDBResult<T[]>> => {
  return performWorkerOperation<T[]>('search', { keyword, searchType: 'author' });
};

export const searchBooksByContent = <T = unknown>(keyword: string): Promise<IDBResult<T[]>> => {
  return performWorkerOperation<T[]>('search', { keyword, searchType: 'content' });
};

export const getAllBooks = <T = unknown>(): Promise<IDBResult<T[]>> => {
  return performWorkerOperation<T[]>('getAll');
};

export const getBookById = <T = unknown>(id: string): Promise<IDBResult<T>> => {
  return performWorkerOperation<T>('get', { key: id });
};

export const deleteBookById = async (id: string): Promise<IDBResult<null>> => {
  const result = await performWorkerOperation<null>('delete', { key: id });
  if (!result.error) {
    releaseBookResourceUrls(id);
    try {
      await deleteBookResources(id);
    } catch (error) {
      console.error('Failed to delete book resources:', getErrorMessage(error));
    }
  }
  return result;
};
