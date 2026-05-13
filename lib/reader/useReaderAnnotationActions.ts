import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_READER_ANNOTATION_COLOR,
  type ReaderAnnotation,
  type ReaderAnnotationDraft,
  type ReaderStyleAnnotationType,
  createReaderAnnotationGroupId,
  deleteReaderAnnotation,
  deleteReaderAnnotations,
  getStoredReaderAnnotationColor,
  isReaderStyleAnnotationType,
  saveReaderAnnotation,
  saveReaderAnnotationColor,
  updateReaderAnnotation,
} from '@/lib/readerAnnotations';
import { requestBookDetailMenuSearch } from '@/components/DetailMenu';
import type { ReaderAnnotationColorMap, ReaderSelectionMenuState } from '@/lib/reader/selectionUtils';

export interface ReaderNoteEditorState {
  annotation?: ReaderAnnotation;
  drafts: ReaderAnnotationDraft[];
  noteText: string;
  quote: string;
}

const getStoredReaderAnnotationColorMap = (): ReaderAnnotationColorMap => ({
  marker: getStoredReaderAnnotationColor('marker'),
  underline: getStoredReaderAnnotationColor('underline'),
  wave: getStoredReaderAnnotationColor('wave'),
});

export const useReaderAnnotationActions = ({
  bookId,
  clearSelection,
  selectionMenuState,
}: {
  bookId?: string;
  clearSelection: () => void;
  selectionMenuState: ReaderSelectionMenuState | null;
}): {
  annotationColors: ReaderAnnotationColorMap;
  handleApplyAnnotation: (type: ReaderStyleAnnotationType, color?: string) => ReaderAnnotation[];
  handleCancelNote: () => void;
  handleDeleteAnnotation: (annotationIds?: string[]) => void;
  handleDeleteNote: () => void;
  handleOpenNote: () => void;
  handleSaveNote: (noteText: string) => void;
  handleSearchSelection: (keyword: string) => void;
  handleSelectColor: (type: ReaderStyleAnnotationType, color: string) => void;
  noteEditorState: ReaderNoteEditorState | null;
} => {
  const [annotationColors, setAnnotationColors] = useState<ReaderAnnotationColorMap>(getStoredReaderAnnotationColorMap);
  const [noteEditorState, setNoteEditorState] = useState<ReaderNoteEditorState | null>(null);

  useEffect(() => {
    const styleAnnotation = selectionMenuState?.styleAnnotation;
    if (styleAnnotation?.color && isReaderStyleAnnotationType(styleAnnotation.type)) {
      setAnnotationColors((prev) => ({ ...prev, [styleAnnotation.type]: styleAnnotation.color }));
    }
  }, [selectionMenuState?.styleAnnotation]);

  const handleSelectColor = useCallback(
    (type: ReaderStyleAnnotationType, color: string) => {
      setAnnotationColors((prev) => ({ ...prev, [type]: color }));
      saveReaderAnnotationColor(color, type);
      if (bookId && selectionMenuState?.styleAnnotation) {
        const styleAnnotationIds = selectionMenuState.styleAnnotationIds?.length
          ? selectionMenuState.styleAnnotationIds
          : [selectionMenuState.styleAnnotation.id];
        styleAnnotationIds.forEach((annotationId) => {
          updateReaderAnnotation(bookId, annotationId, { color });
        });
      }
    },
    [bookId, selectionMenuState],
  );

  const handleApplyAnnotation = useCallback(
    (type: ReaderStyleAnnotationType, color?: string) => {
      if (!bookId || !selectionMenuState) return [];
      const nextColor = color || annotationColors[type];
      const appliedAnnotations: ReaderAnnotation[] = [];
      const groupId =
        selectionMenuState.drafts.length > 1 && !selectionMenuState.styleAnnotation
          ? createReaderAnnotationGroupId()
          : selectionMenuState.styleAnnotation?.groupId;

      if (selectionMenuState.styleAnnotation) {
        selectionMenuState.drafts.forEach((draft) => {
          const annotation = saveReaderAnnotation(
            bookId,
            draft,
            type,
            nextColor,
            undefined,
            selectionMenuState.styleAnnotation?.id,
            groupId,
          );
          if (annotation) appliedAnnotations.push(annotation);
        });
      } else {
        selectionMenuState.drafts.forEach((draft) => {
          const annotation = saveReaderAnnotation(bookId, draft, type, nextColor, undefined, undefined, groupId);
          if (annotation) appliedAnnotations.push(annotation);
        });
      }
      return appliedAnnotations;
    },
    [annotationColors, bookId, selectionMenuState],
  );

  const handleDeleteAnnotation = useCallback(
    (annotationIds?: string[]) => {
      const targetAnnotationIds = annotationIds?.length ? annotationIds : selectionMenuState?.styleAnnotationIds;
      if (bookId && targetAnnotationIds?.length) {
        deleteReaderAnnotations(bookId, targetAnnotationIds);
      } else if (bookId && selectionMenuState?.styleAnnotation) {
        deleteReaderAnnotation(bookId, selectionMenuState.styleAnnotation.id);
      }
      clearSelection();
    },
    [bookId, clearSelection, selectionMenuState],
  );

  const handleDeleteNote = useCallback(() => {
    if (bookId && selectionMenuState?.noteAnnotation) {
      deleteReaderAnnotation(bookId, selectionMenuState.noteAnnotation.id);
    }
    clearSelection();
  }, [bookId, clearSelection, selectionMenuState?.noteAnnotation]);

  const handleOpenNote = useCallback(() => {
    if (!selectionMenuState) return;
    setNoteEditorState({
      annotation: selectionMenuState.noteAnnotation,
      drafts: selectionMenuState.drafts,
      noteText: selectionMenuState.noteAnnotation?.noteText || '',
      quote: (selectionMenuState.noteAnnotation?.text || selectionMenuState.text).trim(),
    });
  }, [selectionMenuState]);

  const handleSearchSelection = useCallback(
    (keyword: string) => {
      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) return;
      requestBookDetailMenuSearch(normalizedKeyword);
      clearSelection();
    },
    [clearSelection],
  );

  const handleCancelNote = useCallback(() => {
    setNoteEditorState(null);
    clearSelection();
  }, [clearSelection]);

  const handleSaveNote = useCallback(
    (noteText: string) => {
      if (!bookId || !noteEditorState) return;

      if (noteEditorState.annotation) {
        updateReaderAnnotation(bookId, noteEditorState.annotation.id, {
          color: DEFAULT_READER_ANNOTATION_COLOR,
          noteText,
        });
      } else {
        noteEditorState.drafts.forEach((draft) => {
          saveReaderAnnotation(bookId, draft, 'note', DEFAULT_READER_ANNOTATION_COLOR, noteText);
        });
      }
      setNoteEditorState(null);
      clearSelection();
    },
    [bookId, clearSelection, noteEditorState],
  );

  return {
    annotationColors,
    handleApplyAnnotation,
    handleCancelNote,
    handleDeleteAnnotation,
    handleDeleteNote,
    handleOpenNote,
    handleSaveNote,
    handleSearchSelection,
    handleSelectColor,
    noteEditorState,
  };
};
