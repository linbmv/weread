#!/bin/bash
# 管理员工具：手动创建用户账号
# 使用 Wrangler CLI 直接操作 D1 数据库

set -e

echo "🔐 WeRead 用户管理工具"
echo "======================="
echo ""

# 检查 wrangler 是否安装
if ! command -v wrangler &> /dev/null; then
    echo "❌ 错误: wrangler CLI 未安装"
    echo "请运行: npm install -g wrangler"
    exit 1
fi

# 获取用户输入
read -p "输入用户名: " username
read -sp "输入密码: " password
echo ""

if [ -z "$username" ] || [ -z "$password" ]; then
    echo "❌ 用户名和密码不能为空"
    exit 1
fi

# 生成 UUID 和密码哈希
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
SALT=$(uuidgen | tr '[:upper:]' '[:lower:]')
TIMESTAMP=$(date +%s)000  # 毫秒时间戳

echo ""
echo "📝 创建用户..."
echo "   用户名: $username"
echo "   用户ID: $USER_ID"
echo ""

# 创建 SQL 脚本
SQL_FILE="/tmp/create_user_${USER_ID}.sql"
cat > "$SQL_FILE" << EOF
-- 创建用户: $username
-- 注意: 密码需要在应用中使用 PBKDF2 哈希后才能使用
-- 这里只插入用户记录，密码需要用户首次登录后重置

INSERT INTO users (id, username, password_hash, created_at)
VALUES ('$USER_ID', '$username', '$SALT:temporary_hash', $TIMESTAMP);

SELECT 'User created successfully' as status;
EOF

echo "⚙️  执行 SQL..."
cd backend
wrangler d1 execute weread_db --file="$SQL_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 用户创建成功！"
    echo ""
    echo "⚠️  重要提示:"
    echo "1. 用户需要首次登录时重置密码"
    echo "2. 或者通过 Cloudflare Dashboard 手动设置密码哈希"
    echo ""
    echo "用户信息:"
    echo "  用户名: $username"
    echo "  用户ID: $USER_ID"
else
    echo "❌ 创建失败"
    exit 1
fi

# 清理临时文件
rm -f "$SQL_FILE"
