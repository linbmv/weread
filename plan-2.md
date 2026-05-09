# 本地书库加载功能实施计划

## 目标

为当前阅读器增加“本地书库”能力：项目构建时扫描指定本地书籍目录，生成可信的本地 manifest；运行时首页自动展示这些内置书籍；清空 IndexedDB 后，内置书籍仍然存在，并可在打开时重新从本地资源解析和缓存。

本功能不改变用户导入书籍的主流程。用户导入书籍仍然写入 IndexedDB；内置书籍本体来自本地 manifest 和静态资源 URL；用户数据继续保存在浏览器 IndexedDB。

## 当前项目现状

1. 首页书架数据来源：
   - `pages/home/index.tsx` 通过 `getAllBooks<BookInfo>()` 获取书籍列表。
   - `getAllBooks` 最终从 IndexedDB 的 `books_info` 读取。
   - 当前没有读取 `assets/books` 的逻辑。

2. 阅读页数据来源：
   - `pages/book-detail/index.tsx` 通过 URL 中的 `id` 调用 `getBookById<BookInfo>(id)`。
   - 如果 IndexedDB 中不存在对应 `document`，当前会返回首页。

3. 导入解析流程：
   - 首页通过文件选择器拿到 `File`。
   - `lib/bookImporter.ts#importBookFile` 读取 TXT/EPUB，生成 `ReaderBookDocument`、资源记录和 `fingerprint`。
   - `store/books.ts#addBook` 把解析结果写入 IndexedDB。

4. 现有 `assets/books`：
   - 目录下已有多本 TXT 测试书籍和部分图片资源。
   - 当前它们没有被硬编码引用，也不会自动显示在书库中。

## 设计原则

1. 本地 manifest 是内置书籍唯一可信来源。
2. 内置书籍本体是只读源，不被用户导入覆盖。
3. IndexedDB 是解析缓存和用户数据主存储。
4. 首页展示需要合并两种来源：
   - 用户导入书籍：来自 IndexedDB。
   - 内置书籍：来自 manifest，并可叠加 IndexedDB 中的解析缓存状态。
5. 阅读页打开内置书时优先读 IndexedDB 缓存；缓存不存在时通过 manifest 的 URL 重新 fetch 原文件、解析、写入缓存，再进入阅读。
6. 书籍身份必须稳定，避免用户数据因为重新构建或清库后换 ID。

## 数据模型调整

### BookInfo 扩展字段

建议在 `store/books.ts` 的 `BookInfo` 上增加来源字段：

```ts
sourceKind?: 'user-import' | 'builtin';
sourceId?: string;
sourceUrl?: string;
sourceFileName?: string;
sourceSize?: number;
```

字段含义：

- `sourceKind`: 区分用户导入书和内置书。
- `sourceId`: 内置书籍在 manifest 中的稳定 ID。
- `sourceUrl`: 内置书籍静态资源地址。
- `sourceFileName`: 原始文件名，用于冲突提示和展示。
- `sourceSize`: 原始文件大小，用于展示。

兼容策略：

- 旧书籍没有 `sourceKind` 时视为 `user-import`。
- 已存在的 `fingerprint` 继续作为主身份之一。

### 内置书籍 manifest

新增构建产物，建议路径：

```text
public/builtin-books.manifest.json
```

推荐结构：

```json
{
  "schemaVersion": 1,
  "generatedAt": 1710000000000,
  "books": [
    {
      "sourceId": "builtin:sha256:...",
      "title": "三国演义",
      "author": "",
      "sourceType": "txt",
      "fileName": "theThreeKingdoms.txt",
      "size": 1792611,
      "fingerprint": "...",
      "url": "/weread/builtin-books/theThreeKingdoms/theThreeKingdoms.txt",
      "coverUrl": ""
    }
  ]
}
```

关键要求：

- `sourceId` 必须稳定，建议基于文件 SHA-256。
- `fingerprint` 建议直接使用文件 SHA-256，与当前导入流程保持一致。
- `url` 必须是浏览器可 fetch 的静态资源地址。
- manifest 只记录元数据，不直接塞全文内容。

