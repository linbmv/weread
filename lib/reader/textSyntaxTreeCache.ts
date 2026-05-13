import { readerDocumentToTextSyntaxTree } from '@/lib/readerDocument';
import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';

interface TextSyntaxTreeCacheEntry {
  key: string;
  tree: TextSyntaxTree;
}

const TEXT_SYNTAX_TREE_CACHE_LIMIT = 2;

const textSyntaxTreeCache = new Map<string, TextSyntaxTreeCacheEntry>();

const getTextSyntaxTreeCacheKey = (book: BookInfo): string => {
  const rawTextLength = book.document?.rawText?.length ?? 0;
  const chapterCount = book.document?.chapters?.length ?? 0;
  return [book.id, book.fingerprint || '', book.modifyTime || 0, book.sourceType, rawTextLength, chapterCount].join(
    '|',
  );
};

export const getCachedTextSyntaxTree = (book: BookInfo): TextSyntaxTree => {
  const key = getTextSyntaxTreeCacheKey(book);
  const cached = textSyntaxTreeCache.get(book.id);
  if (cached?.key === key) {
    textSyntaxTreeCache.delete(book.id);
    textSyntaxTreeCache.set(book.id, cached);
    return cached.tree;
  }

  const tree = readerDocumentToTextSyntaxTree(book.document);
  textSyntaxTreeCache.set(book.id, { key, tree });
  if (textSyntaxTreeCache.size > TEXT_SYNTAX_TREE_CACHE_LIMIT) {
    const oldestBookId = textSyntaxTreeCache.keys().next().value;
    if (oldestBookId !== undefined) textSyntaxTreeCache.delete(oldestBookId);
  }
  return tree;
};
