import { listBookResources } from '@/lib/bookResources';
import { createBackupZip } from '@/lib/backup/backupZip';
import { BACKUP_SCHEMA_VERSION } from '@/lib/backup/backupSchema';
import { getAllReaderSettings } from '@/lib/readerSettingStore';
import { getBookById } from '@/store/books';
import { getReaderAnnotations } from '@/lib/readerAnnotations';
import { getReaderBookStatusRecord } from '@/lib/readerBookStatus';
import { getReaderProgress } from '@/lib/readerProgress';
import { getReaderReadingTimeRecordsForBook, getReaderReadingTimeSummary } from '@/lib/readerReadingTime';
import { t } from '@/locales';
import type {
  BackupBookPayload,
  BackupExportKind,
  BackupManifest,
  BackupResourceManifestItem,
  BackupUserDataPayload,
} from '@/lib/backup/backupSchema';
import type { BookInfo } from '@/store/books';

const encoder = new TextEncoder();

const jsonEntry = (value: unknown): Uint8Array => {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
};

const formatExportTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
};

const sanitizeFileName = (value: string): string => {
  const invalidChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  return Array.from(value.trim() || t('common.unnamed_book'))
    .map((char) => (invalidChars.has(char) || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .slice(0, 80);
};

const encodeResourcePath = (resourceKey: string): string => {
  const bytes = encoder.encode(resourceKey);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const createBookPayload = (book: BookInfo, includeBook: boolean): BackupBookPayload => ({
  author: book.author || '',
  createTime: book.createTime,
  document: includeBook ? book.document : undefined,
  fingerprint: book.fingerprint,
  id: book.id,
  image: book.image || '',
  modifyTime: book.modifyTime,
  sourceType: book.sourceType,
  title: book.title || t('common.unnamed_book'),
});

export const createSingleBookBackup = async ({
  bookId,
  includeBook,
}: {
  bookId: string;
  includeBook: boolean;
}): Promise<{ blob: Blob; fileName: string }> => {
  const result = await getBookById<BookInfo>(bookId);
  if (result.error || !result.data) {
    throw new Error(t('backup.book_not_found'));
  }

  const book = result.data;
  const createdAt = Date.now();
  const annotations = getReaderAnnotations(bookId);
  const bookStatus = getReaderBookStatusRecord(bookId);
  const progress = getReaderProgress(bookId);
  const settings = await getAllReaderSettings();
  const readingTime = await getReaderReadingTimeRecordsForBook(bookId);
  const readingTimeSummary = getReaderReadingTimeSummary(bookId);
  const resources = includeBook ? await listBookResources(bookId) : [];
  const exportKind: BackupExportKind = includeBook ? 'full' : 'user-data';
  const manifest: BackupManifest = {
    appName: 'weread',
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    bookCount: 1,
    books: [
      {
        annotationCount: annotations.length,
        author: book.author || '',
        fingerprint: book.fingerprint,
        id: book.id,
        progressUpdatedAt: progress?.updatedAt,
        readingTimeMs: readingTimeSummary.totalMs,
        readingStatus: bookStatus?.status,
        sourceType: book.sourceType,
        title: book.title || t('common.unnamed_book'),
      },
    ],
    createdAt,
    exportKind,
    includes: {
      annotations: true,
      bookContent: includeBook,
      bookStatus: true,
      progress: true,
      readingTime: true,
      resources: includeBook && resources.length > 0,
      settings: true,
    },
  };
  const userData: BackupUserDataPayload = {
    annotations,
    bookStatus,
    progress,
    readingTimeDaily: readingTime.daily,
    readingTimeSegments: readingTime.segments,
    settings,
  };
  const resourceManifest: BackupResourceManifestItem[] = resources.map((resource) => ({
    mediaType: resource.mediaType,
    path: `books/${book.id}/resources/files/${encodeResourcePath(resource.resourceKey)}`,
    resourceKey: resource.resourceKey,
    size: resource.size,
  }));

  const entries = [
    { data: jsonEntry(manifest), path: 'manifest.json' },
    { data: jsonEntry(createBookPayload(book, includeBook)), path: `books/${book.id}/book.json` },
    { data: jsonEntry(userData.annotations), path: 'user-data/annotations.json' },
    { data: jsonEntry(userData.bookStatus || null), path: 'user-data/book-status.json' },
    { data: jsonEntry(userData.progress || null), path: 'user-data/progress.json' },
    { data: jsonEntry(userData.settings), path: 'user-data/settings.json' },
    { data: jsonEntry(userData.readingTimeDaily), path: 'user-data/reading-time-daily.json' },
    { data: jsonEntry(userData.readingTimeSegments), path: 'user-data/reading-time-segments.json' },
    { data: jsonEntry(resourceManifest), path: `books/${book.id}/resources/manifest.json` },
    ...resources.map((resource, index) => ({
      data: resource.blob,
      path: resourceManifest[index].path,
    })),
  ];

  const blob = await createBackupZip(entries);
  return {
    blob,
    fileName: `${sanitizeFileName(book.title)}-${formatExportTime(createdAt)}-archive.bdz`,
  };
};

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
