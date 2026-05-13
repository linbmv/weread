import { useEffect, useState } from 'react';
import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import { type ReaderAnnotation, getReaderAnnotations } from '@/lib/readerAnnotations';

export const useReaderAnnotationsForBook = (bookId: string | undefined): ReaderAnnotation[] => {
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>(() => getReaderAnnotations(bookId));
  useEffect(() => {
    const updateAnnotations = () => {
      setAnnotations(getReaderAnnotations(bookId));
    };
    updateAnnotations();
    syncHook.tap(EVENT_NAME.SET_READER_ANNOTATIONS, updateAnnotations);
    return () => {
      syncHook.off(EVENT_NAME.SET_READER_ANNOTATIONS, updateAnnotations);
    };
  }, [bookId]);
  return annotations;
};
