/**
 * 管理员 API 路由
 * 需要管理员权限才能访问
 */

import type { Env } from './index';

// 检查是否为管理员
export async function isAdmin(userId: string, env: Env): Promise<boolean> {
  const user: any = await env.DB.prepare(
    "SELECT is_admin FROM users WHERE id = ?"
  ).bind(userId).first();

  return user && user.is_admin === 1;
}

// 获取所有用户列表
export async function handleAdminGetUsers(user: any, env: Env, cors: Record<string, string>): Promise<Response> {
  if (!(await isAdmin(user.id, env))) {
    return new Response(
      JSON.stringify({ error: "权限不足" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const { results } = await env.DB.prepare(`
    SELECT id, username, is_admin, storage_used, storage_limit,
           upload_rate_limit, api_rate_limit, is_active,
           created_at, last_login
    FROM users
    ORDER BY created_at DESC
  `).all();

  return new Response(JSON.stringify(results), {
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

// 创建用户
export async function handleAdminCreateUser(
  user: any,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (!(await isAdmin(user.id, env))) {
    return new Response(
      JSON.stringify({ error: "权限不足" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const { username, password, isAdmin: newUserIsAdmin, storageLimit, uploadRateLimit, apiRateLimit } =
    (await request.json()) as any;

  if (!username || !password) {
    return new Response(
      JSON.stringify({ error: "用户名和密码不能为空" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // 检查用户是否已存在
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE username = ?"
  ).bind(username).first();

  if (existing) {
    return new Response(
      JSON.stringify({ error: "用户名已存在" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // 生成密码哈希（需要从主文件导入 hashPassword 函数）
  const userId = crypto.randomUUID();
  const salt = crypto.randomUUID();

  // 临时：在这里重复实现 hashPassword
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 50000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );
  const exported = (await crypto.subtle.exportKey("raw", key)) as ArrayBuffer;
  const passwordHash = `${salt}:${btoa(String.fromCharCode(...new Uint8Array(exported)))}`;

  // 插入新用户
  await env.DB.prepare(`
    INSERT INTO users (
      id, username, password_hash, is_admin,
      storage_used, storage_limit, upload_rate_limit, api_rate_limit,
      is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId,
    username,
    passwordHash,
    newUserIsAdmin ? 1 : 0,
    0, // storage_used
    storageLimit || 104857600, // 默认 100MB
    uploadRateLimit || 10,
    apiRateLimit || 100,
    1, // is_active
    Date.now()
  ).run();

  return new Response(
    JSON.stringify({ success: true, userId }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
}

// 更新用户配额
export async function handleAdminUpdateUser(
  user: any,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (!(await isAdmin(user.id, env))) {
    return new Response(
      JSON.stringify({ error: "权限不足" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const { userId, storageLimit, uploadRateLimit, apiRateLimit, isActive, isAdmin: makeAdmin } =
    (await request.json()) as any;

  if (!userId) {
    return new Response(
      JSON.stringify({ error: "缺少用户ID" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // 构建更新语句
  const updates: string[] = [];
  const params: any[] = [];

  if (storageLimit !== undefined) {
    updates.push("storage_limit = ?");
    params.push(storageLimit);
  }
  if (uploadRateLimit !== undefined) {
    updates.push("upload_rate_limit = ?");
    params.push(uploadRateLimit);
  }
  if (apiRateLimit !== undefined) {
    updates.push("api_rate_limit = ?");
    params.push(apiRateLimit);
  }
  if (isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(isActive ? 1 : 0);
  }
  if (makeAdmin !== undefined) {
    updates.push("is_admin = ?");
    params.push(makeAdmin ? 1 : 0);
  }

  if (updates.length === 0) {
    return new Response(
      JSON.stringify({ error: "没有需要更新的字段" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  params.push(userId);

  await env.DB.prepare(`
    UPDATE users SET ${updates.join(", ")} WHERE id = ?
  `).bind(...params).run();

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
}

// 删除用户
export async function handleAdminDeleteUser(
  user: any,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (!(await isAdmin(user.id, env))) {
    return new Response(
      JSON.stringify({ error: "权限不足" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const { userId } = (await request.json()) as any;

  if (!userId) {
    return new Response(
      JSON.stringify({ error: "缺少用户ID" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // 不能删除自己
  if (userId === user.id) {
    return new Response(
      JSON.stringify({ error: "不能删除自己" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // 删除用户（会级联删除相关数据）
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();

  // TODO: 删除 KV 中的书籍内容
  // 需要先查询该用户的所有书籍，然后删除对应的 KV 数据

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
}

// 获取系统统计
export async function handleAdminStats(user: any, env: Env, cors: Record<string, string>): Promise<Response> {
  if (!(await isAdmin(user.id, env))) {
    return new Response(
      JSON.stringify({ error: "权限不足" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const userCount: any = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
  const bookCount: any = await env.DB.prepare("SELECT COUNT(*) as count FROM book_metadata").first();
  const totalStorage: any = await env.DB.prepare("SELECT SUM(storage_used) as total FROM users").first();

  return new Response(
    JSON.stringify({
      userCount: userCount.count,
      bookCount: bookCount.count,
      totalStorage: totalStorage.total || 0,
    }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
}
