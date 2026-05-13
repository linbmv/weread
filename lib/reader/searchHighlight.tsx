import React from 'react';
import { findKeywordSentenceMatches } from '@/lib/searchText';

// Bounded per-keyword cache: when search keyword changes the entire cache is
// dropped, so we never hold stale highlight nodes for an old query. The cap is
// per active keyword and bounds memory in long reading sessions.
const READER_HIGHLIGHT_CACHE_LIMIT = 512;
let highlightCacheKeyword = '';
let highlightCache = new Map<string, React.ReactNode>();

export const renderHighlightedText = (text: string, keyword: string): React.ReactNode => {
  if (!keyword) return text;

  if (highlightCacheKeyword !== keyword) {
    highlightCacheKeyword = keyword;
    highlightCache = new Map();
  } else {
    const cached = highlightCache.get(text);
    if (cached !== undefined) return cached;
  }

  const nodes: React.ReactNode[] = [];
  let fromIndex = 0;

  findKeywordSentenceMatches(text, keyword).forEach((sentenceMatch, sentenceIndex) => {
    if (sentenceMatch.start > fromIndex) {
      nodes.push(text.slice(fromIndex, sentenceMatch.start));
    }

    const sentenceNodes: React.ReactNode[] = [];
    let sentenceFromIndex = 0;
    let matchIndex = sentenceMatch.sentence.indexOf(keyword, sentenceFromIndex);

    while (matchIndex !== -1) {
      if (matchIndex > sentenceFromIndex) {
        sentenceNodes.push(sentenceMatch.sentence.slice(sentenceFromIndex, matchIndex));
      }
      sentenceNodes.push(
        <span className="reader-search-match-highlight" key={`${sentenceIndex}-${matchIndex}`}>
          {sentenceMatch.sentence.slice(matchIndex, matchIndex + keyword.length)}
        </span>,
      );
      sentenceFromIndex = matchIndex + keyword.length;
      matchIndex = sentenceMatch.sentence.indexOf(keyword, sentenceFromIndex);
    }

    if (sentenceFromIndex < sentenceMatch.sentence.length) {
      sentenceNodes.push(sentenceMatch.sentence.slice(sentenceFromIndex));
    }

    nodes.push(
      <mark className="reader-search-sentence-highlight" key={`${sentenceMatch.start}-${sentenceIndex}`}>
        {sentenceNodes}
      </mark>,
    );
    fromIndex = sentenceMatch.end;
  });

  if (fromIndex < text.length) {
    nodes.push(text.slice(fromIndex));
  }

  if (highlightCache.size >= READER_HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = highlightCache.keys().next();
    if (!oldestKey.done) highlightCache.delete(oldestKey.value);
  }
  highlightCache.set(text, nodes);
  return nodes;
};
