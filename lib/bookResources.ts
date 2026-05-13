import { getErrorMessage } from '@/lib/utils';

export interface BookResourceRecord {
  bookId: string;
  resourceKey: string;
  mediaType: string;
  blob: Blob;
  size: number;
}

const RESOURCE_DB_NAME = 'weread-book-resources';

const RESOURCE_STORE_NAME = 'resources';

const RESOURCE_DB_VERSION = 1;

// Cap the in-memory Blob URL cache so long reading sessions cannot leak
// unbounded amounts of memory. URLs evicted here are revoked synchronously,
// so any <img> still referencing them will fall back to a broken image, but
// the resolver hook will create a fresh URL on the next render.
const MAX_BLOB_URL_CACHE_SIZE = 64;

let resourceDB: IDBDatabase | null = null;
let resourceDBPromise: Promise<IDBDatabase> | null = null;

const blobUrlCache = new Map<string, string>();

const buildPrimaryKey = (bookId: string, resourceKey: string): string => `${bookId}\u0000${resourceKey}`;

const openResourceDB = (): Promise<IDBDatabase> => {
  if (resourceDB) return Promise.resolve(resourceDB);
  if (resourceDBPromise) return resourceDBPromise;

  resourceDBPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(RESOURCE_DB_NAME, RESOURCE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RESOURCE_STORE_NAME)) {
        const store = database.createObjectStore(RESOURCE_STORE_NAME, { keyPath: 'primaryKey' });
        store.createIndex('byBook', 'bookId');
      }
    };
    request.onsuccess = () => {
      resourceDB = request.result;
      resourceDBPromise = null;
      resolve(resourceDB);
    };
    request.onerror = () => {
      resourceDBPromise = null;
      reject(request.error || new Error('Failed to open resource database'));
    };
  });

  return resourceDBPromise;
};

const ensureWritable = async (): Promise<IDBObjectStore | undefined> => {
  try {
    const database = await openResourceDB();
    return database.transaction(RESOURCE_STORE_NAME, 'readwrite').objectStore(RESOURCE_STORE_NAME);
  } catch (error) {
    console.error('Resource DB unavailable:', getErrorMessage(error));
    return undefined;
  }
};

interface PersistedRecord extends BookResourceRecord {
  primaryKey: string;
}

export const persistBookResources = async (records: BookResourceRecord[]): Promise<void> => {
  if (records.length === 0) return;
  const store = await ensureWritable();
  if (!store) return;
  await new Promise<void>((resolve) => {
    let pending = records.length;
    const onSettled = (): void => {
      pending--;
      if (pending <= 0) resolve();
    };
    records.forEach((record) => {
      const persisted: PersistedRecord = {
        ...record,
        primaryKey: buildPrimaryKey(record.bookId, record.resourceKey),
      };
      const request = store.put(persisted);
      request.onsuccess = onSettled;
      request.onerror = onSettled;
    });
  });
};

export const loadBookResource = async (bookId: string, resourceKey: string): Promise<BookResourceRecord | undefined> => {
  try {
    const database = await openResourceDB();
    return await new Promise<BookResourceRecord | undefined>((resolve) => {
      const store = database.transaction(RESOURCE_STORE_NAME, 'readonly').objectStore(RESOURCE_STORE_NAME);
      const request = store.get(buildPrimaryKey(bookId, resourceKey));
      request.onsuccess = () => {
        const result = request.result as PersistedRecord | undefined;
        resolve(result || undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
};

export const listBookResources = async (bookId: string): Promise<BookResourceRecord[]> => {
  if (!bookId) return [];
  try {
    const database = await openResourceDB();
    return await new Promise<BookResourceRecord[]>((resolve) => {
      const store = database.transaction(RESOURCE_STORE_NAME, 'readonly').objectStore(RESOURCE_STORE_NAME);
      const index = store.index('byBook');
      const request = index.openCursor(IDBKeyRange.only(bookId));
      const records: BookResourceRecord[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(records);
          return;
        }
        const { primaryKey: _primaryKey, ...record } = cursor.value as PersistedRecord;
        records.push(record);
        cursor.continue();
      };
      request.onerror = () => resolve(records);
    });
  } catch {
    return [];
  }
};

export const deleteBookResources = async (bookId: string): Promise<void> => {
  const store = await ensureWritable();
  if (!store) return;
  const index = store.index('byBook');
  await new Promise<void>((resolve) => {
    const request = index.openKeyCursor(IDBKeyRange.only(bookId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => resolve();
  });
};

export const getBookResourceUrl = async (bookId: string, resourceKey: string): Promise<string | undefined> => {
  const cacheKey = buildPrimaryKey(bookId, resourceKey);
  const cached = blobUrlCache.get(cacheKey);
  if (cached) {
    // LRU touch: re-insert so the most recently used url survives eviction.
    blobUrlCache.delete(cacheKey);
    blobUrlCache.set(cacheKey, cached);
    return cached;
  }

  const record = await loadBookResource(bookId, resourceKey);
  if (!record) return undefined;
  const url = URL.createObjectURL(record.blob);
  blobUrlCache.set(cacheKey, url);
  evictBlobUrlCacheIfNeeded();
  return url;
};

const evictBlobUrlCacheIfNeeded = (): void => {
  while (blobUrlCache.size > MAX_BLOB_URL_CACHE_SIZE) {
    const oldestKey = blobUrlCache.keys().next();
    if (oldestKey.done) return;
    const url = blobUrlCache.get(oldestKey.value);
    if (url) URL.revokeObjectURL(url);
    blobUrlCache.delete(oldestKey.value);
  }
};

export const releaseBookResourceUrls = (bookId?: string): void => {
  const prefix = bookId ? `${bookId}\u0000` : undefined;
  for (const [key, url] of blobUrlCache) {
    if (!prefix || key.startsWith(prefix)) {
      URL.revokeObjectURL(url);
      blobUrlCache.delete(key);
    }
  }
};

export const RESOURCE_URL_SCHEME = 'weread-resource:';

export const buildResourcePlaceholderUrl = (resourceKey: string): string => {
  return `${RESOURCE_URL_SCHEME}${encodeURIComponent(resourceKey)}`;
};

export const isResourcePlaceholderUrl = (value: string): boolean => {
  return value.startsWith(RESOURCE_URL_SCHEME);
};

export const parseResourcePlaceholderKey = (value: string): string | undefined => {
  if (!isResourcePlaceholderUrl(value)) return undefined;
  try {
    return decodeURIComponent(value.slice(RESOURCE_URL_SCHEME.length));
  } catch {
    return undefined;
  }
};
