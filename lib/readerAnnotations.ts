import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import type { ReaderBlock, TextSyntaxTree } from '@/lib/transformText';

export type ReaderAnnotationType = 'marker' | 'note' | 'underline' | 'wave';

export type ReaderStyleAnnotationType = Exclude<ReaderAnnotationType, 'note'>;

export interface ReaderAnnotation {
  id: string;
  bookId: string;
  blockId: string;
  color: string;
  createdAt: number;
  endOffset: number;
  noteText?: string;
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

export const READER_ANNOTATION_COLORS = ['#ff909c', '#b89fff', '#74b4ff', '#70d382', '#ffcb7e'] as const;

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

const canUseStorage = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readAnnotationMap = (): Record<string, ReaderAnnotation[]> => {
  if (!canUseStorage()) return {};
  try {
    const value = window.localStorage.getItem(ANNOTATION_STORAGE_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, ReaderAnnotation[]>;
  } catch {
    return {};
  }
};

const writeAnnotationMap = (value: Record<string, ReaderAnnotation[]>): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(ANNOTATION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore restricted storage contexts.
  }
};

const emitAnnotationChange = (): void => {
  syncHook.call(EVENT_NAME.SET_READER_ANNOTATIONS);
};

const normalizeRange = (startOffset: number, endOffset: number, textLength: number): { start: number; end: number } => {
  const start = Math.min(Math.max(Math.floor(startOffset), 0), Math.max(textLength, 0));
  const end = Math.min(Math.max(Math.floor(endOffset), 0), Math.max(textLength, 0));
  return start <= end ? { start, end } : { start: end, end: start };
};

const createAnnotationId = (): string => {
  if (typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const getReaderAnnotations = (bookId?: string | null): ReaderAnnotation[] => {
  if (!bookId) return [];
  return [...(readAnnotationMap()[bookId] || [])].sort((a, b) => {
    if ((a.titleId ?? 0) !== (b.titleId ?? 0)) return (a.titleId ?? 0) - (b.titleId ?? 0);
    if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId);
    return a.startOffset - b.startOffset || a.createdAt - b.createdAt;
  });
};

export const getReaderAnnotationsByBlock = (bookId: string | undefined, blockId: string): ReaderAnnotation[] => {
  return getReaderAnnotations(bookId).filter((annotation) => annotation.blockId === blockId);
};

export const saveReaderAnnotation = (
  bookId: string,
  draft: ReaderAnnotationDraft,
  type: ReaderAnnotationType,
  color = type === 'note' ? DEFAULT_READER_ANNOTATION_COLOR : getStoredReaderAnnotationColor(type),
  noteText?: string,
  existingId?: string,
): ReaderAnnotation | undefined => {
  const range = normalizeRange(draft.startOffset, draft.endOffset, draft.text.length);
  if (!bookId || range.start === range.end) return undefined;

  const map = readAnnotationMap();
  const list = map[bookId] || [];
  const now = Date.now();
  let annotation: ReaderAnnotation = {
    id: existingId || createAnnotationId(),
    bookId,
    blockId: draft.blockId,
    color,
    createdAt: existingId ? list.find((item) => item.id === existingId)?.createdAt ?? now : now,
    endOffset: range.end,
    noteText: noteText?.trim() || undefined,
    startOffset: range.start,
    text: draft.text.slice(range.start, range.end),
    titleId: draft.titleId,
    type,
    updatedAt: now,
  };

  let nextList = list.filter((item) => item.id !== annotation.id);
  if (type !== 'note') {
    const mergedItems = nextList.filter((item) => {
      return (
        item.blockId === annotation.blockId &&
        item.type !== 'note' &&
        item.endOffset > annotation.startOffset &&
        item.startOffset < annotation.endOffset
      );
    });

    if (mergedItems.length > 0) {
      const mergedStart = Math.min(annotation.startOffset, ...mergedItems.map((item) => item.startOffset));
      const mergedEnd = Math.max(annotation.endOffset, ...mergedItems.map((item) => item.endOffset));
      annotation = {
        ...annotation,
        createdAt: Math.min(annotation.createdAt, ...mergedItems.map((item) => item.createdAt)),
        endOffset: mergedEnd,
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
  if (!canUseStorage()) return defaultColor;
  const value = window.localStorage.getItem(getColorStorageKey(type));
  return READER_ANNOTATION_COLORS.includes(value as (typeof READER_ANNOTATION_COLORS)[number])
    ? value || defaultColor
    : defaultColor;
};

export const saveReaderAnnotationColor = (color: string, type?: ReaderStyleAnnotationType): void => {
  if (!canUseStorage()) return;
  const defaultColor = getDefaultReaderAnnotationColor(type);
  const normalized = READER_ANNOTATION_COLORS.includes(color as (typeof READER_ANNOTATION_COLORS)[number])
    ? color
    : defaultColor;
  window.localStorage.setItem(getColorStorageKey(type), normalized);
};

export const getAnnotationBlock = (
  textSyntaxTree: TextSyntaxTree,
  annotation: Pick<ReaderAnnotation, 'blockId'>,
): ReaderBlock | undefined => {
  return textSyntaxTree.blocks.find((block) => block.id === annotation.blockId);
};
