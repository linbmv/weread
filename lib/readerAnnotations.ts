import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import { clamp, createRandomId, safeReadStorage, safeWriteStorage } from '@/lib/utils';
import type { ReaderBlock, TextSyntaxTree } from '@/lib/transformText';

export type ReaderAnnotationType = 'bookmark' | 'marker' | 'note' | 'underline' | 'wave';

export type ReaderStyleAnnotationType = Exclude<ReaderAnnotationType, 'bookmark' | 'note'>;

export interface ReaderAnnotation {
  id: string;
  bookId: string;
  blockId: string;
  color: string;
  createdAt: number;
  endOffset: number;
  groupId?: string;
  noteText?: string;
  page?: number;
  startOffset: number;
  text: string;
  titleId?: number;
  type: ReaderAnnotationType;
  updatedAt: number;
}

export interface ReaderAnnotationDraft {
  blockId: string;
  endOffset: number;
  startOffset: number;
  text: string;
  titleId?: number;
}

export interface ReaderBookmarkDraft {
  blockId: string;
  page: number;
  startOffset?: number;
  text: string;
  titleId?: number;
}

export const READER_ANNOTATION_COLORS = ['#ff909c', '#b89fff', '#74b4ff', '#70d382', '#ffcb7e'] as const;

export const READER_BOOKMARK_COLOR = '#0097ff';

export const DEFAULT_READER_ANNOTATION_COLOR = READER_ANNOTATION_COLORS[4];

const DEFAULT_READER_STYLE_ANNOTATION_COLORS: Record<ReaderStyleAnnotationType, string> = {
  marker: READER_ANNOTATION_COLORS[4],
  underline: READER_ANNOTATION_COLORS[0],
  wave: READER_ANNOTATION_COLORS[2],
};

const ANNOTATION_STORAGE_KEY = 'weread-reader-annotations-v1';

const COLOR_STORAGE_KEY = 'weread-reader-annotation-color';

const getColorStorageKey = (type?: ReaderStyleAnnotationType): string => {
  return type ? `${COLOR_STORAGE_KEY}-${type}` : COLOR_STORAGE_KEY;
};

const getDefaultReaderAnnotationColor = (type?: ReaderStyleAnnotationType): string => {
  return type ? DEFAULT_READER_STYLE_ANNOTATION_COLORS[type] : DEFAULT_READER_ANNOTATION_COLOR;
};

export const isReaderStyleAnnotationType = (type: ReaderAnnotationType): type is ReaderStyleAnnotationType => {
  return type === 'marker' || type === 'underline' || type === 'wave';
};

const readAnnotationMap = (): Record<string, ReaderAnnotation[]> => {
  const value = safeReadStorage(ANNOTATION_STORAGE_KEY);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, ReaderAnnotation[]>;
  } catch {
    return {};
  }
};

const writeAnnotationMap = (value: Record<string, ReaderAnnotation[]>): void => {
  safeWriteStorage(ANNOTATION_STORAGE_KEY, JSON.stringify(value));
};

const emitAnnotationChange = (): void => {
  syncHook.call(EVENT_NAME.SET_READER_ANNOTATIONS);
};

const normalizeRange = (startOffset: number, endOffset: number, textLength: number): { start: number; end: number } => {
  const limit = Math.max(textLength, 0);
  const start = clamp(Math.floor(startOffset), 0, limit);
  const end = clamp(Math.floor(endOffset), 0, limit);
  return start <= end ? { start, end } : { start: end, end: start };
};

const createAnnotationId = (): string => createRandomId('annotation');

export const createReaderAnnotationGroupId = (): string => createRandomId('annotation-group');

const compareBlockId = (a: string, b: string): number => {
  const matchA = /(\d+)(?!.*\d)/u.exec(a);
  const matchB = /(\d+)(?!.*\d)/u.exec(b);
  const numericA = matchA ? Number(matchA[1]) : Number.NaN;
  const numericB = matchB ? Number(matchB[1]) : Number.NaN;
  if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) {
    return numericA - numericB;
  }
  return a.localeCompare(b);
};

