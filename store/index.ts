import { WebDB } from '@/lib/indexedDB';
import { hydrateReaderAnnotations } from '@/lib/readerAnnotations';
import { hydrateReaderBookStatus } from '@/lib/readerBookStatus';
import { hydrateReaderProgress } from '@/lib/readerProgress';
import { hydrateReaderReadingTime } from '@/lib/readerReadingTime';
import { hydrateReaderSettings } from '@/lib/readerSettings';
import { terminateDBWorker } from '@/store/books';

const DATABASE_VERSION = 3;

export const db = new WebDB({ dbName: 'read', version: DATABASE_VERSION });

const hydrateReaderData = async (): Promise<void> => {
  await Promise.all([
    hydrateReaderSettings(),
    hydrateReaderAnnotations(),
    hydrateReaderProgress(),
    hydrateReaderReadingTime(),
    hydrateReaderBookStatus(),
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
  terminateDBWorker();
  db.closeDataBase();
};

export const resumeDB = (): Promise<boolean> => {
  return db
    .refreshDatabase()
    .then(async (result) => {
      if (result.status !== 'success') return false;
      await hydrateReaderData();
      return true;
    })
    .catch(() => false);
};
