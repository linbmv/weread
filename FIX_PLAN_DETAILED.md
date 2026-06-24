# 修复方案文档

## 总体分析

WeRead 当前问题来自一次书架全局状态与性能优化改造未闭环：`pages/home/index.tsx` 和 `pages/shelf/index.tsx` 依赖 `ranuts/utils` 中不存在的 `useSignal`，`vite.config.ts` 直接导入未声明的 `rollup-plugin-visualizer`，`store/bookshelf.ts` 把“未加载、加载中、已加载、失败、空书架”压缩成一个数组和一个布尔值，导致加载失败会清空既有书架，页面也无法区分空数据与未加载。导入流程在 `useHomeBookImport` 中基于一次性 `workingBooks` 快照合并，多个导入流程并发时会互相覆盖。

项目未发现 `.context/` 目录，因此没有额外编码偏好文件需要遵循。以下方案按现有 React 19 + Vite + IndexedDB worker 架构给出，所有代码均为建议补丁内容，不执行实际文件修改。

## 架构决策

**Rationale**

- 用 React 原生 `useSyncExternalStore` 封装书架 store，替代不存在的 `useSignal`，降低外部工具 API 风险。
- 让书架 store 成为唯一内存状态源，提供事务式 `mergeBookShelf` / `replaceBookShelfFromLoad`，避免页面直接用陈旧数组覆盖全局状态。
- 引入 `loadStatus` 和 `hasLoaded`，把“未加载”“空书架”“失败”拆开，解决 UI 和数据安全问题。
- 仅让首页首屏同步加载，Reader/Shelf 继续懒加载，避免盲目懒加载损害 LCP。
- Bundle 可视化器改为环境变量启用，避免默认构建依赖和产物负担。
- 性能监控只在开发或显式开启时运行，并清理 observer/timer，避免生产噪声。

**Rejected Alternatives**

- 继续使用 `ranuts createSignal + useSignal`：当前依赖没有 `useSignal` 类型导出，构建失败。
- 加载失败时 `setBookShelf([])`：会把可用旧状态覆盖成空书架，存在数据丢失感知风险。
- 每个页面独立 `useState + getAllBooks`：会回到首页与 `/shelf` 状态不同步的问题。
- 导入完成后直接 `updateBookShelf(workingBooks)`：并发导入时最后完成的流程会覆盖先完成流程。
- 全路由 eager import：可修复 LCP 但会放大 Reader 首包，不符合现有注释中的拆包目标。

**Assumptions**

- `getAllBooks<BookInfo>()` 返回完整本地书架元数据。
- `addBook()` 是持久化层权威写入入口。
- 首页 `/` 是默认首屏，Reader 体积大，仍适合懒加载。
- 项目使用 npm 或 pnpm 均可，但依赖声明以 `package.json` 为准。

**Potential Side Effects**

- 书架 store API 变更会影响所有直接导入 `getBookShelfLoading` / `updateBookShelf` 的位置，需要同步替换。
- 首页 eager import 会增加初始 JS 体积，但减少首屏 Suspense waterfall。
- Bundle analyzer 改为环境变量启用后，默认 `npm run build` 不再生成 `dist/stats.html`，需用 `ANALYZE=true npm run build`。
- 加载失败保留旧状态后，UI 会显示旧数据和错误提示，而不是空列表。

---

## 方案 1: useSignal 不存在 - 编译失败

### 问题分析

`pages/home/index.tsx` 与 `pages/shelf/index.tsx` 从 `ranuts/utils` 导入 `useSignal`，但本地 `ranuts` 类型导出中不存在该 API。当前 `store/bookshelf.ts` 使用 `createSignal`，页面又尝试用不存在的 hook 订阅，导致 TypeScript/Vite 编译失败。

根因是全局状态选择了外部 signal API，但没有稳定 React hook 桥接层。修复应落在本地 store：提供 React 原生可订阅接口，页面只依赖本项目 API。

### 修复步骤

1. 在 `store/bookshelf.ts` 改造为 React external store：增加订阅器、快照 getter、`useBookShelf` hook。
2. 移除页面对 `useSignal` 的依赖。
3. 用 `useBookShelf()` 替换 `useHomeBookList()` / `useShelfBooks()` 内部实现。
4. 保留 `getBookShelf()` 作为非 React 代码读取当前快照的入口。

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -1,24 +1,77 @@
-import { createSignal } from 'ranuts/utils';
+import { useSyncExternalStore } from 'react';
 import type { BookInfo } from './books';
 import { getAllBooks } from './books';
 import { resumeDB } from './index';
 import { getReaderProgress } from '@/lib/readerProgress';
+import { getErrorMessage } from '@/lib/utils';
 
 const MAX_BOOK_LOAD_RETRIES = 3;
 
-// 防止重复加载的标志
-let isLoadingInProgress = false;
+export type BookShelfLoadStatus = 'idle' | 'loading' | 'success' | 'error';
 
-// 全局书架状态
-export const [getBookShelf, setBookShelf] = createSignal<BookInfo[]>(
-  [],
-  { subscriber: 'bookshelf-change' }
-);
+export interface BookShelfSnapshot {
+  books: BookInfo[];
+  error: string | null;
+  hasLoaded: boolean;
+  loadStatus: BookShelfLoadStatus;
+}
 
-// 全局加载状态
-export const [getBookShelfLoading, setBookShelfLoading] = createSignal<boolean>(
-  false,
-  { subscriber: 'bookshelf-loading' }
-);
+const listeners = new Set<() => void>();
+
+let snapshot: BookShelfSnapshot = {
+  books: [],
+  error: null,
+  hasLoaded: false,
+  loadStatus: 'idle',
+};
+
+let activeLoadPromise: Promise<void> | null = null;
+
+const emitBookShelfChange = (): void => {
+  listeners.forEach((listener) => listener());
+};
+
+const setBookShelfSnapshot = (next: BookShelfSnapshot): void => {
+  snapshot = next;
+  emitBookShelfChange();
+};
+
+const patchBookShelfSnapshot = (patch: Partial<BookShelfSnapshot>): void => {
+  setBookShelfSnapshot({ ...snapshot, ...patch });
+};
+
+export const subscribeBookShelf = (listener: () => void): (() => void) => {
+  listeners.add(listener);
+  return () => {
+    listeners.delete(listener);
+  };
+};
+
+export const getBookShelfSnapshot = (): BookShelfSnapshot => snapshot;
+
+export const getBookShelfServerSnapshot = (): BookShelfSnapshot => snapshot;
+
+export const useBookShelf = (): BookShelfSnapshot => {
+  return useSyncExternalStore(subscribeBookShelf, getBookShelfSnapshot, getBookShelfServerSnapshot);
+};
+
+export const getBookShelf = (): BookInfo[] => snapshot.books;
+
+export const getBookShelfLoading = (): boolean => snapshot.loadStatus === 'loading';
+
+export const getBookShelfHasLoaded = (): boolean => snapshot.hasLoaded;
+
+export const getBookShelfError = (): string | null => snapshot.error;
```

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -1,6 +1,6 @@
 import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
 import { Link, useHref, useNavigate } from 'react-router-dom';
-import { debounce, useSignal } from 'ranuts/utils';
+import { debounce } from 'ranuts/utils';
@@ -10,14 +10,12 @@ import {
 } from '@/store/books';
 import {
-  getBookShelf,
-  getBookShelfLoading,
   loadBookShelf,
-  upsertBookInShelf,
-  updateBookShelf,
   getBookRecentTimestamp,
+  useBookShelf,
 } from '@/store/bookshelf';
@@ -403,17 +401,18 @@ export interface BookSearchState {
 }
 
-const useHomeBookList = (): { bookList: BookInfo[]; loading: boolean } => {
-  const bookList = useSignal(getBookShelf);
-  const loading = useSignal(getBookShelfLoading);
+const useHomeBookList = (): { bookList: BookInfo[]; error: string | null; hasLoaded: boolean; loading: boolean } => {
+  const { books, error, hasLoaded, loadStatus } = useBookShelf();
+  const loading = loadStatus === 'loading';
 
   useEffect(() => {
-    // 只在书架为空时加载数据
-    if (bookList.length === 0 && !loading) {
+    if (!hasLoaded && loadStatus !== 'loading') {
       loadBookShelf();
     }
-  }, []);
+  }, [hasLoaded, loadStatus]);
 
-  return { bookList, loading };
+  return { bookList: books, error, hasLoaded, loading };
 };
```