export const getReaderAnnotations = (bookId?: string | null): ReaderAnnotation[] => {
  if (!bookId) return [];
  return [...(readAnnotationMap()[bookId] || [])].sort((a, b) => {
    if ((a.titleId ?? 0) !== (b.titleId ?? 0)) return (a.titleId ?? 0) - (b.titleId ?? 0);
    if (a.blockId !== b.blockId) return compareBlockId(a.blockId, b.blockId);
    return a.startOffset - b.startOffset || a.createdAt - b.createdAt;
  });
};

export const getReaderAnnotationsByBlock = (bookId: string | undefined, blockId: string): ReaderAnnotation[] => {
  return getReaderAnnotations(bookId).filter((annotation) => annotation.blockId === blockId);
};

export const deleteReaderAnnotationsForBook = (bookId?: string | null): void => {
  if (!bookId) return;
  const map = readAnnotationMap();
  if (!map[bookId]) return;
  delete map[bookId];
  writeAnnotationMap(map);
  emitAnnotationChange();
};

export const getReaderBookmarkForPage = (
  bookId: string | undefined | null,
  page: number,
): ReaderAnnotation | undefined => {
  if (!bookId || !Number.isFinite(page)) return undefined;
  return getReaderAnnotations(bookId).find((annotation) => annotation.type === 'bookmark' && annotation.page === page);
};

export const saveReaderBookmark = (bookId: string, draft: ReaderBookmarkDraft): ReaderAnnotation | undefined => {
  const text = draft.text.trim();
  if (!bookId || !draft.blockId || !text || !Number.isFinite(draft.page)) return undefined;

  const map = readAnnotationMap();
  const list = map[bookId] || [];
  const now = Date.now();
  const existing = list.find((annotation) => annotation.type === 'bookmark' && annotation.page === draft.page);
  const startOffset = clamp(Math.floor(draft.startOffset ?? 0), 0, Number.MAX_SAFE_INTEGER);
  const annotation: ReaderAnnotation = {
    id: existing?.id || createAnnotationId(),
    blockId: draft.blockId,
    bookId,
    color: READER_BOOKMARK_COLOR,
    createdAt: existing?.createdAt ?? now,
    endOffset: startOffset + text.length,
    page: draft.page,
    startOffset,
    text,
    titleId: draft.titleId,
    type: 'bookmark',
    updatedAt: now,
  };

  map[bookId] = [...list.filter((item) => item.id !== annotation.id), annotation];
  writeAnnotationMap(map);
  emitAnnotationChange();
  return annotation;
};

