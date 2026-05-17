import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Link, useHref, useNavigate } from 'react-router-dom';
import { BookCoverFallback } from '@/components/BookCard';
import { Loading } from '@/components/Loading';
import { OcticonXCircle as ShelfSearchClearIcon, OcticonSearch as ShelfSearchIcon } from '@/components/Octicon';
import { ROUTE_PATH, createReaderPath } from '@/router';
import { getAllBooks } from '@/store/books';
import type { BookInfo } from '@/store/books';
import { resumeDB } from '@/store';
import { startSpaViewTransition } from '@/lib/navigation';
import {
  type ReaderBookShelfStatus,
  getReaderBookShelfStatus,
  useReaderBookStatusRevision,
} from '@/lib/readerBookStatus';
import { getReaderProgress } from '@/lib/readerProgress';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import {
  ImportCard,
  ImportConflictDialog,
  SearchResultsPanel,
  useBookSearch,
  useBookSearchNativeNavigation,
  useHomeBookImport,
} from '@/pages/home';
import {
  createEmptyReaderSearchHighlight,
  setCurrentBookDetail,
  setPageNum,
  setReaderNavigationTarget,
  setReaderSearchHighlight,
  setTextSyntaxTree,
} from '@/lib/subscribe';
import { createEmptyTextSyntaxTree } from '@/lib/transformText';
import { t } from '@/locales';
import './index.scss';

const MAX_SHELF_BOOK_LOAD_RETRIES = 3;

type ShelfStatusFilterValue = 'all' | ReaderBookShelfStatus;

const SHELF_STATUS_FILTER_OPTIONS: Array<{ id: ShelfStatusFilterValue; labelKey: string }> = [
  { id: 'all', labelKey: 'shelf.all' },
  { id: 'unread', labelKey: 'shelf.unread' },
  { id: 'reading', labelKey: 'shelf.reading' },
  { id: 'read', labelKey: 'shelf.read' },
  { id: 'finished', labelKey: 'shelf.finished' },
];

const ShelfFilterIcon = (): React.JSX.Element => (
  <svg aria-hidden="true" fill="none" focusable="false" height="14" viewBox="0 0 16 16" width="14">
    <path
      d="M2 4.25h12M4.5 8h7M6.75 11.75h2.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);

const getBookRecentTimestamp = (book: BookInfo): number => {
  const progress = getReaderProgress(book.id);
  return Math.max(progress?.updatedAt || 0, progress?.lastReadAt || 0, book.modifyTime || 0, book.createTime || 0);
};

const sortShelfBooks = (books: BookInfo[]): BookInfo[] => {
  return [...books].sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a));
};

const clearReaderSignals = (): void => {
  setPageNum(0);
  setCurrentBookDetail(null);
  setReaderNavigationTarget({ revision: 0 });
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
  setTextSyntaxTree(createEmptyTextSyntaxTree());
};

const useShelfBooks = (): {
  books: BookInfo[];
  loading: boolean;
  setBooks: Dispatch<SetStateAction<BookInfo[]>>;
} => {
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const setSortedBooks = useCallback<Dispatch<SetStateAction<BookInfo[]>>>((value) => {
    setBooks((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      return sortShelfBooks(next);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBooks = async (): Promise<void> => {
      let attempts = 0;
      while (attempts < MAX_SHELF_BOOK_LOAD_RETRIES) {
        const result = await getAllBooks<BookInfo>();
        if (!result.error) {
          if (!cancelled) {
            setSortedBooks(result.data);
            setLoading(false);
          }
          return;
        }
        attempts += 1;
        try {
          await resumeDB();
        } catch {
          // Retry only; failures are reflected by an empty shelf.
        }
      }
      if (!cancelled) {
        setBooks([]);
        setLoading(false);
      }
    };

    void loadBooks();
    return () => {
      cancelled = true;
    };
  }, []);

  return { books, loading, setBooks: setSortedBooks };
};

const ShelfStatusFilter = ({
  onChange,
  value,
}: {
  onChange: (value: ShelfStatusFilterValue) => void;
  value: ShelfStatusFilterValue;
}): React.JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLabel = SHELF_STATUS_FILTER_OPTIONS.find((option) => option.id === value)?.labelKey || '';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setIsExpanded(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div ref={containerRef} className={`shelf-status-filter ${isExpanded ? 'is-expanded' : ''}`}>
      <div className="shelf-status-filter-options">
        {SHELF_STATUS_FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            className={`shelf-status-filter-option ${value === option.id ? 'is-active' : ''}`}
            type="button"
            onClick={() => {
              onChange(option.id);
              setIsExpanded(false);
            }}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <button
        aria-expanded={isExpanded}
        className="shelf-status-filter-trigger"
        type="button"
        onClick={() => setIsExpanded(true)}
      >
        <span>{t(currentLabel)}</span>
        <ShelfFilterIcon />
      </button>
    </div>
  );
};

const ShelfBookItem = ({ book }: { book: BookInfo }): React.JSX.Element => {
  const navigate = useNavigate();
  const { id, image, title = '', author = '' } = book;
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(resolvedImage && !imageFailed);
  const path = createReaderPath(id);
  const href = useHref(path);

  useEffect(() => {
    setImageFailed(false);
  }, [id, image]);

  const openBook = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      startSpaViewTransition(() => {
        clearReaderSignals();
        navigate(path);
      });
    },
    [navigate, path],
  );

  return (
    <a className="shelf-book-item" href={href} style={{ viewTransitionName: `book-info-${id}` }} onClick={openBook}>
      <div className="shelf-book-cover">
        {shouldShowImage ? (
          <img src={resolvedImage} alt={title} onError={() => setImageFailed(true)} />
        ) : (
          <BookCoverFallback className="shelf-book-cover-fallback" title={title} />
        )}
      </div>
      <div className="shelf-book-title" title={title}>
        {title}
      </div>
      {author && (
        <div className="shelf-book-author" title={author}>
          {author}
        </div>
      )}
    </a>
  );
};

