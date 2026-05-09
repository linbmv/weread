// 数据库：IDBDatabase 对象，数据库有版本概念，同一时刻只能有一个版本，每个域名可以建多个数据库
// 对象仓库：IDBObjectStore 对象，类似于关系型数据库的表格
// 索引：IDBIndex 对象，可以在对象仓库中，为不同的属性建立索引，主键建立默认索引
// 事务：IDBTransaction 对象，增删改查都需要通过事务来完成，事务对象提供了 error,abord,complete 三个回调方法，监听操作结果
// 操作请求：IDBRequest 对象
// 指针：IDBCursor 对象
// 主键集合：IDBKeyRange 对象，主键是默认建立索引的属性，可以取当前层级的某个属性，也可以指定下一层对象的属性，还可以是一个递增的整数

import { getErrorMessage } from '@/lib/utils';

export interface IDBResult<T = unknown> {
  status: 'success' | 'error' | 'pending';
  code: number;
  data: T;
  error: boolean;
  message?: string;
  reason?: string;
  progress?: number;
}

const errorResult = <T = unknown>(message: string, data?: T): IDBResult<T> => ({
  status: 'error',
  code: 1,
  data: data as T,
  error: true,
  message,
});

const successResult = <T = unknown>(data: T): IDBResult<T> => ({
  status: 'success',
  code: 0,
  data,
  error: false,
});

const extractVersion = (message: string): number | undefined => {
  const match = /existing version \((\d+)\)/u.exec(message);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

export class WebDB {
  database?: IDBDatabase;
  version: number;
  dbName: string;
  constructor({ dbName, version }: { dbName: string; version?: number }) {
    this.dbName = dbName;
    this.version = version || 1;
  }
  openDataBase = (): Promise<IDBResult<{ db: IDBDatabase }>> => {
    return new Promise<IDBResult<{ db: IDBDatabase }>>((resolve) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onsuccess = () => {
        this.database = request.result;
        this.version = this.database.version;
        resolve(successResult({ db: this.database }));
      };
      request.onerror = () => {
        const message = request.error?.message || 'open database error';
        if (request.error?.name === 'VersionError') {
          const existVersion = extractVersion(message);
          if (existVersion !== undefined && existVersion > this.version) {
            this.version = existVersion;
            this.refreshDatabase().then(resolve).catch((error: IDBResult<{ db: IDBDatabase }>) => {
              resolve(error);
            });
            return;
          }
        }
        resolve(errorResult<{ db: IDBDatabase }>(message, undefined as unknown as { db: IDBDatabase }));
      };
      request.onupgradeneeded = () => {
        this.database = request.result;
        this.version = this.database.version;
        // 在这里创建 ObjectStore
        if (this.database && !this.database.objectStoreNames.contains('books_info')) {
          this.database.createObjectStore('books_info', { keyPath: 'id' });
        }
      };
    });
  };
  closeDataBase = (): void => {
    this.database?.close();
    this.database = undefined;
  };
  deleteDatabase = ({ dbName }: { dbName: string }): Promise<IDBResult> => {
    return new Promise<IDBResult>((resolve) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve(successResult(null));
      request.onerror = () => resolve(errorResult(request.error?.message || 'delete database error', null));
    });
  };
  getObjectStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore | undefined {
    if (!this.database) {
      console.error('Database is not open');
      return undefined;
    }
    try {
      const transaction = this.database.transaction([storeName], mode);
      return transaction.objectStore(storeName);
    } catch (error) {
      console.error('getObjectStore failed', getErrorMessage(error));
      return undefined;
    }
  }
  createObjectStore = ({ storeName, options }: { storeName: string; options: IDBObjectStoreParameters }): void => {
    if (this.database?.objectStoreNames.contains(storeName)) return;
    this.database?.createObjectStore(storeName, options);
  };
  refreshDatabase = (): Promise<IDBResult<{ db: IDBDatabase }>> => {
    this.closeDataBase();
    return this.openDataBase();
  };
  createObjectStoreIndex = ({
    storeName,
    indexName,
    keyPath,
    options,
  }: {
    storeName: string;
    indexName: string;
    keyPath: string | string[];
    options?: IDBIndexParameters;
  }): void => {
    const store = this.getObjectStore(storeName);
    store?.createIndex(indexName, keyPath, options);
  };
  add = <T = unknown>({ storeName, data }: { storeName: string; data: T }): Promise<IDBResult<T>> => {
    return new Promise<IDBResult<T>>((resolve) => {
      const store = this.getObjectStore(storeName, 'readwrite');
      if (!store) return resolve(errorResult<T>('Database not initialized', undefined as T));
      const request = store.add(data);
      request.onsuccess = () => resolve(successResult(data));
      request.onerror = () => resolve(errorResult<T>(request.error?.message || 'add error', undefined as T));
    });
  };
  update = <T = unknown>({ storeName, data }: { storeName: string; data: T }): Promise<IDBResult<null>> => {
    return new Promise<IDBResult<null>>((resolve) => {
      const store = this.getObjectStore(storeName, 'readwrite');
      if (!store) return resolve(errorResult('Database not initialized', null));
      const request = store.put(data);
      request.onsuccess = () => resolve(successResult(null));
      request.onerror = () => resolve(errorResult(request.error?.message || 'update error', null));
    });
  };
  readByKey = <T = unknown>({ storeName, key }: { storeName: string; key: IDBValidKey }): Promise<IDBResult<T>> => {
    return new Promise<IDBResult<T>>((resolve) => {
      const store = this.getObjectStore(storeName);
      if (!store) return resolve(errorResult<T>('Database not initialized', undefined as T));
      const request = store.get(key);
      request.onsuccess = () => resolve(successResult(request.result as T));
      request.onerror = () => resolve(errorResult<T>(request.error?.message || 'read error', undefined as T));
    });
  };
  readByCursor = <T = unknown>({
    storeName,
    keyRange,
    direction,
  }: {
    storeName: string;
    keyRange?: IDBKeyRange;
    direction?: IDBCursorDirection;
  }): Promise<IDBResult<T[]>> => {
    return new Promise<IDBResult<T[]>>((resolve) => {
      const store = this.getObjectStore(storeName);
      if (!store) return resolve(errorResult<T[]>('Database not initialized', []));
      const request = store.openCursor(keyRange, direction);
      const result: T[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          result.push(cursor.value as T);
          cursor.continue();
        } else {
          resolve(successResult(result));
        }
      };
      request.onerror = () => resolve(errorResult<T[]>(request.error?.message || 'read cursor error', result));
    });
  };
  delete = ({ storeName, key }: { storeName: string; key: IDBValidKey }): Promise<IDBResult<null>> => {
    return new Promise<IDBResult<null>>((resolve) => {
      const store = this.getObjectStore(storeName, 'readwrite');
      if (!store) return resolve(errorResult('Database not initialized', null));
      const request = store.delete(key);
      request.onsuccess = () => resolve(successResult(null));
      request.onerror = () => resolve(errorResult(request.error?.message || 'delete error', null));
    });
  };
}
