import { db } from '@/store';
import {
  READER_READING_TIME_DAILY_STORE_NAME,
  READER_READING_TIME_SEGMENTS_STORE_NAME,
} from '@/lib/readerStoreNames';
import { createRandomId } from '@/lib/utils';
import type { ReaderReadingMode } from '@/lib/readerSettings';

export interface ReaderReadingTimeSegment {
  id: string;
  bookId: string;
  dayKey: string;
  durationMs: number;
  endedAt: number;
  page?: number;
  readingMode?: ReaderReadingMode;
  startedAt: number;
  titleId?: number;
}

export interface ReaderReadingTimeDailyAggregate {
  id: string;
  bookId: string;
  dayKey: string;
  durationMs: number;
  segmentCount: number;
  updatedAt: number;
}

export interface ReaderReadingTimeInput {
  bookId: string;
  durationMs: number;
  endedAt: number;
  page?: number;
  readingMode?: ReaderReadingMode;
  startedAt: number;
  titleId?: number;
}

const dailyAggregateCache = new Map<string, ReaderReadingTimeDailyAggregate>();

const getDailyAggregateId = (bookId: string, dayKey: string): string => `${bookId}:${dayKey}`;

const getLocalDayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNextLocalDayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

const normalizeDuration = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
};

const splitReadingTimeByLocalDay = (input: ReaderReadingTimeInput): ReaderReadingTimeSegment[] => {
  const durationMs = normalizeDuration(input.durationMs);
  if (!input.bookId || durationMs <= 0) return [];
  const startedAt = Number.isFinite(input.startedAt) ? input.startedAt : input.endedAt - durationMs;
  const endedAt = Math.max(Number.isFinite(input.endedAt) ? input.endedAt : startedAt + durationMs, startedAt + 1);
  const rawDuration = Math.max(endedAt - startedAt, 1);
  const segments: ReaderReadingTimeSegment[] = [];
  let cursor = startedAt;

  while (cursor < endedAt) {
    const nextDayStart = getNextLocalDayStart(cursor);
    const segmentEnd = Math.min(endedAt, nextDayStart);
    const segmentRatio = (segmentEnd - cursor) / rawDuration;
    const segmentDuration = normalizeDuration(durationMs * segmentRatio);
    if (segmentDuration > 0) {
      segments.push({
        bookId: input.bookId,
        dayKey: getLocalDayKey(cursor),
        durationMs: segmentDuration,
        endedAt: segmentEnd,
        id: createRandomId('reading-time'),
        page: input.page,
        readingMode: input.readingMode,
        startedAt: cursor,
        titleId: input.titleId,
      });
    }
    cursor = segmentEnd;
  }

  return segments;
};

const upsertDailyAggregate = (segment: ReaderReadingTimeSegment): void => {
  const id = getDailyAggregateId(segment.bookId, segment.dayKey);
  const previous = dailyAggregateCache.get(id);
  const next: ReaderReadingTimeDailyAggregate = {
    bookId: segment.bookId,
    dayKey: segment.dayKey,
    durationMs: Math.max(0, Math.round(previous?.durationMs || 0)) + segment.durationMs,
    id,
    segmentCount: Math.max(0, Math.round(previous?.segmentCount || 0)) + 1,
    updatedAt: Date.now(),
  };
  dailyAggregateCache.set(id, next);
  void db.update<ReaderReadingTimeDailyAggregate>({
    data: next,
    storeName: READER_READING_TIME_DAILY_STORE_NAME,
  });
};

export const hydrateReaderReadingTime = async (): Promise<void> => {
  const result = await db.readByCursor<ReaderReadingTimeDailyAggregate>({
    storeName: READER_READING_TIME_DAILY_STORE_NAME,
  });
  if (result.error) return;
  dailyAggregateCache.clear();
  result.data.forEach((record) => {
    if (record?.id && record.bookId && record.dayKey) {
      dailyAggregateCache.set(record.id, record);
    }
  });
};

export const recordReaderReadingTime = (input: ReaderReadingTimeInput): number => {
  const segments = splitReadingTimeByLocalDay(input);
  segments.forEach((segment) => {
    void db.add<ReaderReadingTimeSegment>({
      data: segment,
      storeName: READER_READING_TIME_SEGMENTS_STORE_NAME,
    });
    upsertDailyAggregate(segment);
  });
  return segments.reduce((sum, segment) => sum + segment.durationMs, 0);
};

