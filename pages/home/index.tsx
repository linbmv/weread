import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { debounce } from 'ranuts/utils';
import { BookCard } from '@/components/BookCard';
import { addBook, getAllBooks, searchBooksByAuthor, searchBooksByContent, searchBooksByTitle } from '@/store/books';
import { trim } from '@/lib/transformText';
import { resumeDB } from '@/store';
import { startSpaViewTransition } from '@/lib/navigation';
import { importBookFile, isSupportedBookFile } from '@/lib/bookImporter';
import type { BookInfo, SearchResult } from '@/store/books';
import { ROUTE_PATH } from '@/router';
import { DEVICE_ENUM, useCheckDevice } from '@/lib/hooks';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import { Loading } from '@/components/Loading';
import {
  OcticonChevronRight as HomeArrowRightIcon,
  OcticonPlus as HomePlusIcon,
  OcticonSearch as HomeSearchIcon,
} from '@/components/Octicon';
import { t } from '@/locales';
import 'ranui/input';

const DESKTOP_INPUT_STYLE = {
  '--ran-input-border-radius': '2rem',
  '--ran-input-content-border-radius': '2rem',
  '--ran-input-content-padding': '10px 10px 10px 52px',
  '--ran-input-content-font-size': '16px',
  '--ran-input-content-font-weight': '400',
};

const MOBILE_INPUT_STYLE = {
  '--ran-input-border-radius': '2rem',
  '--ran-input-content-border-radius': '2rem',
  '--ran-input-content-padding': '10px 10px 10px 36px',
  '--ran-input-content-font-size': '16px',
  '--ran-input-content-font-weight': '400',
  '--ran-input-padding': '0px 10px',
};

const MAX_BOOK_LOAD_RETRIES = 3;

const appendImportedBooks = (bookList: BookInfo[], importedBooks: BookInfo[]): BookInfo[] => {
  if (importedBooks.length === 0) return bookList;
  const bookMap = new Map(bookList.map((book) => [book.id, book]));
  importedBooks.forEach((book) => {
    bookMap.set(book.id, book);
  });
  return Array.from(bookMap.values());
};

const addBookByFile = (): Promise<BookInfo[]> => {
  return new Promise((resolve) => {
    const uploadFile = document.createElement('input');
    uploadFile.setAttribute('type', 'file');
    uploadFile.setAttribute('accept', '.txt,.epub,text/plain,application/epub+zip');
    uploadFile.setAttribute('multiple', 'multiple');
    uploadFile.click();
    uploadFile.onchange = () => {
      const { files } = uploadFile;
      if (!files || files.length === 0) {
        resolve([]);
        return;
      }
      const supportedFiles = Array.from(files).filter(isSupportedBookFile);
      if (supportedFiles.length === 0) {
        resolve([]);
        return;
      }
      Promise.allSettled(
        supportedFiles.map(async (file) => {
          const book = await importBookFile(file);
          const res = await addBook(book);
          if (!res.error && res.data) return res.data as BookInfo;
          throw new Error(res.message || `Failed to add book: ${file.name}`);
        }),
      ).then((results) => {
        resolve(
          results
            .filter((result): result is PromiseFulfilledResult<BookInfo> => result.status === 'fulfilled')
            .map((result) => result.value),
        );
      });
    };
  });
};

interface HomeSearchState {
  searchValue: string;
  searchLoading: boolean;
  searchTitleResult: BookInfo[];
  searchAuthorResult: BookInfo[];
  searchContentResult: SearchResult[];
}

