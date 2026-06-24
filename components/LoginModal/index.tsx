import React, { useState } from 'react';
import { login, register, getAuthState } from '@/store/auth';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal = ({ isOpen, onClose }: LoginModalProps): React.JSX.Element | null => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const authState = getAuthState();
  const displayError = localError || authState.error;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setLocalError('请输入用户名');
      return;
    }
    if (password.length < 6) {
      setLocalError('密码长度不能少于 6 位');
      return;
    }
    
    if (isRegister) {
      if (password !== confirmPassword) {
        setLocalError('两次输入的密码不一致');
        return;
      }
      
      setSubmitting(true);
      const success = await register(trimmedUser, password);
      setSubmitting(false);
      
      if (success) {
        // Automatically switch to login on success
        setIsRegister(false);
        setLocalError(null);
        alert('注册成功，请使用新账号登录！');
      }
    } else {
      setSubmitting(true);
      const success = await login(trimmedUser, password);
      setSubmitting(false);
      
      if (success) {
        onClose();
        // Reload page to hydrate new cloud books and sync items
        window.location.reload();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
          aria-label="关闭"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {isRegister ? '创建新账号' : '登录 WeRead 云端'}
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {isRegister ? '注册以启用云端多端同步与长久书籍存储' : '登录以同步您的书籍、笔记与阅读进度'}
          </p>
        </div>

        {/* Error Display */}
        {displayError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-900/50">
            {displayError}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              用户名
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-850 dark:text-zinc-50 focus:ring-1 focus:ring-zinc-500 transition-all"
              placeholder="请输入您的用户名"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              密码
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-850 dark:text-zinc-50 focus:ring-1 focus:ring-zinc-500 transition-all"
              placeholder="请输入密码（不少于 6 位）"
              disabled={submitting}
            />
          </div>

          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                确认密码
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-850 dark:text-zinc-50 focus:ring-1 focus:ring-zinc-500 transition-all"
                placeholder="请再次输入密码"
                disabled={submitting}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-zinc-900 py-2.5 font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center justify-center cursor-pointer"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                处理中...
              </span>
            ) : (
              isRegister ? '注册账号' : '立即登录'
            )}
          </button>
        </form>

        {/* Footer Link */}
        <div className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {isRegister ? '已经有账号了？' : '还没有账号？'}
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setLocalError(null);
            }}
            className="ml-1 font-semibold text-zinc-900 hover:underline dark:text-zinc-100 cursor-pointer"
          >
            {isRegister ? '立即登录' : '创建一个账号'}
          </button>
        </div>
      </div>
    </div>
  );
};