export const getReaderReadingTimeSummary = (bookId?: string): {
  daily: ReaderReadingTimeDailyAggregate[];
  readingDays: number;
  totalMs: number;
} => {
  const daily = Array.from(dailyAggregateCache.values()).filter((record) => !bookId || record.bookId === bookId);
  const totalMs = daily.reduce((sum, record) => sum + Math.max(0, Math.round(record.durationMs || 0)), 0);
  const readingDays = new Set(daily.filter((record) => record.durationMs > 0).map((record) => record.dayKey)).size;
  return { daily, readingDays, totalMs };
};

export const getReaderReadingTimeRecordsForBook = async (
  bookId?: string,
): Promise<{
  daily: ReaderReadingTimeDailyAggregate[];
  segments: ReaderReadingTimeSegment[];
}> => {
  if (!bookId) return { daily: [], segments: [] };
  const keyRange = IDBKeyRange.only(bookId);
  const [dailyResult, segmentResult] = await Promise.all([
    db.readByCursor<ReaderReadingTimeDailyAggregate>({
      storeName: READER_READING_TIME_DAILY_STORE_NAME,
      indexName: 'bookId',
      keyRange,
    }),
    db.readByCursor<ReaderReadingTimeSegment>({
      storeName: READER_READING_TIME_SEGMENTS_STORE_NAME,
      indexName: 'bookId',
      keyRange,
    }),
  ]);
  return {
    daily: dailyResult.error ? [] : dailyResult.data,
    segments: segmentResult.error ? [] : segmentResult.data,
  };
};

export const restoreReaderReadingTimeForBook = async ({
  bookId,
  daily,
  segments,
  sourceBookId,
}: {
  bookId: string;
  daily: ReaderReadingTimeDailyAggregate[];
  segments: ReaderReadingTimeSegment[];
  sourceBookId: string;
}): Promise<void> => {
  const existingDailyForBook = Array.from(dailyAggregateCache.values()).filter((record) => record.bookId === bookId);
  const deleteDaily = existingDailyForBook.map((record) => {
    dailyAggregateCache.delete(record.id);
    return db.delete({ key: record.id, storeName: READER_READING_TIME_DAILY_STORE_NAME });
  });
  const deleteSegments = db.deleteByCursor({
    storeName: READER_READING_TIME_SEGMENTS_STORE_NAME,
    indexName: 'bookId',
    keyRange: IDBKeyRange.only(bookId),
  });
  await Promise.all([...deleteDaily, deleteSegments]);

  const restoreDaily = daily
    .filter((record) => record?.dayKey)
    .map((record) => {
      const next: ReaderReadingTimeDailyAggregate = {
        ...record,
        bookId,
        id: `${bookId}:${record.dayKey}`,
      };
      dailyAggregateCache.set(next.id, next);
      return db.update<ReaderReadingTimeDailyAggregate>({
        data: next,
        storeName: READER_READING_TIME_DAILY_STORE_NAME,
      });
    });

  const restoreSegments = segments
    .filter((segment) => segment?.id && segment.durationMs > 0)
    .map((segment) => {
      const next: ReaderReadingTimeSegment = {
        ...segment,
        bookId,
        id: sourceBookId === bookId ? segment.id : `${bookId}:${segment.id}`,
      };
      return db.update<ReaderReadingTimeSegment>({
        data: next,
        storeName: READER_READING_TIME_SEGMENTS_STORE_NAME,
      });
    });

  await Promise.all([...restoreDaily, ...restoreSegments]);
};

export const deleteReaderReadingTimeForBook = async (bookId: string): Promise<void> => {
  const pendingDeletes: Promise<unknown>[] = [];
  Array.from(dailyAggregateCache.values())
    .filter((record) => record.bookId === bookId)
    .forEach((record) => {
      dailyAggregateCache.delete(record.id);
      pendingDeletes.push(db.delete({ key: record.id, storeName: READER_READING_TIME_DAILY_STORE_NAME }));
    });
  pendingDeletes.push(
    db.deleteByCursor({
      storeName: READER_READING_TIME_SEGMENTS_STORE_NAME,
      indexName: 'bookId',
      keyRange: IDBKeyRange.only(bookId),
    }),
  );
  await Promise.all(pendingDeletes);
};