const useHomeBookList = (): { bookList: BookInfo[]; setBookList: React.Dispatch<React.SetStateAction<BookInfo[]>> } => {
  const [bookList, setBookList] = useState<BookInfo[]>([]);

  const loadBooks = useCallback(async () => {
    let attempts = 0;
    while (attempts < MAX_BOOK_LOAD_RETRIES) {
      const res = await getAllBooks<BookInfo>();
      if (!res.error) {
        setBookList(res.data);
        return;
      }
      attempts++;
      try {
        await resumeDB();
      } catch {
        // resumeDB rejects only with false; treat as transient and continue retrying.
      }
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  return { bookList, setBookList };
};

const useHomeSearch = (inputRef: React.RefObject<HTMLInputElement | null>): HomeSearchState => {
  const [searchValue, setSearchValue] = useState<string>('');
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchTitleResult, setSearchTitleResult] = useState<BookInfo[]>([]);
  const [searchAuthorResult, setSearchAuthorResult] = useState<BookInfo[]>([]);
  const [searchContentResult, setSearchContentResult] = useState<SearchResult[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const target = inputRef.current;
    if (!target) return;

    const onChange = debounce((event: Event) => {
      const value = trim((event.target as HTMLInputElement)?.value || '');
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSearchValue(value);
      if (!value) {
        setSearchTitleResult([]);
        setSearchAuthorResult([]);
        setSearchContentResult([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      setSearchTitleResult([]);
      setSearchAuthorResult([]);
      setSearchContentResult([]);

      Promise.allSettled([
        searchBooksByTitle<BookInfo>(value),
        searchBooksByAuthor<BookInfo>(value),
        searchBooksByContent<SearchResult>(value),
      ]).then((results) => {
        if (requestIdRef.current !== requestId) return;
        const [titleRes, authorRes, contentRes] = results;
        if (titleRes.status === 'fulfilled' && !titleRes.value.error) {
          setSearchTitleResult(titleRes.value.data);
        }
        if (authorRes.status === 'fulfilled' && !authorRes.value.error) {
          setSearchAuthorResult(authorRes.value.data);
        }
        if (contentRes.status === 'fulfilled' && !contentRes.value.error) {
          setSearchContentResult(contentRes.value.data);
        }
        setSearchLoading(false);
      });
    }, 500);

    target.addEventListener('change', onChange);
    return () => {
      target.removeEventListener('change', onChange);
    };
  }, [inputRef]);

  return { searchValue, searchLoading, searchTitleResult, searchAuthorResult, searchContentResult };
};

const renderHighlightedText = (text: string, keyword: string, bookId: string): React.ReactNode => {
  if (!text) return null;
  if (!keyword) return text;
  const segments = text.split(keyword);
  return segments.map((segment, index) => (
    <span key={`${bookId}-${index}`} item-id={bookId}>
      {segment}
      {index < segments.length - 1 && (
        <span item-id={bookId} className="text-blue-500">
          {keyword}
        </span>
      )}
    </span>
  ));
};

interface SearchResultRowProps {
  book: BookInfo | SearchResult;
  highlightedField: 'title' | 'author' | 'matched';
  keyword: string;
  rowKey: string;
}

const SearchResultRow = ({ book, highlightedField, keyword, rowKey }: SearchResultRowProps): React.JSX.Element => {
  const { id, title = '', author = '', image } = book;
  const matchedText = (book as SearchResult).matchedText?.[0] || '';
  const resolvedImage = useResolvedBookImage(id, image);
  return (
    <div
      className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-light-gray-color-1 min-h-32"
      key={rowKey}
      item-id={id}
    >
      {resolvedImage && <img className="w-16 mr-5" src={resolvedImage} item-id={id} alt={title} />}
      <div>
        <div className="text-lg text-text-color-1 font-medium break-all" item-id={id}>
          {highlightedField === 'title' ? renderHighlightedText(title, keyword, id) : title}
        </div>
        <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={id}>
          {highlightedField === 'author' ? renderHighlightedText(author, keyword, id) : author}
        </div>
        {highlightedField === 'matched' && (
          <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={id}>
            {renderHighlightedText(matchedText, keyword, id)}
          </div>
        )}
      </div>
    </div>
  );
};

interface SearchResultsPanelProps {
  state: HomeSearchState;
  panelClassName: string;
  searchResultRef: React.RefObject<HTMLDivElement | null>;
}

const SearchResultsPanel = ({ state, panelClassName, searchResultRef }: SearchResultsPanelProps): React.JSX.Element => {
  const { searchValue, searchLoading, searchTitleResult, searchAuthorResult, searchContentResult } = state;
  const noResult =
    !searchLoading &&
    searchTitleResult.length === 0 &&
    searchAuthorResult.length === 0 &&
    searchContentResult.length === 0;

  return (
    <div
      className="w-full transition-all duration-500 overflow-hidden mt-6 pb-6"
      style={{ height: searchValue ? 'calc(100vh - var(--spacing) * 48)' : '0px' }}
      ref={searchResultRef}
    >
      <div className="overflow-y-auto h-full">
        {searchTitleResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pb-1.5">{t('ebook')}</div>
              <div>
                {searchTitleResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-title`}
                    book={book}
                    highlightedField="title"
                    keyword={searchValue}
                    rowKey={`${book.id}-title`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {searchAuthorResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pb-1.5">{t('author')}</div>
              <div>
                {searchAuthorResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-author`}
                    book={book}
                    highlightedField="author"
                    keyword={searchValue}
                    rowKey={`${book.id}-author`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {searchContentResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pb-1.5">
                {t('search_result_1')} <span className="text-blue-500">{searchValue}</span> {t('search_result_2')}
                {t('search_result_3')}
                {searchContentResult.length}
              </div>
              <div>
                {searchContentResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-content`}
                    book={book}
                    highlightedField="matched"
                    keyword={searchValue}
                    rowKey={`${book.id}-content`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {noResult && (
          <div className="h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-text-color-2 font-normal text-xl">{t('no_result')}</div>
            </div>
          </div>
        )}
        {searchLoading && (
          <div className="h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <r-loading
                name="circle-fold"
                className="text-2xl"
                style={{
                  '--loading-circle-fold-item-before-background': 'var(--brand-blue-color-1)',
                  '--loading-circle-fold-item-after-background': 'var(--brand-blue-color-1)',
                }}
              ></r-loading>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ImportCardProps {
  className: string;
  iconSize: number;
  onAdd: () => void;
}

const ImportCard = ({ className, iconSize, onAdd }: ImportCardProps): React.JSX.Element => {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onAdd();
  };

  return (
    <div className={className} role="button" tabIndex={0} onClick={onAdd} onKeyDown={onKeyDown}>
      <HomePlusIcon style={{ width: iconSize, height: iconSize, color: 'var(--icon-color-2)' }} />
    </div>
  );
};

const useHomeNativeNavigation = (searchResultRef: React.RefObject<HTMLDivElement | null>): void => {
  const navigate = useNavigate();
  useEffect(() => {
    const element = searchResultRef.current;
    if (!element) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLDivElement;
      const id = target.getAttribute('item-id');
      if (!id) return;
      startSpaViewTransition(() => {
        navigate(`${ROUTE_PATH.BOOK_DETAIL}?id=${id}`);
      });
    };
    element.addEventListener('click', handler);
    return () => {
      element.removeEventListener('click', handler);
    };
  }, [navigate, searchResultRef]);
};

export const Home = (): React.JSX.Element => {
  const [currentDevice] = useCheckDevice();
  if (currentDevice === DEVICE_ENUM.MOBILE) return <MobileHome />;
  if (currentDevice === DEVICE_ENUM.DESKTOP) return <DesktopHome />;
  return <Loading />;
};

export const DesktopHome = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultRef = useRef<HTMLDivElement>(null);
  const { bookList, setBookList } = useHomeBookList();
  const searchState = useHomeSearch(inputRef);
  useHomeNativeNavigation(searchResultRef);

  const onAdd = () => {
    addBookByFile().then((books) => {
      setBookList((current) => appendImportedBooks(current, books));
    });
  };

  return (
    <div>
      <div className="w-full bg-front-bg-color-2">
        <div className="w-full min-h-72 pt-28">
          <div className="relative w-1/2 min-w-2xs h-14 block mx-auto">
            <HomeSearchIcon
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
              style={{ width: 24, height: 24, color: 'var(--icon-color-1)' }}
            />
            <r-input
              className="w-full h-full block mx-auto"
              style={DESKTOP_INPUT_STYLE}
              placeholder={t('search')}
              ref={inputRef}
            ></r-input>
          </div>
          <SearchResultsPanel
            state={searchState}
            panelClassName="w-1/2 min-w-2xs block mx-auto bg-front-bg-color-3 rounded-xl py-5 mb-6"
            searchResultRef={searchResultRef}
          />
        </div>
      </div>
      {!searchState.searchValue && (
        <div className="w-full bg-front-bg-color-1 min-h-svh">
          <div className="max-w-7xl mx-auto pt-12 flex flex-row justify-between items-center">
            <div className="flex justify-start items-center">
              <div className="cursor-pointer text-text-color-1 text-2xl font-medium">{t('my_bookcase')}</div>
              <HomeArrowRightIcon
                className="cursor-pointer"
                style={{ width: 24, height: 24, color: 'var(--icon-color-1)' }}
              />
            </div>
          </div>
          <div className="max-w-7xl mx-auto flex flex-row flex-wrap justify-start items-center">
            <ImportCard
              className="w-2xs h-40 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
              iconSize={64}
              onAdd={onAdd}
            />
            {bookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const MobileHome = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultRef = useRef<HTMLDivElement>(null);
  const { bookList, setBookList } = useHomeBookList();
  const searchState = useHomeSearch(inputRef);
  useHomeNativeNavigation(searchResultRef);

  const onAdd = () => {
    addBookByFile().then((books) => {
      setBookList((current) => appendImportedBooks(current, books));
    });
  };

  return (
    <div className="w-full min-h-svh bg-front-bg-color-2">
      <div className="p-5">
        <div className="relative w-full h-9 block mx-auto">
          <HomeSearchIcon
            className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none z-10"
            style={{ width: 16, height: 16, color: 'var(--icon-color-1)' }}
          />
          <r-input
            className="w-full h-full block mx-auto"
            style={MOBILE_INPUT_STYLE}
            placeholder={t('search')}
            ref={inputRef}
          ></r-input>
        </div>
      </div>
      {searchState.searchValue && (
        <div className="px-5">
          <SearchResultsPanel
            state={searchState}
            panelClassName="block mx-auto bg-front-bg-color-3 rounded-xl mb-6"
            searchResultRef={searchResultRef}
          />
        </div>
      )}
      {!searchState.searchValue && (
        <div className="px-5">
          <div className="flex flex-row flex-wrap justify-start items-center">
            <ImportCard
              className="w-24 h-36 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
              iconSize={54}
              onAdd={onAdd}
            />
            {bookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
