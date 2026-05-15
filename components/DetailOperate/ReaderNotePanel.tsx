import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  EVENT_NAME,
  getCurrentBookDetail,
  getPageNum,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
  syncHook,
} from '@/lib/subscribe';
import { showGlobalFallback } from '@/lib/globalFallback';
import { type ReaderAnnotation, getAnnotationBlock, getReaderAnnotations } from '@/lib/readerAnnotations';
import { OcticonBookmark, OcticonMarker, OcticonUnderline, OcticonWave, OcticonWriteNote } from '@/components/Octicon';

const writePanelClipboardText = async (text: string): Promise<boolean> => {
  if (!text) return false;

  try {
    const clipboard = window.navigator.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {}

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};

const getAnnotationPanelLabel = (annotation: ReaderAnnotation): string => {
  if (annotation.type === 'note' && annotation.noteText) return annotation.noteText;
  return annotation.text;
};

const formatReaderNoteCopyDate = (value: number): string => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const ReaderAnnotationMarkerPanelIcon = (): React.JSX.Element => <OcticonMarker />;

const ReaderAnnotationWavePanelIcon = (): React.JSX.Element => <OcticonWave />;

const ReaderAnnotationUnderlinePanelIcon = (): React.JSX.Element => <OcticonUnderline />;

const ReaderAnnotationNotePanelIcon = (): React.JSX.Element => <OcticonWriteNote />;

const ReaderAnnotationBookmarkPanelIcon = (): React.JSX.Element => <OcticonBookmark />;

const getAnnotationTypeIcon = (annotation: ReaderAnnotation): React.JSX.Element => {
  if (annotation.type === 'bookmark') return <ReaderAnnotationBookmarkPanelIcon />;
  if (annotation.type === 'note') return <ReaderAnnotationNotePanelIcon />;
  if (annotation.type === 'wave') return <ReaderAnnotationWavePanelIcon />;
  if (annotation.type === 'underline') return <ReaderAnnotationUnderlinePanelIcon />;
  return <ReaderAnnotationMarkerPanelIcon />;
};

export const ReaderNotePanel = (): React.JSX.Element => {
  const [revision, setRevision] = useState(0);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const bookDetail = getCurrentBookDetail();
  const textSyntaxTree = getTextSyntaxTree();
  const annotations = useMemo(() => getReaderAnnotations(bookDetail?.id), [bookDetail?.id, revision]);

  const blockIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    textSyntaxTree.blocks.forEach((block, index) => {
      map.set(block.id, index);
    });
    return map;
  }, [textSyntaxTree.blocks]);

  const groups = useMemo(() => {
    const titleOrder = new Map<number, number>();
    textSyntaxTree.sequences.forEach((sequence, index) => {
      titleOrder.set(sequence.titleId, index);
    });

    const grouped = new Map<number, ReaderAnnotation[]>();
    annotations.forEach((annotation) => {
      const block = getAnnotationBlock(textSyntaxTree, annotation);
      const titleId = annotation.titleId ?? block?.titleId ?? 0;
      const list = grouped.get(titleId);
      if (list) list.push(annotation);
      else grouped.set(titleId, [annotation]);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => (titleOrder.get(a[0]) ?? a[0]) - (titleOrder.get(b[0]) ?? b[0]))
      .map(([titleId, items]) => ({
        items: [...items].sort((a, b) => {
          const blockA = blockIndexMap.get(a.blockId) ?? 0;
          const blockB = blockIndexMap.get(b.blockId) ?? 0;
          return blockA - blockB || a.startOffset - b.startOffset || a.createdAt - b.createdAt;
        }),
        title: textSyntaxTree.titleIdTitle[titleId] || '正文',
        titleId,
      }));
  }, [annotations, blockIndexMap, textSyntaxTree]);

  const jumpToAnnotation = useCallback(
    (annotation: ReaderAnnotation) => {
      const block = getAnnotationBlock(textSyntaxTree, annotation);
      const titleId = annotation.titleId ?? block?.titleId ?? 0;
      if (!block && typeof annotation.page !== 'number') {
        showGlobalFallback({ message: '笔记定位失败，原文位置已失效', tone: 'error' });
        return;
      }
      if (!block) {
        showGlobalFallback({ message: '笔记原文位置已变化，已按页码定位', tone: 'info' });
      }
      const page =
        typeof annotation.page === 'number' && Number.isFinite(annotation.page)
          ? annotation.page
          : (textSyntaxTree.blockIdPage[annotation.blockId] ?? textSyntaxTree.titleIdPage[titleId] ?? getPageNum());
      const blockStartPage = textSyntaxTree.blockIdPage[annotation.blockId];
      const blockEndPage = textSyntaxTree.blockIdPageEnd[annotation.blockId] ?? blockStartPage;
      const blockPageOffset =
        Number.isFinite(page) && Number.isFinite(blockStartPage)
          ? Math.min(Math.max(page - blockStartPage, 0), Math.max((blockEndPage ?? blockStartPage) - blockStartPage, 0))
          : undefined;

      setReaderNavigationTarget({
        blockId: annotation.blockId,
        blockPageOffset,
        matchStart: annotation.startOffset,
        page,
        revision: Date.now(),
        titleId,
      });
      if (Number.isFinite(page) && getPageNum() !== page) {
        setPageNum(page);
      }
    syncHook.call(EVENT_NAME.CLOSE_READER_CONTROL_PANEL);
    },
    [textSyntaxTree],
  );

  const copyAllNotes = useCallback(() => {
    if (annotations.length === 0) return;
    const lines: string[] = [`《${bookDetail?.title || '未命名书籍'}》 ${annotations.length}个笔记`];
    groups.forEach((group) => {
      lines.push(group.title);
      group.items.forEach((annotation) => {
        if (annotation.type === 'note' && annotation.noteText) {
          lines.push(
            `◆ ${formatReaderNoteCopyDate(annotation.createdAt)}发表想法 ${annotation.noteText} 原文：${annotation.text}`,
          );
          return;
        }
        lines.push(`◆ ${getAnnotationPanelLabel(annotation)}`);
      });
    });

    void writePanelClipboardText(lines.join('\n')).then((success) => {
      if (!success) return;
      setCopyToastVisible(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopyToastVisible(false);
        copyTimerRef.current = null;
      }, 1200);
    });
  }, [annotations.length, bookDetail?.title, groups]);

  useEffect(() => {
    const update = () => setRevision((prev) => prev + 1);
    syncHook.tap(EVENT_NAME.SET_READER_ANNOTATIONS, update);
    syncHook.tap(EVENT_NAME.SET_TEXT_SYNTAX_TREE, update);
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, update);
    return () => {
      syncHook.off(EVENT_NAME.SET_READER_ANNOTATIONS, update);
      syncHook.off(EVENT_NAME.SET_TEXT_SYNTAX_TREE, update);
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, update);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const copyToast =
    copyToastVisible && typeof document !== 'undefined'
      ? createPortal(<div className="reader-copy-toast">复制成功</div>, document.body)
      : null;

  return (
    <>
      {copyToast}
      <div className="reader-note-panel-wrapper">
        <div className="reader-note-panel-title">笔记</div>
        {annotations.length === 0 ? (
          <div className="reader-note-panel-empty">暂无笔记</div>
        ) : (
          <div className="reader-note-panel-list">
            {groups.map((group) => (
              <div className="reader-note-panel-group" key={group.titleId}>
                <div className="reader-note-panel-group-title">{group.title}</div>
                {group.items.map((annotation) => (
                  <button
                    className="reader-note-panel-item"
                    key={annotation.id}
                    type="button"
                    onClick={() => jumpToAnnotation(annotation)}
                  >
                    <span className="reader-note-panel-type-icon">{getAnnotationTypeIcon(annotation)}</span>
                    <span className="reader-note-panel-item-content">
                      <span className="reader-note-panel-item-text">{getAnnotationPanelLabel(annotation)}</span>
                      {annotation.type === 'note' && annotation.noteText ? (
                        <span className="reader-note-panel-item-quote">{annotation.text}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <button
          className="reader-note-panel-copy"
          disabled={annotations.length === 0}
          type="button"
          onClick={copyAllNotes}
        >
          复制全部笔记 · {annotations.length}
        </button>
      </div>
    </>
  );
};
