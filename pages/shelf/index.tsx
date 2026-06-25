import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useHref, useNavigate } from 'react-router-dom';
import { BookCoverFallback } from '@/components/BookCard';
import { Loading } from '@/components/Loading';
import { OcticonXCircle as ShelfSearchClearIcon, OcticonSearch as ShelfSearchIcon } from '@/components/Octicon';
import { getAuthState, logout } from '@/store/auth';
import { LoginModal } from '@/components/LoginModal';
import { ROUTE_PATH, createReaderPath } from '@/router';
import { OnlineSearch } from '@/components/OnlineSearch';
import type { BookInfo } from '@/store/books';
import {
  deleteBookFromShelf,
  loadBookShelf,
  useBookShelf,
} from '@/store/bookshelf';
import { startSpaViewTransition } from '@/lib/navigation';
import { downloadBookAsTxt } from '@/lib/bookDownloader';
import {
  type ReaderBookShelfStatus,
  getReaderBookShelfStatus,
  useReaderBookStatusRevision,
} from '@/lib/readerBookStatus';
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

const clearReaderSignals = (): void => {
  setPageNum(0);
  setCurrentBookDetail(null);
  setReaderNavigationTarget({ revision: 0 });
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
  setTextSyntaxTree(createEmptyTextSyntaxTree());
};

const useShelfBooks = (): {
  error: string | null;
  hasLoaded: boolean;
  books: BookInfo[];
  loading: boolean;
} => {
  const { books, error, hasLoaded, loadStatus } = useBookShelf();
  const loading = loadStatus === 'loading';

  useEffect(() => {
    if (!hasLoaded && loadStatus !== 'loading') {
      loadBookShelf();
    }
  }, [hasLoaded, loadStatus]);

  return { books, error, hasLoaded, loading };
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

const ShelfBookItem = memo(({ book }: { book: BookInfo }): React.JSX.Element => {
  const navigate = useNavigate();
  const { id, image, title = '', author = '' } = book;
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
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

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = () => setShowContextMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showContextMenu]);

  // 删除书籍
  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm(`确定要删除《${title}》吗？`)) {
      return;
    }

    const result = await deleteBookFromShelf(id);
    if (result.status === 'success') {
      alert('删除成功');
      window.location.reload(); // 刷新页面
    } else {
      alert(`删除失败: ${result.error}`);
    }
  }, [id, title]);

  // 下载书籍到本地
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowContextMenu(false);

    const result = await downloadBookAsTxt(id, title);
    if (!result.success) {
      alert(`下载失败: ${result.error}`);
    }
  }, [id, title]);

  return (
    <>
      <a
        className="shelf-book-item"
        href={href}
        style={{ viewTransitionName: `book-info-${id}` }}
        onClick={openBook}
        onContextMenu={handleContextMenu}
      >
      <div className="shelf-book-cover">
        {shouldShowImage ? (
          <img
            src={resolvedImage}
            alt={title}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
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

    {/* 右键菜单 */}
    {showContextMenu && (
      <div
        className="shelf-context-menu"
        style={{
          position: 'fixed',
          left: `${menuPosition.x}px`,
          top: `${menuPosition.y}px`,
          zIndex: 1000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={(e) => { e.preventDefault(); openBook(e as any); }}>打开</button>
        <button onClick={handleDownload}>下载</button>
        <button className="delete-button" onClick={handleDelete}>删除</button>
      </div>
    )}
  </>
  );
});

export const Shelf = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultRef = useRef<HTMLDivElement>(null);
  const { books, loading } = useShelfBooks();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(books);
  const [searchDraft, setSearchDraft] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShelfStatusFilterValue>('all');
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isOnlineSearchOpen, setIsOnlineSearchOpen] = useState(false);
  const auth = getAuthState();
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
            <div className="shelf-navbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={() => setIsOnlineSearchOpen(true)}
                className="shelf-navbar-link"
                style={{
                  fontSize: 14,
                  color: 'var(--text-color-primary)',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
                type="button"
              >
                九库搜索
              </button>
              <Link className="shelf-navbar-link" to={ROUTE_PATH.HOME}>
                {t('home')}
              </Link>
              {auth.loggedIn ? (
                <div className="shelf-user-info" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="shelf-username" style={{ fontSize: 14, color: 'var(--text-color-primary)' }}>
                    {auth.user?.username}
                  </span>
                  <button
                    onClick={() => logout()}
                    className="shelf-logout-btn"
                    style={{
                      fontSize: 14,
                      color: '#ff4d4f',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                    type="button"
                  >
                    退出
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsLoginOpen(true)}
                  className="shelf-login-btn"
                  style={{
                    fontSize: 14,
                    color: 'var(--text-color-primary)',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  type="button"
                >
                  登录
                </button>
              )}
            </div>
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
      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
      <OnlineSearch isOpen={isOnlineSearchOpen} onClose={() => setIsOnlineSearchOpen(false)} />
    </div>
  );
};

export default Shelf;
