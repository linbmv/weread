# 导出备份与恢复计划

## 目标

为当前阅读器增加稳定的“导出备份与恢复”能力，覆盖书籍主数据、书籍资源、用户数据与阅读设置。功能目标不是只导出可读文本，而是让用户可以在后续版本中恢复完整阅读状态。

## 导出类型

1. 完整备份包
   - 面向恢复功能。
   - 包含书籍数据、EPUB 图片/封面资源、笔记、划线、书签、阅读进度、阅读时长、阅读设置。
   - 推荐格式：`.zip`。

2. 仅用户数据备份
   - 面向迁移笔记、划线、书签、进度、设置。
   - 不包含书籍正文和图片资源。
   - 推荐格式：`.zip`，内部仍使用 JSON，便于和完整备份共用恢复流程。

3. 书籍本体导出
   - TXT 书籍可导出 `.txt`。
   - EPUB 若要导出原始 EPUB，需要导入时额外保存原始文件 Blob；否则只能导出当前解析后的内部文档结构，不能保证还原为原始 EPUB。

## 备份包结构

推荐结构：

```text
weread-backup.zip
  manifest.json
  books/
    {bookId}/book.json
    {bookId}/resources/{resourceKey}
  user-data/
    annotations.json
    progress.json
    settings.json
```

`manifest.json` 建议包含：

- `backupSchemaVersion`
- `appName`
- `createdAt`
- `bookCount`
- `books[]` 简要信息
- `includes`: books/resources/annotations/progress/settings

## 数据来源

1. 书籍数据
   - IndexedDB `books_info`
   - 字段包含 `id/title/author/image/document/sourceType/fingerprint/createTime/modifyTime`

2. 书籍资源
   - IndexedDB 中的书籍资源存储。
   - 用于 EPUB 图片、封面等大资源。

3. 用户数据
   - `readerAnnotations`
   - `readerProgress`
   - `readerSettings`
   - 其他用户书籍模块。

## 恢复策略

恢复前先读取 `manifest.json`，展示预览：

- 备份创建时间
- 书籍数量
- 是否包含资源
- 是否包含用户数据
- 备份版本

恢复冲突策略：

1. 同 fingerprint
   - 默认识别为同一本书。
   - 提供覆盖 / 跳过 / 保留两份。

2. 同名但 fingerprint 不同
   - 识别为重名书。
   - 提供覆盖 / 跳过 / 保留两份。
   - 保留两份时沿用当前 `{书名}(n)` 命名逻辑。

3. 仅用户数据恢复
   - 优先按 `bookId` 匹配。
   - 如果 `bookId` 不存在，再按 `fingerprint` 匹配。
   - 匹配失败时列为未恢复项，不应阻断其他书籍恢复。

## 交互入口

首版入口建议放在首页书架区域，不放在阅读正文主界面：

- 首页导入附近增加“备份/恢复”入口。
- 打开统一管理面板。
- 面板内提供：
  - 导出完整备份
  - 导出仅用户数据
  - 导入备份
  - 恢复预览
  - 冲突处理

阅读界面后续可增加轻量入口：

- 导出本书
- 导出本书笔记

不建议把“恢复完整备份”放进阅读界面。

## 组件建议

新增独立组件：

- `BackupManager`
- `BackupExportPanel`
- `BackupImportPanel`
- `BackupConflictDialog`

新增工具模块：

- `lib/backup/exportBackup.ts`
- `lib/backup/importBackup.ts`
- `lib/backup/backupSchema.ts`
- `lib/backup/backupMigrations.ts`

## 版本兼容

必须定义 `backupSchemaVersion`。

恢复流程只读取稳定备份协议，不应直接裸导出当前 IndexedDB/localStorage 结构。后续数据结构变化时，通过迁移函数转换旧备份：

```text
v1 -> v2 -> v3
```

首版可以只支持当前版本，但文件结构需要从一开始就预留版本号和迁移入口。

## 实施阶段

### 第一阶段：基础完整备份

- 导出完整 `.zip`。
- 包含书籍、资源、annotations、progress、settings。
- 支持导入完整 `.zip`。
- 支持恢复预览。
- 单本恢复失败不影响其他书籍。

### 第二阶段：冲突处理

- 同 fingerprint 冲突处理。
- 同名冲突处理。
- 复用当前导入中的覆盖 / 保留两份逻辑。
- 恢复用户数据时支持按 `bookId` 和 `fingerprint` 双通道匹配。

### 第三阶段：仅用户数据导出恢复

- 导出 notes/highlights/bookmarks/progress/settings。
- 可选择全部书籍或单本书籍。
- 恢复时显示未匹配书籍列表。

### 第四阶段：稳定版迁移

- 增加 `backupSchemaVersion` 迁移函数。
- 增加备份校验。
- 增加恢复失败摘要。
- 增加大备份导入的分阶段 fallback 提示。



## 当前存在“双 fingerprint”机制：

导入时有文件级 SHA-256，同时 store/books.ts#getBookFingerprint 还有基于书名、作者、正文头尾抽样的旧指纹。这是为了兼容旧书籍数据，属于合理的过渡逻辑，建议最后做备份/迁移时统一回填。