## 构建期扫描

### 新增脚本

建议新增：

```text
scripts/generateBuiltinBooksManifest.ts
```

职责：

1. 扫描固定目录，例如：

```text
assets/books
```

2. 递归识别支持格式：

```text
.txt
.epub
```

3. 计算每本书的：

- 文件 SHA-256
- 文件大小
- 文件名
- sourceType
- sourceId
- 静态资源 URL

4. 可选读取同目录封面：

```text
cover.png
cover.jpg
image.png
```

5. 输出 manifest 到 `public/builtin-books.manifest.json`。

6. 将内置书籍文件复制或同步到 `public/builtin-books`，保证生产环境可通过 URL 访问。

### package.json 脚本

建议新增：

```json
{
  "scripts": {
    "builtin-books": "tsx scripts/generateBuiltinBooksManifest.ts"
  }
}
```

后续可接入：

```json
{
  "scripts": {
    "prebuild": "pnpm builtin-books"
  }
}
```

开发阶段可以先手动执行，避免影响现有构建。

## 书籍来源层

新增模块：

```text
lib/bookSources.ts
```

职责：

1. 加载 manifest。
2. 将 manifest 条目转换为首页可展示的 `BookInfo` 轻量对象。
3. 合并 IndexedDB 用户书籍和内置书籍。
4. 根据 bookId/sourceId 获取书籍。
5. 对内置书籍执行“缓存优先，本地 URL 回退”的加载逻辑。

建议暴露接口：

```ts
getAllBookEntries(): Promise<BookInfo[]>
getBookEntryById(id: string): Promise<BookInfo | null>
ensureBookDocument(id: string): Promise<BookInfo | null>
```

其中：

- `getAllBookEntries` 给首页使用。
- `getBookEntryById` 读取轻量元数据。
- `ensureBookDocument` 给阅读页使用，保证返回带 `document` 的完整书籍。

## 内置书籍缓存机制

### 打开内置书时

流程：

1. 根据 URL 的 `id` 查 IndexedDB。
2. 如果存在完整 `document`，直接进入阅读。
3. 如果不存在：
   - 查 manifest。
   - 找不到则返回首页并提示书籍不存在。
   - 找到则 fetch `sourceUrl`。
   - 将响应转成 `File` 或 Blob-like 对象，复用 `importBookFile` 解析。
   - 以 manifest 的稳定 `sourceId` 或 `fingerprint` 作为书籍 ID 写入 IndexedDB。
   - 标记 `sourceKind: 'builtin'`。
   - 进入阅读。

### 缓存 ID 策略

建议：

```text
book.id = manifest.sourceId
book.fingerprint = manifest.fingerprint
```

这样 IndexedDB 被清空后重新缓存，ID 仍然一致，用户数据恢复时也容易匹配。

### 缓存失败处理

需要接入全局 fallback：

- manifest 加载失败：显示“本地书库读取失败”。
- 内置书籍 fetch 失败：显示“本地书籍文件不可访问”。
- 解析失败：复用 EPUB/TXT 解析失败提示。
- 单本内置书加载失败不影响其他书。

## 首页接入

修改 `pages/home/index.tsx`：

1. 将 `useHomeBookList` 中的 `getAllBooks<BookInfo>()` 替换为新的 `getAllBookEntries()`。
2. 保持 `BookCard` 展示方式不变。
3. 内置书籍卡片不做特殊视觉标记。
4. 搜索功能第一阶段仍只搜索 IndexedDB 已缓存书籍。
5. 第二阶段再支持 manifest 元数据搜索：
   - 标题搜索可直接查 manifest。
   - 正文搜索只对已经缓存到 IndexedDB 的内置书籍生效。

注意：

- 首页必须在 IndexedDB 读取失败时仍能展示 manifest 内置书籍。
- 用户导入书和内置书合并时，按稳定 ID 去重。

