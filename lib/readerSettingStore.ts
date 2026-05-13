import { db } from '@/store';
import { READER_SETTINGS_STORE_NAME } from '@/lib/readerStoreNames';
import { safeReadStorage, safeWriteStorage } from '@/lib/utils';

export interface ReaderSettingRecord {
  key: string;
  updatedAt: number;
  value: string;
}

// In-memory overlay over localStorage so high-frequency reads on the render
// path (font size, line gap, indent, scroll padding) skip the try/catch +
// canUseStorage probe on every call. Cross-tab sync was not supported anyway.
const settingMemoryCache = new Map<string, string | null>();

export const readCachedReaderSetting = (key: string): string | null => {
  if (settingMemoryCache.has(key)) return settingMemoryCache.get(key) ?? null;
  const value = safeReadStorage(key);
  settingMemoryCache.set(key, value);
  return value;
};

export const writeCachedReaderSetting = (key: string, value: string): void => {
  settingMemoryCache.set(key, value);
  safeWriteStorage(key, value);
};

export const persistReaderSetting = (key: string, value: string): void => {
  writeCachedReaderSetting(key, value);
  void db.update<ReaderSettingRecord>({
    data: {
      key,
      updatedAt: Date.now(),
      value,
    },
    storeName: READER_SETTINGS_STORE_NAME,
  });
};

export const getAllReaderSettings = async (): Promise<ReaderSettingRecord[]> => {
  const result = await db.readByCursor<ReaderSettingRecord>({ storeName: READER_SETTINGS_STORE_NAME });
  return result.error ? [] : result.data;
};

export const restoreReaderSettings = async (records: ReaderSettingRecord[]): Promise<void> => {
  await Promise.all(
    records
      .filter((record) => record?.key && typeof record.value === 'string')
      .map(async (record) => {
        writeCachedReaderSetting(record.key, record.value);
        await db.update<ReaderSettingRecord>({
          data: {
            key: record.key,
            updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
            value: record.value,
          },
          storeName: READER_SETTINGS_STORE_NAME,
        });
      }),
  );
};

export const hydrateReaderSettingCache = async (): Promise<void> => {
  const result = await db.readByCursor<ReaderSettingRecord>({ storeName: READER_SETTINGS_STORE_NAME });
  if (result.error) return;
  result.data.forEach((record) => {
    if (record?.key && typeof record.value === 'string') {
      writeCachedReaderSetting(record.key, record.value);
    }
  });
};
