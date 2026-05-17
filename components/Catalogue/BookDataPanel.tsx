import { type ComponentType, type SVGProps, useCallback, useEffect, useMemo, useState } from 'react';
import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import { BookCoverFallback } from '@/components/BookCard';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/Catalogue/BookDataPanelIcons';
import { buildBookDataPanelData, getMonthBarWidth } from '@/components/Catalogue/bookDataPanelData';
import { OcticonBookFinished, OcticonBookRead, OcticonBookReading } from '@/components/Octicon';
import { t } from '@/locales';
import { createSingleBookBackup, downloadBlob } from '@/lib/backup/exportBackup';
import { showGlobalFallback } from '@/lib/globalFallback';
import {
  type ReaderBookStatus,
  getReaderBookStatus,
  setReaderBookStatus,
  useReaderBookStatusRevision,
} from '@/lib/readerBookStatus';

interface BookDataPanelProps {
  bookDetail: BookInfo | null;
  coverFailed: boolean;
  coverUrl?: string;
  onClose: () => void;
  onCoverError: () => void;
  open: boolean;
  revision: number;
  textSyntaxTree: TextSyntaxTree;
}

const PANEL_MOTION_DURATION = 180;

const DurationValue = ({
  duration,
}: {
  duration: {
    hours: number;
    minutes: number;
  };
}): React.JSX.Element => (
  <div className="flex items-baseline gap-[2px]">
    {duration.hours > 0 ? (
      <>
        <span className="reader-catalog-data-value text-[22px] font-bold">{duration.hours}</span>
        <span className="reader-catalog-data-unit text-[12px] font-normal mr-0.5">{t('common.hour')}</span>
      </>
    ) : null}
    <span className="reader-catalog-data-value text-[22px] font-bold">{duration.minutes}</span>
    <span className="reader-catalog-data-unit text-[12px] font-normal">{t('common.minute')}</span>
  </div>
);

const READER_BOOK_STATUS_BUTTONS: Array<{
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  status: ReaderBookStatus;
}> = [
  { Icon: OcticonBookReading, label: 'shelf.reading', status: 'reading' },
  { Icon: OcticonBookRead, label: 'shelf.read', status: 'read' },
  { Icon: OcticonBookFinished, label: 'shelf.finished', status: 'finished' },
];

