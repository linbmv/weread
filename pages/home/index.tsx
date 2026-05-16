import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useHref, useNavigate } from 'react-router-dom';
import { debounce } from 'ranuts/utils';
import { BookCard, BookCoverFallback } from '@/components/BookCard';
import {
  addBook,
  getAllBooks,
  getBookFingerprint,
  searchBooksByAuthor,
  searchBooksByContent,
  searchBooksByTitle,
} from '@/store/books';
import { trim } from '@/lib/transformText';
import { resumeDB } from '@/store';
import { startSpaViewTransition } from '@/lib/navigation';
import { importBookFile, isSupportedBookFile } from '@/lib/bookImporter';
import type { BookInfo, SearchResult } from '@/store/books';
import type { ImportedBookData } from '@/lib/bookImporter';
import {
  createImportedBookDataFromBackup,
  getBackupArchiveIdentity,
  isBackupFile,
  isFullBackupArchive,
  parseBackupFile,
  restoreBackupUserData,
} from '@/lib/backup/importBackup';
import type { ParsedBackupArchive } from '@/lib/backup/backupSchema';
import { ROUTE_PATH, createReaderPath } from '@/router';
import { DEVICE_ENUM, useCheckDevice } from '@/lib/hooks';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import { clearReaderBookData } from '@/lib/readerBookData';
import { getReaderProgress } from '@/lib/readerProgress';
import { getErrorMessage } from '@/lib/utils';
import { showGlobalFallback } from '@/lib/globalFallback';
import { clearChapterPaginationCache } from '@/lib/chapterPagination';
import { Loading } from '@/components/Loading';
import {
  OcticonChevronRight as HomeArrowRightIcon,
  OcticonPlus as HomePlusIcon,
  OcticonXCircle as HomeSearchClearIcon,
  OcticonSearch as HomeSearchIcon,
} from '@/components/Octicon';
import { t } from '@/locales';
import 'ranui/input';
import './index.scss';

const DESKTOP_INPUT_STYLE = {
  '--ran-input-border-radius': '2rem',
  '--ran-input-content-border-radius': '2rem',
  '--ran-input-content-padding': '10px 10px 10px 52px',
  '--ran-input-content-font-size': '16px',
  '--ran-input-content-font-weight': '400',
};

const MAX_BOOK_LOAD_RETRIES = 3;

const BOOK_IMPORT_TIMEOUT_MS = 180_000;

type ImportConflictType = 'missing-book' | 'restore-user-data' | 'same-book' | 'same-title';

type ImportConflictAction = 'cancel' | 'keepBoth' | 'overwrite';

const HOME_RECENT_BOOK_LIMIT = 6;

let homeBookListCache: BookInfo[] | null = null;

const writeHomeBookListCache = (books: BookInfo[]): void => {
  homeBookListCache = books;
};

interface ImportConflictState {
  bookId: string;
  confirmOnly?: boolean;
  description?: string;
  disableBookLink?: boolean;
  dialogTitle?: string;
  fileName: string;
  fileSizeLabel: string;
  lastReadLabel: string;
  showApplyToRemaining: boolean;
  sourceTypeLabel: string;
  title: string;
  type: ImportConflictType;
  warningText?: string;
}

interface ImportConflictDecision {
  action: ImportConflictAction;
  applyToRemaining: boolean;
}

interface ImportConflictDialogProps {
  state: ImportConflictState | null;
  onCancel: (applyToRemaining: boolean) => void;
  onConfirm: (action: Exclude<ImportConflictAction, 'cancel'>, applyToRemaining: boolean) => void;
}

const chooseBookFiles = (): Promise<File[]> => {
  return new Promise((resolve) => {
    const uploadFile = document.createElement('input');
    uploadFile.setAttribute('type', 'file');
    uploadFile.setAttribute('accept', '.txt,.epub,.bdz,text/plain,application/epub+zip,application/zip');
    uploadFile.setAttribute('multiple', 'multiple');
    uploadFile.onchange = () => {
      resolve(uploadFile.files ? Array.from(uploadFile.files) : []);
      uploadFile.remove();
    };
    uploadFile.click();
  });
};

const isSupportedImportFile = (file: File): boolean => isSupportedBookFile(file) || isBackupFile(file);

const withTimeout = <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const importBookFileWithFallback = (file: File): Promise<ImportedBookData> => {
  const controller = new AbortController();
  const timeoutMessage = `《${file.name}》解析超时，已中断导入`;
  return withTimeout(importBookFile(file, { signal: controller.signal }), BOOK_IMPORT_TIMEOUT_MS, timeoutMessage, () =>
    controller.abort(new Error(timeoutMessage)),
  );
};

const getBookIdentity = (book: Pick<BookInfo, 'fingerprint' | 'id'>): string => book.fingerprint || book.id;

const normalizeBookTitle = (title: string): string => title.trim() || '未命名书籍';

