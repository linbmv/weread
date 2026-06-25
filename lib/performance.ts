/**
 * 性能监控工具
 * 用于收集和上报前端性能指标
 */

interface PerformanceMetrics {
  pageLoad: number;
  domReady: number;
  firstPaint: number;
  firstContentfulPaint: number;
  largestContentfulPaint?: number;
  timeToInteractive?: number;
}

/**
 * 测量页面加载性能
 */
export const measurePageLoad = (): void => {
  if (typeof window === 'undefined' || !window.performance) return;

  window.addEventListener('load', () => {
    // 等待所有性能指标准备就绪
    setTimeout(() => {
      const perfData = window.performance.timing;
      const navigationStart = perfData.navigationStart;

      const metrics: PerformanceMetrics = {
        pageLoad: perfData.loadEventEnd - navigationStart,
        domReady: perfData.domContentLoadedEventEnd - navigationStart,
        firstPaint: 0,
        firstContentfulPaint: 0,
      };

      // 获取 Paint Timing
      const paintEntries = performance.getEntriesByType('paint');
      paintEntries.forEach((entry) => {
        if (entry.name === 'first-paint') {
          metrics.firstPaint = entry.startTime;
        } else if (entry.name === 'first-contentful-paint') {
          metrics.firstContentfulPaint = entry.startTime;
        }
      });

      // 获取 LCP (Largest Contentful Paint)
      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1] as any;
          metrics.largestContentfulPaint = lastEntry.renderTime || lastEntry.loadTime;
        });
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      } catch {
        // LCP not supported
      }

      console.log('[Performance Metrics]', {
        pageLoad: `${metrics.pageLoad}ms`,
        domReady: `${metrics.domReady}ms`,
        firstPaint: `${metrics.firstPaint}ms`,
        firstContentfulPaint: `${metrics.firstContentfulPaint}ms`,
        largestContentfulPaint: metrics.largestContentfulPaint ? `${metrics.largestContentfulPaint}ms` : 'N/A',
      });

      // 这里可以添加性能数据上报逻辑
      // reportToAnalytics(metrics);
    }, 0);
  });
};

/**
 * 监控长任务（阻塞主线程超过 50ms 的任务）
 */
export const monitorLongTasks = (): void => {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.warn('[Long Task Detected]', {
          duration: `${entry.duration}ms`,
          startTime: `${entry.startTime}ms`,
        });
      }
    });

    observer.observe({ entryTypes: ['longtask'] });
  } catch (_e) {
    // Long Task API not supported
  }
};

/**
 * 测量特定操作的性能
 */
export const measureOperation = (name: string, operation: () => void | Promise<void>): void => {
  const startTime = performance.now();
  const result = operation();

  if (result instanceof Promise) {
    result.then(() => {
      const duration = performance.now() - startTime;
      console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
    });
  } else {
    const duration = performance.now() - startTime;
    console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
  }
};

/**
 * 监控内存使用（仅 Chrome）
 */
export const monitorMemory = (): void => {
  if (typeof window === 'undefined') return;

  const memory = (performance as any).memory;
  if (!memory) {
    console.log('[Memory] Memory monitoring not supported in this browser');
    return;
  }

  const usedMemoryMB = (memory.usedJSHeapSize / 1048576).toFixed(2);
  const totalMemoryMB = (memory.totalJSHeapSize / 1048576).toFixed(2);
  const limitMemoryMB = (memory.jsHeapSizeLimit / 1048576).toFixed(2);

  console.log('[Memory Usage]', {
    used: `${usedMemoryMB}MB`,
    total: `${totalMemoryMB}MB`,
    limit: `${limitMemoryMB}MB`,
    usage: `${((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2)}%`,
  });
};

/**
 * 初始化性能监控（在应用启动时调用）
 */
export const initPerformanceMonitoring = (): void => {
  if (import.meta.env.DEV) {
    measurePageLoad();
    monitorLongTasks();

    // 每 30 秒监控一次内存
    setInterval(monitorMemory, 30000);
  }
};
