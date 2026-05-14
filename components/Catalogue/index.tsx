import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import { EVENT_NAME, getCurrentBookDetail, getTextSyntaxTree, syncHook } from '@/lib/subscribe';
import { SORT_DIRECTION } from '@/lib/enums';
import { getReaderProgress } from '@/lib/readerProgress';
import { getStoredReaderReadingMode } from '@/lib/readerSettings';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import { useSyncHookEvents } from '@/lib/useSyncHookEvents';
import { OcticonClock, OcticonSortAsc } from '@/components/Octicon';
import { BookDataPanel } from '@/components/Catalogue/BookDataPanel';
import { BookSummaryButton } from '@/components/Catalogue/BookSummaryButton';
import { CatalogueProgressIcon } from '@/components/Catalogue/CatalogueProgressIcon';
import {
  formatReadingDuration,
  getCatalogueReadPercent,
  getCurrentTitleId,
  isCurrentPageBookmarked,
  turnToCatalogueTitle,
} from '@/components/Catalogue/catalogueUtils';
import './index.scss';

const CATALOGUE_META_EVENTS = [
  EVENT_NAME.SET_CURRENT_BOOK_PAGE,
  EVENT_NAME.SET_CURRENT_BOOK_DETAIL,
  EVENT_NAME.SET_READER_ANNOTATIONS,
  EVENT_NAME.SET_READER_NAVIGATION_TARGET,
  EVENT_NAME.SET_READER_PROGRESS,
  EVENT_NAME.SET_TEXT_SYNTAX_TREE,
] as const;

