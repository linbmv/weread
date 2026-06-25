import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, getAuthState } from '@/store/auth';
import { ROUTE_PATH } from '@/router';
import './index.scss';

interface User {
  id: string;
  username: string;
  is_admin: number;
  storage_used: number;
  storage_limit: number;
  upload_rate_limit: number;
  api_rate_limit: number;
  is_active: number;
  created_at: number;
  last_login?: number;
}

interface Stats {
  userCount: number;
  bookCount: number;
  totalStorage: number;
}

export const AdminPage = (): React.JSX.Element => {
  const navigate = useNavigate();
  const auth = getAuthState();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // 检查管理员权限
  useEffect(() => {
    if (!auth.loggedIn) {
      navigate(ROUTE_PATH.HOME);
      return;
    }
    loadData();
  }, [auth.loggedIn, navigate]);

  const loadData = async () => {
    setLoading(true);
    const [usersRes, statsRes] = await Promise.all([
      apiFetch('/api/admin/users'),
      apiFetch('/api/admin/stats'),
    ]);

    if (usersRes.error) {
      alert(usersRes.error);
      navigate(ROUTE_PATH.HOME);
      return;
    }

    setUsers(usersRes.data || []);
    setStats(statsRes.data || null);
    setLoading(false);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round(bytes / Math.pow(k, i) * 100) / 100} ${sizes[i]}`;
  };

  const formatDate = (timestamp?: number): string => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleDateString('zh-CN');
  };

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>管理员面板</h1>
        <button onClick={() => navigate(ROUTE_PATH.HOME)}>返回首页</button>
      </header>

      {loading ? (
        <div className="admin-loading">加载中...</div>
      ) : (
        <>
          {/* 统计卡片 */}
          {stats && (
            <div className="admin-stats">
              <div className="stat-card">
                <div className="stat-label">用户数</div>
                <div className="stat-value">{stats.userCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">书籍数</div>
                <div className="stat-value">{stats.bookCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">总存储</div>
                <div className="stat-value">{formatBytes(stats.totalStorage)}</div>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="admin-actions">
            <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
              创建用户
            </button>
            <button className="btn-secondary" onClick={loadData}>
              刷新
            </button>
          </div>

          {/* 用户列表 */}
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>角色</th>
                  <th>存储使用</th>
                  <th>上传限制</th>
                  <th>API限制</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.is_admin ? '管理员' : '普通用户'}</td>
                    <td>
                      {formatBytes(user.storage_used)} / {formatBytes(user.storage_limit)}
                    </td>
                    <td>{user.upload_rate_limit}/小时</td>
                    <td>{user.api_rate_limit}/小时</td>
                    <td>{user.is_active ? '启用' : '禁用'}</td>
                    <td>{formatDate(user.created_at)}</td>
                    <td>
                      <button
                        className="btn-small"
                        onClick={() => setEditingUser(user)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 创建用户模态框 */}
          {showCreateModal && (
            <CreateUserModal
              onClose={() => setShowCreateModal(false)}
              onSuccess={loadData}
            />
          )}

          {/* 编辑用户模态框 */}
          {editingUser && (
            <EditUserModal
              user={editingUser}
              onClose={() => setEditingUser(null)}
              onSuccess={loadData}
            />
          )}
        </>
      )}
    </div>
  );
};

// 创建用户模态框组件
const CreateUserModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [storageLimit, setStorageLimit] = useState('100');
  const [uploadRateLimit, setUploadRateLimit] = useState('10');
  const [apiRateLimit, setApiRateLimit] = useState('100');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const { error } = await apiFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        isAdmin,
        storageLimit: parseInt(storageLimit) * 1024 * 1024,
        uploadRateLimit: parseInt(uploadRateLimit),
        apiRateLimit: parseInt(apiRateLimit),
      }),
    });

    setSubmitting(false);

    if (error) {
      alert(error);
      return;
    }

    alert('用户创建成功');
    onSuccess();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>创建用户</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
              />
              管理员权限
            </label>
          </div>
          <div className="form-group">
            <label>存储限制 (MB)</label>
            <input
              type="number"
              value={storageLimit}
              onChange={(e) => setStorageLimit(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="form-group">
            <label>上传限制 (次/小时)</label>
            <input
              type="number"
              value={uploadRateLimit}
              onChange={(e) => setUploadRateLimit(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="form-group">
            <label>API限制 (次/小时)</label>
            <input
              type="number"
              value={apiRateLimit}
              onChange={(e) => setApiRateLimit(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 编辑用户模态框组件
const EditUserModal = ({
  user,
  onClose,
  onSuccess,
}: {
  user: User;
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const [storageLimit, setStorageLimit] = useState(String(user.storage_limit / 1024 / 1024));
  const [uploadRateLimit, setUploadRateLimit] = useState(String(user.upload_rate_limit));
  const [apiRateLimit, setApiRateLimit] = useState(String(user.api_rate_limit));
  const [isActive, setIsActive] = useState(user.is_active === 1);
  const [isAdmin, setIsAdmin] = useState(user.is_admin === 1);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const { error } = await apiFetch('/api/admin/users/update', {
      method: 'POST',
      body: JSON.stringify({
        userId: user.id,
        storageLimit: parseInt(storageLimit) * 1024 * 1024,
        uploadRateLimit: parseInt(uploadRateLimit),
        apiRateLimit: parseInt(apiRateLimit),
        isActive,
        isAdmin,
      }),
    });

    setSubmitting(false);

    if (error) {
      alert(error);
      return;
    }

    alert('更新成功');
    onSuccess();
    onClose();
  };

  const handleDelete = async () => {
    if (!confirm(`确定要删除用户 ${user.username} 吗？此操作不可恢复！`)) {
      return;
    }

    setSubmitting(true);

    const { error } = await apiFetch('/api/admin/users/delete', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id }),
    });

    setSubmitting(false);

    if (error) {
      alert(error);
      return;
    }

    alert('删除成功');
    onSuccess();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>编辑用户: {user.username}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>存储限制 (MB)</label>
            <input
              type="number"
              value={storageLimit}
              onChange={(e) => setStorageLimit(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="form-group">
            <label>上传限制 (次/小时)</label>
            <input
              type="number"
              value={uploadRateLimit}
              onChange={(e) => setUploadRateLimit(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="form-group">
            <label>API限制 (次/小时)</label>
            <input
              type="number"
              value={apiRateLimit}
              onChange={(e) => setApiRateLimit(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              启用账号
            </label>
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
              />
              管理员权限
            </label>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-danger"
              onClick={handleDelete}
              disabled={submitting}
            >
              删除用户
            </button>
            <button type="button" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
