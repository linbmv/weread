import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { debounce } from 'ranuts/utils';
import { EVENT_NAME, getTextSyntaxTree, syncHook } from '@/lib/subscribe';
import { trim } from '@/lib/transformText';
import { OcticonSearch, OcticonXCircle } from '@/components/Octicon';
import { t } from '@/locales';
import type { ReaderMenuSearchSessionState, SearchResult } from '@/components/DetailMenu/types';
import {
  clearReaderMenuSearchSessions,
  clearReaderMenuSearchState,
  clearReaderSearchHighlight,
  consumePendingReaderMenuSearchKeyword,
  createEmptyReaderMenuSearchState,
  getReaderMenuSearchKey,
  getReaderMenuSearchState,
  saveReaderMenuSearchScrollTop,
  saveReaderMenuSearchState,
} from '@/components/DetailMenu/searchSession';
import {
  buildReaderMenuSearchResults,
  getSearchResultTarget,
  renderSearchResultSentence,
  setReaderMenuSearchHighlight,
  turnToSearchResultPage,
} from '@/components/DetailMenu/searchUtils';

interface ReaderMenuSearchProps {
  idleContent: React.ReactNode;
}

const ReaderSearchIcon = (): React.JSX.Element => <OcticonSearch className="reader-menu-search-icon" />;

export const ReaderMenuSearch = ({ idleContent }: ReaderMenuSearchProps): React.JSX.Element => {
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

        const pageSearchResult = buildReaderMenuSearchResults(normalizedSearchValue, getTextSyntaxTree());
        setReaderMenuSearchHighlight(normalizedSearchValue, pageSearchResult);
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
      setReaderMenuSearchHighlight(initialSearchState.keyword, initialSearchState.searchResult);
    }
  }, [initialSearchState, searchCacheKey]);

  useEffect(() => {
    if (
      initialSearchState.keyword &&
      initialSearchState.showSearchResult &&
      initialSearchState.searchResult.length === 0
    ) {
      startSearchFromKeyword(initialSearchState.keyword);
    }
  }, [initialSearchState, startSearchFromKeyword]);

  useEffect(() => {
    const runRequestedSearch = () => {
      const keyword = consumePendingReaderMenuSearchKeyword(searchCacheKey);
      if (!keyword) return;
      startSearchFromKeyword(keyword);
    };
    syncHook.tap(EVENT_NAME.OPEN_READER_MENU_SEARCH, runRequestedSearch);
    return () => {
      syncHook.off(EVENT_NAME.OPEN_READER_MENU_SEARCH, runRequestedSearch);
    };
  }, [searchCacheKey, startSearchFromKeyword]);

  useEffect(() => {
    window.addEventListener('pagehide', clearReaderMenuSearchSessions);
    return () => {
      window.removeEventListener('pagehide', clearReaderMenuSearchSessions);
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
      className="reader-menu-panel w-md flex flex-col"
      style={{
        height: 'calc(100vh - calc(var(--spacing) * 30))',
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
            <button aria-label="清除搜索" className="reader-menu-search-clear" type="button" onClick={clearSearch}>
              <OcticonXCircle />
            </button>
          )}
        </div>
      </div>
      {!showSearchResult ? (
        idleContent
      ) : (
        <div className="reader-menu-scroll-area pb-7 overflow-y-auto flex-auto" ref={searchResultRef}>
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
