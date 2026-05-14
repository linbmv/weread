import { EVENT_NAME, createEmptyReaderSearchHighlight, setReaderSearchHighlight, syncHook } from '@/lib/subscribe';
import { trim } from '@/lib/transformText';
import type { ReaderMenuSearchSessionState } from '@/components/DetailMenu/types';

const readerMenuSearchSessionState = new Map<string, ReaderMenuSearchSessionState>();

let pendingReaderMenuSearchKeyword = '';

export const createEmptyReaderMenuSearchState = (): ReaderMenuSearchSessionState => ({
  keyword: '',
  searchResult: [],
  searchResultScrollTop: 0,
  showSearchResult: false,
});

export const getReaderMenuSearchKey = (): string => {
  const match = window.location.pathname.match(/\/reader\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : 'default';
};

export const getReaderMenuSearchState = (key: string): ReaderMenuSearchSessionState => {
  const state = readerMenuSearchSessionState.get(key);
  if (!state) return createEmptyReaderMenuSearchState();
  return {
    ...state,
    searchResultScrollTop: Number.isFinite(state.searchResultScrollTop) ? state.searchResultScrollTop : 0,
  };
};

export const saveReaderMenuSearchState = (key: string, state: ReaderMenuSearchSessionState): void => {
  readerMenuSearchSessionState.set(key, state);
};

export const saveReaderMenuSearchScrollTop = (key: string, scrollTop: number): void => {
  const state = getReaderMenuSearchState(key);
  if (!state.keyword || !state.showSearchResult || state.searchResult.length === 0) return;
  readerMenuSearchSessionState.set(key, {
    ...state,
    searchResultScrollTop: Math.max(scrollTop, 0),
  });
};

export const clearReaderMenuSearchState = (key: string): void => {
  readerMenuSearchSessionState.delete(key);
};

export const clearReaderMenuSearchSessions = (): void => {
  readerMenuSearchSessionState.clear();
};

export const clearReaderSearchHighlight = (): void => {
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
};

export const consumePendingReaderMenuSearchKeyword = (key: string): string => {
  const keyword = pendingReaderMenuSearchKeyword || getReaderMenuSearchState(key).keyword;
  pendingReaderMenuSearchKeyword = '';
  return keyword;
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
