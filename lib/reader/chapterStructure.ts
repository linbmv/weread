import type { ReaderBlock, TextSyntaxTree } from '@/lib/transformText';
import { getPageNum } from '@/lib/subscribe';
import { getReaderProgress } from '@/lib/readerProgress';

export const getChapterTitleIds = (textSyntaxTree: TextSyntaxTree): number[] => {
  if (textSyntaxTree.sequences.length > 0) {
    return textSyntaxTree.sequences.map((item) => item.titleId);
  }
  return textSyntaxTree.titleIdTitle.map((_, index) => index);
};

export const getTitleBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  return textSyntaxTree.blocks.filter((block) => block.titleId === titleId);
};

export const isEmptyHeadingTitleBlocks = (blocks: ReaderBlock[]): boolean => {
  return blocks.length > 0 && blocks.every((block) => block.type === 'heading');
};

export const getTitleSequenceIndex = (textSyntaxTree: TextSyntaxTree, titleId: number): number => {
  return textSyntaxTree.sequences.findIndex((item) => item.titleId === titleId);
};

export const shouldAttachPreviousVolumeTitle = (
  previousBlocks: ReaderBlock[],
  currentBlocks: ReaderBlock[],
): boolean => {
  if (!isEmptyHeadingTitleBlocks(previousBlocks) || currentBlocks.length === 0) return false;
  return previousBlocks.some((block) => block.level === 2);
};

export const getForwardMergedTitleBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  const index = getTitleSequenceIndex(textSyntaxTree, titleId);
  const mergedBlocks: ReaderBlock[] = [];
  if (index < 0) return mergedBlocks;

  for (let i = index; i < textSyntaxTree.sequences.length; i++) {
    const blocks = getTitleBlocks(textSyntaxTree, textSyntaxTree.sequences[i].titleId);
    if (blocks.length === 0) continue;
    mergedBlocks.push(...blocks);
    if (!isEmptyHeadingTitleBlocks(blocks)) break;
  }

  return mergedBlocks;
};

export const getPreviousEmptyHeadingBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  const index = getTitleSequenceIndex(textSyntaxTree, titleId);
  const blocks: ReaderBlock[] = [];
  if (index <= 0) return blocks;

  for (let i = index - 1; i >= 0; i--) {
    const previousBlocks = getTitleBlocks(textSyntaxTree, textSyntaxTree.sequences[i].titleId);
    if (!isEmptyHeadingTitleBlocks(previousBlocks)) break;
    blocks.unshift(...previousBlocks);
  }

  return blocks;
};

export const getChapterBlocks = (textSyntaxTree: TextSyntaxTree, titleId: number): ReaderBlock[] => {
  const blocks = getTitleBlocks(textSyntaxTree, titleId);

  if (isEmptyHeadingTitleBlocks(blocks)) {
    const mergedBlocks = getForwardMergedTitleBlocks(textSyntaxTree, titleId);
    if (mergedBlocks.length > blocks.length) return mergedBlocks;
  }

  const previousBlocks = getPreviousEmptyHeadingBlocks(textSyntaxTree, titleId);
  if (shouldAttachPreviousVolumeTitle(previousBlocks, blocks)) {
    return [...previousBlocks, ...blocks];
  }

  return blocks.length > 0 ? blocks : textSyntaxTree.blocks;
};

export const getTitlePage = (textSyntaxTree: TextSyntaxTree, titleId: number): number => {
  const page = Number(textSyntaxTree.titleIdPage[titleId]);
  return Number.isFinite(page) ? page : getPageNum();
};

export const hasCompleteChapterStartPages = (
  titleIds: readonly number[],
  chapterStartPages: Record<number, number>,
): boolean => {
  return titleIds.length > 0 && titleIds.every((titleId) => Number.isFinite(chapterStartPages[titleId]));
};

export const getPageTitle = (textSyntaxTree: TextSyntaxTree, pageNum: number): string => {
  const titleId = textSyntaxTree.pageTitleId[pageNum] ?? textSyntaxTree.pageTitleId[0] ?? 0;
  return textSyntaxTree.titleIdTitle[titleId] || '';
};

export const getFirstTitleId = (textSyntaxTree: TextSyntaxTree): number => {
  return textSyntaxTree.sequences[0]?.titleId ?? (textSyntaxTree.titleIdTitle.length > 0 ? 0 : 0);
};

export const isValidTitleId = (textSyntaxTree: TextSyntaxTree, titleId: number | undefined): titleId is number => {
  return typeof titleId === 'number' && titleId >= 0 && titleId < textSyntaxTree.titleIdTitle.length;
};

export const getTitleIdByPage = (textSyntaxTree: TextSyntaxTree, pageNum: number): number => {
  const titleId = textSyntaxTree.pageTitleId[pageNum] ?? textSyntaxTree.pageTitleId[0];
  return isValidTitleId(textSyntaxTree, titleId) ? titleId : getFirstTitleId(textSyntaxTree);
};

export const getReaderProgressTitleId = (
  bookId: string | undefined,
  textSyntaxTree: TextSyntaxTree,
): number | undefined => {
  const titleId = getReaderProgress(bookId)?.titleId;
  return isValidTitleId(textSyntaxTree, titleId) ? titleId : undefined;
};

export const getScrollInitialTitleId = (
  bookId: string | undefined,
  pageNum: number,
  textSyntaxTree: TextSyntaxTree,
): number => {
  if (pageNum > 0) return getTitleIdByPage(textSyntaxTree, pageNum);
  return getReaderProgressTitleId(bookId, textSyntaxTree) ?? getTitleIdByPage(textSyntaxTree, pageNum);
};

export const buildPageTitleId = (
  pageCount: number,
  titleIdPage: Record<string, number>,
  firstTitleId = 0,
): number[] => {
  const orderedTitles = Object.entries(titleIdPage)
    .map(([titleId, page]) => ({ titleId: Number(titleId), page }))
    .filter((item) => Number.isFinite(item.titleId))
    .sort((a, b) => a.page - b.page || a.titleId - b.titleId);

  const result = new Array<number>(pageCount);
  let titleIndex = 0;
  let currentTitleId = orderedTitles[0]?.titleId ?? firstTitleId;
  for (let page = 0; page < pageCount; page++) {
    while (titleIndex < orderedTitles.length && orderedTitles[titleIndex].page <= page) {
      currentTitleId = orderedTitles[titleIndex].titleId;
      titleIndex++;
    }
    result[page] = currentTitleId;
  }
  return result;
};
