import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import { t } from '@/locales';
import { getReaderProgress } from '@/lib/readerProgress';
import { getReaderReadingTimeSummary } from '@/lib/readerReadingTime';

interface ReadingDayRecord {
  date: string;
  dayKey: string;
  durationMs: number;
  time: string;
  totalMinutes: number;
}

interface ReadingMonthRecord {
  days: ReadingDayRecord[];
  durationMs: number;
  month: string;
  monthKey: string;
  time: string;
  totalMinutes: number;
}

export interface ProcessedReadingDayRecord extends ReadingDayRecord {
  calculatedProgress: number;
  ratioProgress: number;
}

export interface ProcessedReadingMonthRecord extends ReadingMonthRecord {
  calculatedProgress: number;
  days: ProcessedReadingDayRecord[];
  ratioProgress: number;
}

export interface BookDataPanelData {
  lastRead: string;
  maxDailyDate: string;
  maxDailyDuration: { hours: number; minutes: number };
  monthlyRecords: ProcessedReadingMonthRecord[];
  readPercent: string;
  readingDays: number;
  showReadingRecords: boolean;
  startLabel: string;
  title: string;
  totalDuration: { hours: number; minutes: number };
  totalWords: { unit: string; value: string };
}

const PROGRESS_BASE_PERCENT = 30;

const MIN_READING_RECORD_DURATION_MS = 60_000;

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const getRatioPercent = (value: number, base: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return 0;
  return clampPercent((value / base) * 100);
};

const getWeightedProgressPercent = (ratioPercent: number, basePercent = PROGRESS_BASE_PERCENT): number => {
  const safeBasePercent = clampPercent(basePercent);
  const safeRatioPercent = clampPercent(ratioPercent);
  return clampPercent(safeBasePercent + (safeRatioPercent / 100) * (100 - safeBasePercent));
};

export const getMonthBarWidth = ({
  isAnyExpanded,
  isExpanded,
  progress,
}: {
  isAnyExpanded: boolean;
  isExpanded: boolean;
  progress: number;
}): number => {
  if (isAnyExpanded && !isExpanded) return 100;
  return clampPercent(progress);
};

const getMinutesFromDuration = (durationMs: number): number => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.floor(durationMs / 60_000);
};

const formatDurationMinutes = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return t('common.duration_hours_minutes', [hours, minutes]);
  if (hours > 0) return t('common.duration_hours', [hours]);
  return t('common.duration_minutes', [minutes]);
};

const getDurationPartsFromMinutes = (totalMinutes: number): { hours: number; minutes: number } => ({
  hours: Math.floor(totalMinutes / 60),
  minutes: totalMinutes % 60,
});

const getDurationParts = (durationMs: number): { hours: number; minutes: number } => {
  return getDurationPartsFromMinutes(getMinutesFromDuration(durationMs));
};

const getLocalDateFromDayKey = (dayKey: string): Date => {
  const [year = '0', month = '1', day = '1'] = dayKey.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const formatMonthDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).format(date);
};

const formatDayKeyMonth = (dayKey: string): string => {
  const date = getLocalDateFromDayKey(dayKey);
  return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date);
};

const formatDayKeyDay = (dayKey: string): string => {
  const date = getLocalDateFromDayKey(dayKey);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(date);
};

const formatLastRead = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return t('book_data.never_read');
  const date = new Date(timestamp);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((todayStart - dateStart) / 86_400_000);
  if (dayDiff === 0) return t('common.today');
  if (dayDiff === 1) return t('common.yesterday');
  if (date.getFullYear() === today.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(date);
};

const formatWordCount = (rawText: string): { unit: string; value: string } => {
  const count = rawText.replace(/\s/g, '').length;
  if (count >= 10_000) {
    return {
      unit: t('common.ten_thousand'),
      value: (count / 10_000).toFixed(1).replace(/\.0$/, ''),
    };
  }
  return {
    unit: t('common.word'),
    value: String(count),
  };
};

const formatReadPercent = (value: number | undefined): string => {
  if (!Number.isFinite(value)) return '0';
  return `${Math.round(Math.min(Math.max(value || 0, 0), 100))}`;
};