## 阅读页接入

修改 `pages/book-detail/index.tsx`：

1. 将 `loadBookDetailById` 内部的 `getBookById<BookInfo>(id)` 替换为 `ensureBookDocument(id)`。
2. 如果是用户导入书，行为保持不变。
3. 如果是内置书且 IndexedDB 缓存丢失，自动从 `sourceUrl` 拉取、解析、写入缓存。
4. 加载期间继续显示现有 `Loading`。
5. 失败时返回首页并显示全局 fallback。

重点：

- 不要在阅读器内部新增第二套文本解析逻辑。
- 必须复用 `readerDocumentToTextSyntaxTree` 和现有 `BookInfo.document` 结构。

## 导入冲突处理

用户导入书籍时，需要把 manifest 内置书籍也纳入冲突判断。

### 同 hash

规则：

- 认为是同一本书。
- 不允许覆盖内置书籍本体。
- 提示“书库中已存在该内置书籍”。
- 可提供“打开已有书籍”操作。
- 不新增第二本，避免笔记和进度分裂。

### 同名但 hash 不同

规则：

- 弹出当前重名冲突确认。
- 默认建议保留两个文件。
- 用户选择保留时，用户导入书命名为 `{书名}(n)`。
- 用户选择覆盖时：
  - 如果目标是用户导入书，可以沿用当前覆盖逻辑。
  - 如果目标是内置书，不覆盖内置源；应改为“保留两个文件”或提示内置书不能覆盖。

### 同名不同类型

规则：

- 仍触发冲突确认。
- 默认保留两个文件。
- 不因为类型不同而静默跳过确认。

## 用户数据策略

继续使用当前 IndexedDB/localStorage 相关用户数据模块：

- 阅读进度
- 阅读时长
- 笔记
- 划线
- 书签
- 阅读设置

关键要求：

- 内置书籍的用户数据挂在稳定 `book.id/sourceId` 上。
- 清空 IndexedDB 后，正文可以从 manifest 恢复，但用户数据不会自动恢复。
- 用户数据恢复依赖后续“备份与恢复”功能。

与 `plan.md` 的备份功能配合：

- 备份文件中应保存 `sourceKind/sourceId/fingerprint/title/sourceType`。
- 恢复时优先按 `bookId/sourceId` 匹配。
- 其次按 `fingerprint` 匹配。
- 如果内置书籍存在但未缓存，应允许先恢复用户数据，等用户打开书籍时再恢复正文缓存。

## 搜索策略

第一阶段：

- 首页书名/作者搜索包含 manifest 内置书籍。
- 正文搜索只覆盖 IndexedDB 中已缓存的书籍。

第二阶段：

- 可以在内置书籍首次打开并缓存后，自动进入现有全文搜索索引。
- 不建议为了全文搜索在首页启动时解析所有内置书籍，避免大书拖慢首屏。

## 删除和清库策略

### 删除用户导入书

保持当前逻辑：

- 删除 `books_info`
- 删除资源缓存
- 清理该书用户数据

### 删除内置书籍

建议第一版不提供真正删除内置书籍。

可选后续能力：

- “从书架隐藏”
- 隐藏状态保存在用户设置中
- 清空 IndexedDB 后隐藏状态也会丢失，除非纳入备份

### 清空 IndexedDB

清空后：

- 用户导入书籍消失。
- 用户数据消失。
- 内置书籍仍通过 manifest 显示。
- 打开内置书籍时重新解析并缓存。

## 文件结构建议

新增文件：

```text
scripts/generateBuiltinBooksManifest.ts
lib/builtinBooks.ts
lib/bookSources.ts
public/builtin-books.manifest.json
```

可能修改：

```text
package.json
store/books.ts
lib/bookImporter.ts
pages/home/index.tsx
pages/book-detail/index.tsx
components/BookCard/index.tsx
```

说明：

