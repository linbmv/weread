import type { BookInfo } from '@/store/books';
import { BookCoverFallback } from '@/components/BookCard';
import { t } from '@/locales';

interface BookSummaryButtonProps {
  bookDetail: BookInfo | null;
  coverFailed: boolean;
  coverUrl?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onCoverError: () => void;
}

export const BookSummaryButton = ({
  bookDetail,
  coverFailed,
  coverUrl,
  onClick,
  onCoverError,
}: BookSummaryButtonProps): React.JSX.Element => {
  return (
    <button
      aria-label={t('catalogue.open_book_data')}
      className="reader-catalog-book-summary px-7 py-2 flex flex-row flex-nowrap items-center shrink-0"
      type="button"
      onClick={onClick}
    >
      {coverUrl && !coverFailed ? (
        <img className="w-14 mr-5" src={coverUrl} alt={bookDetail?.title} onError={onCoverError} />
      ) : (
        <BookCoverFallback className="w-14 h-20 mr-5" title={bookDetail?.title} />
      )}
      <div className="text-left">
        <div className="text-lg text-text-color-1 font-medium break-all">{bookDetail?.title}</div>
        <div className="text-sm text-text-color-2 font-medium mt-1 break-all">{bookDetail?.author}</div>
      </div>
    </button>
  );
};
