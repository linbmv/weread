const DEFAULT_SECRET = "weread_secret_key_123456_secure_key";
// CORS Headers helper
function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
    };
}
// 1. Password Hashing (PBKDF2 Web Crypto)
async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
    const key = await crypto.subtle.deriveKey({
        name: "PBKDF2",
        salt: enc.encode(salt),
        iterations: 50000,
        hash: "SHA-256",
    }, keyMaterial, { name: "HMAC", hash: "SHA-256", length: 256 }, true, ["sign"]);
    const exported = (await crypto.subtle.exportKey("raw", key));
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}
// 2. JWT Helpers
async function signJwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const tokenInput = `${encodedHeader}.${encodedPayload}`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(tokenInput));
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    return `${tokenInput}.${encodedSignature}`;
}
async function verifyJwt(token, secret) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            return null;
        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const tokenInput = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        // Base64Url decode the signature
        const sigStr = atob(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"));
        const signatureBytes = new Uint8Array(sigStr.length);
        for (let i = 0; i < sigStr.length; i++) {
            signatureBytes[i] = sigStr.charCodeAt(i);
        }
        const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(tokenInput));
        if (!isValid)
            return null;
        const payloadStr = atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadStr);
        if (payload.exp && Date.now() > payload.exp)
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
// 3. User Authentication Middleware
async function authenticate(request, env) {
    const authHeader = request.headers.get("Authorization");
    let token = "";
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
    }
    else {
        // Try to get token from cookies
        const cookieHeader = request.headers.get("Cookie");
        if (cookieHeader) {
            const match = cookieHeader.match(/token=([^;]+)/);
            if (match)
                token = match[1];
        }
    }
    if (!token)
        return null;
    const secret = env.JWT_SECRET || DEFAULT_SECRET;
    return await verifyJwt(token, secret);
}
// Main handler
export default {
    async fetch(request, env, _ctx) {
        const cors = corsHeaders(request);
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: cors });
        }
        const url = new URL(request.url);
        const path = url.pathname;
        try {
            // Public Auth routes
            if (path === "/api/auth/register" && request.method === "POST") {
                const { username, password } = (await request.json());
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
            }
            if (path === "/api/auth/login" && request.method === "POST") {
                const { username, password } = (await request.json());
                if (!username || !password) {
                    return new Response(JSON.stringify({ error: "请输入用户名和密码" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
                }
                const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
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
                const { bookInfo, document, resources } = (await request.json());
                if (!bookInfo || !bookInfo.id || !bookInfo.title) {
                    return new Response(JSON.stringify({ error: "无效的书籍数据" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
                }
                // Save metadata to D1
                await env.DB.prepare(`INSERT OR REPLACE INTO book_metadata 
           (id, user_id, title, author, image, source_type, create_time, modify_time) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(bookInfo.id, user.id, bookInfo.title, bookInfo.author || "", bookInfo.image || "", bookInfo.sourceType || "txt", bookInfo.createTime || Date.now(), bookInfo.modifyTime || Date.now()).run();
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
                const bookId = contentMatch[1];
                const kvKey = `book_content:${user.id}:${bookId}`;
                const content = await env.BOOKS_KV.get(kvKey);
                if (!content) {
                    return new Response(JSON.stringify({ error: "未找到书籍正文内容" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
                }
                return new Response(content, { headers: { ...cors, "Content-Type": "application/json" } });
            }
            // 8. Sync APIs
            // Progress Sync
            if (path === "/api/sync/progress") {
                if (request.method === "POST") {
                    const items = (await request.json()); // Array of progress objects
                    const stmt = env.DB.prepare(`INSERT INTO reading_progress (user_id, book_id, progress_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             progress_json = excluded.progress_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > reading_progress.updated_at`);
                    const batch = items.map((item) => stmt.bind(user.id, item.bookId, JSON.stringify(item.progress), item.updatedAt));
                    await env.DB.batch(batch);
                    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
                if (request.method === "GET") {
                    const { results } = await env.DB.prepare("SELECT * FROM reading_progress WHERE user_id = ?").bind(user.id).all();
                    const progress = results.map((r) => ({
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
                    const items = (await request.json());
                    const stmt = env.DB.prepare(`INSERT INTO annotations (user_id, book_id, annotations_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             annotations_json = excluded.annotations_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > annotations.updated_at`);
                    const batch = items.map((item) => stmt.bind(user.id, item.bookId, JSON.stringify(item.annotations), item.updatedAt));
                    await env.DB.batch(batch);
                    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
                if (request.method === "GET") {
                    const { results } = await env.DB.prepare("SELECT * FROM annotations WHERE user_id = ?").bind(user.id).all();
                    const list = results.map((r) => ({
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
                    const { settings, updatedAt } = (await request.json());
                    await env.DB.prepare(`INSERT INTO user_settings (user_id, settings_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             settings_json = excluded.settings_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > user_settings.updated_at`).bind(user.id, JSON.stringify(settings), updatedAt).run();
                    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
                if (request.method === "GET") {
                    const result = await env.DB.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(user.id).first();
                    if (!result)
                        return new Response(JSON.stringify(null), { headers: { ...cors, "Content-Type": "application/json" } });
                    return new Response(JSON.stringify({
                        settings: JSON.parse(result.settings_json),
                        updatedAt: result.updated_at
                    }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
            }
            // Book Status Sync
            if (path === "/api/sync/status") {
                if (request.method === "POST") {
                    const items = (await request.json());
                    const stmt = env.DB.prepare(`INSERT INTO book_status (user_id, book_id, status_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             status_json = excluded.status_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > book_status.updated_at`);
                    const batch = items.map((item) => stmt.bind(user.id, item.bookId, JSON.stringify(item.status), item.updatedAt));
                    await env.DB.batch(batch);
                    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
                if (request.method === "GET") {
                    const { results } = await env.DB.prepare("SELECT * FROM book_status WHERE user_id = ?").bind(user.id).all();
                    const list = results.map((r) => ({
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
                    const { timeData, updatedAt } = (await request.json());
                    await env.DB.prepare(`INSERT INTO reading_time (user_id, time_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             time_json = excluded.time_json,
             updated_at = excluded.updated_at
             WHERE excluded.updated_at > reading_time.updated_at`).bind(user.id, JSON.stringify(timeData), updatedAt).run();
                    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
                if (request.method === "GET") {
                    const result = await env.DB.prepare("SELECT * FROM reading_time WHERE user_id = ?").bind(user.id).first();
                    if (!result)
                        return new Response(JSON.stringify(null), { headers: { ...cors, "Content-Type": "application/json" } });
                    return new Response(JSON.stringify({
                        timeData: JSON.parse(result.time_json),
                        updatedAt: result.updated_at
                    }), { headers: { ...cors, "Content-Type": "application/json" } });
                }
            }
            return new Response(JSON.stringify({ error: "接口不存在" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
        }
        catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
        }
    }
};
