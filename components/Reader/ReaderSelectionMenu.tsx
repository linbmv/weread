import React, { type CSSProperties, useEffect, useState } from 'react';
import {
  OcticonClearFormat,
  OcticonCopy,
  OcticonMarker,
  OcticonSearch,
  OcticonUnderline,
  OcticonWave,
  OcticonWriteNote,
  OcticonX,
} from '@/components/Octicon';
import {
  READER_ANNOTATION_COLORS,
  type ReaderAnnotation,
  type ReaderStyleAnnotationType,
  isReaderStyleAnnotationType,
} from '@/lib/readerAnnotations';
import {
  type ReaderAnnotationColorMap,
  type ReaderSelectionMenuState,
  getReaderMenuTopBoundary,
  getReaderSelectionMenuTopHeight,
} from '@/lib/reader/selectionUtils';
import type { ReaderNoteEditorState } from '@/lib/reader/useReaderAnnotationActions';
import { useDelayedUnmount } from '@/lib/reader/useDelayedUnmount';
import { t } from '@/locales';

interface ReaderSelectionMenuProps {
  onApplyAnnotation: (type: ReaderStyleAnnotationType, color?: string) => ReaderAnnotation[];
  onDeleteAnnotation: (annotationIds?: string[]) => void;
  onDeleteNote: () => void;
  onOpenNote: () => void;
  onSearchSelection: (keyword: string) => void;
  onSelectColor: (type: ReaderStyleAnnotationType, color: string) => void;
  selectedColors: ReaderAnnotationColorMap;
  state: ReaderSelectionMenuState | null;
  onCopy: () => void;
}

interface ReaderNoteModalProps {
  onCancel: () => void;
  onSave: (noteText: string) => void;
  state: ReaderNoteEditorState | null;
}

const SelectionCopyIcon = (): React.JSX.Element => <OcticonCopy />;
const SelectionMarkerIcon = (): React.JSX.Element => <OcticonMarker />;
const SelectionWavyIcon = (): React.JSX.Element => <OcticonWave />;
const SelectionUnderlineIcon = (): React.JSX.Element => <OcticonUnderline />;
const SelectionNoteIcon = (): React.JSX.Element => <OcticonWriteNote />;
const SelectionSearchIcon = (): React.JSX.Element => <OcticonSearch />;
const SelectionClearFormatIcon = (): React.JSX.Element => <OcticonClearFormat />;

const SelectionMenuIcon = ({
  children,
  size = '22px',
}: {
  children: React.ReactNode;
  size?: string;
}): React.JSX.Element => (
  <span className="reader-selection-menu-icon" style={{ '--reader-selection-menu-icon-size': size } as CSSProperties}>
    {children}
  </span>
);

