import React, { type CSSProperties } from 'react';
import { type ReaderAnnotation, type ReaderAnnotationDraft, isReaderStyleAnnotationType } from '@/lib/readerAnnotations';
import { renderHighlightedText } from '@/lib/reader/searchHighlight';

// Older annotations do not have groupId; multi-block writes happen synchronously in one menu action.
export const LEGACY_STYLE_ANNOTATION_GROUP_TIME_WINDOW = 1000;

export const createAnnotationDraft = (
  annotation: ReaderAnnotation,
  blockText = annotation.text,
): ReaderAnnotationDraft => ({
  blockId: annotation.blockId,
  endOffset: annotation.endOffset,
  startOffset: annotation.startOffset,
  text: blockText,
  titleId: annotation.titleId,
});

export const getRelatedStyleAnnotationIds = (
  styleAnnotation: ReaderAnnotation,
  annotations: ReaderAnnotation[],
): string[] => {
  const relatedAnnotations = styleAnnotation.groupId
    ? annotations.filter(
        (annotation) => isReaderStyleAnnotationType(annotation.type) && annotation.groupId === styleAnnotation.groupId,
      )
    : annotations.filter((annotation) => {
        return (
          annotation.type === styleAnnotation.type &&
          annotation.bookId === styleAnnotation.bookId &&
          Math.abs(annotation.createdAt - styleAnnotation.createdAt) <= LEGACY_STYLE_ANNOTATION_GROUP_TIME_WINDOW
        );
      });
  const ids = relatedAnnotations.map((annotation) => annotation.id);
  return ids.includes(styleAnnotation.id) ? ids : [styleAnnotation.id, ...ids];
};

export interface ReaderAnnotationSegment {
  end: number;
  noteAnnotation?: ReaderAnnotation;
  start: number;
  styleAnnotation?: ReaderAnnotation;
}

export const getBlockAnnotationSegments = (
  text: string,
  annotations: ReaderAnnotation[],
): ReaderAnnotationSegment[] => {
  if (annotations.length === 0) return [{ start: 0, end: text.length }];

  const points = new Set<number>([0, text.length]);
  const normalizedAnnotations = annotations
    .map((annotation) => ({
      ...annotation,
      endOffset: Math.min(Math.max(annotation.endOffset, 0), text.length),
      startOffset: Math.min(Math.max(annotation.startOffset, 0), text.length),
    }))
    .filter((annotation) => {
      if (annotation.startOffset >= annotation.endOffset) return false;
      return text.slice(annotation.startOffset, annotation.endOffset) === annotation.text;
    });

  normalizedAnnotations.forEach((annotation) => {
    points.add(annotation.startOffset);
    points.add(annotation.endOffset);
  });

  const sortedPoints = Array.from(points).sort((a, b) => a - b);
  const segments: ReaderAnnotationSegment[] = [];

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const start = sortedPoints[i];
    const end = sortedPoints[i + 1];
    if (start === end) continue;
    const styleAnnotation = normalizedAnnotations
      .filter(
        (annotation) =>
          isReaderStyleAnnotationType(annotation.type) && annotation.startOffset < end && annotation.endOffset > start,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const noteAnnotation = normalizedAnnotations
      .filter(
        (annotation) => annotation.type === 'note' && annotation.startOffset < end && annotation.endOffset > start,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    segments.push({ end, noteAnnotation, start, styleAnnotation });
  }

  return segments.length > 0 ? segments : [{ start: 0, end: text.length }];
};

export const getAnnotationClassName = ({
  noteAnnotation,
  styleAnnotation,
}: Pick<ReaderAnnotationSegment, 'noteAnnotation' | 'styleAnnotation'>): string => {
  const classNames = ['reader-annotation'];
  if (styleAnnotation) {
    classNames.push(`reader-annotation-${styleAnnotation.type}`);
  }
  if (noteAnnotation) {
    classNames.push('reader-annotation-note');
  }
  return classNames.join(' ');
};

export const hasAnnotationSegment = (segment: ReaderAnnotationSegment): boolean => {
  return Boolean(segment.styleAnnotation || segment.noteAnnotation);
};

export const getPrimaryAnnotation = (segment: ReaderAnnotationSegment): ReaderAnnotation | undefined => {
  return segment.styleAnnotation || segment.noteAnnotation;
};

export const getSegmentKey = (segment: ReaderAnnotationSegment, index: number): string => {
  return `${segment.styleAnnotation?.id || 'plain'}-${segment.noteAnnotation?.id || 'note-empty'}-${segment.start}-${index}`;
};

export const renderTextWithAnnotations = (
  text: string,
  annotations: ReaderAnnotation[],
  searchKeyword: string,
  shouldHighlight: boolean,
): React.ReactNode => {
  if (annotations.length === 0) {
    return shouldHighlight ? renderHighlightedText(text, searchKeyword) : text;
  }

  return getBlockAnnotationSegments(text, annotations).map((segment, index) => {
    const segmentText = text.slice(segment.start, segment.end);
    const content =
      shouldHighlight && segmentText.includes(searchKeyword)
        ? renderHighlightedText(segmentText, searchKeyword)
        : segmentText;
    if (!hasAnnotationSegment(segment)) return <span key={`plain-${segment.start}-${index}`}>{content}</span>;

    const primaryAnnotation = getPrimaryAnnotation(segment);
    const annotationColor = segment.styleAnnotation?.color || segment.noteAnnotation?.color;

    return (
      <span
        className={getAnnotationClassName(segment)}
        data-reader-annotation-id={primaryAnnotation?.id}
        data-reader-note-annotation-id={segment.noteAnnotation?.id}
        data-reader-style-annotation-id={segment.styleAnnotation?.id}
        key={getSegmentKey(segment, index)}
        style={{ '--reader-annotation-color': annotationColor } as CSSProperties}
      >
        {content}
      </span>
    );
  });
};