export const Catalogue = (): React.JSX.Element => {
  const sortRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasAlignedCurrentTitleRef = useRef(false);
  const [sortDirection, setSortDirection] = useState(SORT_DIRECTION.DOWN);
  const [metaRevision, setMetaRevision] = useState(0);
  const [bookDataPanelOpen, setBookDataPanelOpen] = useState(false);
  const bookDetail: BookInfo | null = getCurrentBookDetail();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const [currentTitleId, setCurrentTitleId] = useState(() => getCurrentTitleId(bookDetail?.id, textSyntaxTree));
  const [coverFailed, setCoverFailed] = useState(false);
  const resolvedCover = useResolvedBookImage(bookDetail?.id, bookDetail?.image);
  const currentReadPercent = getCatalogueReadPercent(bookDetail?.id, currentTitleId);
  const isScrollMode = getStoredReaderReadingMode() === 'scroll';
  const readingDurationLabel = useMemo(
    () => formatReadingDuration(getReaderProgress(bookDetail?.id)?.totalReadingMs),
    [bookDetail?.id, metaRevision],
  );

  useEffect(() => {
    setCoverFailed(false);
  }, [bookDetail?.id, bookDetail?.image]);

  const toSort = useCallback(() => {
    const next = sortDirection === SORT_DIRECTION.DOWN ? SORT_DIRECTION.UP : SORT_DIRECTION.DOWN;
    setSortDirection(next);
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({
      behavior: 'smooth',
      top: next === SORT_DIRECTION.UP ? container.scrollHeight : 0,
    });
  }, [sortDirection]);

  const updateCurrentTitleId = useCallback(() => {
    const nextTitleId = getCurrentTitleId(bookDetail?.id, getTextSyntaxTree());
    setCurrentTitleId((prevTitleId) => (prevTitleId === nextTitleId ? prevTitleId : nextTitleId));
  }, [bookDetail?.id]);

  const updateCatalogueMeta = useCallback(() => {
    updateCurrentTitleId();
    setMetaRevision((revision) => revision + 1);
  }, [updateCurrentTitleId]);

  const addCurrentPageBookmark = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    syncHook.call(EVENT_NAME.ADD_READER_PAGE_BOOKMARK);
    setMetaRevision((revision) => revision + 1);
  }, []);

  const openBookDataPanel = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setBookDataPanelOpen(true);
  }, []);

  const closeBookDataPanel = useCallback(() => {
    setBookDataPanelOpen(false);
  }, []);

  const alignCurrentTitle = useCallback(() => {
    if (hasAlignedCurrentTitleRef.current || currentTitleId === undefined) return false;
    const container = scrollRef.current;
    if (!container || container.clientHeight <= 0) return false;

    const currentItem = container.querySelector<HTMLElement>(`[data-title-id="${currentTitleId}"]`);
    if (!currentItem) return false;

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const targetScrollTop = currentItem.offsetTop - (container.clientHeight - currentItem.offsetHeight) / 2;
    container.scrollTo({
      behavior: 'auto',
      top: Math.min(Math.max(targetScrollTop, 0), maxScrollTop),
    });
    hasAlignedCurrentTitleRef.current = true;
    return true;
  }, [currentTitleId]);

  useEffect(() => {
    scrollRef.current?.addEventListener('click', turnToCatalogueTitle);
    sortRef.current?.addEventListener('click', toSort);
    return () => {
      scrollRef.current?.removeEventListener('click', turnToCatalogueTitle);
      sortRef.current?.removeEventListener('click', toSort);
    };
  }, [toSort]);

  useEffect(() => {
    updateCatalogueMeta();
  }, [updateCatalogueMeta]);

  useSyncHookEvents(CATALOGUE_META_EVENTS, updateCatalogueMeta);

  useLayoutEffect(() => {
    if (alignCurrentTitle()) return;

    const frame = window.requestAnimationFrame(() => {
      alignCurrentTitle();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [alignCurrentTitle, textSyntaxTree?.sequences]);

  return (
    <>
      <BookSummaryButton
        bookDetail={bookDetail}
        coverFailed={coverFailed}
        coverUrl={resolvedCover}
        onClick={openBookDataPanel}
        onCoverError={() => setCoverFailed(true)}
      />
      <div className="readerCatalog_header_meta">
        <div className="readerCatalog_reading_duration">
          <OcticonClock />
          <div>{readingDurationLabel}</div>
        </div>
        <div ref={sortRef}>
          <OcticonSortAsc
            className={`cursor-pointer hover-icon ${sortDirection}`}
            style={{
              transform: sortDirection === SORT_DIRECTION.DOWN ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 180ms ease',
            }}
          />
        </div>
      </div>
      <div className="reader-menu-scroll-area overflow-y-auto flex-auto" ref={scrollRef}>
        {textSyntaxTree?.sequences?.map((item) => {
          const isCurrentTitle = item.titleId === currentTitleId;
          const isBookmarked = isCurrentTitle && isCurrentPageBookmarked(bookDetail?.id);
          const showProgress = isCurrentTitle && currentReadPercent !== undefined;
          const showBookmarkAction = isCurrentTitle && !isScrollMode;
          const showMeta = showProgress || showBookmarkAction;
          return (
            <div
              className={`readerCatalog_list_item ${isCurrentTitle ? 'is-current' : ''} ${showMeta ? 'has-meta' : ''}`}
              data-title-id={item.titleId}
              key={item.titleId}
            >
              <div className="readerCatalog_list_item_inner">
                <div className="readerCatalog_list_item_title">{item.title}</div>
                {showMeta ? (
                  <div className="readerCatalog_list_item_meta">
                    {showProgress ? (
                      <div className="readerCatalog_list_item_meta_progress">
                        <CatalogueProgressIcon />
                        <div>{`当前读到 ${currentReadPercent}%`}</div>
                      </div>
                    ) : null}
                    {showBookmarkAction ? (
                      <button
                        className="readerCatalog_list_item_meta_add_bookMark"
                        data-reader-catalog-bookmark="true"
                        type="button"
                        onClick={addCurrentPageBookmark}
                      >
                        {isBookmarked ? (
                          <span>已添加书签</span>
                        ) : (
                          <>
                            <span className="readerCatalog_list_item_meta_add_bookMark_plus">+</span>
                            <span>书签</span>
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <BookDataPanel
        bookDetail={bookDetail}
        coverFailed={coverFailed}
        coverUrl={resolvedCover}
        onClose={closeBookDataPanel}
        onCoverError={() => setCoverFailed(true)}
        open={bookDataPanelOpen}
        revision={metaRevision}
        textSyntaxTree={textSyntaxTree}
      />
    </>
  );
};