- `lib/builtinBooks.ts` 只处理 manifest 加载和类型。
- `lib/bookSources.ts` 处理“用户书籍 + 内置书籍 + 缓存补齐”的统一读取。
- `store/books.ts` 继续负责 IndexedDB 写入和查询，不直接关心 manifest 扫描。

## 实施步骤

### 第一步：定义 manifest schema

- 新增 `BuiltinBookManifest`、`BuiltinBookEntry` 类型。
- 明确 `schemaVersion`。
- 明确 `sourceId/fingerprint/url/sourceType/title/author/size` 字段。
- 写一个最小手动 manifest 样例用于调试。

### 第二步：实现构建期扫描脚本

- 扫描 `assets/books`。
- 支持递归子目录。
- 支持 `.txt` 和 `.epub`。
- 计算 SHA-256。
- 复制文件到 `public/builtin-books`。
- 生成 `public/builtin-books.manifest.json`。

### 第三步：实现 manifest 加载模块

- 新增 `lib/builtinBooks.ts`。
- fetch `/weread/builtin-books.manifest.json`。
- 校验基础字段。
- manifest 加载失败时返回空列表并发出 fallback。

### 第四步：实现统一书籍来源层

- 新增 `lib/bookSources.ts`。
- 实现 `getAllBookEntries()`。
- 实现 `ensureBookDocument(id)`。
- 合并 IndexedDB 和 manifest。
- 处理内置书籍缓存优先、本地 URL 回退。

### 第五步：首页接入

- `useHomeBookList` 改为调用 `getAllBookEntries()`。
- 保持现有 UI。
- 确保 IndexedDB 失败时仍展示内置书籍。
- 导入冲突判断纳入内置书籍。

### 第六步：阅读页接入

- `loadBookDetailById` 改为调用 `ensureBookDocument(id)`。
- 内置书籍首次打开时自动解析缓存。
- 失败时给出明确 fallback。

### 第七步：冲突处理完善

- 同 hash 内置书：不新增、不覆盖，提示并引导打开。
- 同名不同 hash：保留当前冲突弹窗，默认保留两个文件。
- 覆盖内置书时改为阻止覆盖源文件。

### 第八步：搜索策略接入

- 标题/作者搜索加入 manifest 元数据。
- 正文搜索第一版只搜索已缓存书籍。
- 后续再考虑为内置书籍建立懒加载全文索引。

### 第九步：验证

需要覆盖的测试场景：

1. 空 IndexedDB 时首页仍显示内置书籍。
2. 点击内置 TXT，能够 fetch、解析、缓存、阅读。
3. 点击内置 EPUB，能够 fetch、解析、缓存、阅读。
4. 刷新页面后二次打开优先走 IndexedDB 缓存。
5. 清空 IndexedDB 后内置书籍重新显示，并能再次缓存。
6. 用户导入同 hash 内置书，不生成第二本。
7. 用户导入同名不同 hash 书籍，触发冲突弹窗。
8. 多本导入时，某本与内置书冲突不影响其他书。
9. 搜索标题能搜到未缓存内置书。
10. 正文搜索不会强制解析所有内置书。

## 风险与注意点

1. 大 EPUB 首次打开仍需要解析，可能较慢，需要沿用现有解析超时和 fallback。
2. manifest 文件路径必须与 Vite `base: '/weread'` 兼容。
3. 内置书籍 ID 一旦发布后应尽量稳定，否则用户数据匹配会失效。
4. 不要在首页启动时解析全部内置书籍，否则会重新引入大书性能问题。
5. 如果未来做 PWA 离线，需要把 manifest 和内置书籍资源纳入 service worker 缓存策略。

## 推荐首版范围

首版只实现：

- 构建期扫描 manifest。
- 首页展示内置书籍。
- 阅读页首次打开内置书籍时解析并缓存。
- 清空 IndexedDB 后内置书籍仍存在。
- 同 hash 用户导入与内置书去重。

暂不实现：

- 内置书籍隐藏。
- 未缓存内置书全文搜索。
- 自动备份用户数据。
- 运行时 Node API 扫描目录。