const buildMonthlyRecords = (bookId?: string): ReadingMonthRecord[] => {
  if (!bookId) return [];
  const summary = getReaderReadingTimeSummary(bookId);
  const monthMap = new Map<string, ReadingMonthRecord>();

  summary.daily
    .filter((record) => record.durationMs >= MIN_READING_RECORD_DURATION_MS)
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
    .forEach((record) => {
      const monthKey = record.dayKey.slice(0, 7);
      const previous = monthMap.get(monthKey);
      const totalMinutes = getMinutesFromDuration(record.durationMs);
      const day: ReadingDayRecord = {
        date: formatDayKeyDay(record.dayKey),
        dayKey: record.dayKey,
        durationMs: totalMinutes * 60_000,
        time: formatDurationMinutes(totalMinutes),
        totalMinutes,
      };
      if (previous) {
        previous.durationMs += day.durationMs;
        previous.totalMinutes += day.totalMinutes;
        previous.time = formatDurationMinutes(previous.totalMinutes);
        previous.days.push(day);
        return;
      }
      monthMap.set(monthKey, {
        days: [day],
        durationMs: day.durationMs,
        month: formatDayKeyMonth(record.dayKey),
        monthKey,
        time: formatDurationMinutes(day.totalMinutes),
        totalMinutes: day.totalMinutes,
      });
    });

  return Array.from(monthMap.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
};

const buildProcessedMonthlyRecords = (monthlyRecords: ReadingMonthRecord[]): ProcessedReadingMonthRecord[] => {
  const maxMonthMinutes = Math.max(0, ...monthlyRecords.map((record) => record.totalMinutes));
  return monthlyRecords.map((record) => {
    const maxDayMinutes = Math.max(0, ...record.days.map((day) => day.totalMinutes));
    const monthRatioProgress = getRatioPercent(record.totalMinutes, maxMonthMinutes);
    return {
      ...record,
      calculatedProgress: getWeightedProgressPercent(monthRatioProgress),
      days: record.days.map((day) => {
        const ratioProgress = getRatioPercent(day.totalMinutes, maxDayMinutes);
        return {
          ...day,
          calculatedProgress: getWeightedProgressPercent(ratioProgress),
          ratioProgress,
        };
      }),
      ratioProgress: monthRatioProgress,
    };
  });
};

export const buildBookDataPanelData = (bookDetail: BookInfo, textSyntaxTree: TextSyntaxTree): BookDataPanelData => {
  const progress = getReaderProgress(bookDetail.id);
  const summary = getReaderReadingTimeSummary(bookDetail.id);
  const monthlyRecords = buildMonthlyRecords(bookDetail.id);
  const visibleDailyRecords = summary.daily.filter((record) => record.durationMs >= MIN_READING_RECORD_DURATION_MS);
  const sortedDaily = [...summary.daily]
    .filter((record) => record.durationMs >= MIN_READING_RECORD_DURATION_MS)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const maxDaily = [...visibleDailyRecords].sort((a, b) => b.durationMs - a.durationMs)[0];
  const totalDurationMs = Math.max(summary.totalMs, progress?.totalReadingMs || 0);
  const visibleTotalMinutes = monthlyRecords.reduce((sum, record) => sum + record.totalMinutes, 0);
  const displayTotalMinutes = visibleTotalMinutes > 0 ? visibleTotalMinutes : getMinutesFromDuration(totalDurationMs);
  const earliestDay = sortedDaily[0]?.dayKey;
  const wordCount = formatWordCount(textSyntaxTree.rawText || bookDetail.document?.rawText || '');

  return {
    lastRead: formatLastRead(progress?.lastReadAt || progress?.updatedAt),
    maxDailyDate: maxDaily?.durationMs
      ? formatMonthDay(getLocalDateFromDayKey(maxDaily.dayKey).getTime())
      : t('common.no_record'),
    maxDailyDuration: getDurationParts(maxDaily?.durationMs || 0),
    monthlyRecords: buildProcessedMonthlyRecords(monthlyRecords),
    readPercent: formatReadPercent(progress?.readPercent),
    readingDays: new Set(visibleDailyRecords.map((record) => record.dayKey)).size,
    showReadingRecords: visibleTotalMinutes > 0,
    startLabel: earliestDay
      ? t('book_data.started_reading', [formatMonthDay(getLocalDateFromDayKey(earliestDay).getTime())])
      : t('book_data.not_started'),
    title: bookDetail.title || t('common.unnamed_book'),
    totalDuration: getDurationPartsFromMinutes(displayTotalMinutes),
    totalWords: wordCount,
  };
};
