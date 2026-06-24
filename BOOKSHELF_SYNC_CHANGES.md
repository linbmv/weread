# 书架状态同步改造 - 方案3实现

## 问题描述

在原有实现中，首页和 `/shelf` 页面的书架数据不同步：
- 在首页添加书籍后，`/shelf` 页面不会显示
- 在 `/shelf` 添加书籍后，首页不会显示
- 需要刷新页面才能看到更新

**根本原因：**
首页使用了模块级缓存 `homeBookListCache`，并且只在首次加载时从数据库读取数据。当用户在 `/shelf` 添加书籍后返回首页，首页不会重新加载数据，导致数据不同步。

## 解决方案：全局状态管理（方案3）

使用 `ranuts/utils` 的 `createSignal` 创建全局响应式状态，让首页和 `/shelf` 共享同一个内存中的书籍列表。

## 实现细节

### 1. 创建全局书架状态管理 (`store/bookshelf.ts`)

新增文件，提供以下功能：

- **状态管理**
  - `getBookShelf()` - 获取当前书架列表
  - `setBookShelf(books)` - 更新书架列表
  - `getBookShelfLoading()` - 获取加载状态
  - `setBookShelfLoading(loading)` - 更新加载状态

- **核心函数**
  - `loadBookShelf()` - 从数据库加载书架（带重试机制）
  - `upsertBookInShelf(book)` - 添加或更新书籍
  - `removeBookFromShelf(bookId)` - 移除书籍
  - `updateBookShelf(books)` - 批量更新书架
  - `refreshBookShelf()` - 刷新排序

- **工具函数**
  - `getBookRecentTimestamp(book)` - 获取书籍最近时间戳
  - `sortBooksByRecent(books)` - 按最近时间排序

### 2. 修改首页 (`pages/home/index.tsx`)

**移除的代码：**
- 模块级缓存 `homeBookListCache`
- `MAX_BOOK_LOAD_RETRIES` 常量（移到 bookshelf.ts）
- `getBookRecentTimestamp` 函数（移到 bookshelf.ts）
- 复杂的 `useHomeBookList` hook 实现

**新增的代码：**
```typescript
import { useSignal } from 'ranuts/utils';
import {
  getBookShelf,
  getBookShelfLoading,
  loadBookShelf,
  upsertBookInShelf,
  updateBookShelf,
  getBookRecentTimestamp,
} from '@/store/bookshelf';

// 简化的 hook
const useHomeBookList = (): { bookList: BookInfo[]; loading: boolean } => {
  const bookList = useSignal(getBookShelf);
  const loading = useSignal(getBookShelfLoading);

  useEffect(() => {
    // 只在书架为空时加载数据
    if (bookList.length === 0 && !loading) {
      loadBookShelf();
    }
  }, []);

  return { bookList, loading };
};
```

**函数签名变更：**
- `useHomeBookImport(bookList, setBookList)` → `useHomeBookImport(bookList)`
- 内部使用 `updateBookShelf(workingBooks)` 替代 `setBookList(workingBooks)`

### 3. 修改书架页面 (`pages/shelf/index.tsx`)

**移除的代码：**
- `getBookRecentTimestamp` 函数（使用 bookshelf.ts 中的版本）
- `sortShelfBooks` 函数（使用 bookshelf.ts 中的 `sortBooksByRecent`）
- 复杂的 `useShelfBooks` hook 实现（含重试逻辑和状态管理）

**新增的代码：**
```typescript
import { useSignal } from 'ranuts/utils';
import {
  getBookShelf,
  getBookShelfLoading,
  loadBookShelf,
} from '@/store/bookshelf';

// 简化的 hook
const useShelfBooks = (): { books: BookInfo[]; loading: boolean } => {
  const books = useSignal(getBookShelf);
  const loading = useSignal(getBookShelfLoading);

  useEffect(() => {
    if (books.length === 0 && !loading) {
      loadBookShelf();
    }
  }, []);

  return { books, loading };
};
```

**函数签名变更：**
- `useHomeBookImport(books, setBooks)` → `useHomeBookImport(books)`

## 工作原理

### 数据流

