-- 添加用户权限和配额字段
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0; -- 0=普通用户, 1=管理员
ALTER TABLE users ADD COLUMN storage_used INTEGER DEFAULT 0; -- 已使用存储（字节）
ALTER TABLE users ADD COLUMN storage_limit INTEGER DEFAULT 104857600; -- 存储限制（默认100MB）
ALTER TABLE users ADD COLUMN upload_rate_limit INTEGER DEFAULT 10; -- 每小时上传次数限制
ALTER TABLE users ADD COLUMN api_rate_limit INTEGER DEFAULT 100; -- 每小时API调用次数限制
ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1; -- 0=禁用, 1=启用
ALTER TABLE users ADD COLUMN last_login INTEGER; -- 最后登录时间