```diff
--- a/pages/shelf/index.tsx
+++ b/pages/shelf/index.tsx
@@ -1,7 +1,6 @@
 import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
 import type { Dispatch, SetStateAction } from 'react';
 import { Link, useHref, useNavigate } from 'react-router-dom';
-import { useSignal } from 'ranuts/utils';
@@ -14,9 +13,8 @@ import { OnlineSearch } from '@/components/OnlineSearch';
 import type { BookInfo } from '@/store/books';
 import {
-  getBookShelf,
-  getBookShelfLoading,
   loadBookShelf,
+  useBookShelf,
 } from '@/store/bookshelf';
@@ -66,18 +64,18 @@ const clearReaderSignals = (): void => {
 };
 
 const useShelfBooks = (): {
+  error: string | null;
+  hasLoaded: boolean;
   books: BookInfo[];
   loading: boolean;
 } => {
-  const books = useSignal(getBookShelf);
-  const loading = useSignal(getBookShelfLoading);
+  const { books, error, hasLoaded, loadStatus } = useBookShelf();
+  const loading = loadStatus === 'loading';
 
   useEffect(() => {
-    // 只在书架为空时加载数据
-    if (books.length === 0 && !loading) {
+    if (!hasLoaded && loadStatus !== 'loading') {
       loadBookShelf();
     }
-  }, []);
+  }, [hasLoaded, loadStatus]);
 
-  return { books, loading };
+  return { books, error, hasLoaded, loading };
 };
```

### 测试验证

```bash
npm run tsc
npm run build
```

验证点：

- TypeScript 不再报 `Module '"ranuts/utils"' has no exported member 'useSignal'`。
- 首页和 `/shelf` 首次进入能加载书架。
- 导入书籍后两个页面都能响应更新。
- 切换页面不触发重复加载死循环。

### 风险评估

- `useSyncExternalStore` 要求快照对象引用在状态变化时更新，上述 `setBookShelfSnapshot` 已保证。
- 如果其他模块依赖 `setBookShelf` 旧导出，需要统一迁移；当前检索中主要使用 `getBookShelf`、`updateBookShelf`。
- 从外部 signal 切到本地 store 后，`ranuts` 订阅机制不再参与书架状态，属于期望结果。

---

## 方案 2: rollup-plugin-visualizer 依赖缺失 - 构建失败

### 问题分析

`vite.config.ts` 静态导入 `rollup-plugin-visualizer`，但 `package.json` 的 `devDependencies` 没有声明该包。即使某些机器的根目录或缓存里有该包，项目自身仍不可复现，CI 或干净安装会构建失败。

此外可视化器不应默认进入所有构建流程，否则会增加构建时间并产生非业务产物。

### 修复步骤

1. 将 `rollup-plugin-visualizer` 加入 `devDependencies`。
2. 让 visualizer 只在 `ANALYZE=true` 时启用。
3. 增加 `build:analyze` 脚本。
4. 使用 Vite 配置函数支持按环境生成插件列表。

```diff
--- a/package.json
+++ b/package.json
@@ -12,6 +12,7 @@
     "build": "vite build && node scripts/generate-pwa-service-worker.mjs",
+    "build:analyze": "ANALYZE=true vite build && node scripts/generate-pwa-service-worker.mjs",
     "preview": "vite preview --host 0.0.0.0",
@@ -38,6 +39,7 @@
     "postcss": "^8.5.6",
     "prettier": "^3.7.4",
+    "rollup-plugin-visualizer": "^6.0.5",
     "sass-embedded": "^1.96.0",
```

```diff
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -13,54 +13,58 @@ const normalizeBase = (value: string | undefined): string => {
   return `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
 };
 
