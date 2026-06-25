import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type NkswChapter,
  type NkswSearchResult,
  download9kswFull,
  get9kswCatalog,
  get9kswChapter,
  search9ksw,
} from '@/lib/9kswClient';
import { addBookToShelf } from '@/store/bookshelf';
import { createReaderPath } from '@/router';
import { showGlobalFallback } from '@/lib/globalFallback';
import type { ReaderBookDocument, ReaderDocumentChapter } from '@/lib/readerDocument';
import './index.scss';

interface OnlineSearchProps {
  isOpen: boolean;
  onClose: () => void;
  initialKeyword?: string;
}

type ViewMode = 'search' | 'catalog';

export const OnlineSearch = ({ isOpen, onClose, initialKeyword }: OnlineSearchProps): React.JSX.Element | null => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('search');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NkswSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 目录状态
  const [catalogTitle, setCatalogTitle] = useState('');
  const [chapters, setChapters] = useState<NkswChapter[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [currentNovelUrl, setCurrentNovelUrl] = useState('');

  // 下载状态
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, chapter: '' });

  // 在线阅读中的操作状态
  const [actionBookId, setActionBookId] = useState<string | null>(null);

  const handleSearch = useCallback(async (forcedKeyword?: string) => {
    const keyword = forcedKeyword || inputRef.current?.value.trim();
    if (!keyword) return;

    setSearching(true);
    setSearchError(null);
    setResults([]);
    setHasSearched(true);

    try {
      const data = await search9ksw(keyword);
      setResults(data);
    } catch (err: any) {
      setSearchError(err.message || '搜索失败');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (inputRef.current) {
        inputRef.current.value = initialKeyword || '';
        if (initialKeyword) {
          handleSearch(initialKeyword);
        }
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, initialKeyword, handleSearch]);

  useEffect(() => {
    if (!isOpen) {
      setViewMode('search');
      setResults([]);
      setSearchError(null);
      setHasSearched(false);
      setCatalogTitle('');
      setChapters([]);
      setDownloading(false);
      setActionBookId(null);
    }
  }, [isOpen]);

  const handleOpenCatalog = useCallback(async (book: NkswSearchResult) => {
    setCurrentNovelUrl(book.url);
    setViewMode('catalog');
    setCatalogLoading(true);
    setCatalogTitle(book.title);
    setChapters([]);

    try {
      const catalog = await get9kswCatalog(book.url);
      setCatalogTitle(catalog.title);
      setChapters(catalog.chapters);
    } catch (err: any) {
      showGlobalFallback({ message: '加载目录失败: ' + err.message, tone: 'error' });
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const handleBackToSearch = useCallback(() => {
    setViewMode('search');
    setCatalogTitle('');
    setChapters([]);
    setDownloading(false);
  }, []);

  // 在线阅读：抓取全部章节正文，构造 BookInfo，导入书架，然后导航到阅读器
  const handleOnlineRead = useCallback(async (book: NkswSearchResult) => {
    setActionBookId(book.id);
    try {
      const catalog = await get9kswCatalog(book.url);
      if (catalog.chapters.length === 0) {
        showGlobalFallback({ message: '该小说暂无可用章节', tone: 'error' });
        return;
      }

      // 只加载前几章用于快速打开，其他章节正文置空
      const PRELOAD_COUNT = 3;
      const docChapters: ReaderDocumentChapter[] = [];
      let rawText = '';

      for (let i = 0; i < catalog.chapters.length; i++) {
        const ch = catalog.chapters[i];
        let text = '';
        if (i < PRELOAD_COUNT) {
          try {
            text = await get9kswChapter(ch.url);
          } catch {
            text = '[章节加载失败]';
          }
        }
        docChapters.push({
          id: `ch-${ch.order}`,
          title: ch.title,
          text,
          order: ch.order,
        });
        rawText += `\n${ch.title}\n${text}\n`;
      }

      const document: ReaderBookDocument = {
        version: 1,
        sourceType: 'txt',
        title: catalog.title,
        author: '',
        chapters: docChapters,
        rawText,
      };

      const bookId = `9ksw-${book.id}`;
      const result = await addBookToShelf({
        id: bookId,
        title: catalog.title,
        author: '',
        document,
        sourceType: 'txt',
        overwrite: true,
      });

      if (result.error) {
        showGlobalFallback({ message: '导入书籍失败: ' + result.message, tone: 'error' });
        return;
      }

      onClose();
      navigate(createReaderPath(bookId));
    } catch (err: any) {
      showGlobalFallback({ message: '在线阅读加载失败: ' + err.message, tone: 'error' });
    } finally {
      setActionBookId(null);
    }
  }, [navigate, onClose]);

  // 全本下载到书架
  const handleDownloadFull = useCallback(async () => {
    if (downloading || chapters.length === 0) return;
    setDownloading(true);

    try {
      const data = await download9kswFull(currentNovelUrl, (current, total, chapter) => {
        setDownloadProgress({ current, total, chapter });
      });

      const docChapters: ReaderDocumentChapter[] = data.chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        text: ch.text,
        order: ch.order,
      }));

      const document: ReaderBookDocument = {
        version: 1,
        sourceType: 'txt',
        title: data.title,
        author: '',
        chapters: docChapters,
        rawText: data.fullText,
      };

      const bookId = `9ksw-${currentNovelUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
      const result = await addBookToShelf({
        id: bookId,
        title: data.title,
        author: '',
        document,
        sourceType: 'txt',
        overwrite: true,
      });

      if (result.error) {
        showGlobalFallback({ message: '导入书架失败: ' + result.message, tone: 'error' });
      } else {
        showGlobalFallback({ message: `《${data.title}》已成功导入书架（${data.chapters.length} 章）`, tone: 'success' });
      }
    } catch (err: any) {
      showGlobalFallback({ message: '全本下载失败: ' + err.message, tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }, [downloading, chapters, currentNovelUrl]);

  // 点击单章进入在线阅读（从目录页）
  const handleReadFromCatalog = useCallback(async (chapterIndex: number) => {
    if (chapters.length === 0) return;

    setActionBookId('catalog-read');
    try {
      const docChapters: ReaderDocumentChapter[] = [];
      let rawText = '';

      // 预加载当前章以及前后各1章
      const preloadStart = Math.max(0, chapterIndex - 1);
      const preloadEnd = Math.min(chapters.length - 1, chapterIndex + 1);

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        let text = '';
        if (i >= preloadStart && i <= preloadEnd) {
          try {
            text = await get9kswChapter(ch.url);
          } catch {
            text = '[章节加载失败]';
          }
        }
        docChapters.push({
          id: `ch-${ch.order}`,
          title: ch.title,
          text,
          order: ch.order,
        });
        rawText += `\n${ch.title}\n${text}\n`;
      }

      const document: ReaderBookDocument = {
        version: 1,
        sourceType: 'txt',
        title: catalogTitle,
        author: '',
        chapters: docChapters,
        rawText,
      };

      const bookId = `9ksw-${currentNovelUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
      const result = await addBookToShelf({
        id: bookId,
        title: catalogTitle,
        author: '',
        document,
        sourceType: 'txt',
        overwrite: true,
      });

      if (result.error) {
        showGlobalFallback({ message: '导入书架失败: ' + result.message, tone: 'error' });
        return;
      }

      onClose();
      navigate(createReaderPath(bookId));
    } catch (err: any) {
      showGlobalFallback({ message: '章节加载失败: ' + err.message, tone: 'error' });
    } finally {
      setActionBookId(null);
    }
  }, [chapters, catalogTitle, currentNovelUrl, navigate, onClose]);

  if (!isOpen) return null;

  return (
    <div className="online-search-overlay" onClick={onClose}>
      <div className="online-search-panel" onClick={(e) => e.stopPropagation()}>
        {viewMode === 'search' && (
          <>
            {/* 搜索头部 */}
            <div className="os-header">
              <button className="os-close-btn" onClick={onClose} type="button" aria-label="关闭">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
              <form
                className="os-search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSearch();
                }}
              >
                <input
                  ref={inputRef}
                  className="os-search-input"
                  type="text"
                  placeholder="在九库书屋搜索小说..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                />
                <button className="os-search-btn" type="submit" disabled={searching}>
                  {searching ? '搜索中...' : '搜索'}
                </button>
              </form>
            </div>

            {/* 搜索结果 */}
            <div className="os-body">
              {searching && <div className="os-status">正在搜索中，请稍候...</div>}
              {searchError && <div className="os-status">搜索失败：{searchError}</div>}
              {!searching && !searchError && hasSearched && results.length === 0 && (
                <div className="os-status">未找到相关小说，请尝试其他关键词。</div>
              )}
              {!searching && !hasSearched && (
                <div className="os-status">输入书名或作者开始搜索 9ksw.com 上的小说</div>
              )}
              {results.length > 0 && (
                <ul className="os-result-list">
                  {results.map((book) => (
                    <li key={book.id} className="os-result-item">
                      <div className="os-result-title">{book.title}</div>
                      <div className="os-result-actions">
                        <button
                          className="os-action-btn"
                          onClick={() => handleOpenCatalog(book)}
                          type="button"
                        >
                          查看目录
                        </button>
                        <button
                          className="os-action-btn primary"
                          onClick={() => handleOnlineRead(book)}
                          disabled={actionBookId === book.id}
                          type="button"
                        >
                          {actionBookId === book.id ? '加载中...' : '在线阅读'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {viewMode === 'catalog' && (
          <>
            {/* 目录头部 */}
            <div className="os-catalog-header">
              <button className="os-back-btn" onClick={handleBackToSearch} type="button">
                ← 返回
              </button>
              <div className="os-catalog-title">{catalogTitle}</div>
              <button
                className="os-action-btn primary"
                onClick={handleDownloadFull}
                disabled={downloading || catalogLoading || chapters.length === 0}
                type="button"
                style={{ flexShrink: 0 }}
              >
                {downloading ? '下载中...' : '下载全本'}
              </button>
            </div>

            {/* 下载进度 */}
            {downloading && (
              <div className="os-download-progress">
                <div className="os-progress-bar">
                  <div
                    className="os-progress-fill"
                    style={{ width: `${downloadProgress.total ? (downloadProgress.current / downloadProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="os-progress-text">
                  正在下载 ({downloadProgress.current}/{downloadProgress.total})：{downloadProgress.chapter}
                </div>
              </div>
            )}

            {/* 章节列表 */}
            <div className="os-body">
              {catalogLoading && <div className="os-status">加载目录中...</div>}
              {!catalogLoading && chapters.length === 0 && <div className="os-status">暂无章节</div>}
              {chapters.map((ch, index) => (
                <div
                  key={ch.url}
                  className="os-chapter-item"
                  onClick={() => !actionBookId && handleReadFromCatalog(index)}
                >
                  {ch.title}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
