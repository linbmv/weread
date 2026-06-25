# 管理员功能使用指南

## 🎉 新功能

### 1. 管理员面板
完整的用户管理系统，包括创建用户、配额管理、速率限制。

### 2. 删除书籍功能
右键点击书籍卡片即可删除。

---

## 📋 功能清单

### ✅ 已实现

#### 后端 API
- ✅ `GET /api/admin/users` - 获取所有用户
- ✅ `POST /api/admin/users` - 创建用户
- ✅ `POST /api/admin/users/update` - 更新用户配额
- ✅ `POST /api/admin/users/delete` - 删除用户
- ✅ `GET /api/admin/stats` - 系统统计

#### 数据库扩展
- ✅ `is_admin` - 管理员标识
- ✅ `storage_used` - 已使用存储
- ✅ `storage_limit` - 存储限制
- ✅ `upload_rate_limit` - 上传速率限制
- ✅ `api_rate_limit` - API 速率限制
- ✅ `is_active` - 账号启用状态
- ✅ `last_login` - 最后登录时间

#### 前端界面
- ✅ 管理员面板 (`/admin`)
- ✅ 用户列表展示
- ✅ 创建用户模态框
- ✅ 编辑用户配额模态框
- ✅ 删除用户功能
- ✅ 系统统计卡片
- ✅ 书籍右键菜单删除

---

## 🚀 使用指南

### 第一步：数据库迁移

在部署新代码后，需要执行数据库迁移：

```bash
cd backend
wrangler d1 execute weread_db --file=migration_001_admin.sql
```

### 第二步：设置第一个管理员

由于注册已禁用，需要手动设置管理员：

```bash
# 方法 1: 使用 Wrangler CLI
wrangler d1 execute weread_db --command="UPDATE users SET is_admin = 1 WHERE username = '你的用户名'"

# 方法 2: 在 Cloudflare Dashboard
# 进入 D1 数据库 → 执行 SQL:
# UPDATE users SET is_admin = 1 WHERE username = '你的用户名';
```

### 第三步：访问管理员面板

1. 登录你的账号
2. 访问 `https://你的域名/admin`
3. 现在你可以：
   - 创建新用户
   - 设置用户配额
   - 管理用户权限
   - 查看系统统计

---

## 📊 管理员面板功能

### 创建用户
- 设置用户名和密码
- 指定是否为管理员
- 配置存储限制（MB）
- 配置上传速率（次/小时）
- 配置 API 速率（次/小时）

### 编辑用户
- 调整存储配额
- 修改速率限制
- 启用/禁用账号
- 授予/撤销管理员权限

### 删除用户
- 删除用户及其所有数据
- 级联删除书籍、进度、笔记等

### 系统统计
- 总用户数
- 总书籍数
- 总存储使用量

---

## 🗑️ 删除书籍功能

### 使用方法

1. **首页或书架页面**
2. **右键点击**书籍卡片
3. 在弹出菜单中选择 **"删除"**
4. 确认删除

### 效果
- 删除书籍元数据
- 删除书籍内容
- 删除相关进度、笔记、书签
- 释放存储空间

---

## 🔐 安全说明

### 管理员权限
- 只有 `is_admin = 1` 的用户可以访问管理员 API
- 普通用户访问会返回 403 权限不足

### 数据保护
- 管理员不能删除自己
- 删除用户会级联删除所有相关数据
- 删除操作不可恢复

### 速率限制
虽然数据库字段已准备好，但**速率限制尚未实施**。

需要进一步实现：
- 上传书籍前检查 `upload_rate_limit`
- API 调用前检查 `api_rate_limit`
- 使用 KV 存储计数器

---

## 📝 待实现功能

### 速率限制实施
```typescript
// 上传书籍时检查
const user = await checkRateLimit(userId, 'upload');
if (user.uploadCount >= user.upload_rate_limit) {
  return error('超过上传限制');
}
```

### 容量限制实施
```typescript
// 上传书籍时检查存储
if (user.storage_used + bookSize > user.storage_limit) {
  return error('存储空间不足');
}
```

### 日志记录
- 管理员操作日志
- 用户行为审计
- 删除操作记录

---

## 🎯 快速开始

```bash
# 1. 数据库迁移
cd backend
wrangler d1 execute weread_db --file=migration_001_admin.sql

# 2. 设置管理员
wrangler d1 execute weread_db --command="UPDATE users SET is_admin = 1 WHERE username = 'admin'"

# 3. 访问管理面板
# https://你的域名/admin

# 4. 创建第一个用户
# 在管理面板点击"创建用户"按钮
```

---

## ⚠️ 注意事项

1. **第一次部署后**，必须执行数据库迁移
2. **必须手动设置第一个管理员**
3. 删除操作**不可恢复**，请谨慎操作
4. 速率限制字段已添加，但**逻辑尚未实施**

---

需要帮助？查看 `SECURITY_GUIDE.md` 了解更多安全配置。