export const Shelf = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultRef = useRef<HTMLDivElement>(null);
  const { books, loading, setBooks } = useShelfBooks();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(books, setBooks);
  const [searchDraft, setSearchDraft] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShelfStatusFilterValue>('all');
  const statusRevision = useReaderBookStatusRevision();
  const isSearchExpanded = Boolean(searchDraft);
  useBookSearchNativeNavigation(searchResultRef);
  const clearShelfSearch = useCallback(() => {
    searchState.clearSearch();
    setSearchDraft('');
  }, [searchState]);
  const visibleBooks = useMemo(() => {
    if (statusFilter === 'all') return books;
    return books.filter((book) => getReaderBookShelfStatus(book.id) === statusFilter);
  }, [books, statusFilter, statusRevision]);

  return (
    <div className="shelf-page">
      <header className={`shelf-navbar ${isSearchExpanded ? 'is-searching' : ''}`}>
        <div className="shelf-navbar-border">
          <div className="shelf-navbar-inner">
            <div className="shelf-search">
              <ShelfSearchIcon className="shelf-search-icon" />
              <input
                ref={inputRef}
                placeholder={t('search')}
                onChange={(event) => setSearchDraft(event.currentTarget.value.trim())}
                onInput={(event) => setSearchDraft(event.currentTarget.value.trim())}
              />
              {searchDraft && (
                <button
                  aria-label={t('search.clear')}
                  className="reader-search-clear-button"
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    zIndex: 2,
                    display: 'flex',
                    width: 16,
                    height: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    border: 0,
                    borderRadius: 999,
                    background: 'transparent',
                    color: '#8c8c8e',
                    cursor: 'pointer',
                    transform: 'translateY(-50%)',
                  }}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearShelfSearch}
                >
                  <ShelfSearchClearIcon style={{ display: 'block', width: 16, height: 16 }} />
                </button>
              )}
            </div>
            <Link className="shelf-navbar-link" to={ROUTE_PATH.HOME}>
              {t('home')}
            </Link>
          </div>
        </div>
        <SearchResultsPanel
          className="shelf-search-results"
          expanded={isSearchExpanded}
          height="calc(100vh - 96px)"
          panelClassName="shelf-search-result-panel bg-front-bg-color-3 rounded-xl py-5 mb-6"
          searchResultRef={searchResultRef}
          state={searchState}
        />
      </header>

      <main className="shelf-main">
        <div className="shelf-page-header">
          <h1>{t('my_bookcase')}</h1>
          <ShelfStatusFilter value={statusFilter} onChange={setStatusFilter} />
        </div>
        {loading ? (
          <div className="shelf-loading">
            <Loading />
          </div>
        ) : (
          <div className="shelf-list">
            {visibleBooks.map((book) => (
              <ShelfBookItem book={book} key={book.id} />
            ))}
            <ImportCard className="shelf-import-book" iconSize={48} onAdd={onAdd} />
          </div>
        )}
      </main>
      <ImportConflictDialog state={conflictState} onCancel={onCancelConflict} onConfirm={onConfirmConflict} />
    </div>
  );
};

export default Shelf;