export const saveReaderAnnotation = (
  bookId: string,
  draft: ReaderAnnotationDraft,
  type: ReaderAnnotationType,
  color = isReaderStyleAnnotationType(type) ? getStoredReaderAnnotationColor(type) : DEFAULT_READER_ANNOTATION_COLOR,
  noteText?: string,
  existingId?: string,
  groupId?: string,
): ReaderAnnotation | undefined => {
  const range = normalizeRange(draft.startOffset, draft.endOffset, draft.text.length);
  if (!bookId || range.start === range.end) return undefined;

  const map = readAnnotationMap();
  const list = map[bookId] || [];
  const now = Date.now();
  const existingAnnotation = existingId ? list.find((item) => item.id === existingId) : undefined;
  let annotation: ReaderAnnotation = {
    id: existingId || createAnnotationId(),
    bookId,
    blockId: draft.blockId,
    color,
    createdAt: existingAnnotation?.createdAt ?? now,
    endOffset: range.end,
    groupId: groupId || existingAnnotation?.groupId,
    noteText: noteText?.trim() || undefined,
    startOffset: range.start,
    text: draft.text.slice(range.start, range.end),
    titleId: draft.titleId,
    type,
    updatedAt: now,
  };

  let nextList = list.filter((item) => item.id !== annotation.id);
  if (isReaderStyleAnnotationType(type)) {
    const mergedItems = nextList.filter((item) => {
      return (
        item.blockId === annotation.blockId &&
        isReaderStyleAnnotationType(item.type) &&
        item.endOffset > annotation.startOffset &&
        item.startOffset < annotation.endOffset
      );
    });

    if (mergedItems.length > 0) {
      const mergedStart = Math.min(annotation.startOffset, ...mergedItems.map((item) => item.startOffset));
      const mergedEnd = Math.max(annotation.endOffset, ...mergedItems.map((item) => item.endOffset));
      const mergedGroupIds = Array.from(new Set(mergedItems.map((item) => item.groupId).filter(Boolean)));
      annotation = {
        ...annotation,
        createdAt: Math.min(annotation.createdAt, ...mergedItems.map((item) => item.createdAt)),
        endOffset: mergedEnd,
        groupId: annotation.groupId || (mergedGroupIds.length === 1 ? mergedGroupIds[0] : undefined),
        startOffset: mergedStart,
        text: draft.text.slice(mergedStart, mergedEnd),
      };
      nextList = nextList.filter((item) => !mergedItems.some((mergedItem) => mergedItem.id === item.id));
    }
  }

  map[bookId] = [...nextList, annotation];
  writeAnnotationMap(map);
  emitAnnotationChange();
  return annotation;
};

export const updateReaderAnnotation = (
  bookId: string,
  annotationId: string,
  patch: Partial<Pick<ReaderAnnotation, 'color' | 'noteText' | 'type'>>,
): ReaderAnnotation | undefined => {
  const map = readAnnotationMap();
  const list = map[bookId] || [];
  let updated: ReaderAnnotation | undefined;
  map[bookId] = list.map((annotation) => {
    if (annotation.id !== annotationId) return annotation;
    updated = {
      ...annotation,
      ...patch,
      noteText: patch.noteText !== undefined ? patch.noteText.trim() || undefined : annotation.noteText,
      updatedAt: Date.now(),
    };
    return updated;
  });
  if (!updated) return undefined;
  writeAnnotationMap(map);
  emitAnnotationChange();
  return updated;
};

export const deleteReaderAnnotations = (bookId: string, annotationIds: string[]): void => {
  if (annotationIds.length === 0) return;
  const idSet = new Set(annotationIds);
  const map = readAnnotationMap();
  map[bookId] = (map[bookId] || []).filter((annotation) => !idSet.has(annotation.id));
  writeAnnotationMap(map);
  emitAnnotationChange();
};

export const deleteReaderAnnotation = (bookId: string, annotationId: string): void => {
  const map = readAnnotationMap();
  const next = (map[bookId] || []).filter((annotation) => annotation.id !== annotationId);
  map[bookId] = next;
  writeAnnotationMap(map);
  emitAnnotationChange();
};

export const getStoredReaderAnnotationColor = (type?: ReaderStyleAnnotationType): string => {
  const defaultColor = getDefaultReaderAnnotationColor(type);
  const value = safeReadStorage(getColorStorageKey(type));
  return READER_ANNOTATION_COLORS.includes(value as (typeof READER_ANNOTATION_COLORS)[number])
    ? value || defaultColor
    : defaultColor;
};

export const saveReaderAnnotationColor = (color: string, type?: ReaderStyleAnnotationType): void => {
  const defaultColor = getDefaultReaderAnnotationColor(type);
  const normalized = READER_ANNOTATION_COLORS.includes(color as (typeof READER_ANNOTATION_COLORS)[number])
    ? color
    : defaultColor;
  safeWriteStorage(getColorStorageKey(type), normalized);
};

export const getAnnotationBlock = (
  textSyntaxTree: TextSyntaxTree,
  annotation: Pick<ReaderAnnotation, 'blockId'>,
): ReaderBlock | undefined => {
  return textSyntaxTree.blocks.find((block) => block.id === annotation.blockId);
};
