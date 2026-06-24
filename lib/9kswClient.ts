import { API_BASE } from '@/store/auth';

export interface NkswSearchResult {
  title: string;
  url: string;
  id: string;
}

export interface NkswChapter {
  title: string;
  url: string;
  order: number;
}

export interface NkswCatalog {
  title: string;
  chapters: NkswChapter[];
}

/**
 * 在 9ksw.com 搜索小说
 */
export const search9ksw = async (keyword: string): Promise<NkswSearchResult[]> => {
  const res = await fetch(`${API_BASE}/api/9ksw/search?q=${encodeURIComponent(keyword)}`);
  if (!res.ok) throw new Error('搜索请求失败');
  return res.json();
};

/**
 * 获取小说目录（全部章节列表）
 */
export const get9kswCatalog = async (novelUrl: string): Promise<NkswCatalog> => {
  const res = await fetch(`${API_BASE}/api/9ksw/catalog?url=${encodeURIComponent(novelUrl)}`);
  if (!res.ok) throw new Error('获取目录失败');
  return res.json();
};

/**
 * 获取单章正文（纯文本）
 */
export const get9kswChapter = async (chapterUrl: string): Promise<string> => {
  const res = await fetch(`${API_BASE}/api/9ksw/chapter?url=${encodeURIComponent(chapterUrl)}`);
  if (!res.ok) throw new Error('获取章节正文失败');
  const data = await res.json();
  return data.content || '';
};

/**
 * 全本下载：前端逐章抓取，拼装成完整文本和 ReaderBookDocument 兼容结构。
 * 通过 onProgress 回调报告进度。
 */
export const download9kswFull = async (
  novelUrl: string,
  onProgress?: (current: number, total: number, chapterTitle: string) => void,
): Promise<{ title: string; fullText: string; chapters: Array<{ id: string; title: string; text: string; order: number }> }> => {
  const catalog = await get9kswCatalog(novelUrl);
  const total = catalog.chapters.length;
  const chaptersData: Array<{ id: string; title: string; text: string; order: number }> = [];
  let fullText = '';

  for (let i = 0; i < total; i++) {
    const ch = catalog.chapters[i];
    onProgress?.(i + 1, total, ch.title);

    try {
      const content = await get9kswChapter(ch.url);
      chaptersData.push({
        id: `chapter-${ch.order}`,
        title: ch.title,
        text: content,
        order: ch.order,
      });
      fullText += `\n\n${ch.title}\n\n${content}\n`;
    } catch {
      chaptersData.push({
        id: `chapter-${ch.order}`,
        title: ch.title,
        text: '[本章下载失败]',
        order: ch.order,
      });
      fullText += `\n\n${ch.title}\n\n[本章下载失败]\n`;
    }

    // 每章间隔 200ms 防止过于频繁
    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { title: catalog.title, fullText, chapters: chaptersData };
};
