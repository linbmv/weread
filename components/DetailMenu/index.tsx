import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { debounce, getQuery } from 'ranuts/utils';
import { Catalogue } from '@/components/Catalogue';
import {
  EVENT_NAME,
  createEmptyReaderSearchHighlight,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
  setReaderSearchHighlight,
  syncHook,
} from '@/lib/subscribe';
import { findKeywordSentenceMatches } from '@/lib/searchText';
import { trim } from '@/lib/transformText';
import type { TextSyntaxTree } from '@/lib/transformText';
import { t } from '@/locales';

interface SearchResultText {
  blockId: string;
  blockLength: number;
  matchStart: number;
  page: number;
  sentence: string;
}

interface SearchResult {
  index: number;
  text: SearchResultText[];
  title: string;
}

interface ReaderMenuSearchSessionState {
  keyword: string;
  searchResult: SearchResult[];
  searchResultScrollTop: number;
  showSearchResult: boolean;
}

interface SearchResultTarget {
  blockId?: string;
  matchStart?: number;
  page: number;
}

const ReaderSearchIcon = (): React.JSX.Element => (
  <svg
    className="reader-menu-search-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path d="m21 21l-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </g>
  </svg>
);

const readerMenuSearchSessionState = new Map<string, ReaderMenuSearchSessionState>();

let pendingReaderMenuSearchKeyword = '';

const createEmptyReaderMenuSearchState = (): ReaderMenuSearchSessionState => ({
  keyword: '',
  searchResult: [],
  searchResultScrollTop: 0,
  showSearchResult: false,
});

const getReaderMenuSearchKey = (): string => {
  const { id } = getQuery();
  return typeof id === 'string' && id ? id : 'default';
};

const getReaderMenuSearchState = (key: string): ReaderMenuSearchSessionState => {
  const state = readerMenuSearchSessionState.get(key);
  if (!state) return createEmptyReaderMenuSearchState();
  return {
    ...state,
    searchResultScrollTop: Number.isFinite(state.searchResultScrollTop) ? state.searchResultScrollTop : 0,
  };
};

const saveReaderMenuSearchState = (key: string, state: ReaderMenuSearchSessionState): void => {
  readerMenuSearchSessionState.set(key, state);
};

const saveReaderMenuSearchScrollTop = (key: string, scrollTop: number): void => {
  const state = getReaderMenuSearchState(key);
  if (!state.keyword || !state.showSearchResult || state.searchResult.length === 0) return;
  readerMenuSearchSessionState.set(key, {
    ...state,
    searchResultScrollTop: Math.max(scrollTop, 0),
  });
};

const clearReaderMenuSearchState = (key: string): void => {
  readerMenuSearchSessionState.delete(key);
};

const clearReaderSearchHighlight = (): void => {
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
};

export const clearBookDetailMenuSearchState = (bookId?: string): void => {
  pendingReaderMenuSearchKeyword = '';
  if (bookId) {
    readerMenuSearchSessionState.delete(bookId);
  } else {
    readerMenuSearchSessionState.clear();
  }
  clearReaderSearchHighlight();
};

export const requestBookDetailMenuSearch = (keyword: string): void => {
  const normalizedKeyword = trim(keyword);
  if (!normalizedKeyword) return;
  const key = getReaderMenuSearchKey();
  pendingReaderMenuSearchKeyword = normalizedKeyword;
  saveReaderMenuSearchState(key, {
    keyword: normalizedKeyword,
    searchResult: [],
    searchResultScrollTop: 0,
    showSearchResult: true,
  });
  syncHook.call(EVENT_NAME.OPEN_READER_MENU_SEARCH);
};

const clampSearchResultPage = (page: number, totalPage: number): number => {
  return Math.min(Math.max(page, 0), Math.max(totalPage, 0));
};

