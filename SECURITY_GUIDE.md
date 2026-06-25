# 🔒 安全配置指南

## 问题 1: 如何删除书籍？

### 当前状况
- ✅ 后端逻辑已实现 (`deleteBookFromShelf` in `store/bookshelf.ts`)
- ❌ 前端 UI 未实现

### 解决方案：添加删除按钮

需要在以下位置添加删除功能：

#### 选项 A: 书籍卡片右键菜单（推荐）
在 `components/BookCard/index.tsx` 添加右键菜单：
- 右键点击书籍卡片
- 显示菜单：查看 | 删除
- 确认后调用 `deleteBookFromShelf(bookId)`

#### 选项 B: 书籍详情页删除按钮
在书籍阅读器的设置面板添加"删除此书"按钮

---

## 问题 2: 防止恶意注册和滥用

### 🚨 当前安全问题

1. **注册完全开放** - 任何人都可以注册
2. **无速率限制** - 可以暴力注册/上传
3. **无容量限制** - 用户可以无限上传书籍
4. **无流量限制** - API 可以被滥用

---

## 🛡️ 安全加固方案

### 方案 1: 禁用公开注册（推荐）

修改 `backend/index.ts`，注册需要邀请码：

```typescript
// 在 /api/auth/register 路由中添加
const INVITE_CODES = ["WEREAD2024", "PRIVATE123"]; // 预设邀请码

if (path === "/api/auth/register" && request.method === "POST") {
  const { username, password, inviteCode } = (await request.json()) as any;
  
  // 验证邀请码
  if (!inviteCode || !INVITE_CODES.includes(inviteCode)) {
    return new Response(
      JSON.stringify({ error: "无效的邀请码" }), 
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
  
  // 原有注册逻辑...
}
```

### 方案 2: 添加速率限制（防止暴力攻击）

使用 Cloudflare Workers KV 实现速率限制：

```typescript
// 在路由前添加速率限制检查
async function checkRateLimit(
  env: Env, 
  key: string, 
  limit: number, 
  windowSeconds: number
): Promise<boolean> {
  const now = Date.now();
  const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;
  
  const count = await env.BOOKS_KV.get(windowKey);
  const currentCount = count ? parseInt(count) : 0;
  
  if (currentCount >= limit) {
    return false; // 超过限制
  }
  
  await env.BOOKS_KV.put(
    windowKey, 
    String(currentCount + 1), 
    { expirationTtl: windowSeconds * 2 }
  );
  
  return true;
}

// 在注册路由中使用
const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
const allowed = await checkRateLimit(env, `register:${clientIP}`, 5, 3600); // 每小时最多 5 次

if (!allowed) {
  return new Response(
    JSON.stringify({ error: "注册过于频繁，请稍后再试" }),
    { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
  );
}
```

### 方案 3: 用户容量限制

添加存储容量限制：

```typescript
// 在数据库 schema 中添加用户容量字段
// schema.sql 添加:
ALTER TABLE users ADD COLUMN storage_used INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN storage_limit INTEGER DEFAULT 104857600; -- 100MB

// 上传书籍时检查容量
if (path === "/api/books" && request.method === "POST") {
  const { bookInfo, document, resources } = (await request.json()) as any;
  
  // 计算书籍大小
  const bookSize = JSON.stringify({ document, resources }).length;
  
  // 查询用户已用容量
  const userStats: any = await env.DB.prepare(
    "SELECT storage_used, storage_limit FROM users WHERE id = ?"
  ).bind(user.id).first();
  
  if (userStats.storage_used + bookSize > userStats.storage_limit) {
    return new Response(
      JSON.stringify({ error: "存储空间不足" }),
      { status: 413, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
  
  // 更新已用容量
  await env.DB.prepare(
    "UPDATE users SET storage_used = storage_used + ? WHERE id = ?"
  ).bind(bookSize, user.id).run();
  
  // 保存书籍...
}
```

### 方案 4: API 流量限制（防止 API 滥用）

```typescript
// 限制每个用户的 API 调用频率
async function checkUserRateLimit(
  env: Env,
  userId: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const key = `user_ratelimit:${userId}:${endpoint}`;
  return checkRateLimit(env, key, limit, windowSeconds);
}

// 在需要保护的路由前添加
const allowed = await checkUserRateLimit(env, user.id, "upload", 10, 3600); // 每小时最多上传 10 本书
if (!allowed) {
  return new Response(
    JSON.stringify({ error: "上传过于频繁" }),
    { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
  );
}
```

---

## 🚀 快速实施方案（最小改动）

### 1. 立即禁用公开注册

修改 `backend/index.ts` 第 289 行：

```typescript
if (path === "/api/auth/register" && request.method === "POST") {
  // 禁用公开注册
  return new Response(
    JSON.stringify({ error: "注册功能已关闭，请联系管理员" }),
    { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
  );
}
```

### 2. 使用 Cloudflare Dashboard 限制流量

1. 访问 https://dash.cloudflare.com/
2. 进入 Workers & Pages → weread-backend
3. Settings → Triggers
4. 添加 Rate Limiting 规则：
   - `/api/books` POST: 10 requests/hour
   - `/api/9ksw/*`: 100 requests/hour

---

## 📊 推荐配置

### 个人使用（最严格）
- ❌ 完全禁用注册
- ✅ 只允许预先创建的账号登录
- ✅ 每用户 100MB 容量限制
- ✅ 每小时最多上传 5 本书

### 小型分享（适中）
- ✅ 邀请码注册
- ✅ 注册速率限制：5次/小时
- ✅ 每用户 500MB 容量限制
- ✅ 每小时最多上传 20 本书

### 公开服务（宽松但安全）
- ✅ 开放注册 + 验证码
- ✅ 注册速率限制：10次/小时
- ✅ 每用户 1GB 容量限制
- ✅ 每小时最多上传 50 本书

---

## ✅ 立即行动建议

1. **立即执行**：禁用公开注册（方案 1）
2. **本周内**：添加速率限制（方案 2）
3. **本月内**：添加容量限制（方案 3）
4. **可选**：Cloudflare Rate Limiting 规则

---

需要我帮你实现其中任何一个方案吗？
