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
import { t } from '@/locales';
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

const CatalogueMobileScrollIcon = ({ direction }: { direction: SORT_DIRECTION }): React.JSX.Element => {
  if (direction === SORT_DIRECTION.DOWN) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
        <path d="M7.47 10.78a.749.749 0 0 0 1.06 0l3.75-3.75a.749.749 0 1 0-1.06-1.06L8.75 8.439V1.75a.75.75 0 0 0-1.5 0v6.689L4.78 5.97a.749.749 0 1 0-1.06 1.06l3.75 3.75ZM3.75 13a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z"></path>
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <path d="M3 2.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 2.25Zm5.53 2.97 3.75 3.75a.749.749 0 1 1-1.06 1.06L8.75 7.561v6.689a.75.75 0 0 1-1.5 0V7.561L4.78 10.03a.749.749 0 1 1-1.06-1.06l3.75-3.75a.749.749 0 0 1 1.06 0Z"></path>
    </svg>
  );
};

export const Catalogue = (): React.JSX.Element => {
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
    return () => {
      scrollRef.current?.removeEventListener('click', turnToCatalogueTitle);
    };
  }, []);

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
        <button className="readerCatalog_sort_button" type="button" onClick={toSort}>
          <OcticonSortAsc
            className={`cursor-pointer hover-icon ${sortDirection}`}
            style={{
              transform: sortDirection === SORT_DIRECTION.DOWN ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 180ms ease',
            }}
          />
        </button>
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
                        <div>{t('catalogue.current_read_to', [currentReadPercent])}</div>
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
                          <span>{t('catalogue.bookmark_added')}</span>
                        ) : (
                          <>
                            <span className="readerCatalog_list_item_meta_add_bookMark_plus">+</span>
                            <span>{t('catalogue.bookmark')}</span>
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
      <button className="readerCatalog_mobile_scroll_button" type="button" onClick={toSort}>
        <CatalogueMobileScrollIcon direction={sortDirection} />
        <span>{sortDirection === SORT_DIRECTION.DOWN ? t('catalogue.go_bottom') : t('catalogue.go_top')}</span>
      </button>
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
