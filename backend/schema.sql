-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- UUID
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 书籍元数据表
CREATE TABLE IF NOT EXISTS book_metadata (
    id TEXT NOT NULL, -- computed fingerprint
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    image TEXT, -- cover base64 or image url
    source_type TEXT NOT NULL,
    create_time INTEGER NOT NULL,
    modify_time INTEGER NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 阅读进度表
CREATE TABLE IF NOT EXISTS reading_progress (
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    progress_json TEXT NOT NULL, -- JSON string of progress details
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, book_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 划线与想法笔记表
CREATE TABLE IF NOT EXISTS annotations (
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    annotations_json TEXT NOT NULL, -- JSON list of annotations/notes
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, book_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 阅读时长与统计
CREATE TABLE IF NOT EXISTS reading_time (
    user_id TEXT NOT NULL,
    time_json TEXT NOT NULL, -- reading time statistics
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 阅读设置表
CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 阅读状态表 (未读、在读、读过、读完)
CREATE TABLE IF NOT EXISTS book_status (
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    status_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, book_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
