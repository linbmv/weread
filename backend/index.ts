/**
 * WeRead Backend API
 * Version: 1.0.2
 * Auto-deploy enabled via GitHub Actions
 * Last update: 2026-06-25
 */

export interface Env {
  DB: D1Database;
  BOOKS_KV: KVNamespace;
  JWT_SECRET?: string;
}

const DEFAULT_SECRET = "weread_secret_key_123456_secure_key";

// CORS Headers helper
function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

// 1. Password Hashing (PBKDF2 Web Crypto)
async function hashPassword(password: string, salt: string): Promise<string> {
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
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

// 2. JWT Helpers
async function signJwt(payload: any, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const tokenInput = `${encodedHeader}.${encodedPayload}`;
  
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(tokenInput)
  );
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${tokenInput}.${encodedSignature}`;
}

async function verifyJwt(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const tokenInput = `${encodedHeader}.${encodedPayload}`;
    
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    
    // Base64Url decode the signature
    const sigStr = atob(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"));
    const signatureBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) {
      signatureBytes[i] = sigStr.charCodeAt(i);
    }
    
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(tokenInput)
    );
    
    if (!isValid) return null;
    
    const payloadStr = atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadStr);
    
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// 3. User Authentication Middleware
async function authenticate(request: Request, env: Env): Promise<{ id: string; username: string } | null> {
  const authHeader = request.headers.get("Authorization");
  let token = "";
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else {
    // Try to get token from cookies
    const cookieHeader = request.headers.get("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/token=([^;]+)/);
      if (match) token = match[1];
    }
  }
  
  if (!token) return null;
  const secret = env.JWT_SECRET || DEFAULT_SECRET;
  return await verifyJwt(token, secret);
}

// ============ 9ksw 代理辅助函数 ============
const NKSW_BASE = "https://9ksw.com";
const NKSW_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

async function handle9kswSearch(keyword: string, cors: Record<string, string>): Promise<Response> {
  if (!keyword) return new Response(JSON.stringify({ error: "缺少搜索关键词" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  const payload = `keyboard=${encodeURIComponent(keyword)}&show=title,writer,byr&searchget=1`;
  const response = await fetch(`${NKSW_BASE}/e/search/index.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": NKSW_UA,
    },
    body: payload,
  });
  const html = await response.text();

  const results: Array<{ title: string; url: string; id: string }> = [];
  const hrefs = new Set<string>();

  const blocks = html.split(/class=["']each_truyen["']/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const hrefMatch = block.match(/href=["'](\/novel\d+\/?)['"]/);
    if (!hrefMatch) continue;
    const p = hrefMatch[1];

    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();

    if (p && title && !hrefs.has(p)) {
      hrefs.add(p);
      results.push({ title, url: NKSW_BASE + p, id: p.replace(/\//g, "") });
    }
  }

  return new Response(JSON.stringify(results), { headers: { ...cors, "Content-Type": "application/json" } });
}

async function handle9kswCatalog(catalogUrl: string, cors: Record<string, string>): Promise<Response> {
  if (!catalogUrl) return new Response(JSON.stringify({ error: "缺少目录URL" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  const response = await fetch(catalogUrl, { headers: { "User-Agent": NKSW_UA } });
  const html = await response.text();

  let title = "未知小说";
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  if (titleMatch) title = titleMatch[1].split("_")[0].trim();

  const catalogBlockMatch = html.match(/<div\s[^>]*id=["']list-chapter["'][\s\S]*?<ul[^>]*class=["']list-chapter["'][^>]*>([\s\S]*?)<\/ul>/);
  if (!catalogBlockMatch) {
    return new Response(JSON.stringify({ error: "未找到章节列表容器" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const catalogBlock = catalogBlockMatch[1];

  const chaptersMap = new Map<string, { title: string; url: string; order: number }>();
  const chapterLinkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = chapterLinkRegex.exec(catalogBlock)) !== null) {
    const href = match[1].trim();
    const chapterTitle = match[2].replace(/<[^>]+>/g, "").trim();
    if (href && chapterTitle) {
      let fullUrl = href;
      if (!href.startsWith("http")) {
        if (href.startsWith("/")) {
          fullUrl = NKSW_BASE + href;
        } else {
          const baseCatalog = catalogUrl.endsWith("/") ? catalogUrl : catalogUrl + "/";
          fullUrl = baseCatalog + href;
        }
      }
      if (!chaptersMap.has(fullUrl)) {
        const orderMatch = href.match(/chapter(\d+)\.html/);
        const order = orderMatch ? parseInt(orderMatch[1]) : idx++;
        chaptersMap.set(fullUrl, { title: chapterTitle, url: fullUrl, order });
      }
    }
  }

  const sortedChapters = Array.from(chaptersMap.values()).sort((a, b) => a.order - b.order);
  return new Response(JSON.stringify({ title, chapters: sortedChapters }), { headers: { ...cors, "Content-Type": "application/json" } });
}

async function handle9kswChapter(chapterUrl: string, cors: Record<string, string>): Promise<Response> {
  if (!chapterUrl) return new Response(JSON.stringify({ error: "缺少章节URL" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  const response = await fetch(chapterUrl, { headers: { "User-Agent": NKSW_UA } });
  const html = await response.text();

  const urlMatch = html.match(/"url":\s*"([^"]+)"/);
  if (!urlMatch) {
    return new Response(JSON.stringify({ error: "未能提取正文密钥" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const payload = `url=${encodeURIComponent(urlMatch[1])}&mobile=1&isk=1`;
  const apiRes = await fetch(`${NKSW_BASE}/conapi.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": NKSW_UA,
    },
    body: payload,
  });

  const apiJson = (await apiRes.json()) as any;
  if (apiJson && apiJson.success === "1") {
    const cleanContent = apiJson.content
      .replace(/&nbsp;/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .join("\n\n");

    return new Response(JSON.stringify({ content: cleanContent }), { headers: { ...cors, "Content-Type": "application/json" } });
  } else {
    return new Response(JSON.stringify({ error: apiJson ? apiJson.msg : "9ksw API 未知错误" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
}

// Main handler
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request);
    
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
      // ============ 9ksw 公开代理路由（无需登录） ============
      if (path === "/api/9ksw/search") {
        return await handle9kswSearch(url.searchParams.get("q") || "", cors);
      }
      if (path === "/api/9ksw/catalog") {
        return await handle9kswCatalog(url.searchParams.get("url") || "", cors);
      }
      if (path === "/api/9ksw/chapter") {
        return await handle9kswChapter(url.searchParams.get("url") || "", cors);
      }

      // Public Auth routes
      if (path === "/api/auth/register" && request.method === "POST") {
        // 🔒 注册已禁用 - 防止恶意注册和滥用
        // 如需启用，请使用邀请码系统或联系管理员手动创建账号
        return new Response(
          JSON.stringify({ error: "注册功能已关闭。如需账号，请联系管理员。" }),
          { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
        );

        /* 原注册逻辑已禁用
        const { username, password } = (await request.json()) as any;
        if (!username || !password) {
          return new Response(JSON.stringify({ error: "请输入用户名和密码" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        // Check if user exists
        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "用户名已存在" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        const userId = crypto.randomUUID();
        const salt = crypto.randomUUID(); // Use random uuid as salt
        const passwordHash = `${salt}:${await hashPassword(password, salt)}`;

        await env.DB.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
          .bind(userId, username, passwordHash, Date.now())
          .run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
        */
      }
      
      if (path === "/api/auth/login" && request.method === "POST") {
        const { username, password } = (await request.json()) as any;
        if (!username || !password) {
          return new Response(JSON.stringify({ error: "请输入用户名和密码" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        const user: any = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "用户名或密码错误" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        const [salt, hash] = user.password_hash.split(":");
        const computedHash = await hashPassword(password, salt);
        if (computedHash !== hash) {
          return new Response(JSON.stringify({ error: "用户名或密码错误" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        const secret = env.JWT_SECRET || DEFAULT_SECRET;
        const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
        const token = await signJwt({ id: user.id, username: user.username, exp }, secret);
        
        return new Response(JSON.stringify({ token, user: { id: user.id, username: user.username } }), {
          headers: {
            ...cors,
            "Content-Type": "application/json",
            "Set-Cookie": `token=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${30 * 24 * 60 * 60}`,
          },
        });
      }
      
      // All other routes require auth
      const user = await authenticate(request, env);
      if (!user) {
        return new Response(JSON.stringify({ error: "未登录或登录已过期" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      }
      
      if (path === "/api/auth/me" && request.method === "GET") {
        return new Response(JSON.stringify({ user }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      
      if (path === "/api/auth/logout" && request.method === "POST") {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            ...cors,
            "Content-Type": "application/json",
            "Set-Cookie": "token=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
          },
        });
      }
      
      // 4. Books Metadata List
      if (path === "/api/books" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM book_metadata WHERE user_id = ? ORDER BY modify_time DESC")
          .bind(user.id)
          .all();
        return new Response(JSON.stringify(results), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      
      // 5. Book Upload (D1 Metadata + KV Content)
      if (path === "/api/books" && request.method === "POST") {
        const { bookInfo, document, resources } = (await request.json()) as any;
        if (!bookInfo || !bookInfo.id || !bookInfo.title) {
          return new Response(JSON.stringify({ error: "无效的书籍数据" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        // Save metadata to D1
        await env.DB.prepare(
          `INSERT OR REPLACE INTO book_metadata 
           (id, user_id, title, author, image, source_type, create_time, modify_time) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          bookInfo.id,
          user.id,
          bookInfo.title,
          bookInfo.author || "",
          bookInfo.image || "",
          bookInfo.sourceType || "txt",
          bookInfo.createTime || Date.now(),
          bookInfo.modifyTime || Date.now()
        ).run();
        
        // Save book contents and resources to KV
        const kvKey = `book_content:${user.id}:${bookInfo.id}`;
        await env.BOOKS_KV.put(kvKey, JSON.stringify({ document, resources }));
        
        return new Response(JSON.stringify({ success: true, id: bookInfo.id }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      
      // 6. Delete Book
      const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
      if (bookMatch && request.method === "DELETE") {
        const bookId = bookMatch[1];
        
        // Delete D1 Metadata
        await env.DB.prepare("DELETE FROM book_metadata WHERE user_id = ? AND id = ?").bind(user.id, bookId).run();
        
        // Delete related sync tables
        await env.DB.prepare("DELETE FROM reading_progress WHERE user_id = ? AND book_id = ?").bind(user.id, bookId).run();
        await env.DB.prepare("DELETE FROM annotations WHERE user_id = ? AND book_id = ?").bind(user.id, bookId).run();
        await env.DB.prepare("DELETE FROM book_status WHERE user_id = ? AND book_id = ?").bind(user.id, bookId).run();
        
        // Delete KV content
        const kvKey = `book_content:${user.id}:${bookId}`;
        await env.BOOKS_KV.delete(kvKey);
        
        return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      
      // 7. Get Book Content (KV)
      const contentMatch = path.match(/^\/api\/books\/([^/]+)\/content$/);
      if (contentMatch && request.method === "GET") {
        try {
          const bookId = contentMatch[1];
          const kvKey = `book_content:${user.id}:${bookId}`;
          const content = await env.BOOKS_KV.get(kvKey);

          if (!content) {
            return new Response(JSON.stringify({ error: "未找到书籍正文内容" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
          }

          // 同时查询书籍元数据，避免前端二次请求
          const bookMeta: any = await env.DB.prepare(
            "SELECT id, title, author, image, source_type, create_time, modify_time FROM book_metadata WHERE user_id = ? AND id = ?"
          ).bind(user.id, bookId).first();

          const parsedContent = JSON.parse(content);
          const response = {
            ...parsedContent,
            meta: bookMeta ? {
              id: bookMeta.id,
              title: bookMeta.title,
              author: bookMeta.author,
              image: bookMeta.image,
              source_type: bookMeta.source_type,
              create_time: bookMeta.create_time,
              modify_time: bookMeta.modify_time,
            } : null,
          };

          return new Response(JSON.stringify(response), { headers: { ...cors, "Content-Type": "application/json" } });
        } catch (error: any) {
          console.error('[/api/books/:id/content] Error:', error);
          return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
        }
      }
      
      // 8. Sync APIs
      // Progress Sync
      if (path === "/api/sync/progress") {
        if (request.method === "POST") {
          const items = (await request.json()) as any[]; // Array of progress objects
          const stmt = env.DB.prepare(
            `INSERT INTO reading_progress (user_id, book_id, progress_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             progress_json = excluded.progress_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > reading_progress.updated_at`
          );
          
          const batch = items.map((item: any) => 
            stmt.bind(user.id, item.bookId, JSON.stringify(item.progress), item.updatedAt)
          );
          
          await env.DB.batch(batch);
          return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        if (request.method === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM reading_progress WHERE user_id = ?").bind(user.id).all();
          const progress = results.map((r: any) => ({
            bookId: r.book_id,
            progress: JSON.parse(r.progress_json),
            updatedAt: r.updated_at
          }));
          return new Response(JSON.stringify(progress), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      }
      
      // Annotations Sync
      if (path === "/api/sync/annotations") {
        if (request.method === "POST") {
          const items = (await request.json()) as any[];
          const stmt = env.DB.prepare(
            `INSERT INTO annotations (user_id, book_id, annotations_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             annotations_json = excluded.annotations_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > annotations.updated_at`
          );
          
          const batch = items.map((item: any) => 
            stmt.bind(user.id, item.bookId, JSON.stringify(item.annotations), item.updatedAt)
          );
          
          await env.DB.batch(batch);
          return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        if (request.method === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM annotations WHERE user_id = ?").bind(user.id).all();
          const list = results.map((r: any) => ({
            bookId: r.book_id,
            annotations: JSON.parse(r.annotations_json),
            updatedAt: r.updated_at
          }));
          return new Response(JSON.stringify(list), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      }
      
      // Settings Sync
      if (path === "/api/sync/settings") {
        if (request.method === "POST") {
          const { settings, updatedAt } = (await request.json()) as any;
          await env.DB.prepare(
            `INSERT INTO user_settings (user_id, settings_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             settings_json = excluded.settings_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > user_settings.updated_at`
          ).bind(user.id, JSON.stringify(settings), updatedAt).run();
          return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        if (request.method === "GET") {
          const result: any = await env.DB.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(user.id).first();
          if (!result) return new Response(JSON.stringify(null), { headers: { ...cors, "Content-Type": "application/json" } });
          return new Response(JSON.stringify({
            settings: JSON.parse(result.settings_json),
            updatedAt: result.updated_at
          }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      }
      
      // Book Status Sync
      if (path === "/api/sync/status") {
        if (request.method === "POST") {
          const items = (await request.json()) as any[];
          const stmt = env.DB.prepare(
            `INSERT INTO book_status (user_id, book_id, status_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             status_json = excluded.status_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > book_status.updated_at`
          );
          
          const batch = items.map((item: any) => 
            stmt.bind(user.id, item.bookId, JSON.stringify(item.status), item.updatedAt)
          );
          
          await env.DB.batch(batch);
          return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        if (request.method === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM book_status WHERE user_id = ?").bind(user.id).all();
          const list = results.map((r: any) => ({
            bookId: r.book_id,
            status: JSON.parse(r.status_json),
            updatedAt: r.updated_at
          }));
          return new Response(JSON.stringify(list), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      }
      
      // Reading Time Sync
      if (path === "/api/sync/time") {
        if (request.method === "POST") {
          const { timeData, updatedAt } = (await request.json()) as any;
          await env.DB.prepare(
            `INSERT INTO reading_time (user_id, time_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             time_json = excluded.time_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > reading_time.updated_at`
          ).bind(user.id, JSON.stringify(timeData), updatedAt).run();
          return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
        
        if (request.method === "GET") {
          const result: any = await env.DB.prepare("SELECT * FROM reading_time WHERE user_id = ?").bind(user.id).first();
          if (!result) return new Response(JSON.stringify(null), { headers: { ...cors, "Content-Type": "application/json" } });
          return new Response(JSON.stringify({
            timeData: JSON.parse(result.time_json),
            updatedAt: result.updated_at
          }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      }

      // ============ 管理员 API ============
      // 检查管理员权限
      async function checkAdmin(): Promise<boolean> {
        const adminCheck: any = await env.DB.prepare(
          "SELECT is_admin FROM users WHERE id = ?"
        ).bind(user.id).first();
        return adminCheck && adminCheck.is_admin === 1;
      }

      // 获取所有用户
      if (path === "/api/admin/users" && request.method === "GET") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { results } = await env.DB.prepare(`
          SELECT id, username, is_admin, storage_used, storage_limit,
                 upload_rate_limit, api_rate_limit, is_active,
                 created_at, last_login
          FROM users
          ORDER BY created_at DESC
        `).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 创建用户
      if (path === "/api/admin/users" && request.method === "POST") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { username, password, isAdmin: newUserIsAdmin, storageLimit, uploadRateLimit, apiRateLimit } = (await request.json()) as any;

        if (!username || !password) {
          return new Response(JSON.stringify({ error: "用户名和密码不能为空" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "用户名已存在" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        const userId = crypto.randomUUID();
        const salt = crypto.randomUUID();
        const passwordHash = `${salt}:${await hashPassword(password, salt)}`;

        await env.DB.prepare(`
          INSERT INTO users (
            id, username, password_hash, is_admin,
            storage_used, storage_limit, upload_rate_limit, api_rate_limit,
            is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          userId, username, passwordHash, newUserIsAdmin ? 1 : 0,
          0, storageLimit || 104857600, uploadRateLimit || 10, apiRateLimit || 100,
          1, Date.now()
        ).run();

        return new Response(JSON.stringify({ success: true, userId }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 更新用户
      if (path === "/api/admin/users/update" && request.method === "POST") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { userId, storageLimit, uploadRateLimit, apiRateLimit, isActive, isAdmin: makeAdmin } = (await request.json()) as any;

        if (!userId) {
          return new Response(JSON.stringify({ error: "缺少用户ID" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        const updates: string[] = [];
        const params: any[] = [];

        if (storageLimit !== undefined) { updates.push("storage_limit = ?"); params.push(storageLimit); }
        if (uploadRateLimit !== undefined) { updates.push("upload_rate_limit = ?"); params.push(uploadRateLimit); }
        if (apiRateLimit !== undefined) { updates.push("api_rate_limit = ?"); params.push(apiRateLimit); }
        if (isActive !== undefined) { updates.push("is_active = ?"); params.push(isActive ? 1 : 0); }
        if (makeAdmin !== undefined) { updates.push("is_admin = ?"); params.push(makeAdmin ? 1 : 0); }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: "没有需要更新的字段" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        params.push(userId);
        await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 删除用户
      if (path === "/api/admin/users/delete" && request.method === "POST") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { userId } = (await request.json()) as any;

        if (!userId) {
          return new Response(JSON.stringify({ error: "缺少用户ID" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }
        if (userId === user.id) {
          return new Response(JSON.stringify({ error: "不能删除自己" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 系统统计
      if (path === "/api/admin/stats" && request.method === "GET") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const userCount: any = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
        const bookCount: any = await env.DB.prepare("SELECT COUNT(*) as count FROM book_metadata").first();
        const totalStorage: any = await env.DB.prepare("SELECT SUM(storage_used) as total FROM users").first();

        return new Response(JSON.stringify({
          userCount: userCount.count,
          bookCount: bookCount.count,
          totalStorage: totalStorage.total || 0,
        }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 修改用户密码
      if (path === "/api/admin/users/password" && request.method === "POST") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { userId, newPassword } = (await request.json()) as any;

        if (!userId || !newPassword) {
          return new Response(JSON.stringify({ error: "缺少用户ID或新密码" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        const salt = crypto.randomUUID();
        const passwordHash = `${salt}:${await hashPassword(newPassword, salt)}`;

        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, userId).run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 获取所有用户的书籍（管理员）
      if (path === "/api/admin/books" && request.method === "GET") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { results } = await env.DB.prepare(`
          SELECT bm.id, bm.user_id, bm.title, bm.author, bm.source_type,
                 bm.create_time, bm.modify_time, u.username
          FROM book_metadata bm
          LEFT JOIN users u ON bm.user_id = u.id
          ORDER BY bm.modify_time DESC
        `).all();
        return new Response(JSON.stringify(results), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // 删除任意用户的书籍（管理员）
      if (path === "/api/admin/books/delete" && request.method === "POST") {
        if (!(await checkAdmin())) {
          return new Response(JSON.stringify({ error: "权限不足" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { userId, bookId } = (await request.json()) as any;

        if (!userId || !bookId) {
          return new Response(JSON.stringify({ error: "缺少用户ID或书籍ID" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }

        // 删除 D1 元数据
        await env.DB.prepare("DELETE FROM book_metadata WHERE user_id = ? AND id = ?").bind(userId, bookId).run();
        // 删除相关同步数据
        await env.DB.prepare("DELETE FROM reading_progress WHERE user_id = ? AND book_id = ?").bind(userId, bookId).run();
        await env.DB.prepare("DELETE FROM annotations WHERE user_id = ? AND book_id = ?").bind(userId, bookId).run();
        await env.DB.prepare("DELETE FROM book_status WHERE user_id = ? AND book_id = ?").bind(userId, bookId).run();
        // 删除 KV 内容
        await env.BOOKS_KV.delete(`book_content:${userId}:${bookId}`);

        return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "接口不存在" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
  }
};
