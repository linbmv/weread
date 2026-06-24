import { useEffect, useState } from 'react';
import { READER_BOOK_STATUS_STORE_NAME } from '@/lib/readerStoreNames';
import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import { db } from '@/store';
import { getAuthState, apiFetch } from '@/store/auth';

const syncBookStatusCloud = (bookId: string, status: ReaderBookStatus | null): void => {
  if (getAuthState().loggedIn) {
    void apiFetch('/api/sync/status', {
      method: 'POST',
      body: JSON.stringify([{
        bookId,
        status: status ? { status, updatedAt: Date.now() } : null,
        updatedAt: Date.now(),
      }]),
    });
  }
};

export const READER_BOOK_STATUS_OPTIONS = ['reading', 'read', 'finished'] as const;

export type ReaderBookStatus = (typeof READER_BOOK_STATUS_OPTIONS)[number];

export type ReaderBookShelfStatus = ReaderBookStatus | 'unread';

export interface ReaderBookStatusRecord {
  bookId: string;
  status: ReaderBookStatus;
  updatedAt: number;
}

let bookStatusMapCache: Record<string, ReaderBookStatusRecord> = {};

const isReaderBookStatus = (value: unknown): value is ReaderBookStatus => {
  return READER_BOOK_STATUS_OPTIONS.includes(value as ReaderBookStatus);
};

const emitBookStatusChange = (): void => {
  syncHook.call(EVENT_NAME.SET_READER_BOOK_STATUS);
};

const persistReaderBookStatus = (record: ReaderBookStatusRecord): void => {
  void db.update<ReaderBookStatusRecord>({
    data: record,
    storeName: READER_BOOK_STATUS_STORE_NAME,
  });
};

export const hydrateReaderBookStatus = async (): Promise<void> => {
  const result = await db.readByCursor<ReaderBookStatusRecord>({ storeName: READER_BOOK_STATUS_STORE_NAME });
  if (result.error) return;
  const nextMap: Record<string, ReaderBookStatusRecord> = {};
  result.data.forEach((record) => {
    if (!record?.bookId || !isReaderBookStatus(record.status)) return;
    nextMap[record.bookId] = record;
  });

  if (getAuthState().loggedIn) {
    const { data: cloudStatus, error } = await apiFetch<any[]>('/api/sync/status');
    if (!error && cloudStatus) {
      for (const item of cloudStatus) {
        const local = nextMap[item.bookId];
        if (!local || local.updatedAt < item.updatedAt) {
          if (item.status) {
            const record = {
              bookId: item.bookId,
              status: item.status.status,
              updatedAt: item.status.updatedAt || item.updatedAt,
            };
            nextMap[item.bookId] = record;
            void db.update<ReaderBookStatusRecord>({
              data: record,
              storeName: READER_BOOK_STATUS_STORE_NAME,
            });
          } else {
            delete nextMap[item.bookId];
            void db.delete({ key: item.bookId, storeName: READER_BOOK_STATUS_STORE_NAME });
          }
        }
      }
    }
  }

  bookStatusMapCache = nextMap;
  emitBookStatusChange();
};

export const getReaderBookStatusRecord = (bookId?: string | null): ReaderBookStatusRecord | undefined => {
  if (!bookId) return undefined;
  return bookStatusMapCache[bookId];
};

export const getReaderBookStatus = (bookId?: string | null): ReaderBookStatus | undefined => {
  return getReaderBookStatusRecord(bookId)?.status;
};

export const getReaderBookShelfStatus = (bookId?: string | null): ReaderBookShelfStatus => {
  return getReaderBookStatus(bookId) || 'unread';
};

export const setReaderBookStatus = (bookId: string | undefined | null, status?: ReaderBookStatus | null): void => {
  if (!bookId) return;
  if (!isReaderBookStatus(status)) {
    delete bookStatusMapCache[bookId];
    void db.delete({ key: bookId, storeName: READER_BOOK_STATUS_STORE_NAME });
    emitBookStatusChange();
    syncBookStatusCloud(bookId, null);
    return;
  }

  const next: ReaderBookStatusRecord = {
    bookId,
    status,
    updatedAt: Date.now(),
  };
  bookStatusMapCache[bookId] = next;
  persistReaderBookStatus(next);
  emitBookStatusChange();
  syncBookStatusCloud(bookId, status);
};

export const deleteReaderBookStatus = async (bookId: string): Promise<void> => {
  if (!(bookId in bookStatusMapCache)) return;
  delete bookStatusMapCache[bookId];
  emitBookStatusChange();
  await db.delete({ key: bookId, storeName: READER_BOOK_STATUS_STORE_NAME });
  syncBookStatusCloud(bookId, null);
};

export const restoreReaderBookStatusForBook = async ({
  bookId,
  status,
}: {
  bookId: string;
  status?: ReaderBookStatusRecord;
}): Promise<void> => {
  if (!status || !isReaderBookStatus(status.status)) {
    delete bookStatusMapCache[bookId];
    await db.delete({ key: bookId, storeName: READER_BOOK_STATUS_STORE_NAME });
    emitBookStatusChange();
    return;
  }

  const next: ReaderBookStatusRecord = {
    bookId,
    status: status.status,
    updatedAt: Number.isFinite(status.updatedAt) ? status.updatedAt : Date.now(),
  };
  bookStatusMapCache[bookId] = next;
  await db.update<ReaderBookStatusRecord>({
    data: next,
    storeName: READER_BOOK_STATUS_STORE_NAME,
  });
  emitBookStatusChange();
};

export const useReaderBookStatusRevision = (): number => {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const updateRevision = () => setRevision((value) => value + 1);
    syncHook.tap(EVENT_NAME.SET_READER_BOOK_STATUS, updateRevision);
    return () => {
      syncHook.off(EVENT_NAME.SET_READER_BOOK_STATUS, updateRevision);
    };
  }, []);

  return revision;
};
