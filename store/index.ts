import { WebDB } from '@/lib/indexedDB';
import { hydrateReaderAnnotations } from '@/lib/readerAnnotations';
import { hydrateReaderProgress } from '@/lib/readerProgress';
import { hydrateReaderReadingTime } from '@/lib/readerReadingTime';
import { hydrateReaderSettings } from '@/lib/readerSettings';

const DATABASE_VERSION = 2;

export const db = new WebDB({ dbName: 'read', version: DATABASE_VERSION });

const hydrateReaderData = async (): Promise<void> => {
  await Promise.all([
    hydrateReaderSettings(),
    hydrateReaderAnnotations(),
    hydrateReaderProgress(),
    hydrateReaderReadingTime(),
  ]);
};

export const initDB = (): Promise<boolean> => {
  return db.openDataBase().then(async (result) => {
    if (result.status !== 'success') return false;
    await hydrateReaderData();
    return true;
  });
};
export const closeDB = (): void => {
  db.closeDataBase();
};

export const resumeDB = (): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    db.refreshDatabase()
      .then(async (result) => {
        if (result.status !== 'success') {
          resolve(false);
          return;
        }
        await hydrateReaderData();
        resolve(true);
      })
      .catch(() => {
        reject(false);
      });
  });
};
