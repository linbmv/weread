import type { BookInfo } from '@/store/books';
import type { BookResourceRecord } from '@/lib/bookResources';
import type { ReaderAnnotation } from '@/lib/readerAnnotations';
import type { ReaderLocator } from '@/lib/readerProgress';
import type { ReaderReadingTimeDailyAggregate, ReaderReadingTimeSegment } from '@/lib/readerReadingTime';

export const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_FILE_EXTENSION = 'bdz';

export type BackupExportKind = 'full' | 'user-data';

export interface BackupManifestBook {
  annotationCount: number;
  author: string;
  fingerprint?: string;
  id: string;
  progressUpdatedAt?: number;
  readingTimeMs: number;
  sourceType: BookInfo['sourceType'];
  title: string;
}

export interface BackupManifest {
  appName: 'weread';
  backupSchemaVersion: number;
  bookCount: number;
  books: BackupManifestBook[];
  createdAt: number;
  exportKind: BackupExportKind;
  includes: {
    annotations: boolean;
    bookContent: boolean;
    progress: boolean;
    readingTime: boolean;
    resources: boolean;
    settings: boolean;
  };
}

export interface BackupBookPayload {
  author: string;
  createTime?: number;
  document?: BookInfo['document'];
  fingerprint?: string;
  id: string;
  image: string;
  modifyTime?: number;
  sourceType: BookInfo['sourceType'];
  title: string;
}

export interface BackupResourceManifestItem {
  mediaType: string;
  path: string;
  resourceKey: string;
  size: number;
}

export interface BackupUserDataPayload {
  annotations: ReaderAnnotation[];
  progress?: ReaderLocator;
  readingTimeDaily: ReaderReadingTimeDailyAggregate[];
  readingTimeSegments: ReaderReadingTimeSegment[];
  settings: Array<{ key: string; updatedAt: number; value: string }>;
}

export interface ParsedBackupArchive {
  book: BackupBookPayload;
  file: File;
  manifest: BackupManifest;
  resources: Array<BackupResourceManifestItem & { blob: Blob }>;
  userData: BackupUserDataPayload;
}

export const isFullBackupManifest = (manifest: BackupManifest): boolean => {
  return manifest.exportKind === 'full' && manifest.includes.bookContent;
};

export const getBackupBookIdentity = (book: Pick<BackupBookPayload, 'fingerprint' | 'id'>): string => {
  return book.fingerprint || book.id;
};

export const toBookResourceRecords = (
  bookId: string,
  resources: Array<BackupResourceManifestItem & { blob: Blob }>,
): BookResourceRecord[] => {
  return resources.map((resource) => ({
    blob: resource.blob,
    bookId,
    mediaType: resource.mediaType,
    resourceKey: resource.resourceKey,
    size: resource.size,
  }));
};