const resolveUniqueBookTitle = (title: string, existingBooks: BookInfo[], currentIdentity: string): string => {
  const baseTitle = title.trim() || '未命名书籍';
  const existingTitles = new Set(
    existingBooks.filter((book) => getBookIdentity(book) !== currentIdentity).map((book) => book.title),
  );
  if (!existingTitles.has(baseTitle)) return baseTitle;

  let index = 2;
  let nextTitle = `${baseTitle}(${index})`;
  while (existingTitles.has(nextTitle)) {
    index += 1;
    nextTitle = `${baseTitle}(${index})`;
  }
  return nextTitle;
};

const formatBookFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size <= 0) return '0KB';
  const mb = size / 1024 / 1024;
  if (mb >= 1) {
    const value = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${value}MB`;
  }
  const kb = Math.max(1, Math.round(size / 1024));
  return `${kb}KB`;
};

const formatImportDate = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '暂无';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatProgressPercent = (value?: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value || 0), 0), 100);
};

const createImportConflictState = ({
  existingBook,
  file,
  imported,
  showApplyToRemaining,
  type,
}: {
  existingBook: BookInfo;
  file: File;
  imported: ImportedBookData;
  showApplyToRemaining: boolean;
  type: ImportConflictType;
}): ImportConflictState => {
  const progress = getReaderProgress(existingBook.id);
  const readPercent = formatProgressPercent(progress?.readPercent);
  const lastReadDateLabel = `上次阅读时间 ${formatImportDate(progress?.updatedAt)}`;
  const lastReadLabel = readPercent > 0 ? `${lastReadDateLabel} (已阅读 ${readPercent}%)` : lastReadDateLabel;
  return {
    bookId: existingBook.id,
    fileName: file.name,
    fileSizeLabel: formatBookFileSize(file.size),
    lastReadLabel,
    showApplyToRemaining,
    sourceTypeLabel: imported.sourceType.toUpperCase(),
    title: existingBook.title || normalizeBookTitle(imported.title),
    type,
  };
};

const formatBackupCreatedAt = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '未知时间';
  return formatImportDate(timestamp);
};

const createBackupUserDataConflictState = ({
  archive,
  existingBook,
  file,
  showApplyToRemaining,
}: {
  archive: ParsedBackupArchive;
  existingBook: BookInfo;
  file: File;
  showApplyToRemaining: boolean;
}): ImportConflictState => {
  const progress = getReaderProgress(existingBook.id);
  const readPercent = formatProgressPercent(progress?.readPercent);
  const lastReadDateLabel = `上次阅读时间 ${formatImportDate(progress?.updatedAt)}`;
  const lastReadLabel = readPercent > 0 ? `${lastReadDateLabel} (已阅读 ${readPercent}%)` : lastReadDateLabel;
  return {
    bookId: existingBook.id,
    description: `${existingBook.title || archive.book.title} 已存在用户数据，是否继续恢复：`,
    dialogTitle: '恢复用户数据',
    fileName: file.name,
    fileSizeLabel: formatBookFileSize(file.size),
    lastReadLabel: `${lastReadLabel} | 备份时间 ${formatBackupCreatedAt(archive.manifest.createdAt)}`,
    showApplyToRemaining,
    sourceTypeLabel: 'Archive',
    title: existingBook.title || archive.book.title,
    type: 'restore-user-data',
    warningText: '恢复将覆盖当前阅读进度、笔记、书签等重要数据',
  };
};

const createMissingBackupBookState = ({
  archive,
  file,
}: {
  archive: ParsedBackupArchive;
  file: File;
}): ImportConflictState => {
  const title = archive.book.title || archive.book.id;
  const fingerprint = archive.book.fingerprint || archive.book.id;
  return {
    bookId: archive.book.id,
    confirmOnly: true,
    description: `无法恢复 ${title} 的用户数据，因为书架中找不到对应的书籍。`,
    dialogTitle: '恢复用户数据',
    disableBookLink: true,
    fileName: file.name,
    fileSizeLabel: formatBookFileSize(file.size),
    lastReadLabel: `备份时间 ${formatBackupCreatedAt(archive.manifest.createdAt)} | 书籍 ${fingerprint.slice(0, 12)}`,
    showApplyToRemaining: false,
    sourceTypeLabel: archive.book.sourceType.toUpperCase(),
    title,
    type: 'missing-book',
    warningText: '恢复失败：缺失书籍本体',
  };
};

const selectBackupArchivesForRestore = (archives: ParsedBackupArchive[]): {
  ignoredCount: number;
  selected: ParsedBackupArchive[];
} => {
  const groups = new Map<string, ParsedBackupArchive[]>();
  archives.forEach((archive) => {
    const key = getBackupArchiveIdentity(archive);
    groups.set(key, [...(groups.get(key) || []), archive]);
  });

  const selected: ParsedBackupArchive[] = [];
  let ignoredCount = 0;
  groups.forEach((group) => {
    const fullBackups = group.filter(isFullBackupArchive);
    const candidates = fullBackups.length > 0 ? fullBackups : group;
    const sorted = [...candidates].sort((a, b) => b.manifest.createdAt - a.manifest.createdAt);
    const [latest, ...rest] = sorted;
    if (latest) selected.push(latest);
    ignoredCount += rest.length + (fullBackups.length > 0 ? group.length - fullBackups.length : 0);
  });

  return { ignoredCount, selected };
};

const upsertBookListItem = (books: BookInfo[], book: BookInfo): BookInfo[] => {
  const index = books.findIndex((item) => item.id === book.id);
  const rest = index === -1 ? books : books.filter((item) => item.id !== book.id);
  return [book, ...rest];
};

const getBookRecentTimestamp = (book: BookInfo): number => {
  const progress = getReaderProgress(book.id);
  return Math.max(progress?.updatedAt || 0, progress?.lastReadAt || 0, book.modifyTime || 0, book.createTime || 0);
};

const getRecentHomeBooks = (books: BookInfo[]): BookInfo[] => {
  return [...books]
    .sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a))
    .slice(0, HOME_RECENT_BOOK_LIMIT);
};

const getImportFailureMessage = (file: File, error: unknown): string => {
  const message = getErrorMessage(error, '导入失败');
  if (/timeout|timed out|超时/iu.test(message)) {
    return /^EPUB /iu.test(message) ? `《${file.name}》解析超时，已中断导入` : message;
  }
  if (/\.epub$/iu.test(file.name)) return `《${file.name}》EPUB 解析失败，已跳过该书`;
  return `《${file.name}》导入失败，已跳过该书`;
};

export const ImportConflictDialog = ({
  state,
  onCancel,
  onConfirm,
}: ImportConflictDialogProps): React.JSX.Element | null => {
  const navigate = useNavigate();
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  const [keepBoth, setKeepBoth] = useState(false);

  useEffect(() => {
    if (state) {
      setApplyToRemaining(false);
      setKeepBoth(false);
    }
  }, [state]);

  const bookUrl = state ? createReaderPath(state.bookId) : ROUTE_PATH.HOME;
  const bookHref = useHref(bookUrl);

  if (!state) return null;

  const isConfirmOnly = Boolean(state.confirmOnly);
  const canKeepBoth = !isConfirmOnly && state.type === 'same-title';
  const isCancelDisabled = canKeepBoth && keepBoth;
  const title = state.type === 'same-book' ? '检测到相同书籍' : '检测到重名书籍';
  const dialogTitle = state.dialogTitle || title;
  const openExistingBook = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onCancel(false);
    navigate(bookUrl);
  };

  return (
    <div className="home-import-dialog-layer" role="presentation">
      <div className="home-import-dialog" role="dialog" aria-modal="true" aria-labelledby="home-import-dialog-title">
        <div className="home-import-dialog-title" id="home-import-dialog-title">
          {dialogTitle}
        </div>
        <div className="home-import-dialog-content">
          <div>{state.description || `${state.title} 已经在书架中：`}</div>
          <div className="home-import-dialog-info">
            {state.disableBookLink ? (
              <div className="home-import-dialog-file">{state.fileName}</div>
            ) : (
              <a className="home-import-dialog-file" href={bookHref} onClick={openExistingBook}>
                {state.fileName}
              </a>
            )}
            <div className="home-import-dialog-meta">
              {state.sourceTypeLabel} | {state.fileSizeLabel} | {state.lastReadLabel}
            </div>
          </div>
          {keepBoth ? (
            <div className="home-import-dialog-note">将自动重命名为 {state.title}(n)</div>
          ) : (
            <div className="home-import-dialog-warning">
              {state.warningText || '覆盖后，原有的阅读进度和笔记将被清除'}
            </div>
          )}
        </div>
        {canKeepBoth && (
          <label className="home-import-dialog-option">
            <input checked={keepBoth} type="checkbox" onChange={(event) => setKeepBoth(event.currentTarget.checked)} />
            <span>保留两个文件</span>
          </label>
        )}
        {!isConfirmOnly && state.showApplyToRemaining && (
          <label className="home-import-dialog-option">
            <input
              checked={applyToRemaining}
              type="checkbox"
              onChange={(event) => setApplyToRemaining(event.currentTarget.checked)}
            />
            <span>为后续所有冲突应用相同操作</span>
          </label>
        )}
        <div className="home-import-dialog-actions">
          <button
            className="home-import-dialog-button"
            disabled={isCancelDisabled}
            style={isConfirmOnly ? { display: 'none' } : undefined}
            type="button"
            onClick={() => onCancel(applyToRemaining)}
          >
            取消
          </button>
          <button
            className="home-import-dialog-button home-import-dialog-button-primary"
            type="button"
            onClick={() => {
              if (isConfirmOnly) {
                onCancel(false);
                return;
              }
              onConfirm(keepBoth ? 'keepBoth' : 'overwrite', applyToRemaining);
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
};

export interface BookSearchState {
  clearSearch: () => void;
  searchValue: string;
  searchLoading: boolean;
  searchTitleResult: BookInfo[];
  searchAuthorResult: BookInfo[];
  searchContentResult: SearchResult[];
}

const useHomeBookList = (): { bookList: BookInfo[]; setBookList: React.Dispatch<React.SetStateAction<BookInfo[]>> } => {
  const hasCachedBookListRef = useRef(homeBookListCache !== null);
  const [bookList, setRawBookList] = useState<BookInfo[]>(() => homeBookListCache || []);
  const setBookList: React.Dispatch<React.SetStateAction<BookInfo[]>> = useCallback((value) => {
    setRawBookList((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      writeHomeBookListCache(next);
      return next;
    });
  }, []);

  const loadBooks = useCallback(async () => {
    let attempts = 0;
    while (attempts < MAX_BOOK_LOAD_RETRIES) {
      const res = await getAllBooks<BookInfo>();
      if (!res.error) {
        setBookList(res.data);
        return;
      }
      attempts++;
      try {
        await resumeDB();
      } catch {
        // resumeDB rejects only with false; treat as transient and continue retrying.
      }
    }
  }, []);

  useEffect(() => {
    if (hasCachedBookListRef.current) return;
    loadBooks();
  }, [loadBooks]);

  return { bookList, setBookList };
};

export const useHomeBookImport = (
  bookList: BookInfo[],
  setBookList: React.Dispatch<React.SetStateAction<BookInfo[]>>,
): {
  conflictState: ImportConflictState | null;
  onAdd: () => void;
  onCancelConflict: (applyToRemaining: boolean) => void;
  onConfirmConflict: (action: Exclude<ImportConflictAction, 'cancel'>, applyToRemaining: boolean) => void;
} => {
  const bookListRef = useRef(bookList);
  const conflictResolverRef = useRef<((decision: ImportConflictDecision) => void) | null>(null);
  const sharedConflictDecisionRef = useRef<ImportConflictDecision | null>(null);
  const [conflictState, setConflictState] = useState<ImportConflictState | null>(null);

  useEffect(() => {
    bookListRef.current = bookList;
  }, [bookList]);

  const isSharedDecisionCompatible = useCallback((decision: ImportConflictDecision, state: ImportConflictState) => {
    return decision.action !== 'keepBoth' || state.type === 'same-title';
  }, []);

  const requestConflictDecision = useCallback(
    (state: ImportConflictState): Promise<ImportConflictDecision> => {
      const sharedDecision = sharedConflictDecisionRef.current;
      if (!state.confirmOnly && sharedDecision && isSharedDecisionCompatible(sharedDecision, state)) {
        return Promise.resolve({ ...sharedDecision, applyToRemaining: false });
      }
      return new Promise((resolve) => {
        conflictResolverRef.current = resolve;
        setConflictState(state);
      });
    },
    [isSharedDecisionCompatible],
  );

  const settleConflict = useCallback((decision: ImportConflictDecision) => {
    const normalizedDecision = { ...decision, applyToRemaining: false };
    if (decision.applyToRemaining) {
      sharedConflictDecisionRef.current = normalizedDecision;
    }
    conflictResolverRef.current?.(decision);
    conflictResolverRef.current = null;
    setConflictState(null);
  }, []);

  const onCancelConflict = useCallback(
    (applyToRemaining: boolean) => {
      settleConflict({ action: 'cancel', applyToRemaining });
    },
    [settleConflict],
  );

  const onConfirmConflict = useCallback(
    (action: Exclude<ImportConflictAction, 'cancel'>, applyToRemaining: boolean) => {
      settleConflict({ action, applyToRemaining });
    },
    [settleConflict],
  );

  const onAdd = useCallback(() => {
    void (async () => {
      sharedConflictDecisionRef.current = null;
      const files = await chooseBookFiles();
      if (files.length === 0) return;

      const supportedFiles = files.filter(isSupportedImportFile);
      if (supportedFiles.length === 0) {
        showGlobalFallback({ message: '请选择 TXT、EPUB 或 BDZ 文件', tone: 'error' });
        return;
      }
      if (supportedFiles.length < files.length) {
        showGlobalFallback({ message: '部分文件格式不支持，已自动跳过', tone: 'info' });
      }

      const latestBooks = await getAllBooks<BookInfo>();
      let workingBooks = latestBooks.error ? bookListRef.current : latestBooks.data;
      if (latestBooks.error) {
        showGlobalFallback({ message: '书架读取失败，本次导入将使用当前列表继续', tone: 'info' });
      }
      let importedCount = 0;
      let failedCount = 0;
      const showApplyToRemaining = supportedFiles.length > 1;
      const parsedBackupByFile = new Map<File, ParsedBackupArchive>();
      const backupArchives: ParsedBackupArchive[] = [];

      for (const file of supportedFiles.filter(isBackupFile)) {
        try {
          backupArchives.push(await parseBackupFile(file));
        } catch (error) {
          failedCount += 1;
          showGlobalFallback({ message: getImportFailureMessage(file, error), tone: 'error' });
        }
      }

      if (backupArchives.length > 0) {
        const { ignoredCount, selected } = selectBackupArchivesForRestore(backupArchives);
        selected.forEach((archive) => parsedBackupByFile.set(archive.file, archive));
        if (ignoredCount > 0) {
          showGlobalFallback({ message: `已忽略 ${ignoredCount} 个低优先级备份`, tone: 'info' });
        }
      }
      const importQueue = [
        ...supportedFiles.filter((file) => !isBackupFile(file)),
        ...supportedFiles.filter((file) => isBackupFile(file) && parsedBackupByFile.has(file)),
      ];

      for (const file of importQueue) {
        try {
          if (isBackupFile(file)) {
            const archive = parsedBackupByFile.get(file);
            if (!archive) continue;
            const backupIdentity = getBackupArchiveIdentity(archive);

            if (isFullBackupArchive(archive)) {
              const imported = createImportedBookDataFromBackup(archive);
              const documentFingerprint = await getBookFingerprint(imported);
              const fingerprint = imported.fingerprint || documentFingerprint;
              const existingSameBook = workingBooks.find((book) => {
                const identity = getBookIdentity(book);
                return (
                  book.id === archive.book.id ||
                  identity === backupIdentity ||
                  identity === fingerprint ||
                  identity === documentFingerprint
                );
              });
              const importedTitle = normalizeBookTitle(imported.title);

              if (existingSameBook) {
                const decision = await requestConflictDecision(
                  createImportConflictState({
                    existingBook: existingSameBook,
                    file,
                    imported,
                    showApplyToRemaining,
                    type: 'same-book',
                  }),
                );
                if (decision.action === 'cancel') continue;
                clearChapterPaginationCache(existingSameBook.id);
                const result = await addBook({
                  ...imported,
                  fingerprint,
                  id: existingSameBook.id,
                  overwrite: true,
                });
                if (result.error || !result.data) {
                  throw new Error(result.message || `Failed to restore backup: ${file.name}`);
                }
                await restoreBackupUserData({ archive, targetBookId: result.data.id });
                workingBooks = upsertBookListItem(workingBooks, result.data);
                importedCount += 1;
                continue;
              }

              const existingSameTitleBook = workingBooks.find(
                (book) => normalizeBookTitle(book.title) === importedTitle && getBookIdentity(book) !== fingerprint,
              );
              if (existingSameTitleBook) {
                const decision = await requestConflictDecision(
                  createImportConflictState({
                    existingBook: existingSameTitleBook,
                    file,
                    imported,
                    showApplyToRemaining,
                    type: 'same-title',
                  }),
                );
                if (decision.action === 'cancel') continue;
                if (decision.action === 'overwrite') {
                  clearChapterPaginationCache(existingSameTitleBook.id);
                  const result = await addBook({
                    ...imported,
                    fingerprint,
                    id: existingSameTitleBook.id,
                    overwrite: true,
                  });
                  if (result.error || !result.data) {
                    throw new Error(result.message || `Failed to restore backup: ${file.name}`);
                  }
                  await restoreBackupUserData({ archive, targetBookId: result.data.id });
                  workingBooks = upsertBookListItem(workingBooks, result.data);
                  importedCount += 1;
                  continue;
                }
              }

              const title = resolveUniqueBookTitle(imported.title, workingBooks, fingerprint);
              const result = await addBook({
                ...imported,
                fingerprint,
                id: archive.book.id,
                title,
              });
              if (result.error || !result.data) {
                throw new Error(result.message || `Failed to restore backup: ${file.name}`);
              }
              await restoreBackupUserData({ archive, targetBookId: result.data.id });
              workingBooks = upsertBookListItem(workingBooks, result.data);
              importedCount += 1;
              continue;
            }

            const targetBook = workingBooks.find((book) => {
              const identity = getBookIdentity(book);
              return book.id === archive.book.id || identity === backupIdentity || identity === archive.book.fingerprint;
            });
            if (!targetBook) {
              await requestConflictDecision(createMissingBackupBookState({ archive, file }));
              continue;
            }
            const decision = await requestConflictDecision(
              createBackupUserDataConflictState({
                archive,
                existingBook: targetBook,
                file,
                showApplyToRemaining,
              }),
            );
            if (decision.action === 'cancel') continue;
            await restoreBackupUserData({ archive, targetBookId: targetBook.id });
            importedCount += 1;
            continue;
          }

          const imported = await importBookFileWithFallback(file);
          const documentFingerprint = await getBookFingerprint(imported);
          const fingerprint = imported.fingerprint || documentFingerprint;
          const existingSameBook = workingBooks.find((book) => {
            const identity = getBookIdentity(book);
            return identity === fingerprint || identity === documentFingerprint;
          });
          const importedTitle = normalizeBookTitle(imported.title);

          if (existingSameBook) {
            const decision = await requestConflictDecision(
              createImportConflictState({
                existingBook: existingSameBook,
                file,
                imported,
                showApplyToRemaining,
                type: 'same-book',
              }),
            );
            if (decision.action === 'cancel') continue;
            await clearReaderBookData(existingSameBook.id);
            const result = await addBook({
              ...imported,
              fingerprint,
              id: existingSameBook.id,
              overwrite: true,
              title: existingSameBook.title,
            });
            if (result.error || !result.data) {
              throw new Error(result.message || `Failed to overwrite book: ${file.name}`);
            }
            workingBooks = upsertBookListItem(workingBooks, result.data);
            importedCount += 1;
            continue;
          }

          const existingSameTitleBook = workingBooks.find(
            (book) => normalizeBookTitle(book.title) === importedTitle && getBookIdentity(book) !== fingerprint,
          );
          if (existingSameTitleBook) {
            const decision = await requestConflictDecision(
              createImportConflictState({
                existingBook: existingSameTitleBook,
                file,
                imported,
                showApplyToRemaining,
                type: 'same-title',
              }),
            );
            if (decision.action === 'cancel') continue;
            if (decision.action === 'overwrite') {
              await clearReaderBookData(existingSameTitleBook.id);
              const result = await addBook({
                ...imported,
                fingerprint,
                id: existingSameTitleBook.id,
                overwrite: true,
                title: existingSameTitleBook.title,
              });
              if (result.error || !result.data) {
                throw new Error(result.message || `Failed to overwrite book: ${file.name}`);
              }
              workingBooks = upsertBookListItem(workingBooks, result.data);
              importedCount += 1;
              continue;
            }
          }

          const title = resolveUniqueBookTitle(imported.title, workingBooks, fingerprint);
          const result = await addBook({
            ...imported,
            fingerprint,
            title,
          });
          if (result.error || !result.data) {
            throw new Error(result.message || `Failed to add book: ${file.name}`);
          }
          workingBooks = upsertBookListItem(workingBooks, result.data);
          importedCount += 1;
        } catch (error) {
          failedCount += 1;
          showGlobalFallback({ message: getImportFailureMessage(file, error), tone: 'error' });
        }
      }

      setBookList(workingBooks);
      if (importedCount > 0 && failedCount > 0) {
        showGlobalFallback({ message: `已导入 ${importedCount} 本书，${failedCount} 本失败`, tone: 'info' });
      } else if (importedCount > 0) {
        showGlobalFallback({ message: `已导入 ${importedCount} 本书`, tone: 'success' });
      } else if (failedCount > 0) {
        showGlobalFallback({ message: '导入失败', tone: 'error' });
      }
    })();
  }, [requestConflictDecision, setBookList]);

  return { conflictState, onAdd, onCancelConflict, onConfirmConflict };
};

export const useBookSearch = (inputRef: React.RefObject<HTMLInputElement | null>): BookSearchState => {
  const [searchValue, setSearchValue] = useState<string>('');
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchTitleResult, setSearchTitleResult] = useState<BookInfo[]>([]);
  const [searchAuthorResult, setSearchAuthorResult] = useState<BookInfo[]>([]);
  const [searchContentResult, setSearchContentResult] = useState<SearchResult[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const target = inputRef.current;
    if (!target) return;

    const onSearchInput = debounce((event: Event) => {
      const value = trim((event.target as HTMLInputElement)?.value || '');
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSearchValue(value);
      if (!value) {
        setSearchTitleResult([]);
        setSearchAuthorResult([]);
        setSearchContentResult([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      setSearchTitleResult([]);
      setSearchAuthorResult([]);
      setSearchContentResult([]);

      Promise.allSettled([
        searchBooksByTitle<BookInfo>(value),
        searchBooksByAuthor<BookInfo>(value),
        searchBooksByContent<SearchResult>(value),
      ]).then((results) => {
        if (requestIdRef.current !== requestId) return;
        const [titleRes, authorRes, contentRes] = results;
        if (titleRes.status === 'fulfilled' && !titleRes.value.error) {
          setSearchTitleResult(titleRes.value.data);
        }
        if (authorRes.status === 'fulfilled' && !authorRes.value.error) {
          setSearchAuthorResult(authorRes.value.data);
        }
        if (contentRes.status === 'fulfilled' && !contentRes.value.error) {
          setSearchContentResult(contentRes.value.data);
        }
        setSearchLoading(false);
      });
    }, 500);

    target.addEventListener('input', onSearchInput);
    target.addEventListener('change', onSearchInput);
    return () => {
      target.removeEventListener('input', onSearchInput);
      target.removeEventListener('change', onSearchInput);
    };
  }, [inputRef]);

  const clearSearch = useCallback(() => {
    requestIdRef.current += 1;
    const target = inputRef.current;
    if (target) {
      target.value = '';
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setSearchValue('');
    setSearchLoading(false);
    setSearchTitleResult([]);
    setSearchAuthorResult([]);
    setSearchContentResult([]);
  }, [inputRef]);

  return { clearSearch, searchValue, searchLoading, searchTitleResult, searchAuthorResult, searchContentResult };
};

const renderHighlightedText = (text: string, keyword: string, bookId: string): React.ReactNode => {
  if (!text) return null;
  if (!keyword) return text;
  const segments = text.split(keyword);
  return segments.map((segment, index) => (
    <span key={`${bookId}-${index}`} item-id={bookId}>
      {segment}
      {index < segments.length - 1 && (
        <span item-id={bookId} className="text-blue-500">
          {keyword}
        </span>
      )}
    </span>
  ));
};

interface SearchResultRowProps {
  book: BookInfo | SearchResult;
  highlightedField: 'title' | 'author' | 'matched';
  keyword: string;
  rowKey: string;
}

const SearchResultRow = ({ book, highlightedField, keyword, rowKey }: SearchResultRowProps): React.JSX.Element => {
  const { id, title = '', author = '', image } = book;
  const matchedText = (book as SearchResult).matchedText?.[0] || '';
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(resolvedImage && !imageFailed);
  useEffect(() => {
    setImageFailed(false);
  }, [id, image]);

  return (
    <div
      className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-light-gray-color-1 min-h-32"
      key={rowKey}
      item-id={id}
    >
      {shouldShowImage ? (
        <img className="w-16 mr-5" src={resolvedImage} item-id={id} alt={title} onError={() => setImageFailed(true)} />
      ) : (
        <BookCoverFallback className="w-16 h-24 mr-5" itemId={id} title={title} />
      )}
      <div>
        <div className="text-lg text-text-color-1 font-medium break-all" item-id={id}>
          {highlightedField === 'title' ? renderHighlightedText(title, keyword, id) : title}
        </div>
        <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={id}>
          {highlightedField === 'author' ? renderHighlightedText(author, keyword, id) : author}
        </div>
        {highlightedField === 'matched' && (
          <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={id}>
            {renderHighlightedText(matchedText, keyword, id)}
          </div>
        )}
      </div>
    </div>
  );
};

interface SearchResultsPanelProps {
  className?: string;
  expanded?: boolean;
  height?: string;
  state: BookSearchState;
  panelClassName: string;
  searchResultRef: React.RefObject<HTMLDivElement | null>;
}

export const SearchResultsPanel = ({
  className = '',
  expanded,
  height = 'calc(100vh - var(--spacing) * 48)',
  state,
  panelClassName,
  searchResultRef,
}: SearchResultsPanelProps): React.JSX.Element => {
  const { searchValue, searchLoading, searchTitleResult, searchAuthorResult, searchContentResult } = state;
  const noResult =
    Boolean(searchValue) &&
    !searchLoading &&
    searchTitleResult.length === 0 &&
    searchAuthorResult.length === 0 &&
    searchContentResult.length === 0;
  const isExpanded = expanded ?? Boolean(searchValue);

  return (
    <div
      className={`w-full transition-all duration-500 overflow-hidden mt-6 pb-6 ${className}`}
      style={{ height: isExpanded ? height : '0px' }}
      ref={searchResultRef}
    >
      <div className="overflow-y-auto h-full">
        {searchTitleResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pt-2">{t('ebook')}</div>
              <div>
                {searchTitleResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-title`}
                    book={book}
                    highlightedField="title"
                    keyword={searchValue}
                    rowKey={`${book.id}-title`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {searchAuthorResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pt-2">{t('author')}</div>
              <div>
                {searchAuthorResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-author`}
                    book={book}
                    highlightedField="author"
                    keyword={searchValue}
                    rowKey={`${book.id}-author`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {searchContentResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pt-2">
                {t('search_result_1')} <span className="text-blue-500">{searchValue}</span> {t('search_result_2')}
                {t('search_result_3')}
                {searchContentResult.length}
              </div>
              <div>
                {searchContentResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-content`}
                    book={book}
                    highlightedField="matched"
                    keyword={searchValue}
                    rowKey={`${book.id}-content`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {noResult && (
          <div className="h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-text-color-2 font-normal text-xl">{t('no_result')}</div>
            </div>
          </div>
        )}
        {searchLoading && (
          <div className="h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <svg
                aria-hidden="true"
                className="text-[34px] text-text-color-2"
                fill="none"
                focusable="false"
                height="1em"
                viewBox="0 0 24 24"
                width="1em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 0h24v24H0z" fill="none" />
                <path
                  d="M12 3c4.97 0 9 4.03 9 9"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                >
                  <animateTransform
                    attributeName="transform"
                    dur="1.5s"
                    repeatCount="indefinite"
                    type="rotate"
                    values="0 12 12;360 12 12"
                  />
                </path>
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ImportCardProps {
  className: string;
  iconSize: number;
  onAdd: () => void;
}

export const ImportCard = ({ className, iconSize, onAdd }: ImportCardProps): React.JSX.Element => {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onAdd();
  };

  return (
    <div className={className} role="button" tabIndex={0} onClick={onAdd} onKeyDown={onKeyDown}>
      <HomePlusIcon style={{ width: iconSize, height: iconSize, color: 'var(--icon-color-2)' }} />
    </div>
  );
};

export const useBookSearchNativeNavigation = (searchResultRef: React.RefObject<HTMLDivElement | null>): void => {
  const navigate = useNavigate();
  useEffect(() => {
    const element = searchResultRef.current;
    if (!element) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLDivElement;
      const id = target.getAttribute('item-id');
      if (!id) return;
      startSpaViewTransition(() => {
        navigate(createReaderPath(id));
      });
    };
    element.addEventListener('click', handler);
    return () => {
      element.removeEventListener('click', handler);
    };
  }, [navigate, searchResultRef]);
};

export const Home = (): React.JSX.Element => {
  const [currentDevice] = useCheckDevice();
  if (currentDevice === DEVICE_ENUM.MOBILE) return <MobileHome />;
  if (currentDevice === DEVICE_ENUM.DESKTOP) return <DesktopHome />;
  return <Loading />;
};

export const DesktopHome = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultRef = useRef<HTMLDivElement>(null);
  const { bookList, setBookList } = useHomeBookList();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(bookList, setBookList);
  const recentBookList = useMemo(() => getRecentHomeBooks(bookList), [bookList]);
  useBookSearchNativeNavigation(searchResultRef);

  return (
    <div>
      <div className="w-full bg-front-bg-color-2">
        <div className="w-full min-h-72 pt-28">
          <div className="home-search-field relative w-1/2 min-w-2xs h-14 block mx-auto">
            <HomeSearchIcon
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
              style={{ width: 24, height: 24, color: 'var(--icon-color-1)' }}
            />
            <r-input
              className="w-full h-full block mx-auto"
              style={DESKTOP_INPUT_STYLE}
              placeholder={t('search')}
              ref={inputRef}
            ></r-input>
          </div>
          <SearchResultsPanel
            state={searchState}
            panelClassName="w-1/2 min-w-2xs block mx-auto bg-front-bg-color-3 rounded-xl py-5 mb-6"
            searchResultRef={searchResultRef}
          />
        </div>
      </div>
      {!searchState.searchValue && (
        <div className="home-bookcase-section w-full bg-front-bg-color-1">
          <div className="max-w-7xl mx-auto pt-12 flex flex-row justify-between items-center">
            <div className="flex justify-start items-center">
              <div className="cursor-pointer text-text-color-1 text-2xl font-medium">{t('my_bookcase')}</div>
              <HomeArrowRightIcon
                className="cursor-pointer"
                style={{ width: 24, height: 24, color: 'var(--icon-color-1)' }}
              />
            </div>
            <Link className="home-shelf-link" to={ROUTE_PATH.SHELF}>
              <span>查看我的书架</span>
              <HomeArrowRightIcon style={{ width: 16, height: 16 }} />
            </Link>
          </div>
          <div className="max-w-7xl mx-auto flex flex-row flex-wrap justify-start items-center">
            <ImportCard
              className="w-2xs h-40 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
              iconSize={64}
              onAdd={onAdd}
            />
            {recentBookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
      <ImportConflictDialog state={conflictState} onCancel={onCancelConflict} onConfirm={onConfirmConflict} />
    </div>
  );
};

export const MobileHome = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultRef = useRef<HTMLDivElement>(null);
  const { bookList, setBookList } = useHomeBookList();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(bookList, setBookList);
  const recentBookList = useMemo(() => getRecentHomeBooks(bookList), [bookList]);
  useBookSearchNativeNavigation(searchResultRef);

  return (
    <div className="w-full min-h-svh bg-front-bg-color-2">
      <div className="p-5">
        <div className="home-mobile-search">
          <HomeSearchIcon className="home-mobile-search-icon" />
          <input
            ref={inputRef}
            placeholder={t('search')}
            type="text"
          />
          {searchState.searchValue && (
            <button
              aria-label="清除搜索"
              className="home-mobile-search-clear reader-search-clear-button"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={searchState.clearSearch}
            >
              <HomeSearchClearIcon style={{ display: 'block', width: 16, height: 16 }} />
            </button>
          )}
        </div>
      </div>
      {searchState.searchValue && (
        <div className="px-5">
          <SearchResultsPanel
            state={searchState}
            panelClassName="block mx-auto bg-front-bg-color-3 rounded-xl mb-6"
            searchResultRef={searchResultRef}
          />
        </div>
      )}
      {!searchState.searchValue && (
        <div className="px-5">
          <div className="flex items-center justify-between pt-2">
            <div className="text-text-color-1 text-xl font-medium">{t('my_bookcase')}</div>
            <Link className="home-shelf-link" to={ROUTE_PATH.SHELF}>
              <span>查看我的书架</span>
              <HomeArrowRightIcon style={{ width: 14, height: 14 }} />
            </Link>
          </div>
          <div className="flex flex-row flex-wrap justify-start items-center">
            <ImportCard
              className="w-24 h-36 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
              iconSize={54}
              onAdd={onAdd}
            />
            {recentBookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
      <ImportConflictDialog state={conflictState} onCancel={onCancelConflict} onConfirm={onConfirmConflict} />
    </div>
  );
};
