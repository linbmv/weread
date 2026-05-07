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

export const createBookStore = (): void => {
  db.createObjectStore({ storeName: STORE_NAME_BOOKS_INFO_KEY, options: { keyPath: 'id' } });
};

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

const successResult = <T>(data: T, message?: string): IDBResult<T> => ({
  status: 'success',
  code: 0,
  data,
  error: false,
  message,
});

const errorResult = <T>(message: string, fallback?: T): IDBResult<T> => ({
  status: 'error',
  code: 1,
  data: fallback as T,
  error: true,
  message,
});

let dbWorker: Worker | null = null;

const getDBWorker = (): Worker => {
  if (!dbWorker) {
    dbWorker = new Worker(new URL('../workers/dbWorker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return dbWorker;
};

interface WorkerResponseEnvelope<T> extends IDBResult<T> {
  operationId: string;
}

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

    let settled = false;
    let timer: number | undefined;

    const cleanup = (): void => {
      worker.removeEventListener('message', messageHandler);
      worker.removeEventListener('error', errorHandler);
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const settle = (result: IDBResult<T>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const messageHandler = (event: MessageEvent<WorkerResponseEnvelope<T>>): void => {
      if (event.data?.operationId !== operationId) return;
      const { operationId: _operationId, ...rest } = event.data;
      settle(rest as IDBResult<T>);
    };

    const errorHandler = (event: ErrorEvent): void => {
      settle(errorResult<T>(event.message || 'Worker error'));
    };

    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);

    timer = window.setTimeout(() => {
      settle(errorResult<T>('Worker operation timed out'));
    }, PENDING_OPERATION_TIMEOUT_MS);

    try {
      worker.postMessage({
        type,
        data,
        dbName: db.database.name,
        storeName: STORE_NAME_BOOKS_INFO_KEY,
        operationId,
      });
    } catch (error) {
      settle(errorResult<T>(getErrorMessage(error, 'Failed to dispatch worker message')));
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
      'Book already exists',
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
        'Book already exists',
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