```
┌─────────────────────────────────────────────────────────┐
│               全局状态 (bookshelf.ts)                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  bookShelfSignal: BookInfo[]                    │   │
│  │  bookShelfLoadingSignal: boolean                │   │
│  └─────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────┬───────────────┘
             │                            │
             │                            │
    ┌────────▼────────┐         ┌────────▼────────┐
    │   首页 (Home)    │         │  书架 (/shelf)   │
    │                 │         │                 │
    │ useSignal()     │         │ useSignal()     │
    │ 自动订阅变化     │         │ 自动订阅变化     │
    └─────────────────┘         └─────────────────┘
```

### 响应式更新

1. **用户在首页添加书籍**
   ```
   onAdd() → addBook() → updateBookShelf(newBooks)
                              ↓
                     bookShelfSignal 更新
                              ↓
                ┌──────────────┴──────────────┐
                ↓                             ↓
           首页自动更新                  /shelf 自动更新
   ```

2. **用户在 /shelf 添加书籍**
   ```
   onAdd() → addBook() → updateBookShelf(newBooks)
                              ↓
                     bookShelfSignal 更新
                              ↓
                ┌──────────────┴──────────────┐
                ↓                             ↓
           首页自动更新                  /shelf 自动更新
   ```

### 懒加载策略

为了性能优化，采用懒加载策略：

```typescript
useEffect(() => {
  // 只在书架为空且未加载时才从数据库读取
  if (bookList.length === 0 && !loading) {
    loadBookShelf();
  }
}, []);
```

**好处：**
- 应用启动时不会自动加载书架数据
- 只有当用户访问首页或 /shelf 时才加载
- 加载一次后，数据保留在内存中
- 页面切换无需重新查询数据库

## 优势对比

### 方案1（路由监听重新加载）
```typescript
useEffect(() => {
  loadBooks(); // 每次进入页面都查询数据库
}, [location.pathname]);
```

❌ 每次切换页面都要查询 IndexedDB（性能开销）  
❌ 首页和 /shelf 仍是两个独立状态  
❌ 有短暂的加载过程

### 方案3（全局状态管理）✅

✅ **真正的数据共享** - 首页和 /shelf 使用同一个内存数组  
✅ **实时同步** - 任何页面添加/删除书籍，其他页面立即更新  
✅ **性能最优** - 只在应用启动时加载一次数据库  
✅ **无加载延迟** - 页面切换时数据已在内存中  
✅ **代码更简洁** - 移除了复杂的缓存逻辑

## 测试要点

1. **数据同步测试**
   - [ ] 在首页添加书籍，切换到 /shelf 应立即显示
   - [ ] 在 /shelf 添加书籍，切换到首页应立即显示
   - [ ] 在首页导入多本书籍，/shelf 应全部显示

2. **排序测试**
   - [ ] 新添加的书籍应出现在列表顶部
   - [ ] 打开过的书籍应排在前面
   - [ ] 排序逻辑应一致（基于最近时间戳）

3. **性能测试**
   - [ ] 首次进入首页/shelf 应加载数据库
   - [ ] 后续切换页面应无加载延迟
   - [ ] 添加书籍后更新应是瞬时的

4. **边界情况**
   - [ ] 空书架状态正常显示
   - [ ] 数据库加载失败时的处理
   - [ ] 大量书籍时的性能表现

## 迁移影响

### 兼容性

✅ **向后兼容** - 不影响现有数据和功能  
✅ **API 不变** - 导出的组件和 hooks 签名基本保持一致  
✅ **渐进式** - 可以逐步迁移其他使用书架数据的组件

### 需要注意的变更

1. `useHomeBookImport` 不再需要 `setBookList` 参数
2. 所有直接操作书架列表的地方应使用 `store/bookshelf.ts` 中的函数
3. `getBookRecentTimestamp` 从 `store/bookshelf.ts` 导入，而非局部定义

## 后续优化建议

1. **扩展全局状态**
   - 将其他共享数据（如阅读进度、书签等）也迁移到全局状态
   - 统一状态管理方式

2. **离线同步**
   - 当用户在线时，同步到云端
   - 实现跨设备书架同步

3. **性能监控**
   - 添加性能埋点，监控书架加载和更新时间
   - 优化大量书籍时的渲染性能

4. **持久化优化**
   - 考虑使用 localStorage 做首屏缓存
   - 减少 IndexedDB 查询次数