export const BookDataPanel = ({
  bookDetail,
  coverFailed,
  coverUrl,
  onClose,
  onCoverError,
  open,
  revision,
  textSyntaxTree,
}: BookDataPanelProps): React.JSX.Element | null => {
  const [shouldRender, setShouldRender] = useState(open);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [animateBars, setAnimateBars] = useState(true);
  const statusRevision = useReaderBookStatusRevision();

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setExpandedMonth(null);
      return;
    }
    const timer = window.setTimeout(() => setShouldRender(false), PANEL_MOTION_DURATION);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  const bookData = useMemo(() => {
    if (!shouldRender || !bookDetail) return null;
    return buildBookDataPanelData(bookDetail, textSyntaxTree);
  }, [bookDetail, revision, shouldRender, textSyntaxTree]);
  const currentBookStatus = useMemo(() => getReaderBookStatus(bookDetail?.id), [bookDetail?.id, statusRevision]);

  useEffect(() => {
    if (!bookData) return;
    setExpandedMonth((current) => {
      if (bookData.monthlyRecords.length === 0) return null;
      if (current !== null && current >= bookData.monthlyRecords.length) return null;
      return current;
    });
  }, [bookData]);

  const handleExpand = useCallback((index: number) => {
    setExpandedMonth((current) => (current === index ? null : index));
    setAnimateBars(false);
    window.setTimeout(() => setAnimateBars(true), 50);
  }, []);

  const toggleBookStatus = useCallback(
    (status: ReaderBookStatus) => {
      if (!bookDetail?.id) return;
      setReaderBookStatus(bookDetail.id, currentBookStatus === status ? undefined : status);
    },
    [bookDetail?.id, currentBookStatus],
  );

  const exportCurrentBook = useCallback(
    (includeBook: boolean) => {
      if (!bookDetail?.id) return;
      void createSingleBookBackup({ bookId: bookDetail.id, includeBook })
        .then(({ blob, fileName }) => {
          downloadBlob(blob, fileName);
          showGlobalFallback({
            message: includeBook ? t('book_data.exported_full_backup') : t('book_data.exported_user_backup'),
            tone: 'success',
          });
        })
        .catch((error: unknown) => {
          showGlobalFallback({ message: error instanceof Error ? error.message : t('book_data.export_failed'), tone: 'error' });
        });
    },
    [bookDetail?.id],
  );

  const stopPanelEvent = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  const closeFromBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.currentTarget === event.target) {
        onClose();
      }
    },
    [onClose],
  );

  if (!shouldRender || !bookData) return null;

  return (
    <div className="reader-catalog-data-overlay" data-state={open ? 'open' : 'closed'} onMouseDown={closeFromBackdrop}>
      <div
        className="reader-catalog-data-sheet w-full shadow-2xl overflow-hidden relative"
        onMouseDown={stopPanelEvent}
      >
        <div className="p-6 pb-5">
          <div className="flex justify-between items-start mb-6 mt-2">
            <div className="flex-1 pr-6 flex flex-col justify-between min-w-0">
              <h2 className="reader-catalog-data-title text-[20px] font-bold leading-snug tracking-wide line-clamp-2">
                {bookData.title}
              </h2>
              <div className="reader-catalog-data-muted mt-3 text-[13px]">
                {t('book_data.last_read', [bookData.lastRead])}
              </div>
              <div className="reader-catalog-data-status-group" aria-label={t('book_data.mark_reading_status')}>
                {READER_BOOK_STATUS_BUTTONS.map(({ Icon, label, status }) => {
                  const active = currentBookStatus === status;
                  return (
                    <button
                      aria-pressed={active}
                      className={`reader-catalog-data-status-button ${active ? 'is-active' : ''}`}
                      key={status}
                      type="button"
                      onClick={() => toggleBookStatus(status)}
                    >
                      <Icon />
                      <span>{t(label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="reader-catalog-data-cover w-[72px] h-[100px] flex-shrink-0 rounded shadow-md overflow-hidden border">
              {coverUrl && !coverFailed ? (
                <img
                  className="w-full h-full object-cover"
                  src={coverUrl}
                  alt={bookData.title}
                  onError={onCoverError}
                />
              ) : (
                <BookCoverFallback className="w-full h-full" title={bookData.title} />
              )}
            </div>
          </div>

          <div className="reader-catalog-data-card rounded-[16px] p-5 mb-4">
            <div className="flex justify-around mb-2 mt-1">
              <div className="flex flex-col items-center justify-center px-1">
                <span className="reader-catalog-data-label text-[13px] mb-1">{t('book_data.total_words')}</span>
                <div className="flex items-baseline gap-[2px]">
                  <span className="reader-catalog-data-value text-[26px] font-semibold">{bookData.totalWords.value}</span>
                  <span className="reader-catalog-data-unit text-[12px] font-normal">{bookData.totalWords.unit}</span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-1">
                <span className="reader-catalog-data-label text-[13px] mb-1">{t('book_data.reading_days')}</span>
                <div className="flex items-baseline gap-[2px]">
                  <span className="reader-catalog-data-value text-[26px] font-semibold">{bookData.readingDays}</span>
                  <span className="reader-catalog-data-unit text-[12px] font-normal">{t('common.day')}</span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-1">
                <span className="reader-catalog-data-label text-[13px] mb-1">{t('book_data.reading_progress')}</span>
                <div className="flex items-baseline gap-[2px]">
                  <span className="reader-catalog-data-value text-[26px] font-semibold">{bookData.readPercent}</span>
                  <span className="reader-catalog-data-unit text-[12px] font-normal">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="reader-catalog-data-card rounded-[16px] p-5">
            <div className="flex justify-between mb-6 px-1">
              <div className="flex-1 min-w-0">
                <div className="reader-catalog-data-label text-[13px] mb-1">{t('book_data.total_duration')}</div>
                <DurationValue duration={bookData.totalDuration} />
                <div className="reader-catalog-data-subtle text-[11px] mt-1">{bookData.startLabel}</div>
              </div>

              <div className="flex-1 pl-6 min-w-0">
                <div className="reader-catalog-data-label text-[13px] mb-1">{t('book_data.max_daily_reading')}</div>
                <DurationValue duration={bookData.maxDailyDuration} />
                <div className="reader-catalog-data-subtle text-[11px] mt-1">{bookData.maxDailyDate}</div>
              </div>
            </div>

            {bookData.showReadingRecords ? (
              <div className="space-y-2 mt-2">
                {bookData.monthlyRecords.length > 0 ? (
                  bookData.monthlyRecords.map((record, index) => {
                    const isExpanded = expandedMonth === index;
                    const isAnyExpanded = expandedMonth !== null;
                    const barWidth = `${getMonthBarWidth({
                      isAnyExpanded,
                      isExpanded,
                      progress: record.calculatedProgress,
                    })}%`;

                    return (
                      <div className="flex flex-col" key={record.monthKey}>
                        {isExpanded ? (
                          <div className="flex justify-between items-center px-1 mb-1 mt-1">
                            <div className="reader-catalog-data-month-summary text-[14px]">
                              <span className="font-bold">{record.month}</span>
                              <span className="mx-1">·</span>
                              <span className="font-bold">{record.time}</span>
                            </div>
                            <button
                              className="reader-catalog-data-icon-button w-7 h-7 flex items-center justify-center rounded-full transition-colors"
                              type="button"
                              onClick={() => handleExpand(index)}
                            >
                              <ChevronUpIcon />
                            </button>
                          </div>
                        ) : (
                          <button
                            className="reader-catalog-data-month-row relative w-full h-[28px] rounded-[6px] flex items-center px-3 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden text-left"
                            type="button"
                            onClick={() => handleExpand(index)}
                          >
                            <div
                              className="reader-catalog-data-month-bar absolute left-0 top-0 bottom-0 rounded-[6px] transition-[width] duration-300 ease-out"
                              style={{ width: barWidth }}
                            ></div>

                            <div className="reader-catalog-data-bar-text relative z-10 w-full flex justify-between items-center text-[14px]">
                              <div>
                                <span className="font-bold">{record.month}</span>
                                <span className="mx-1">·</span>
                                <span className="font-bold">{record.time}</span>
                              </div>
                              <ChevronDownIcon />
                            </div>
                          </button>
                        )}

                        <div
                          className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${
                            isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2 mb-1' : 'grid-rows-[0fr] opacity-0 mt-0 mb-0'
                          }`}
                        >
                          <div className="overflow-hidden space-y-2">
                            {record.days.map((day) => {
                              const dayBarWidth = isExpanded && animateBars ? `${day.calculatedProgress}%` : '0%';

                              return (
                                <div
                                  className="reader-catalog-data-day-row relative w-full h-[28px] rounded-[6px]"
                                  key={day.dayKey}
                                >
                                  <div
                                    className="reader-catalog-data-day-bar absolute left-0 top-0 bottom-0 rounded-[6px] transition-[width] duration-[300ms] ease-out overflow-hidden"
                                    style={{ width: dayBarWidth }}
                                  >
                                    <div className="h-full w-full flex justify-between items-center px-3">
                                      <span className="reader-catalog-data-bar-text text-[13px] font-medium whitespace-nowrap">
                                        {day.date}
                                      </span>
                                      <span className="reader-catalog-data-bar-text text-[13px] font-bold whitespace-nowrap">
                                        {day.time}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="reader-catalog-data-empty h-[44px] flex items-center justify-center text-[13px]">
                    {t('book_data.no_reading_records')}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2">
          <button
            className="reader-catalog-data-button reader-catalog-data-button-secondary flex-1 py-[14px] rounded-[12px] font-medium text-[15px] transition-colors"
            type="button"
            onClick={() => exportCurrentBook(false)}
          >
            {t('book_data.export_user_data')}
          </button>
          <button
            className="reader-catalog-data-button reader-catalog-data-button-primary flex-1 py-[14px] rounded-[12px] font-medium text-[15px] transition-colors shadow-lg shadow-blue-500/20"
            type="button"
            onClick={() => exportCurrentBook(true)}
          >
            {t('book_data.export_full_book')}
          </button>
        </div>
      </div>
    </div>
  );
};
