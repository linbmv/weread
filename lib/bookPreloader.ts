/**
 * 后台预加载书籍内容到 IndexedDB
 * 用于书架页面静默下载，实现秒开书籍
 */

import { getAuthState } from '@/store/auth';
import { getBookById } from '@/store/books';

interface PreloadTask {
  bookId: string;
  priority: number;
}

class BookPreloader {
  private queue: PreloadTask[] = [];
  private loading = new Set<string>();
  private loaded = new Set<string>();
  private maxConcurrent = 2;

  addTask(bookId: string, priority: number = 99): void {
    if (this.loaded.has(bookId) || this.loading.has(bookId)) {
      return;
    }

    this.queue.push({ bookId, priority });
    this.queue.sort((a, b) => a.priority - b.priority);
    this.processQueue();
  }

  addBatch(bookIds: string[], priorityBase: number = 10): void {
    bookIds.forEach((bookId, index) => {
      this.addTask(bookId, priorityBase + index);
    });
  }

  private async processQueue(): Promise<void> {
    if (!getAuthState().loggedIn) {
      return;
    }

    while (this.queue.length > 0 && this.loading.size < this.maxConcurrent) {
      const task = this.queue.shift();
      if (!task) break;

      this.loading.add(task.bookId);
      this.loadBook(task.bookId).finally(() => {
        this.loading.delete(task.bookId);
        this.loaded.add(task.bookId);
        this.processQueue();
      });
    }
  }

  private async loadBook(bookId: string): Promise<void> {
    try {
      const result = await getBookById(bookId);
      if (!result.error && result.data) {
        console.log(`✅ 预加载书籍成功: ${(result.data as any).title || bookId}`);
      } else {
        console.warn(`预加载书籍 ${bookId} 失败:`, result.message);
      }
    } catch (error) {
      console.error(`预加载书籍 ${bookId} 异常:`, error);
    }
  }

  clear(): void {
    this.queue = [];
  }

  getStatus(): { queued: number; loading: number; loaded: number } {
    return {
      queued: this.queue.length,
      loading: this.loading.size,
      loaded: this.loaded.size,
    };
  }
}

export const bookPreloader = new BookPreloader();
