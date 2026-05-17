import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import type { ReaderAnnotation } from '@/lib/readerAnnotations';
import type { ReaderBlock } from '@/lib/transformText';
import { renderTextWithAnnotations } from '@/lib/reader/annotationRendering';
import { t } from '@/locales';

export const ReaderImageBlock = ({
  block,
  bookId,
  onImageSettled,
}: {
  block: ReaderBlock;
  bookId?: string;
  onImageSettled?: (blockId: string) => void;
}): React.JSX.Element => {
  const resolvedSrc = useResolvedBookImage(bookId, block.src);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [block.src, bookId]);

  useEffect(() => {
    if (!onImageSettled) return;
    if (!resolvedSrc || imageFailed) {
      onImageSettled(block.id);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (imageRef.current?.complete) {
        onImageSettled(block.id);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [block.id, imageFailed, onImageSettled, resolvedSrc]);

  const handleImageSettled = useCallback(
    (event?: React.SyntheticEvent<HTMLImageElement>) => {
      if (event?.currentTarget) {
        event.currentTarget.dataset.readerImageSettled = 'true';
      }
      if (event?.type === 'error') {
        setImageFailed(true);
      }
      onImageSettled?.(block.id);
    },
    [block.id, onImageSettled],
  );

  return (
    <figure
      className="reader-content-block reader-content-image"
      data-reader-block-id={block.id}
      data-reader-title-id={block.titleId}
      key={block.id}
    >
      {resolvedSrc && !imageFailed ? (
        <img
          alt={block.alt || ''}
          ref={imageRef}
          src={resolvedSrc}
          onError={handleImageSettled}
          onLoad={handleImageSettled}
        />
      ) : (
        <div className="reader-content-image-fallback" data-reader-image-settled="true">
          {t('reader.image_load_failed')}
        </div>
      )}
    </figure>
  );
};

export const renderReaderBlock = (
  block: ReaderBlock,
  {
    annotations = [],
    bookId,
    onImageSettled,
    searchKeyword,
    shouldHighlight,
  }: {
    annotations?: ReaderAnnotation[];
    bookId?: string;
    onImageSettled?: (blockId: string) => void;
    searchKeyword: string;
    shouldHighlight: boolean;
  },
): React.ReactNode => {
  if (block.type === 'image') {
    return <ReaderImageBlock block={block} bookId={bookId} key={block.id} onImageSettled={onImageSettled} />;
  }

  const content = renderTextWithAnnotations(block.text, annotations, searchKeyword, shouldHighlight);

  if (block.type === 'heading') {
    return (
      <h2
        className={`reader-content-block reader-content-heading reader-content-heading-level-${block.level || 1} ${
          block.breakBefore ? 'reader-content-heading-break-before' : ''
        }`}
        data-reader-block-id={block.id}
        data-reader-title-id={block.titleId}
        key={block.id}
      >
        {content}
      </h2>
    );
  }

  return (
    <p
      className="reader-content-block reader-content-paragraph"
      data-reader-block-id={block.id}
      data-reader-title-id={block.titleId}
      key={block.id}
    >
      {content}
    </p>
  );
};
