import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { BookInfo } from '@/store/books';
import {
  createEmptyReaderSearchHighlight,
  setCurrentBookDetail,
  setPageNum,
  setReaderNavigationTarget,
  setReaderSearchHighlight,
  setTextSyntaxTree,
} from '@/lib/subscribe';
import { createEmptyTextSyntaxTree } from '@/lib/transformText';
import { startSpaViewTransition } from '@/lib/navigation';
import { ROUTE_PATH } from '@/router';
import { useIsMobile } from '@/lib/hooks';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import './index.scss';

interface BookCardProps {
  book: BookInfo;
}

const clearReaderSignals = () => {
  setPageNum(0);
  setCurrentBookDetail(null);
  setReaderNavigationTarget({ revision: 0 });
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
  setTextSyntaxTree(createEmptyTextSyntaxTree());
};

const useBookCardNavigate = (id: string | number | undefined) => {
  const navigate = useNavigate();
  return (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (id === undefined) return;
    const target = `${ROUTE_PATH.BOOK_DETAIL}?id=${id}`;
    startSpaViewTransition(() => {
      clearReaderSignals();
      navigate(target);
    });
  };
};

const DESKTOP_CARD_CLASS =
  'w-2xs h-40 bg-front-bg-color-3 p-5 cursor-pointer rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5';

const MOBILE_CARD_CLASS =
  'w-24 h-36 bg-front-bg-color-3 p-3 cursor-pointer rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5';

export const BookCoverFallback = ({
  className = '',
  itemId,
  title = '',
}: {
  className?: string;
  itemId?: string;
  title?: string;
}): React.JSX.Element => {
  return (
    <div className={`book-cover-fallback ${className}`} aria-hidden="true" item-id={itemId}>
      <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" fill-opacity="0.3" viewBox="0 0 7 8"><path fill="currentColor" d="M1 0C.93 0 .87.01.81.03C.42.11.11.42.03.81C0 .87 0 .93 0 1v5.5C0 7.33.67 8 1.5 8H7V7H1.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5H7V.5c0-.28-.22-.5-.5-.5H6v3L5 2L4 3V0z"></path></svg>
    </div>
  );
};

export const BookCard = ({ book }: BookCardProps): React.JSX.Element => {
  const isMobile = useIsMobile();
  const { id, image, title = '', author = '' } = book || {};
  const onClick = useBookCardNavigate(id);
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(resolvedImage && !imageFailed);
  useEffect(() => {
    setImageFailed(false);
  }, [id, image]);

  return (
    <a
      onClick={onClick}
      href={`/weread/book-detail?id=${id}`}
      style={{ viewTransitionName: `book-info-${id}` }}
      className={isMobile ? MOBILE_CARD_CLASS : DESKTOP_CARD_CLASS}
    >
      {!isMobile && (
        <div className="grow-0">
          {shouldShowImage ? (
            <img
              className="h-28 object-cover mr-5"
              src={resolvedImage}
              alt={title}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <BookCoverFallback className="h-28 w-20 mr-5" title={title} />
          )}
        </div>
      )}
      <div
        className={isMobile ? 'grow shrink basis-0 w-full overflow-hidden truncate' : 'grow shrink basis-0 min-w-36'}
      >
        <div className="text-text-color-1 font-medium truncate break-all" title={isMobile ? title : undefined}>
          {title}
        </div>
        <div
          className={`text-sm text-text-color-2 mt-2 ${isMobile ? 'truncate' : ''}`}
          title={isMobile ? author : undefined}
        >
          {author}
        </div>
      </div>
    </a>
  );
};
