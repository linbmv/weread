import { getBookById } from '@/store/books';
import type { BookInfo } from '@/store/books';

/**
 * 将书籍内容下载保存为本地 TXT 文件
 * @param bookId 书籍 ID
 * @param title 书籍标题（用于文件名）
 */
export const downloadBookAsTxt = async (bookId: string, title: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // 从 IndexedDB 获取完整书籍内容
    const result = await getBookById<BookInfo>(bookId);

    if (result.error || !result.data) {
      return { success: false, error: result.message || '无法获取书籍内容' };
    }

    const book = result.data;
    const bookDocument = book.document;

    // 优先使用 rawText，否则从 chapters 拼接
    let text = bookDocument?.rawText || '';

    if (!text && Array.isArray(bookDocument?.chapters)) {
      text = bookDocument.chapters
        .map((chapter) => {
          const chapterTitle = chapter.title ? `${chapter.title}\n\n` : '';
          return chapterTitle + (chapter.text || '');
        })
        .join('\n\n');
    }

    if (!text) {
      return { success: false, error: '该书籍没有可下载的文本内容' };
    }

    // 创建并触发下载
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');

    // 清理文件名中的非法字符
    const safeTitle = (title || book.title || 'book').replace(/[\\/:*?"<>|]/g, '_');

    link.href = url;
    link.download = `${safeTitle}.txt`;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);

    // 释放 URL 对象
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '下载失败',
    };
  }
};