const getSearchMatchPage = (textSyntaxTree: TextSyntaxTree, blockId: string, matchStart: number, blockLength: number): number => {
  const block = textSyntaxTree.blocks?.find((item) => item.id === blockId);
  const totalPage = textSyntaxTree.totalPage || 0;
  const startPage = textSyntaxTree.blockIdPage[blockId];
  const endPage = textSyntaxTree.blockIdPageEnd[blockId] ?? startPage;

  if (startPage === undefined) {
    if (!block || textSyntaxTree.rawText.length <= 0 || totalPage <= 0) return 0;
    const globalProgress = Math.min(Math.max((block.start + matchStart) / textSyntaxTree.rawText.length, 0), 1);
    return clampSearchResultPage(Math.round(globalProgress * totalPage), totalPage);
  }

  if (endPage <= startPage || blockLength <= 0) return clampSearchResultPage(startPage, totalPage);

  const progress = Math.min(Math.max(matchStart / blockLength, 0), 1);
  const pageSpan = endPage - startPage + 1;
  return clampSearchResultPage(startPage + Math.min(Math.floor(progress * pageSpan), pageSpan - 1), totalPage);
};

const getSearchResultTarget = (target: EventTarget | null): SearchResultTarget | undefined => {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const item = element?.closest<HTMLElement>('[data-search-result-block-id]');
  if (!item) return undefined;

  const fallbackPage = Number(item.dataset.searchResultPage);
  const blockId = item.dataset.searchResultBlockId;
  const matchStart = Number(item.dataset.searchResultMatchStart);
  const blockLength = Number(item.dataset.searchResultBlockLength);

  if (blockId && Number.isFinite(matchStart) && Number.isFinite(blockLength)) {
    return {
      blockId,
      matchStart,
      page: getSearchMatchPage(getTextSyntaxTree(), blockId, matchStart, blockLength),
    };
  }

  return Number.isFinite(fallbackPage) ? { page: fallbackPage } : undefined;
};

const turnToSearchResultPage = (target: SearchResultTarget): void => {
  const textSyntaxTree = getTextSyntaxTree();
  const targetPage = clampSearchResultPage(target.page, textSyntaxTree.totalPage || 0);
  const viewTransitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };

  const block = target.blockId ? textSyntaxTree.blocks.find((item) => item.id === target.blockId) : undefined;
  setReaderNavigationTarget({
    blockId: target.blockId,
    matchStart: target.matchStart,
    page: targetPage,
    revision: Date.now(),
    titleId: block?.titleId,
  });

  if (viewTransitionDocument.startViewTransition) {
    viewTransitionDocument.startViewTransition(() => {
      setPageNum(targetPage);
    });
  } else {
    setPageNum(targetPage);
  }
  syncHook.call(EVENT_NAME.CLOSE_POPOVER);
};

const renderSearchResultSentence = (sentence: string, keyword: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let fromIndex = 0;
  let matchIndex = sentence.indexOf(keyword, fromIndex);

  while (matchIndex !== -1) {
    if (matchIndex > fromIndex) {
      nodes.push(sentence.slice(fromIndex, matchIndex));
    }
    nodes.push(
      <span className="text-brand-blue-color-1" key={`${matchIndex}-${nodes.length}`}>
        {sentence.slice(matchIndex, matchIndex + keyword.length)}
      </span>,
    );
    fromIndex = matchIndex + keyword.length;
    matchIndex = sentence.indexOf(keyword, fromIndex);
  }

  if (fromIndex < sentence.length) {
    nodes.push(sentence.slice(fromIndex));
  }

  return nodes;
};

