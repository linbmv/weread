import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import {
  EVENT_NAME,
  getCurrentBookDetail,
  getPageNum,
  getReaderNavigationTarget,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
  syncHook,
} from '@/lib/subscribe';
import { SORT_DIRECTION } from '@/lib/enums';
import { getReaderBookmarkForPage } from '@/lib/readerAnnotations';
import { getReaderProgress } from '@/lib/readerProgress';
import { getStoredReaderReadingMode } from '@/lib/readerSettings';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import { OcticonSortAsc } from '@/components/Octicon';
import './index.scss';

const toPage = (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.closest('[data-reader-catalog-bookmark]')) return;
  const index = target.closest<HTMLElement>('[data-title-id]')?.dataset.titleId || '';
  const titleId = Number(index);
  if (!Number.isFinite(titleId)) return;
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const page = textSyntaxTree?.titleIdPage[index];
  setReaderNavigationTarget({ page, revision: Date.now(), titleId });
  if (page !== undefined) {
    // Fallback for browsers that don't support View Transitions API
    if (!document.startViewTransition) {
      setPageNum(page);
      return;
    }
    // With View Transition
    document.startViewTransition(() => {
      setPageNum(page);
    });
  }
  syncHook.call(EVENT_NAME.CLOSE_POPOVER);
};

const getCurrentTitleId = (bookId: string | undefined, textSyntaxTree: TextSyntaxTree): number | undefined => {
  const pageTitleId = textSyntaxTree.pageTitleId[getPageNum()] ?? textSyntaxTree.pageTitleId[0];
  const progress = getReaderProgress(bookId);
  const progressTitleId = progress?.titleId;
  const navigationTarget = getReaderNavigationTarget();
  if (getStoredReaderReadingMode() === 'scroll') {
    if (navigationTarget.titleId !== undefined && (!progress || navigationTarget.revision >= progress.updatedAt)) {
      return navigationTarget.titleId;
    }
    if (progressTitleId !== undefined) {
      return progressTitleId;
    }
  }
  return pageTitleId;
};

const getCatalogueReadPercent = (
  bookId: string | undefined,
  currentTitleId: number | undefined,
): number | undefined => {
  const progress = getReaderProgress(bookId);
  if (!progress || progress.titleId !== currentTitleId) return undefined;
  if (typeof progress.readPercent !== 'number' || !Number.isFinite(progress.readPercent)) return undefined;
  const percent = Math.min(Math.max(Math.floor(progress.readPercent), 0), 100);
  return percent >= 1 ? percent : undefined;
};

const isCurrentPageBookmarked = (bookId: string | undefined): boolean => {
  return Boolean(getReaderBookmarkForPage(bookId, getPageNum()));
};

const CatalogueProgressIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.82962 2.971 13.7026 6.62675c.0987.07768.1762.17832.2202.29838.0018.00883.0036.01412.0036.01942.0317.07062.0422.14831.0458.22599 0 .0106.0088.02295.0088.03355 0 .02118-.0141.03884-.0141.06003-.0035.0459-.0141.09181-.03.13771-.0141.05473-.037.10417-.0616.15361-.0159.03001-.037.05826-.0582.08651-.0193.02472-.0281.0565-.0546.07945l-3.93288 3.8102c-.28364.286-.74521.286-1.02532 0-.28363-.2825-.28363-.7451 0-1.0311l2.6962-2.57077-9.93813.00008c-.40519 0-.738151-.33016-.738151-.73624s.331201-.73624.738151-.73624l9.91523-.00007L8.8043 4.00033c-.28363-.28073-.28363-.74507 0-1.02933.28011-.28249.74168-.28249 1.02532 0Z"
      fill="currentColor"
    />
  </svg>
);

export const Catalogue = (): React.JSX.Element => {
  const sortRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasAlignedCurrentTitleRef = useRef(false);
  const [sortDirection, setSortDirection] = useState(SORT_DIRECTION.DOWN);
  const [, setMetaRevision] = useState(0);
  const bookDetail: BookInfo | null = getCurrentBookDetail();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const [currentTitleId, setCurrentTitleId] = useState(() => getCurrentTitleId(bookDetail?.id, textSyntaxTree));
  const resolvedCover = useResolvedBookImage(bookDetail?.id, bookDetail?.image);
  const currentReadPercent = getCatalogueReadPercent(bookDetail?.id, currentTitleId);

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
    scrollRef.current?.addEventListener('click', toPage);
    sortRef.current?.addEventListener('click', toSort);
    return () => {
      scrollRef.current?.removeEventListener('click', toPage);
      sortRef.current?.removeEventListener('click', toSort);
    };
  }, [toSort]);

  useEffect(() => {
    updateCatalogueMeta();
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updateCatalogueMeta);
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateCatalogueMeta);
    syncHook.tap(EVENT_NAME.SET_READER_ANNOTATIONS, updateCatalogueMeta);
    syncHook.tap(EVENT_NAME.SET_READER_NAVIGATION_TARGET, updateCatalogueMeta);
    syncHook.tap(EVENT_NAME.SET_READER_PROGRESS, updateCatalogueMeta);
    syncHook.tap(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateCatalogueMeta);
    return () => {
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updateCatalogueMeta);
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateCatalogueMeta);
      syncHook.off(EVENT_NAME.SET_READER_ANNOTATIONS, updateCatalogueMeta);
      syncHook.off(EVENT_NAME.SET_READER_NAVIGATION_TARGET, updateCatalogueMeta);
      syncHook.off(EVENT_NAME.SET_READER_PROGRESS, updateCatalogueMeta);
      syncHook.off(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateCatalogueMeta);
    };
  }, [updateCatalogueMeta]);

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
      <div className="px-7 py-2 flex flex-row flex-nowrap items-center shrink-0">
        {resolvedCover && <img className="w-14 mr-5" src={resolvedCover} alt={bookDetail?.title} />}
        <div>
          <div className="text-lg text-text-color-1 font-medium break-all">{bookDetail?.title}</div>
          <div className="text-sm text-text-color-2 font-medium mt-1 break-all">{bookDetail?.author}</div>
        </div>
      </div>
      <div className="mx-9 basis-10 flex items-center justify-end shrink-0" ref={sortRef}>
        <OcticonSortAsc
          className={`cursor-pointer hover-icon ${sortDirection}`}
          style={{
            transform: sortDirection === SORT_DIRECTION.DOWN ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 180ms ease',
          }}
        />
      </div>
      <div className="reader-menu-scroll-area overflow-y-auto flex-auto" ref={scrollRef}>
        {textSyntaxTree?.sequences?.map((item) => {
          const isCurrentTitle = item.titleId === currentTitleId;
          const isBookmarked = isCurrentTitle && isCurrentPageBookmarked(bookDetail?.id);
          return (
            <div
              className={`readerCatalog_list_item ${isCurrentTitle ? 'is-current' : ''}`}
              data-title-id={item.titleId}
              key={item.titleId}
            >
              <div className="readerCatalog_list_item_inner">
                <div className="readerCatalog_list_item_title">{item.title}</div>
                {isCurrentTitle ? (
                  <div className="readerCatalog_list_item_meta">
                    {currentReadPercent !== undefined ? (
                      <div className="readerCatalog_list_item_meta_progress">
                        <CatalogueProgressIcon />
                        <div>{`当前读到 ${currentReadPercent}%`}</div>
                      </div>
                    ) : (
                      <div></div>
                    )}
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
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
