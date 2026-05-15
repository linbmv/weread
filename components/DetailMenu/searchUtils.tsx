import type React from 'react';
import {
  EVENT_NAME,
  createEmptyReaderSearchHighlight,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
  setReaderSearchHighlight,
  syncHook,
} from '@/lib/subscribe';
import { findKeywordSentenceMatches } from '@/lib/searchText';
import type { TextSyntaxTree } from '@/lib/transformText';
import type { SearchResult, SearchResultTarget } from '@/components/DetailMenu/types';

const clampSearchResultPage = (page: number, totalPage: number): number => {
  return Math.min(Math.max(page, 0), Math.max(totalPage, 0));
};

export const getSearchMatchPage = (
  textSyntaxTree: TextSyntaxTree,
  blockId: string,
  matchStart: number,
  blockLength: number,
): number => {
  const block = textSyntaxTree.blocks?.find((item) => item.id === blockId);
  const totalPage = textSyntaxTree.totalPage || 0;
  const startPage = textSyntaxTree.blockIdPage[blockId];
  const endPage = textSyntaxTree.blockIdPageEnd[blockId] ?? startPage;

  if (startPage === undefined) {
    if (!block || textSyntaxTree.rawText.length <= 0 || totalPage <= 0) return 0;
    const globalProgress = Math.min(Math.max((block.start + matchStart) / textSyntaxTree.rawText.length, 0), 1);
    return clampSearchResultPage(Math.round(globalProgress * totalPage), totalPage);
  }

  if (endPage <= startPage || blockLength <= 0) return clampSearchResultPage(startPage, totalPage);

  const progress = Math.min(Math.max(matchStart / blockLength, 0), 1);
  const pageSpan = endPage - startPage + 1;
  return clampSearchResultPage(startPage + Math.min(Math.floor(progress * pageSpan), pageSpan - 1), totalPage);
};

export const buildReaderMenuSearchResults = (
  normalizedSearchValue: string,
  textSyntaxTree: TextSyntaxTree,
): SearchResult[] => {
  const { blocks = [], titleIdTitle } = textSyntaxTree || {};
  const pageSearchResult: SearchResult[] = [];

  for (const item of blocks) {
    if (!item.text.includes(normalizedSearchValue)) continue;

    const textList = findKeywordSentenceMatches(item.text, normalizedSearchValue).map((match) => {
      const page = getSearchMatchPage(textSyntaxTree, item.id, match.start, item.text.length);
      return {
        blockId: item.id,
        blockLength: item.text.length,
        matchStart: match.start,
        page,
        sentence: match.sentence,
      };
    });
    if (textList.length === 0) continue;

    const index = textList[0]?.page ?? textSyntaxTree.blockIdPage[item.id] ?? 0;
    const title = item.titleId === undefined ? '' : titleIdTitle[item.titleId] || '';
    const pageSearchResultItem = pageSearchResult.find((i) => i.title === title);
    if (pageSearchResultItem) {
      pageSearchResultItem.text.push(...textList);
    } else {
      pageSearchResult.push({ text: textList, index, title });
    }
  }

  return pageSearchResult;
};

export const setReaderMenuSearchHighlight = (keyword: string, searchResult: SearchResult[]): void => {
  setReaderSearchHighlight(
    searchResult.length > 0 ? { hasResult: true, keyword, revision: Date.now() } : createEmptyReaderSearchHighlight(),
  );
};

export const getSearchResultTarget = (target: EventTarget | null): SearchResultTarget | undefined => {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const item = element?.closest<HTMLElement>('[data-search-result-block-id]');
  if (!item) return undefined;

  const fallbackPage = Number(item.dataset.searchResultPage);
  const blockId = item.dataset.searchResultBlockId;
  const matchStart = Number(item.dataset.searchResultMatchStart);
  const blockLength = Number(item.dataset.searchResultBlockLength);

  if (blockId && Number.isFinite(matchStart) && Number.isFinite(blockLength)) {
    return {
      blockId,
      matchStart,
      page: getSearchMatchPage(getTextSyntaxTree(), blockId, matchStart, blockLength),
    };
  }

  return Number.isFinite(fallbackPage) ? { page: fallbackPage } : undefined;
};

export const turnToSearchResultPage = (target: SearchResultTarget): void => {
  const textSyntaxTree = getTextSyntaxTree();
  const targetPage = clampSearchResultPage(target.page, textSyntaxTree.totalPage || 0);
  const viewTransitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };

  const block = target.blockId ? textSyntaxTree.blocks.find((item) => item.id === target.blockId) : undefined;
  setReaderNavigationTarget({
    blockId: target.blockId,
    matchStart: target.matchStart,
    page: targetPage,
    revision: Date.now(),
    titleId: block?.titleId,
  });

  if (viewTransitionDocument.startViewTransition) {
    viewTransitionDocument.startViewTransition(() => {
      setPageNum(targetPage);
    });
  } else {
    setPageNum(targetPage);
  }
  syncHook.call(EVENT_NAME.CLOSE_READER_CONTROL_PANEL);
};

export const renderSearchResultSentence = (sentence: string, keyword: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let fromIndex = 0;
  let matchIndex = sentence.indexOf(keyword, fromIndex);

  while (matchIndex !== -1) {
    if (matchIndex > fromIndex) {
      nodes.push(sentence.slice(fromIndex, matchIndex));
    }
    nodes.push(
      <span className="text-brand-blue-color-1" key={`${matchIndex}-${nodes.length}`}>
        {sentence.slice(matchIndex, matchIndex + keyword.length)}
      </span>,
    );
    fromIndex = matchIndex + keyword.length;
    matchIndex = sentence.indexOf(keyword, fromIndex);
  }

  if (fromIndex < sentence.length) {
    nodes.push(sentence.slice(fromIndex));
  }

  return nodes;
};
