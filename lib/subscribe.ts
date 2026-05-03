import { createSignal, subscribers } from 'ranuts/utils';
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
  CLOSE_POPOVER = 'close-popover',
  OPEN_READER_MENU_SEARCH = 'open-reader-menu-search',
  SET_CURRENT_BOOK_PAGE = 'set-current-book-page',
  SET_CURRENT_BOOK_DETAIL = 'set-current-book-detail',
  SET_READER_ANNOTATIONS = 'set-reader-annotations',
  SET_READER_NAVIGATION_TARGET = 'set-reader-navigation-target',
  SET_READER_PROGRESS = 'set-reader-progress',
  SET_READER_SEARCH_HIGHLIGHT = 'set-reader-search-highlight',
  SET_TEXT_SYNTAX_TREE = 'set-text-syntax-tree',
}

export const syncHook = subscribers;

export const [getCurrentBookDetail, setCurrentBookDetail] = createSignal<BookInfo | null>(
  null,
  { subscriber: EVENT_NAME.SET_CURRENT_BOOK_DETAIL },
);

export const [getTextSyntaxTree, setTextSyntaxTree] = createSignal<TextSyntaxTree>(
  createEmptyTextSyntaxTree(),
  { subscriber: EVENT_NAME.SET_TEXT_SYNTAX_TREE },
);

export const [getReaderSearchHighlight, setReaderSearchHighlight] = createSignal<ReaderSearchHighlight>(
  createEmptyReaderSearchHighlight(),
  { subscriber: EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT },
);

export const [getReaderNavigationTarget, setReaderNavigationTarget] = createSignal<ReaderNavigationTarget>(
  { revision: 0 },
  { subscriber: EVENT_NAME.SET_READER_NAVIGATION_TARGET },
);

export const [getPageNum, setPageNum] = createSignal<number>(0, { subscriber: EVENT_NAME.SET_CURRENT_BOOK_PAGE });