const formatAnnotationTime = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}`;
};

export const ReaderSelectionMenu = ({
  state,
  onApplyAnnotation,
  onCopy,
  onDeleteAnnotation,
  onDeleteNote,
  onOpenNote,
  onSearchSelection,
  onSelectColor,
  selectedColors,
}: ReaderSelectionMenuProps): React.JSX.Element | null => {
  const [appliedSelectionType, setAppliedSelectionType] = useState<ReaderStyleAnnotationType | null>(null);
  const [appliedAnnotationIds, setAppliedAnnotationIds] = useState<string[]>([]);
  const { renderState, isClosing } = useDelayedUnmount(state);

  useEffect(() => {
    setAppliedSelectionType(null);
    setAppliedAnnotationIds([]);
  }, [state?.annotation?.id, state?.bottom, state?.left, state?.mode, state?.placement, state?.text, state?.top]);

  const currentState = state || renderState;
  if (!currentState) return null;

  const keepSelection = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const applyAnnotation = (type: ReaderStyleAnnotationType) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setAppliedSelectionType(type);
    setAppliedAnnotationIds(onApplyAnnotation(type).map((annotation) => annotation.id));
  };

  const openNote = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenNote();
  };

  const searchSelection = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSearchSelection(currentState.text);
  };

  const deleteAnnotation = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteAnnotation(appliedAnnotationIds.length > 0 ? appliedAnnotationIds : undefined);
  };

  const deleteNote = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteNote();
  };

  const stateStyleType = currentState.styleAnnotation?.type;
  const activeStyleType: ReaderStyleAnnotationType | null =
    appliedSelectionType || (stateStyleType && isReaderStyleAnnotationType(stateStyleType) ? stateStyleType : null);

  const selectColor = (color: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeStyleType) return;
    onSelectColor(activeStyleType, color);
    if (appliedSelectionType) {
      setAppliedAnnotationIds(onApplyAnnotation(appliedSelectionType, color).map((annotation) => annotation.id));
    }
  };

  const showColorPicker = Boolean(activeStyleType);
  const showClearFormat = currentState.hasFormat || appliedAnnotationIds.length > 0;
  const placement =
    currentState.placement === 'top' &&
    currentState.top - getReaderSelectionMenuTopHeight(showColorPicker) < getReaderMenuTopBoundary()
      ? 'bottom'
      : currentState.placement;
  const note = currentState.noteAnnotation;

  return (
    <>
      {note?.noteText ? (
        <div
          className={`reader-selection-note-card ${isClosing ? 'is-closing' : ''}`}
          onMouseDown={keepSelection}
          onPointerDown={keepSelection}
        >
          <div className="reader-selection-note-card-bg">
            <div className="reader-selection-note-card-time">
              {formatAnnotationTime(note.updatedAt || note.createdAt)}
            </div>
            <div className="reader-selection-note-card-content">{note.noteText}</div>
            <div className="reader-selection-note-card-actions">
              <button className="reader-selection-note-card-delete" type="button" onClick={deleteNote}>
                {t('selection.delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={`reader-selection-menu ${isClosing ? 'is-closing' : ''}`}
        data-placement={placement}
        style={{ left: currentState.left, top: placement === 'top' ? currentState.top : currentState.bottom }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={keepSelection}
        onPointerDown={keepSelection}
      >
        {showColorPicker ? (
          <div className="reader-selection-color-container">
            {READER_ANNOTATION_COLORS.map((color) => (
              <button
                aria-label={t('selection.choose_color', [color])}
                className="reader-selection-color-item"
                key={color}
                style={{ background: color }}
                type="button"
                onClick={selectColor(color)}
              >
                {activeStyleType && selectedColors[activeStyleType] === color ? (
                  <span className="reader-selection-color-selected"></span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        <button className="reader-selection-menu-item" type="button" onClick={onCopy}>
          <SelectionMenuIcon size="16px">
            <SelectionCopyIcon />
          </SelectionMenuIcon>
          <span>{t('selection.copy')}</span>
        </button>
        <button
          className={`reader-selection-menu-item ${activeStyleType === 'marker' ? 'is-selected' : ''}`}
          style={{ '--reader-selection-preview-color': selectedColors.marker } as CSSProperties}
          type="button"
          onClick={applyAnnotation('marker')}
        >
          <SelectionMenuIcon>
            <SelectionMarkerIcon />
          </SelectionMenuIcon>
          <span>{t('selection.marker')}</span>
        </button>
        <button
          className={`reader-selection-menu-item ${activeStyleType === 'wave' ? 'is-selected' : ''}`}
          style={{ '--reader-selection-preview-color': selectedColors.wave } as CSSProperties}
          type="button"
          onClick={applyAnnotation('wave')}
        >
          <SelectionMenuIcon>
            <SelectionWavyIcon />
          </SelectionMenuIcon>
          <span>{t('selection.wave')}</span>
        </button>
        <button
          className={`reader-selection-menu-item ${activeStyleType === 'underline' ? 'is-selected' : ''}`}
          style={{ '--reader-selection-preview-color': selectedColors.underline } as CSSProperties}
          type="button"
          onClick={applyAnnotation('underline')}
        >
          <SelectionMenuIcon>
            <SelectionUnderlineIcon />
          </SelectionMenuIcon>
          <span>{t('selection.underline')}</span>
        </button>
        {showClearFormat && (
          <button className="reader-selection-menu-item" type="button" onClick={deleteAnnotation}>
            <SelectionMenuIcon size="19px">
              <SelectionClearFormatIcon />
            </SelectionMenuIcon>
            <span>{t('selection.clear_format')}</span>
          </button>
        )}
        <button className="reader-selection-menu-item" type="button" onClick={openNote}>
          <SelectionMenuIcon size="19px">
            <SelectionNoteIcon />
          </SelectionMenuIcon>
          <span>{t('selection.write_note')}</span>
        </button>
        <button className="reader-selection-menu-item" type="button" onClick={searchSelection}>
          <SelectionMenuIcon size="19px">
            <SelectionSearchIcon />
          </SelectionMenuIcon>
          <span>{t('selection.lookup')}</span>
        </button>
      </div>
    </>
  );
};

export const ReaderCopyToast = ({
  placement = 'top',
  visible,
}: {
  placement?: 'center' | 'top';
  visible: boolean;
}): React.JSX.Element | null => {
  if (!visible) return null;
  return <div className={`reader-copy-toast ${placement === 'center' ? 'is-center' : ''}`}>{t('selection.copied')}</div>;
};

export const ReaderNoteModal = ({ state, onCancel, onSave }: ReaderNoteModalProps): React.JSX.Element | null => {
  const [value, setValue] = useState('');
  const { renderState, isClosing } = useDelayedUnmount(state);

  useEffect(() => {
    if (state) setValue(state.noteText || '');
  }, [state]);

  const currentState = state || renderState;
  if (!currentState) return null;

  const trimmedValue = value.trim();

  return (
    <div
      className={`reader-note-modal-layer ${isClosing ? 'is-closing' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="reader-note-modal">
        <button className="reader-note-modal-close" aria-label={t('common.close')} type="button" onClick={onCancel}>
          <OcticonX />
        </button>
        <div className="reader-note-modal-title">{t('selection.write_note')}</div>
        <div className="reader-note-modal-quote">{currentState.quote}</div>
        <textarea
          autoFocus
          className="reader-note-modal-input"
          maxLength={1000}
          placeholder={t('selection.write_placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="reader-note-modal-actions">
          <button
            className="reader-note-modal-button is-primary"
            disabled={!trimmedValue}
            type="button"
            onClick={() => onSave(trimmedValue)}
          >
            {t('selection.publish')}
          </button>
        </div>
      </div>
    </div>
  );
};