export const BookDetailMenu = (): React.JSX.Element => {
  const searchResultRef = useRef<HTMLDivElement>(null);
  const searchCacheKey = useMemo(getReaderMenuSearchKey, []);
  const initialSearchState = useMemo(() => getReaderMenuSearchState(searchCacheKey), [searchCacheKey]);
  const latestSearchValueRef = useRef(initialSearchState.keyword);
  const searchResultScrollTopRef = useRef(initialSearchState.searchResultScrollTop);
  const [searchKeyword, setSearchKeyword] = useState(initialSearchState.keyword);
  const [showSearchResult, setShowSearchResult] = useState(initialSearchState.showSearchResult);
  const [searchResult, setSearchResult] = useState<SearchResult[]>(initialSearchState.searchResult);

  const persistSearchState = (state: ReaderMenuSearchSessionState) => {
    saveReaderMenuSearchState(searchCacheKey, state);
  };

  const onSearch = useMemo(
    () =>
      debounce((searchValue: string) => {
        const normalizedSearchValue = trim(searchValue);
        if (normalizedSearchValue !== latestSearchValueRef.current) return;

        if (!normalizedSearchValue) {
          const emptyState = createEmptyReaderMenuSearchState();
          setShowSearchResult(false);
          setSearchResult([]);
          persistSearchState(emptyState);
          clearReaderSearchHighlight();
          return;
        }

        setShowSearchResult(true);

        const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
        const { blocks = [], titleIdTitle } = textSyntaxTree || {};
        const pageSearchResult: SearchResult[] = [];

        for (const item of blocks) {
          if (!item.text.includes(normalizedSearchValue)) continue;

          const textList = findKeywordSentenceMatches(item.text, normalizedSearchValue).map((match) => {
            const page = getSearchMatchPage(textSyntaxTree, item.id, match.start, item.text.length);
            return {
              blockId: item.id,
              blockLength: item.text.length,
              matchStart: match.start,
              page,
              sentence: match.sentence,
            };
          });
          if (textList.length === 0) continue;

          const index = textList[0]?.page ?? textSyntaxTree.blockIdPage[item.id] ?? 0;
          const title = item.titleId === undefined ? '' : titleIdTitle[item.titleId] || '';
          const pageSearchResultItem = pageSearchResult.find((i) => i.title === title);
          if (pageSearchResultItem) {
            pageSearchResultItem.text.push(...textList);
          } else {
            pageSearchResult.push({ text: textList, index, title });
          }
        }

        setReaderSearchHighlight(
          pageSearchResult.length > 0
            ? { hasResult: true, keyword: normalizedSearchValue, revision: Date.now() }
            : createEmptyReaderSearchHighlight(),
        );
        searchResultScrollTopRef.current = 0;
        setSearchResult(pageSearchResult);
        persistSearchState({
          keyword: normalizedSearchValue,
          searchResult: pageSearchResult,
          searchResultScrollTop: 0,
          showSearchResult: true,
        });
      }, 300),
    [searchCacheKey],
  );

  const startSearchFromKeyword = useCallback(
    (keyword: string) => {
      const normalizedSearchValue = trim(keyword);
      if (!normalizedSearchValue) return;
      latestSearchValueRef.current = normalizedSearchValue;
      searchResultScrollTopRef.current = 0;
      setSearchKeyword(normalizedSearchValue);
      setShowSearchResult(true);
      setSearchResult([]);
      persistSearchState({
        keyword: normalizedSearchValue,
        searchResult: [],
        searchResultScrollTop: 0,
        showSearchResult: true,
      });
      onSearch(normalizedSearchValue);
    },
    [onSearch, searchCacheKey],
  );

  const clearSearch = () => {
    latestSearchValueRef.current = '';
    searchResultScrollTopRef.current = 0;
    setSearchKeyword('');
    setShowSearchResult(false);
    setSearchResult([]);
    clearReaderMenuSearchState(searchCacheKey);
    clearReaderSearchHighlight();
  };

  const onSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchValue = trim(e.currentTarget.value);
    const previousSearchValue = latestSearchValueRef.current;
    latestSearchValueRef.current = searchValue;
    setSearchKeyword(searchValue);

    if (!searchValue) {
      clearSearch();
      return;
    }

    setShowSearchResult(true);
    if (searchValue !== previousSearchValue) {
      searchResultScrollTopRef.current = 0;
    }
    persistSearchState({
      keyword: searchValue,
      searchResult,
      searchResultScrollTop: searchValue === previousSearchValue ? searchResultScrollTopRef.current : 0,
      showSearchResult: true,
    });
    onSearch(searchValue);
  };

  const onSearchResult = (e: MouseEvent) => {
    const target = getSearchResultTarget(e.target);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const element = searchResultRef.current;
    if (element) {
      saveReaderMenuSearchScrollTop(searchCacheKey, element.scrollTop);
    }
    turnToSearchResultPage(target);
  };

  useEffect(() => {
    if (initialSearchState.keyword && initialSearchState.searchResult.length > 0) {
      setReaderSearchHighlight({
        hasResult: true,
        keyword: initialSearchState.keyword,
        revision: Date.now(),
      });
    }
  }, [initialSearchState, searchCacheKey]);

  useEffect(() => {
    if (initialSearchState.keyword && initialSearchState.showSearchResult && initialSearchState.searchResult.length === 0) {
      startSearchFromKeyword(initialSearchState.keyword);
    }
  }, [initialSearchState, startSearchFromKeyword]);

  useEffect(() => {
    const runRequestedSearch = () => {
      const keyword = pendingReaderMenuSearchKeyword || getReaderMenuSearchState(searchCacheKey).keyword;
      if (!keyword) return;
      pendingReaderMenuSearchKeyword = '';
      startSearchFromKeyword(keyword);
    };
    syncHook.tap(EVENT_NAME.OPEN_READER_MENU_SEARCH, runRequestedSearch);
    return () => {
      syncHook.off(EVENT_NAME.OPEN_READER_MENU_SEARCH, runRequestedSearch);
    };
  }, [searchCacheKey, startSearchFromKeyword]);

  useEffect(() => {
    const clearSessionSearchState = () => {
      readerMenuSearchSessionState.clear();
    };
    window.addEventListener('pagehide', clearSessionSearchState);
    return () => {
      window.removeEventListener('pagehide', clearSessionSearchState);
    };
  }, []);

  useEffect(() => {
    const element = searchResultRef.current;
    if (!showSearchResult || !element) return;

    element.addEventListener('click', onSearchResult, true);
    return () => {
      element.removeEventListener('click', onSearchResult, true);
    };
  }, [searchResult, showSearchResult]);

  useLayoutEffect(() => {
    const element = searchResultRef.current;
    if (!showSearchResult || searchResult.length === 0 || !element) return;

    const frame = window.requestAnimationFrame(() => {
      const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
      element.scrollTop = Math.min(Math.max(searchResultScrollTopRef.current, 0), maxScrollTop);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchResult, showSearchResult]);

  useEffect(() => {
    const element = searchResultRef.current;
    if (!showSearchResult || !element) return;

    const onScroll = () => {
      searchResultScrollTopRef.current = element.scrollTop;
      saveReaderMenuSearchScrollTop(searchCacheKey, element.scrollTop);
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
    };
  }, [searchCacheKey, searchResult, showSearchResult]);

  return (
    <div
      className="reader-popover-panel w-md flex flex-col"
      style={{
        height: 'calc(100vh - calc(var(--spacing) * 32))',
      }}
    >
      <div className="px-6 py-7">
        <div className="reader-menu-search-wrapper">
          <ReaderSearchIcon />
          <input
            aria-label={t('search')}
            className="reader-menu-search-input"
            placeholder={t('search')}
            type="text"
            value={searchKeyword}
            onChange={onSearchInput}
          />
          {searchKeyword && (
            <button
              aria-label="清除搜索"
              className="reader-menu-search-clear"
              type="button"
              onClick={clearSearch}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8L4.22 5.28a.75.75 0 0 1 0-1.06"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {!showSearchResult ? (
        <Catalogue />
      ) : (
        <div className="pb-7 overflow-y-auto flex-auto" ref={searchResultRef}>
          {searchResult.length > 0 ? (
            searchResult.map((item) => {
              const { text = [], index, title } = item;
              return (
                <div key={`${title}-${index}`}>
                  <div className="text-text-color-1 font-normal text-base px-6 py-2">{title}</div>
                  {text.map((str, i) => {
                    const { blockId, blockLength, matchStart, sentence } = str;
                    return (
                      <div
                        className="text-text-color-2 font-normal text-base py-4 px-6 cursor-pointer hover:bg-front-bg-color-2"
                        data-search-result-block-id={blockId}
                        data-search-result-block-length={`${blockLength}`}
                        data-search-result-match-start={`${matchStart}`}
                        data-search-result-page={`${str.page}`}
                        key={`${blockId}-${i}`}
                      >
                        {renderSearchResultSentence(sentence, searchKeyword)}
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <div className="h-full">
              <div className="flex flex-col items-center justify-center h-full">
                <div className="text-text-color-2 font-normal text-base">{t('no_result')}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
