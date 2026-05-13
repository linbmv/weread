import { readBackupZip } from '@/lib/backup/backupZip';
import {
  BACKUP_SCHEMA_VERSION,
  getBackupBookIdentity,
  isFullBackupManifest,
  toBookResourceRecords,
} from '@/lib/backup/backupSchema';
import { restoreReaderAnnotationsForBook } from '@/lib/readerAnnotations';
import { restoreReaderProgressForBook } from '@/lib/readerProgress';
import { restoreReaderReadingTimeForBook } from '@/lib/readerReadingTime';
import { restoreReaderSettings } from '@/lib/readerSettingStore';
import { bootstrapReaderSettings, emitReaderSettingChange } from '@/lib/readerSettings';
import type {
  BackupBookPayload,
  BackupManifest,
  BackupResourceManifestItem,
  BackupUserDataPayload,
  ParsedBackupArchive,
} from '@/lib/backup/backupSchema';
import type { ImportedBookData } from '@/lib/bookImporter';

const decoder = new TextDecoder('utf-8');

const getFileExtension = (file: File): string => {
  const index = file.name.lastIndexOf('.');
  return index === -1 ? '' : file.name.slice(index + 1).toLowerCase();
};

const readJsonEntry = <T>(entries: Map<string, { data: Uint8Array }>, path: string, fallback?: T): T => {
  const entry = entries.get(path);
  if (!entry) {
    if (fallback !== undefined) return fallback;
    throw new Error(`BDZ 缺少 ${path}`);
  }
  return JSON.parse(decoder.decode(entry.data)) as T;
};

export const isBackupFile = (file: File): boolean => {
  return getFileExtension(file) === 'bdz';
};

export const parseBackupFile = async (file: File): Promise<ParsedBackupArchive> => {
  const entries = await readBackupZip(file);
  const manifest = readJsonEntry<BackupManifest>(entries, 'manifest.json');
  if (manifest.appName !== 'weread' || manifest.backupSchemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('不支持的 BDZ 备份版本');
  }
  const manifestBook = manifest.books[0];
  if (!manifestBook?.id) throw new Error('BDZ 备份缺少书籍信息');

  const book = readJsonEntry<BackupBookPayload>(entries, `books/${manifestBook.id}/book.json`);
  const userData: BackupUserDataPayload = {
    annotations: readJsonEntry(entries, 'user-data/annotations.json', []),
    progress: readJsonEntry(entries, 'user-data/progress.json', null) || undefined,
    readingTimeDaily: readJsonEntry(entries, 'user-data/reading-time-daily.json', []),
    readingTimeSegments: readJsonEntry(entries, 'user-data/reading-time-segments.json', []),
    settings: readJsonEntry(entries, 'user-data/settings.json', []),
  };
  const resourceManifest = readJsonEntry<BackupResourceManifestItem[]>(
    entries,
    `books/${manifestBook.id}/resources/manifest.json`,
    [],
  );
  const resources = resourceManifest.map((resource) => {
    const entry = entries.get(resource.path);
    if (!entry) throw new Error(`BDZ 缺少资源 ${resource.resourceKey}`);
    return {
      ...resource,
      blob: new Blob([entry.data as BlobPart], { type: resource.mediaType }),
    };
  });

  return { book, file, manifest, resources, userData };
};

export const getBackupArchiveIdentity = (archive: ParsedBackupArchive): string => {
  return getBackupBookIdentity(archive.book);
};

export const isFullBackupArchive = (archive: ParsedBackupArchive): boolean => {
  return isFullBackupManifest(archive.manifest) && Boolean(archive.book.document);
};

export const createImportedBookDataFromBackup = (archive: ParsedBackupArchive): ImportedBookData => {
  if (!archive.book.document) throw new Error('该 BDZ 只包含用户数据，缺少书籍本体');
  return {
    author: archive.book.author || '',
    document: archive.book.document,
    fingerprint: archive.book.fingerprint,
    image: archive.book.image || '',
    resources: toBookResourceRecords(archive.book.id, archive.resources),
    sourceType: archive.book.sourceType,
    title: archive.book.title || '未命名书籍',
  };
};

export const restoreBackupUserData = async ({
  archive,
  targetBookId,
}: {
  archive: ParsedBackupArchive;
  targetBookId: string;
}): Promise<void> => {
  const sourceBookId = archive.book.id;
  await Promise.all([
    restoreReaderAnnotationsForBook({
      annotations: archive.userData.annotations,
      bookId: targetBookId,
      sourceBookId,
    }),
    restoreReaderProgressForBook({
      bookId: targetBookId,
      progress: archive.userData.progress,
    }),
    restoreReaderReadingTimeForBook({
      bookId: targetBookId,
      daily: archive.userData.readingTimeDaily,
      segments: archive.userData.readingTimeSegments,
      sourceBookId,
    }),
    restoreReaderSettings(archive.userData.settings),
  ]);
  bootstrapReaderSettings();
  emitReaderSettingChange();
};
