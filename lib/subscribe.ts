import { createSignal, subscribers } from '@/lib/utils';
import type { BookInfo } from '@/store/books';
import { createEmptyTextSyntaxTree } from '@/lib/transformText';
import type { TextSyntaxTree } from '@/lib/transformText';

export interface ReaderSearchHighlight {
  hasResult: boolean;
  keyword: string;
  revision: number;
}

export interface ReaderNavigationTarget {
  blockId?: string;
  blockPageOffset?: number;
  matchStart?: number;
  page?: number;
  revision: number;
  titleId?: number;
}

export const createEmptyReaderSearchHighlight = (): ReaderSearchHighlight => ({
  hasResult: false,
  keyword: '',
  revision: 0,
});

export enum EVENT_NAME {
  CLOSE_READER_CONTROL_PANEL = 'close-reader-control-panel',
  CLOSE_MOBILE_READER_CHROME = 'close-mobile-reader-chrome',
  CLOSE_MOBILE_READER_CONTROL_PANEL_FADE = 'close-mobile-reader-control-panel-fade',
  FLUSH_READER_PROGRESS = 'flush-reader-progress',
  OPEN_READER_MENU_SEARCH = 'open-reader-menu-search',
  SET_READER_CONTROL_PANEL_ACTIVE = 'set-reader-control-panel-active',
  SET_CURRENT_BOOK_PAGE = 'set-current-book-page',
  SET_CURRENT_BOOK_DETAIL = 'set-current-book-detail',
  ADD_READER_PAGE_BOOKMARK = 'add-reader-page-bookmark',
  CLEAR_READER_PENDING_LOCATOR = 'clear-reader-pending-locator',
  SET_READER_ANNOTATIONS = 'set-reader-annotations',
  SET_READER_BOOK_STATUS = 'set-reader-book-status',
  SET_READER_NAVIGATION_TARGET = 'set-reader-navigation-target',
  SET_READER_PROGRESS = 'set-reader-progress',
  SET_READER_SEARCH_HIGHLIGHT = 'set-reader-search-highlight',
  SET_TEXT_SYNTAX_TREE = 'set-text-syntax-tree',
}

export const syncHook = subscribers;

const currentBookDetailSignal = createSignal<BookInfo | null>(null);
export const getCurrentBookDetail = (): BookInfo | null => currentBookDetailSignal.value;
export const setCurrentBookDetail = (value: BookInfo | null): void => {
  currentBookDetailSignal.set(value);
  syncHook.call(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, value);
};

const textSyntaxTreeSignal = createSignal<TextSyntaxTree>(createEmptyTextSyntaxTree());
export const getTextSyntaxTree = (): TextSyntaxTree => textSyntaxTreeSignal.value;
export const setTextSyntaxTree = (value: TextSyntaxTree): void => {
  textSyntaxTreeSignal.set(value);
  syncHook.call(EVENT_NAME.SET_TEXT_SYNTAX_TREE, value);
};

const readerSearchHighlightSignal = createSignal<ReaderSearchHighlight>(createEmptyReaderSearchHighlight());
export const getReaderSearchHighlight = (): ReaderSearchHighlight => readerSearchHighlightSignal.value;
export const setReaderSearchHighlight = (value: ReaderSearchHighlight): void => {
  readerSearchHighlightSignal.set(value);
  syncHook.call(EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT, value);
};

const readerNavigationTargetSignal = createSignal<ReaderNavigationTarget>({ revision: 0 });
export const getReaderNavigationTarget = (): ReaderNavigationTarget => readerNavigationTargetSignal.value;
export const setReaderNavigationTarget = (value: ReaderNavigationTarget): void => {
  readerNavigationTargetSignal.set(value);
  syncHook.call(EVENT_NAME.SET_READER_NAVIGATION_TARGET, value);
};

const pageNumSignal = createSignal<number>(0);
export const getPageNum = (): number => pageNumSignal.value;
export const setPageNum = (value: number): void => {
  pageNumSignal.set(value);
  syncHook.call(EVENT_NAME.SET_CURRENT_BOOK_PAGE, value);
};

const readerControlPanelActiveSignal = createSignal<boolean>(false);
export const getReaderControlPanelActive = (): boolean => readerControlPanelActiveSignal.value;
export const setReaderControlPanelActive = (value: boolean): void => {
  readerControlPanelActiveSignal.set(value);
  syncHook.call(EVENT_NAME.SET_READER_CONTROL_PANEL_ACTIVE, value);
};