-export default defineConfig({
-  base: normalizeBase(process.env.VITE_BASE_PATH),
-  plugins: [
-    react(),
-    // Bundle size analyzer - generates stats.html after build
-    visualizer({
-      open: false,
-      gzipSize: true,
-      brotliSize: true,
-      filename: 'dist/stats.html',
-    }),
-  ],
-  build: {
-    target: 'esnext',
-    minify: 'esbuild',
-    // Split vendor code into stable chunks so user code changes do not bust
-    // the long-cached library bundles. Keep heavy / optional libs (flexsearch,
-    // jschardet, lit) in their own chunks so they download lazily with the
-    // routes that need them.
-    rollupOptions: {
-      output: {
-        manualChunks(id: string): string | undefined {
-          if (!id.includes('node_modules')) return undefined;
-          if (id.includes('react-router')) return 'vendor-router';
-          if (id.includes('/react-dom/') || id.includes('\\react-dom\\')) return 'vendor-react';
-          if (id.includes('/react/') || id.includes('\\react\\')) return 'vendor-react';
-          if (id.includes('scheduler')) return 'vendor-react';
-          if (id.includes('flexsearch')) return 'vendor-flexsearch';
-          if (id.includes('jschardet')) return 'vendor-jschardet';
-          if (id.includes('lit') || id.includes('@khmyznikov/pwa-install')) return 'vendor-pwa';
-          if (id.includes('ranui') || id.includes('ranuts')) return 'vendor-ranui';
-          return 'vendor';
+export default defineConfig(() => {
+  const shouldAnalyze = process.env.ANALYZE === 'true';
+
+  return {
+    base: normalizeBase(process.env.VITE_BASE_PATH),
+    plugins: [
+      react(),
+      shouldAnalyze &&
+        visualizer({
+          open: false,
+          gzipSize: true,
+          brotliSize: true,
+          filename: 'dist/stats.html',
+        }),
+    ].filter(Boolean),
+    build: {
+      target: 'esnext',
+      minify: 'esbuild',
+      rollupOptions: {
+        output: {
+          manualChunks(id: string): string | undefined {
+            if (!id.includes('node_modules')) return undefined;
+            if (id.includes('react-router')) return 'vendor-router';
+            if (id.includes('/react-dom/') || id.includes('\\react-dom\\')) return 'vendor-react';
+            if (id.includes('/react/') || id.includes('\\react\\')) return 'vendor-react';
+            if (id.includes('scheduler')) return 'vendor-react';
+            if (id.includes('flexsearch')) return 'vendor-flexsearch';
+            if (id.includes('jschardet')) return 'vendor-jschardet';
+            if (id.includes('lit') || id.includes('@khmyznikov/pwa-install')) return 'vendor-pwa';
+            if (id.includes('ranui') || id.includes('ranuts')) return 'vendor-ranui';
+            return 'vendor';
+          },
         },
       },
     },
-  },
-  publicDir: 'public',
-  resolve: {
-    alias: {
-      '@/components': resolve(__dirname, 'components'),
-      '@/router': resolve(__dirname, 'router'),
-      '@/lib': resolve(__dirname, 'lib'),
-      '@/store': resolve(__dirname, 'store'),
-      '@/assets': resolve(__dirname, 'assets'),
-      '@/types': resolve(__dirname, 'types'),
-      '@/styles': resolve(__dirname, 'styles'),
-      '@/pages': resolve(__dirname, 'pages'),
-      '@/locales': resolve(__dirname, 'locales'),
+    publicDir: 'public',
+    resolve: {
+      alias: {
+        '@/components': resolve(__dirname, 'components'),
+        '@/router': resolve(__dirname, 'router'),
+        '@/lib': resolve(__dirname, 'lib'),
+        '@/store': resolve(__dirname, 'store'),
+        '@/assets': resolve(__dirname, 'assets'),
+        '@/types': resolve(__dirname, 'types'),
+        '@/styles': resolve(__dirname, 'styles'),
+        '@/pages': resolve(__dirname, 'pages'),
+        '@/locales': resolve(__dirname, 'locales'),
+      },
+      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
     },
-    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
-  },
-  css: {
-    preprocessorOptions: {
-      scss: {
-        additionalData: `@import "@/styles/base.css";`,
+    css: {
+      preprocessorOptions: {
+        scss: {
+          additionalData: `@import "@/styles/base.css";`,
+        },
       },
     },
-  },
+  };
 });
```

### 测试验证

```bash
npm install
npm run build
npm run build:analyze
test -f dist/stats.html
```

验证点：

- 干净安装后 `npm run build` 不再因缺包失败。
- 默认构建不会生成 `dist/stats.html`。
- `npm run build:analyze` 会生成 `dist/stats.html`。

### 风险评估

- `ANALYZE=true` 在 Windows cmd 中不兼容；如项目要求 Windows 原生命令，可加 `cross-env`。当前项目未使用 `cross-env`，保持最小改动。
- 依赖版本需与 Rollup/Vite 兼容，`^6.0.5` 支持现代 Vite/Rollup。

---

## 方案 3: 竞态条件 - 数据覆盖风险

### 问题分析

当前 `loadBookShelf()` 用 `isLoadingInProgress` 防止重复加载，但仍有两个问题：

1. 并发调用直接 `return`，调用方无法等待已有加载完成。
2. 加载完成会无条件 `setBookShelf(sortBooksByRecent(result.data))`，如果加载期间用户导入了新书，较旧的数据库快照可能覆盖内存中的新状态。

此外 `useHomeBookImport` 最后调用 `updateBookShelf(workingBooks)`，多个导入流程并发时，后完成的流程会用自己的旧 `workingBooks` 覆盖先完成流程导入的新书。

### 修复步骤

1. 将 `isLoadingInProgress` 改为 `activeLoadPromise`，并发调用复用同一个 Promise。
2. 加载成功时用 `replaceBookShelfFromLoad` 合并，而不是无条件替换。
3. 为导入流程提供 `mergeBookShelf()`，按 `id` 合并增量。
4. `useHomeBookImport` 记录本轮变更 `changedBooks`，最后只合并变更，不覆盖整个数组。

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -50,6 +50,36 @@ export const sortBooksByRecent = (books: BookInfo[]): BookInfo[] => {
   return [...books].sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a));
 };
 
+const mergeBookListsById = (baseBooks: BookInfo[], nextBooks: BookInfo[]): BookInfo[] => {
+  const merged = new Map<string, BookInfo>();
+  baseBooks.forEach((book) => {
+    merged.set(book.id, book);
+  });
+  nextBooks.forEach((book) => {
+    merged.set(book.id, book);
+  });
+  return sortBooksByRecent(Array.from(merged.values()));
+};
+
+export const mergeBookShelf = (books: BookInfo[]): void => {
+  patchBookShelfSnapshot({
+    books: mergeBookListsById(snapshot.books, books),
+    error: null,
+  });
+};
+
+export const replaceBookShelfFromLoad = (books: BookInfo[]): void => {
+  const currentBookIds = new Set(snapshot.books.map((book) => book.id));
+  const loadedBookIds = new Set(books.map((book) => book.id));
+  const optimisticBooks = snapshot.books.filter((book) => !loadedBookIds.has(book.id) && currentBookIds.has(book.id));
+
+  patchBookShelfSnapshot({
+    books: sortBooksByRecent([...books, ...optimisticBooks]),
+    error: null,
+    hasLoaded: true,
+    loadStatus: 'success',
+  });
+};
+
 // 从数据库加载书架数据（防止竞态条件）
 export const loadBookShelf = async (): Promise<void> => {
-  // 防止重复调用
-  if (isLoadingInProgress || getBookShelfLoading()) {
-    return;
+  if (activeLoadPromise) {
+    return activeLoadPromise;
   }
 
-  isLoadingInProgress = true;
-  setBookShelfLoading(true);
-  let attempts = 0;
+  activeLoadPromise = (async () => {
+    patchBookShelfSnapshot({ error: null, loadStatus: 'loading' });
+    let attempts = 0;
 
-  while (attempts < MAX_BOOK_LOAD_RETRIES) {
-    const result = await getAllBooks<BookInfo>();
-    if (!result.error) {
-      setBookShelf(sortBooksByRecent(result.data));
-      setBookShelfLoading(false);
-      isLoadingInProgress = false;
-      return;
-    }
-    attempts += 1;
-    try {
-      await resumeDB();
-    } catch {
-      // Retry only; failures are reflected by an empty shelf.
+    while (attempts < MAX_BOOK_LOAD_RETRIES) {
+      const result = await getAllBooks<BookInfo>();
+      if (!result.error) {
+        replaceBookShelfFromLoad(result.data);
+        return;
+      }
+      attempts += 1;
+      try {
+        await resumeDB();
+      } catch {
+        // Retry only; final failure keeps the current in-memory shelf.
+      }
     }
-  }
 
-  // 如果所有重试都失败，设置为空数组
-  setBookShelf([]);
-  setBookShelfLoading(false);
-  isLoadingInProgress = false;
+    patchBookShelfSnapshot({
+      error: getErrorMessage(new Error('Failed to load bookshelf')),
+      hasLoaded: snapshot.hasLoaded,
+      loadStatus: 'error',
+    });
+  })().finally(() => {
+    activeLoadPromise = null;
+  });
+
+  return activeLoadPromise;
 };
```

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -14,7 +14,7 @@ import {
   loadBookShelf,
   getBookRecentTimestamp,
+  mergeBookShelf,
   useBookShelf,
 } from '@/store/bookshelf';
@@ -488,6 +488,7 @@ export const useHomeBookImport = (
       }
       let importedCount = 0;
       let failedCount = 0;
+      const changedBooks: BookInfo[] = [];
       const showApplyToRemaining = supportedFiles.length > 1;
@@ -582,6 +583,7 @@ export const useHomeBookImport = (
                 await restoreBackupUserData({ archive, targetBookId: result.data.id });
                 workingBooks = upsertBookListItem(workingBooks, result.data);
+                changedBooks.push(result.data);
                 importedCount += 1;
                 continue;
@@ -609,6 +611,7 @@ export const useHomeBookImport = (
                   await restoreBackupUserData({ archive, targetBookId: result.data.id });
                   workingBooks = upsertBookListItem(workingBooks, result.data);
+                  changedBooks.push(result.data);
                   importedCount += 1;
                   continue;
@@ -626,6 +629,7 @@ export const useHomeBookImport = (
               await restoreBackupUserData({ archive, targetBookId: result.data.id });
               workingBooks = upsertBookListItem(workingBooks, result.data);
+              changedBooks.push(result.data);
               importedCount += 1;
               continue;
@@ -703,6 +707,7 @@ export const useHomeBookImport = (
             }
             workingBooks = upsertBookListItem(workingBooks, result.data);
+            changedBooks.push(result.data);
             importedCount += 1;
             continue;
@@ -733,6 +738,7 @@ export const useHomeBookImport = (
               }
               workingBooks = upsertBookListItem(workingBooks, result.data);
+              changedBooks.push(result.data);
               importedCount += 1;
               continue;
@@ -753,6 +759,7 @@ export const useHomeBookImport = (
           }
           workingBooks = upsertBookListItem(workingBooks, result.data);
+          changedBooks.push(result.data);
           importedCount += 1;
@@ -764,7 +771,9 @@ export const useHomeBookImport = (
         }
       }
 
-      updateBookShelf(workingBooks);
+      if (changedBooks.length > 0) {
+        mergeBookShelf(changedBooks);
+      }
```

### 测试验证

手动验证：

1. 打开首页，同时快速切换 `/` 和 `/shelf`。
2. 在两个窗口中分别导入不同书籍。
3. 导入结束后确认两本书都存在。
4. 在 DevTools 中人为延迟 IndexedDB worker 响应，确认加载完成不会把导入中新书覆盖掉。

自动化建议：

```bash
npm run tsc
npm run build
```

可新增单元测试覆盖：

- `mergeBookShelf([A])` 后 `mergeBookShelf([B])` 结果包含 A 和 B。
- `loadBookShelf()` 并发调用只触发一次底层读取。
- 加载期间插入新书，加载完成后新书仍存在。

### 风险评估

- `replaceBookShelfFromLoad` 的乐观合并可能短暂保留已在其他设备删除但当前内存存在的书，后续需要云同步删除事件才能彻底处理。
- 并发导入同一本书时仍依赖 `addBook()` 的 IndexedDB 唯一键和 `BOOK_ALREADY_EXISTS` 语义，UI 层只负责避免覆盖数组。

---

## 方案 4: 加载失败清空书架 - 数据丢失

### 问题分析

当前 `loadBookShelf()` 在所有重试失败后执行 `setBookShelf([])`。这会把内存中的已有书架清空，用户看到的是空书架，容易误以为数据丢失。对于 IndexedDB 暂时不可用、worker 超时、云同步失败等场景，正确行为应该是保留上一次成功状态，并向 UI 暴露错误。

### 修复步骤

1. 移除加载失败后的清空逻辑。
2. 设置 `loadStatus: 'error'` 和错误消息。
3. 页面保留旧数据展示，并显示轻量错误提示。
4. 只有成功加载到空数组时才展示“空书架”。

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -84,11 +84,13 @@ export const loadBookShelf = async (): Promise<void> => {
       }
     }
 
-    patchBookShelfSnapshot({
-      error: getErrorMessage(new Error('Failed to load bookshelf')),
-      hasLoaded: snapshot.hasLoaded,
-      loadStatus: 'error',
-    });
+    const fallbackMessage = 'Failed to load bookshelf';
+    patchBookShelfSnapshot({
+      books: snapshot.books,
+      error: getErrorMessage(new Error(fallbackMessage), fallbackMessage),
+      hasLoaded: snapshot.hasLoaded,
+      loadStatus: 'error',
+    });
   })().finally(() => {
```

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -1218,7 +1218,7 @@ export const DesktopHome = (): React.JSX.Element => {
   const inputRef = useRef<HTMLInputElement>(null);
   const searchResultRef = useRef<HTMLDivElement>(null);
-  const { bookList, loading } = useHomeBookList();
+  const { bookList, error, hasLoaded, loading } = useHomeBookList();
@@ -1261,6 +1261,9 @@ export const DesktopHome = (): React.JSX.Element => {
           {loading ? (
             <div className="max-w-7xl mx-auto flex justify-center items-center py-20">
               <Loading />
             </div>
+          ) : error ? (
+            <div className="max-w-7xl mx-auto py-8 text-text-color-2">{t('shelf.load_failed')}</div>
+          ) : hasLoaded && bookList.length === 0 ? (
+            <div className="max-w-7xl mx-auto py-8 text-text-color-2">{t('shelf.empty')}</div>
           ) : (
```

```diff
--- a/locales/zh-CN.json
+++ b/locales/zh-CN.json
@@ -1,4 +1,6 @@
 {
+  "shelf.empty": "书架为空",
+  "shelf.load_failed": "书架加载失败，请稍后重试",
```

同样给 `zh-HK.json` 和 `en.json` 增加对应文案：

```diff
--- a/locales/en.json
+++ b/locales/en.json
@@ -1,4 +1,6 @@
 {
+  "shelf.empty": "Your shelf is empty",
+  "shelf.load_failed": "Failed to load shelf. Please try again later",
```

### 测试验证

1. 在 `getAllBooks()` 临时模拟返回 error。
2. 先成功加载一次书架，再触发失败。
3. 确认页面仍显示原有书籍，并显示失败提示。
4. 清空数据库后成功加载，确认才显示空书架。

命令：

```bash
npm run tsc
npm run build
```

### 风险评估

- 保留旧数据可能让用户看到过期状态，但比误清空更安全。
- 需要完善多语言 key，否则 `t('shelf.load_failed')` 可能显示原 key。

---

## 方案 5: 业务层脱节 - 状态不一致

### 问题分析

当前 `addBook()`、`deleteBookById()` 是持久化层 API，`store/bookshelf.ts` 是 UI 状态层，二者没有强一致桥接。导入流程手动调用 `updateBookShelf()`，但其他路径如果直接调用 `addBook()` 或 `deleteBookById()`，全局书架不会同步。`upsertBookInShelf`、`removeBookFromShelf` 已存在但没有被业务层统一使用。

### 修复步骤

1. 在 `store/bookshelf.ts` 新增业务封装：`addBookToShelf()`、`deleteBookFromShelf()`。
2. 页面导入使用 `addBookToShelf()` 或在 `addBook()` 成功后调用 `mergeBookShelf()`。
3. 所有删除入口改用 `deleteBookFromShelf()`。
4. 避免组件直接调用 `updateBookShelf()` 覆盖全局状态。

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -1,6 +1,6 @@
 import { useSyncExternalStore } from 'react';
 import type { BookInfo } from './books';
-import { getAllBooks } from './books';
+import { addBook, deleteBookById, getAllBooks } from './books';
+import type { IDBResult } from '@/lib/indexedDB';
 import { resumeDB } from './index';
 import { getReaderProgress } from '@/lib/readerProgress';
@@ -145,6 +145,35 @@ export const removeBookFromShelf = (bookId: string): void => {
   patchBookShelfSnapshot({ books: currentBooks.filter((book) => book.id !== bookId) });
 };
 
+export const addBookToShelf = async (
+  data: Parameters<typeof addBook>[0],
+): Promise<IDBResult<BookInfo>> => {
+  const result = await addBook(data);
+  if (!result.error && result.data) {
+    mergeBookShelf([result.data]);
+  }
+  return result;
+};
+
+export const deleteBookFromShelf = async (bookId: string): Promise<IDBResult<null>> => {
+  const previousBooks = snapshot.books;
+  patchBookShelfSnapshot({
+    books: previousBooks.filter((book) => book.id !== bookId),
+  });
+
+  const result = await deleteBookById(bookId);
+  if (result.error) {
+    patchBookShelfSnapshot({
+      books: previousBooks,
+      error: result.message || 'Failed to delete book',
+    });
+  }
+  return result;
+};
+
 // 批量更新书架
 export const updateBookShelf = (books: BookInfo[]): void => {
-  setBookShelf(sortBooksByRecent(books));
+  patchBookShelfSnapshot({
+    books: sortBooksByRecent(books),
+    error: null,
+  });
 };
```

示例替换导入流程中的 `addBook`：

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -3,7 +3,6 @@ import { Link, useHref, useNavigate } from 'react-router-dom';
 import { debounce } from 'ranuts/utils';
 import { BookCard, BookCoverFallback } from '@/components/BookCard';
 import {
-  addBook,
   getAllBooks,
   getBookFingerprint,
@@ -15,6 +14,7 @@ import {
   getBookRecentTimestamp,
+  addBookToShelf,
   mergeBookShelf,
   useBookShelf,
 } from '@/store/bookshelf';
@@ -568,7 +568,7 @@ export const useHomeBookImport = (
                 );
                 if (decision.action === 'cancel') continue;
                 clearChapterPaginationCache(existingSameBook.id);
-                const result = await addBook({
+                const result = await addBookToShelf({
```

其余 `addBook({` 调用同样替换为 `addBookToShelf({`。

### 测试验证

- 从首页导入书籍，确认首页和 `/shelf` 同步。
- 从在线搜索添加书籍，若该组件当前直接调用 `addBook`，替换后确认同步。
- 删除书籍后确认两个页面同步移除。
- 删除失败时确认 UI 回滚。

```bash
rg -n "addBook\\(|deleteBookById\\(" -g '!node_modules'
npm run tsc
```

### 风险评估

- `addBookToShelf()` 会在每次成功写入后立即更新 UI；导入批量书籍时可能增加渲染次数。可在批量导入场景继续收集 `changedBooks` 后一次 `mergeBookShelf()`。
- 乐观删除失败回滚需要保留前一个快照，如果同时有其他变更，简单回滚可能覆盖其他变更。更稳妥做法是失败时只把删除的单本书合并回来。

---

## 方案 6: 排序更新滞后

### 问题分析

排序依赖 `getReaderProgress(book.id)`、`modifyTime`、`createTime`。导入和添加书籍会更新 `modifyTime`，但阅读进度变化未必会触发 `refreshBookShelf()`。用户读完一本书返回书架，列表顺序可能仍是旧顺序。

### 修复步骤

1. 在阅读进度写入函数中触发 `refreshBookShelf()`。
2. 如果阅读进度模块不适合依赖 store，可通过事件解耦。
3. 确保排序稳定：时间戳相等时用 `title` 或 `id` 保持确定性。

先改排序稳定性：

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -48,7 +48,13 @@ export const getBookRecentTimestamp = (book: BookInfo): number => {
 
 // 排序书籍列表
 export const sortBooksByRecent = (books: BookInfo[]): BookInfo[] => {
-  return [...books].sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a));
+  return [...books].sort((a, b) => {
+    const timestampDiff = getBookRecentTimestamp(b) - getBookRecentTimestamp(a);
+    if (timestampDiff !== 0) return timestampDiff;
+    const titleDiff = (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN');
+    if (titleDiff !== 0) return titleDiff;
+    return a.id.localeCompare(b.id);
+  });
 };
```

在 `lib/readerProgress.ts` 的进度保存入口触发刷新。示例代码如下，具体函数名以实际文件为准：

```diff
--- a/lib/readerProgress.ts
+++ b/lib/readerProgress.ts
@@ -1,5 +1,6 @@
 import { createSignal } from 'ranuts/utils';
+import { refreshBookShelf } from '@/store/bookshelf';
@@ -80,6 +81,7 @@ export const saveReaderProgress = (bookId: string, progress: ReaderProgress): void => {
   const nextProgress = { ...progress, updatedAt: Date.now() };
   localStorage.setItem(getReaderProgressKey(bookId), JSON.stringify(nextProgress));
   setReaderProgressRevision((value) => value + 1);
+  refreshBookShelf();
 };
```

如果担心循环依赖，改为 DOM 事件：

```diff
--- a/lib/readerProgress.ts
+++ b/lib/readerProgress.ts
@@ -80,6 +80,7 @@ export const saveReaderProgress = (bookId: string, progress: ReaderProgress): void => {
   const nextProgress = { ...progress, updatedAt: Date.now() };
   localStorage.setItem(getReaderProgressKey(bookId), JSON.stringify(nextProgress));
   setReaderProgressRevision((value) => value + 1);
+  window.dispatchEvent(new CustomEvent('weread:reader-progress-change', { detail: { bookId } }));
 };
```

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -154,3 +154,13 @@ export const refreshBookShelf = (): void => {
   const currentBooks = getBookShelf();
   patchBookShelfSnapshot({ books: sortBooksByRecent(currentBooks) });
 };
+
+if (typeof window !== 'undefined') {
+  window.addEventListener('weread:reader-progress-change', () => {
+    if (snapshot.books.length === 0) return;
+    refreshBookShelf();
+  });
+}
```

### 测试验证

1. 导入两本书。
2. 打开较旧的一本并产生阅读进度。
3. 返回首页或 `/shelf`，确认该书排到前面。
4. 多本书时间戳相同时刷新页面，顺序不抖动。

```bash
npm run tsc
npm run build
```

### 风险评估

- 每次进度更新都排序可能偏频繁。若阅读器高频保存进度，应节流 `refreshBookShelf()`。
- 直接从 `readerProgress` import `refreshBookShelf` 可能形成循环依赖，事件方式更稳。

---

## 方案 7: MobileHome 缺少 Loading UI

### 问题分析

`DesktopHome` 已在书架区域展示 `Loading`，但 `MobileHome` 忽略了 `loading`，加载期间直接显示导入卡和空列表。移动端用户会误以为书架为空。

### 修复步骤

1. 在 `MobileHome` 解构 `loading`、`error`、`hasLoaded`。
2. 复用移动端布局加入 Loading、错误和空状态。
3. 保证搜索结果展开时不显示书架 loading。

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -1320,7 +1320,7 @@ export const MobileHome = (): React.JSX.Element => {
   const inputRef = useRef<HTMLInputElement>(null);
   const searchResultRef = useRef<HTMLDivElement>(null);
-  const { bookList, loading } = useHomeBookList();
+  const { bookList, error, hasLoaded, loading } = useHomeBookList();
@@ -1383,16 +1383,26 @@ export const MobileHome = (): React.JSX.Element => {
               <HomeArrowRightIcon style={{ width: 14, height: 14 }} />
             </Link>
           </div>
-          <div className="flex flex-row flex-wrap justify-start items-center">
-            <ImportCard
-              className="w-24 h-36 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
-              iconSize={54}
-              onAdd={onAdd}
-            />
-            {recentBookList.map((book) => (
-              <BookCard book={book} key={book.id} />
-            ))}
-          </div>
+          {loading ? (
+            <div className="flex justify-center items-center py-16">
+              <Loading />
+            </div>
+          ) : error ? (
+            <div className="py-8 text-text-color-2">{t('shelf.load_failed')}</div>
+          ) : hasLoaded && bookList.length === 0 ? (
+            <div className="py-8 text-text-color-2">{t('shelf.empty')}</div>
+          ) : (
+            <div className="flex flex-row flex-wrap justify-start items-center">
+              <ImportCard
+                className="w-24 h-36 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
+                iconSize={54}
+                onAdd={onAdd}
+              />
+              {recentBookList.map((book) => (
+                <BookCard book={book} key={book.id} />
+              ))}
+            </div>
+          )}
         </div>
       )}
```

### 测试验证

- 模拟慢速 IndexedDB，移动端 viewport 打开首页。
- 确认加载期间显示 `Loading`。
- 成功加载空数组时显示空状态。
- 搜索输入时 loading 区域不抢占搜索结果。

### 风险评估

- 移动端 loading 会让导入入口暂时不可见，这是合理的，因为导入冲突检测依赖当前书架状态。
- 空状态文案需要多语言补齐。

---

## 方案 8: 盲目懒加载损害 LCP

### 问题分析

`router/index.tsx` 对 `Home`、`BookDetail`、`Shelf` 全部使用 `lazy()`。首页是默认首屏，懒加载会让浏览器先加载入口和 router，再额外请求首页 chunk，增加首屏 waterfall，损害 LCP。Reader 体积较大适合继续懒加载，Shelf 可按使用频率决定，这里保守只取消首页懒加载。

### 修复步骤

1. 静态导入 `Home`。
2. 保留 `BookDetail` 和 `Shelf` 懒加载。
3. 首页路由不包 Suspense，避免首屏 fallback 闪烁。
4. 可选：在首页空闲时预取 Shelf chunk。

```diff
--- a/router/index.tsx
+++ b/router/index.tsx
@@ -1,14 +1,13 @@
 import { Suspense, lazy, useEffect } from 'react';
 import { useNavigate, useRoutes } from 'react-router-dom';
 import type { ReactElement } from 'react';
 import { Loading } from '@/components/Loading/index';
+import { Home } from '@/pages/home/index';
 
-// Each route's bundle is fetched on demand. The reader page in particular
-// pulls in EPUB parsing, the worker glue, and large rendering modules, so
-// keeping it out of the initial chunk meaningfully cuts time-to-interactive.
-const Home = lazy(() => import('@/pages/home/index').then((m) => ({ default: m.Home })));
+// Reader pulls in EPUB parsing, worker glue, and rendering modules, so keep it lazy.
 const BookDetail = lazy(() => import('@/pages/book-detail/index').then((m) => ({ default: m.BookDetail })));
 const Shelf = lazy(() => import('@/pages/shelf/index').then((m) => ({ default: m.Shelf })));
@@ -34,7 +33,7 @@ export const Routes = (): ReactElement | null => {
   const defaultRoute = [
     {
       path: ROUTE_PATH.HOME,
-      element: withSuspense(<Home />),
+      element: <Home />,
     },
```

可选预取：

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -1208,6 +1208,14 @@ export const useBookSearchNativeNavigation = (searchResultRef: React.RefObject<H
   }, [navigate, searchResultRef]);
 };
 
+const prefetchShelfRoute = (): void => {
+  if (typeof window === 'undefined') return;
+  window.requestIdleCallback?.(() => {
+    void import('@/pages/shelf/index');
+  });
+};
+
 export const Home = (): React.JSX.Element => {
+  useEffect(prefetchShelfRoute, []);
   const [currentDevice] = useCheckDevice();
```

### 测试验证

```bash
npm run build
npm run preview
```

验证点：

- 首页首屏不出现 Suspense fallback 的额外闪烁。
- Network 面板中首页模块不再作为路由懒加载 chunk 二次请求。
- Reader chunk 仍独立懒加载。
- Lighthouse LCP 对比修复前后。

### 风险评估

- 首页 bundle 变大，非首页入口的理论性能变差。但路由默认入口是首页，收益更直接。
- 如果部署环境有深链 Reader 首屏需求，可结合 route-level preload 或按路径动态选择。

---

## 方案 9: 无法区分“未加载”和“空书架”

### 问题分析

当前状态只有 `BookInfo[]` 和 `loading`。当数组为空时可能代表：

- 尚未加载。
- 正在加载。
- 加载失败后被清空。
- 成功加载，书架确实为空。

UI 只能用 `books.length === 0` 判断，导致误触发重复加载，也无法展示正确空状态。

### 修复步骤

1. 使用方案 1 中的 `BookShelfSnapshot`。
2. 页面根据 `hasLoaded` 和 `loadStatus` 判断状态。
3. `loadBookShelf()` 成功后设置 `hasLoaded: true`。
4. 加载失败不改变 `hasLoaded`，保留旧状态。

核心 store 已在方案 1/4 覆盖，页面补充如下：

```diff
--- a/pages/shelf/index.tsx
+++ b/pages/shelf/index.tsx
@@ -169,7 +169,7 @@ export const Shelf = (): React.JSX.Element => {
   const inputRef = useRef<HTMLInputElement>(null);
   const searchResultRef = useRef<HTMLDivElement>(null);
-  const { books, loading } = useShelfBooks();
+  const { books, error, hasLoaded, loading } = useShelfBooks();
@@ -279,6 +279,10 @@ export const Shelf = (): React.JSX.Element => {
           <div className="shelf-loading">
             <Loading />
           </div>
+        ) : error ? (
+          <div className="shelf-empty">{t('shelf.load_failed')}</div>
+        ) : hasLoaded && visibleBooks.length === 0 ? (
+          <div className="shelf-empty">{t(statusFilter === 'all' ? 'shelf.empty' : 'shelf.filter_empty')}</div>
         ) : (
           <div className="shelf-list">
```

```diff
--- a/locales/zh-CN.json
+++ b/locales/zh-CN.json
@@ -1,5 +1,7 @@
 {
   "shelf.empty": "书架为空",
+  "shelf.filter_empty": "没有符合条件的书籍",
   "shelf.load_failed": "书架加载失败，请稍后重试",
```

```diff
--- a/locales/en.json
+++ b/locales/en.json
@@ -1,5 +1,7 @@
 {
   "shelf.empty": "Your shelf is empty",
+  "shelf.filter_empty": "No books match this filter",
   "shelf.load_failed": "Failed to load shelf. Please try again later",
```

### 测试验证

- 首次进入页面，`loadStatus` 从 `idle` 到 `loading` 到 `success`。
- 数据库为空，显示空书架。
- 筛选无结果，显示筛选空状态。
- 加载失败，显示失败状态而非空书架。

### 风险评估

- UI 分支增加后，需要保证 `ImportCard` 在空书架状态仍可访问。建议空状态下也渲染导入入口，或在空状态文案下提供导入按钮。
- 多语言 key 必须完整同步。

---

## 方案 10: 并发导入覆盖问题

### 问题分析

`useHomeBookImport` 允许多次点击导入，且导入流程较长。每个流程开始时读取一次 `latestBooks` 并维护自己的 `workingBooks`。如果流程 A 和 B 并发：

1. A 读取书架 `[X]`。
2. B 读取书架 `[X]`。
3. A 导入 `[A1]`，更新全局为 `[A1, X]`。
4. B 导入 `[B1]`，最后 `updateBookShelf([B1, X])`，A1 丢失。

### 修复步骤

1. 增加 `isImportingRef`，防止同一页面重复打开导入流程。
2. 使用 `changedBooks` 增量合并，避免覆盖。
3. UI 层 `ImportCard` 支持 disabled。
4. 导入结束后释放锁。

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -438,6 +438,7 @@ export const useHomeBookImport = (
   const conflictResolverRef = useRef<((decision: ImportConflictDecision) => void) | null>(null);
   const sharedConflictDecisionRef = useRef<ImportConflictDecision | null>(null);
+  const isImportingRef = useRef(false);
   const [conflictState, setConflictState] = useState<ImportConflictState | null>(null);
@@ -466,6 +467,11 @@ export const useHomeBookImport = (
 
   const onAdd = useCallback(() => {
     void (async () => {
+      if (isImportingRef.current) {
+        showGlobalFallback({ message: t('import.in_progress'), tone: 'info' });
+        return;
+      }
+      isImportingRef.current = true;
       sharedConflictDecisionRef.current = null;
-      const files = await chooseBookFiles();
-      if (files.length === 0) return;
+      try {
+        const files = await chooseBookFiles();
+        if (files.length === 0) return;
@@ -780,6 +786,9 @@ export const useHomeBookImport = (
       } else if (failedCount > 0) {
         showGlobalFallback({ message: t('import.failed'), tone: 'error' });
       }
+      } finally {
+        isImportingRef.current = false;
+      }
     })();
   }, [requestConflictDecision]);
```

```diff
--- a/locales/zh-CN.json
+++ b/locales/zh-CN.json
@@ -1,4 +1,5 @@
 {
+  "import.in_progress": "正在导入，请等待当前任务完成",
```

```diff
--- a/locales/en.json
+++ b/locales/en.json
@@ -1,4 +1,5 @@
 {
+  "import.in_progress": "Import is already in progress",
```

更完整的 UI disabled 方案：

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -1176,12 +1176,14 @@ interface ImportCardProps {
   className: string;
+  disabled?: boolean;
   iconSize: number;
   onAdd: () => void;
 }
 
-export const ImportCard = ({ className, iconSize, onAdd }: ImportCardProps): React.JSX.Element => {
+export const ImportCard = ({ className, disabled = false, iconSize, onAdd }: ImportCardProps): React.JSX.Element => {
   const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
+    if (disabled) return;
     if (e.key !== 'Enter' && e.key !== ' ') return;
@@ -1191,7 +1193,14 @@ export const ImportCard = ({ className, iconSize, onAdd }: ImportCardProps): Rea
   };
 
   return (
-    <div className={className} role="button" tabIndex={0} onClick={onAdd} onKeyDown={onKeyDown}>
+    <div
+      aria-disabled={disabled}
+      className={className}
+      role="button"
+      tabIndex={disabled ? -1 : 0}
+      onClick={disabled ? undefined : onAdd}
+      onKeyDown={onKeyDown}
+    >
```

### 测试验证

- 快速连续点击导入卡，仅出现一个文件选择流程或提示导入中。
- 两个浏览器窗口并发导入不同书籍，最终全局书架包含所有新增书籍。
- 批量导入时冲突对话框仍能正常 resolve。
- 取消文件选择后锁释放，可以再次导入。

### 风险评估

- 单页面锁不能阻止多标签页并发。多标签页需 BroadcastChannel 或 IndexedDB 级事务锁。
- 如果 `chooseBookFiles()` 抛错，`finally` 已保证释放锁。

---

## 方案 11: 排序不变量未保护

### 问题分析

`upsertBookInShelf()` 假设当前 `books` 已按最近时间降序排列，使用二分插入。如果外部调用 `setBookShelf` 或 `updateBookShelf` 传入未排序数组，二分插入会在错误前提上工作，导致排序不稳定。当前旧代码曾导出 `setBookShelf`，这类不变量更容易被破坏。

### 修复步骤

1. 不导出底层 setter。
2. 所有写入口都调用 `sortBooksByRecent()` 或基于已排序状态操作。
3. 开发环境加入排序断言。
4. `findInsertIndex` 只接受已排序数组，并在 dev 下校验。

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -55,6 +55,22 @@ export const sortBooksByRecent = (books: BookInfo[]): BookInfo[] => {
   });
 };
 
+const isSortedByRecent = (books: BookInfo[]): boolean => {
+  for (let index = 1; index < books.length; index += 1) {
+    if (getBookRecentTimestamp(books[index - 1]) < getBookRecentTimestamp(books[index])) {
+      return false;
+    }
+  }
+  return true;
+};
+
+const assertSortedByRecent = (books: BookInfo[]): void => {
+  if (!import.meta.env.DEV) return;
+  if (!isSortedByRecent(books)) {
+    console.warn('[bookshelf] expected books to be sorted by recent timestamp');
+  }
+};
+
 const mergeBookListsById = (baseBooks: BookInfo[], nextBooks: BookInfo[]): BookInfo[] => {
@@ -99,6 +115,7 @@ export const loadBookShelf = async (): Promise<void> => {
 const findInsertIndex = (books: BookInfo[], newBook: BookInfo): number => {
+  assertSortedByRecent(books);
   const newTimestamp = getBookRecentTimestamp(newBook);
```

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -124,7 +141,10 @@ export const upsertBookInShelf = (book: BookInfo): void => {
   const currentBooks = getBookShelf();
+  assertSortedByRecent(currentBooks);
   const index = currentBooks.findIndex((item) => item.id === book.id);
```

进一步简化风险：如果列表不大，直接统一排序更稳：

```diff
--- a/store/bookshelf.ts
+++ b/store/bookshelf.ts
@@ -124,34 +124,10 @@ export const upsertBookInShelf = (book: BookInfo): void => {
 export const upsertBookInShelf = (book: BookInfo): void => {
   const currentBooks = getBookShelf();
-  const index = currentBooks.findIndex((item) => item.id === book.id);
-
-  if (index === -1) {
-    const insertIndex = findInsertIndex(currentBooks, book);
-    const updatedBooks = [
-      ...currentBooks.slice(0, insertIndex),
-      book,
-      ...currentBooks.slice(insertIndex)
-    ];
-    setBookShelf(updatedBooks);
-  } else {
-    const oldTimestamp = getBookRecentTimestamp(currentBooks[index]);
-    const newTimestamp = getBookRecentTimestamp(book);
-
-    if (oldTimestamp === newTimestamp) {
-      const updatedBooks = currentBooks.map((item) =>
-        item.id === book.id ? book : item
-      );
-      setBookShelf(updatedBooks);
-    } else {
-      const booksWithoutOld = currentBooks.filter((item) => item.id !== book.id);
-      const insertIndex = findInsertIndex(booksWithoutOld, book);
-      const updatedBooks = [
-        ...booksWithoutOld.slice(0, insertIndex),
-        book,
-        ...booksWithoutOld.slice(insertIndex)
-      ];
-      setBookShelf(updatedBooks);
-    }
-  }
+  const nextBooks = currentBooks.filter((item) => item.id !== book.id);
+  nextBooks.push(book);
+  patchBookShelfSnapshot({ books: sortBooksByRecent(nextBooks), error: null });
 };
```

推荐先采用统一排序版本，除非书架规模已证明需要二分插入优化。

### 测试验证

- 构造乱序数组调用 `updateBookShelf()`，结果应有序。
- 连续 `upsertBookInShelf()` 多本书，结果应始终按最近时间降序。
- 时间戳相同的书顺序稳定。
- Dev 环境不出现排序断言警告。

### 风险评估

- 统一排序是 O(n log n)，理论性能低于二分插入。但书架列表通常远小于需要优化的数据量，正确性优先。
- 若保留二分插入，必须保证所有入口维护排序不变量。

---

## 方案 12: 未使用的导入

### 问题分析

当前存在未使用项：

- `pages/home/index.tsx` 导入 `upsertBookInShelf`，实际未使用。
- `pages/shelf/index.tsx` 定义 `MAX_SHELF_BOOK_LOAD_RETRIES`，实际未使用。
- `pages/shelf/index.tsx` 导入 `Dispatch`、`SetStateAction`，当前片段未看到使用。
- `lib/performance.ts` catch 参数 `e` 未使用。
- `vite.config.ts` 默认导入 visualizer 后如按环境启用，需要类型处理避免 lint 问题。

这些会导致 ESLint 或 TypeScript 严格配置失败，也增加维护噪声。

### 修复步骤

1. 删除未使用 import 和常量。
2. catch 不需要参数时省略。
3. 运行 lint 确认无新增问题。

```diff
--- a/pages/home/index.tsx
+++ b/pages/home/index.tsx
@@ -14,7 +14,6 @@ import {
   getBookShelf,
   getBookShelfLoading,
   loadBookShelf,
-  upsertBookInShelf,
   updateBookShelf,
   getBookRecentTimestamp,
 } from '@/store/bookshelf';
```

```diff
--- a/pages/shelf/index.tsx
+++ b/pages/shelf/index.tsx
@@ -1,5 +1,4 @@
 import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
-import type { Dispatch, SetStateAction } from 'react';
@@ -38,8 +37,6 @@ import { t } from '@/locales';
 import './index.scss';
 
-const MAX_SHELF_BOOK_LOAD_RETRIES = 3;
-
 type ShelfStatusFilterValue = 'all' | ReaderBookShelfStatus;
```

```diff
--- a/lib/performance.ts
+++ b/lib/performance.ts
@@ -78,7 +78,7 @@ export const monitorLongTasks = (): void => {
 
     observer.observe({ entryTypes: ['longtask'] });
-  } catch (e) {
+  } catch {
     // Long Task API not supported
   }
 };
```

### 测试验证

```bash
npm run lint
npm run tsc
```

验证点：

- 无 `no-unused-vars` / `@typescript-eslint/no-unused-vars` 报错。
- 删除 import 后相关文件仍编译通过。

### 风险评估

- 删除未使用项无运行时风险。
- 如果后续方案替换导入，需要避免先删后又新增造成冲突；按最终补丁合并即可。

---

## 方案 13: 性能监控未启用

### 问题分析

`lib/performance.ts` 已实现 `initPerformanceMonitoring()`，但入口 `index.tsx` 没有调用。即使调用，当前实现也有几个问题：

- 仅 `import.meta.env.DEV` 启用，无法通过环境变量在测试/预发启用。
- `measurePageLoad()` 在 `load` 事件后才创建 LCP observer，可能错过 LCP entry。
- `setInterval(monitorMemory, 30000)` 没有清理。
- 使用 deprecated `performance.timing`，可逐步转向 Navigation Timing Level 2。

### 修复步骤

1. 在 `index.tsx` 调用 `initPerformanceMonitoring()`。
2. 支持 `VITE_ENABLE_PERFORMANCE_MONITORING=true`。
3. 提前注册 LCP observer。
4. 返回 cleanup 函数，虽然入口长期运行，但便于测试和热更新。
5. 避免生产默认 console 噪声。

```diff
--- a/index.tsx
+++ b/index.tsx
@@ -3,6 +3,7 @@ import { BrowserRouter } from 'react-router-dom';
 import { App } from './app';
 import { registerPWAServiceWorker } from './lib/pwa';
 import { bootstrapReaderSettings } from './lib/readerSettings';
+import { initPerformanceMonitoring } from './lib/performance';
 import 'ranui/typings';
 import './styles/base.css';
 
 bootstrapReaderSettings();
 registerPWAServiceWorker();
+initPerformanceMonitoring();
```

```diff
--- a/lib/performance.ts
+++ b/lib/performance.ts
@@ -14,6 +14,8 @@ interface PerformanceMetrics {
   timeToInteractive?: number;
 }
 
+type Cleanup = () => void;
+
 /**
  * 测量页面加载性能
  */
-export const measurePageLoad = (): void => {
-  if (typeof window === 'undefined' || !window.performance) return;
+export const measurePageLoad = (): Cleanup => {
+  if (typeof window === 'undefined' || !window.performance) return () => {};
+
+  let largestContentfulPaint = 0;
+  let lcpObserver: PerformanceObserver | null = null;
+
+  if ('PerformanceObserver' in window) {
+    try {
+      lcpObserver = new PerformanceObserver((entryList) => {
+        const entries = entryList.getEntries();
+        const lastEntry = entries[entries.length - 1] as PerformanceEntry & {
+          loadTime?: number;
+          renderTime?: number;
+        };
+        largestContentfulPaint = lastEntry.renderTime || lastEntry.loadTime || lastEntry.startTime;
+      });
+      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
+    } catch {
+      lcpObserver = null;
+    }
+  }
 
-  window.addEventListener('load', () => {
+  const handleLoad = (): void => {
     // 等待所有性能指标准备就绪
-    setTimeout(() => {
-      const perfData = window.performance.timing;
-      const navigationStart = perfData.navigationStart;
+    window.setTimeout(() => {
+      const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
+      const pageLoad = navigationEntry ? navigationEntry.loadEventEnd : performance.now();
+      const domReady = navigationEntry ? navigationEntry.domContentLoadedEventEnd : 0;
 
       const metrics: PerformanceMetrics = {
-        pageLoad: perfData.loadEventEnd - navigationStart,
-        domReady: perfData.domContentLoadedEventEnd - navigationStart,
+        pageLoad,
+        domReady,
         firstPaint: 0,
         firstContentfulPaint: 0,
+        largestContentfulPaint,
       };
@@ -40,22 +62,6 @@ export const measurePageLoad = (): void => {
         }
       });
 
-      // 获取 LCP (Largest Contentful Paint)
-      try {
-        const lcpObserver = new PerformanceObserver((entryList) => {
-          const entries = entryList.getEntries();
-          const lastEntry = entries[entries.length - 1] as any;
-          metrics.largestContentfulPaint = lastEntry.renderTime || lastEntry.loadTime;
-        });
-        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
-      } catch {
-        // LCP not supported
-      }
-
       console.log('[Performance Metrics]', {
@@ -69,7 +75,13 @@ export const measurePageLoad = (): void => {
       // reportToAnalytics(metrics);
     }, 0);
-  });
+  };
+
+  window.addEventListener('load', handleLoad, { once: true });
+  return () => {
+    window.removeEventListener('load', handleLoad);
+    lcpObserver?.disconnect();
+  };
 };
@@ -136,13 +148,24 @@ export const monitorMemory = (): void => {
 /**
  * 初始化性能监控（在应用启动时调用）
  */
-export const initPerformanceMonitoring = (): void => {
-  if (import.meta.env.DEV) {
-    measurePageLoad();
+export const initPerformanceMonitoring = (): Cleanup => {
+  const enabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_PERFORMANCE_MONITORING === 'true';
+  if (!enabled) return () => {};
+
+  const cleanupPageLoad = measurePageLoad();
+  let memoryTimer: number | null = null;
+
+  if (typeof window !== 'undefined') {
     monitorLongTasks();
 
     // 每 30 秒监控一次内存
-    setInterval(monitorMemory, 30000);
+    memoryTimer = window.setInterval(monitorMemory, 30000);
   }
+
+  return () => {
+    cleanupPageLoad();
+    if (memoryTimer !== null) {
+      window.clearInterval(memoryTimer);
+    }
+  };
 };
```

### 测试验证

```bash
npm run dev
```

验证点：

- 开发环境 Console 输出 `[Performance Metrics]`。
- Chrome PerformanceObserver 支持时能看到 LCP。
- 生产默认构建不输出性能日志。
- 设置 `VITE_ENABLE_PERFORMANCE_MONITORING=true` 后预发环境启用。

构建验证：

```bash
npm run tsc
npm run build
```

### 风险评估

- Console 性能日志可能干扰调试输出，因此默认只在 DEV 或显式环境变量启用。
- LCP observer 使用 `buffered: true`，老浏览器可能不支持，已用 try/catch 兜底。
- 若后续接入真实 analytics，上报需采样并脱敏，避免上传书名、用户标识等隐私数据。

---
SESSION_ID: 019efa29-7759-7c90-9d91-58d682137f41
