# 后端自动部署配置指南

## 📋 前置条件

你的项目已经有完整的后端实现：
- ✅ Cloudflare Workers 后端 (`backend/`)
- ✅ D1 数据库
- ✅ KV 存储
- ✅ Pages Functions 代理层

## 🚀 配置自动部署

### 1. 获取 Cloudflare API Token

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 选择 "Edit Cloudflare Workers" 模板
4. 或者自定义权限：
   - Account - Cloudflare Workers Scripts:Edit
   - Account - D1:Edit
   - Account - Workers KV Storage:Edit
5. 复制生成的 Token

### 2. 获取 Account ID

1. 访问 https://dash.cloudflare.com/
2. 选择你的账户
3. 在右侧栏找到 "Account ID"
4. 复制该 ID

### 3. 添加 GitHub Secrets

1. 访问 https://github.com/linbmv/weread/settings/secrets/actions
2. 点击 "New repository secret"
3. 添加两个 Secrets：

**CLOUDFLARE_API_TOKEN**
```
<你在步骤1中获取的 Token>
```

**CLOUDFLARE_ACCOUNT_ID**
```
<你在步骤2中获取的 Account ID>
```

### 4. 提交并推送

```bash
# 添加新文件
git add .github/workflows/deploy-backend.yml
git add backend/wrangler.toml

# 提交
git commit -m "ci: 添加后端自动部署 GitHub Actions"

# 推送到 main
git push origin main
```

### 5. 验证部署

1. 访问 https://github.com/linbmv/weread/actions
2. 查看 "Deploy Backend to Cloudflare Workers" 工作流
3. 等待部署完成（通常 1-2 分钟）
4. 测试 API：
   ```bash
   curl https://weread-backend.sglinhome.workers.dev/api/auth/me
   ```

---

## 🔄 工作流程

推送后自动触发：

```
git push origin main (backend/** 有变更)
  ↓
GitHub Actions 触发
  ↓
Wrangler 构建 + 部署
  ↓
Cloudflare Workers 更新
  ↓
前端通过 functions/api/[[path]].ts 代理访问
```

---

## 📝 重要说明

### JWT_SECRET 配置

**不要**在 `wrangler.toml` 中硬编码 JWT_SECRET！

应该在 Cloudflare Dashboard 中设置：

1. 访问 https://dash.cloudflare.com/
2. 进入 Workers & Pages → weread-backend
3. Settings → Variables → Add variable
4. 添加 Secret:
   - Name: `JWT_SECRET`
   - Value: `<强随机字符串>`
   - Type: Secret (加密)

或使用 Wrangler CLI：
```bash
cd backend
wrangler secret put JWT_SECRET
# 输入你的强随机密钥
```

### D1 数据库初始化

如果数据库是新建的，需要执行 schema：

```bash
cd backend
wrangler d1 execute weread_db --file=schema.sql
```

---

## 🎯 触发条件

GitHub Actions 在以下情况触发：

1. ✅ 推送到 `main` 分支
2. ✅ 且 `backend/**` 目录有变更
3. ✅ 或工作流文件本身有变更

**示例**：
```bash
# ✅ 触发部署
echo "update" >> backend/index.ts
git commit -am "update backend"
git push origin main

# ❌ 不触发部署
echo "update" >> pages/home/index.tsx
git commit -am "update frontend"
git push origin main
```

---

## 📊 监控部署

### 查看实时日志

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录
wrangler login

# 查看实时日志
wrangler tail weread-backend
```

### GitHub Actions 日志

访问: https://github.com/linbmv/weread/actions

---

## 🔧 本地开发

```bash
cd backend

# 安装依赖（如果需要）
npm install -g wrangler

# 本地运行
wrangler dev

# 本地访问
curl http://localhost:8787/api/auth/me
```

---

## 🎉 完成！

配置完成后，每次推送 `backend/` 的变更都会自动部署到 Cloudflare Workers！

前端通过 `functions/api/[[path]].ts` 代理访问，完全透明。
