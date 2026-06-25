export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
};

export const clampRatio = (value: number): number => clamp(value, 0, 1);

export const canUseDOM = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

export const canUseStorage = (): boolean => canUseDOM() && typeof window.localStorage !== 'undefined';

export const safeReadStorage = (key: string): string | null => {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeWriteStorage = (key: string, value: string): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota and private-mode failures.
  }
};

export const safeRemoveStorage = (key: string): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore restricted storage contexts.
  }
};

export const getErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === 'string') return candidate;
  }
  return fallback;
};

export const createRandomId = (prefix = 'id'): string => {
  if (canUseDOM() && typeof window.crypto?.randomUUID === 'function') {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const sha256Hex = async (value: string | Uint8Array<ArrayBuffer>): Promise<string> => {
  const subtle = canUseDOM() ? globalThis.crypto?.subtle : undefined;
  if (!subtle) {
    // Refuse to fall back to a weak 32-bit hash here: the result feeds book
    // fingerprints / ids, and collisions silently overwrite different books.
    // Web Crypto only requires a secure context (HTTPS or localhost), so
    // exposing the failure surfaces it where it can be fixed.
    throw new Error(
      'SHA-256 unavailable: serve this app over HTTPS or from localhost so WebCrypto is enabled.',
    );
  }
  const data: Uint8Array = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const buffer = await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

// ============ 轻量级响应式工具 (替代 ranuts/utils) ============

type Listener<T> = (value: T) => void;

interface Signal<T> {
  value: T;
  subscribe: (listener: Listener<T>) => () => void;
  set: (value: T) => void;
  update: (updater: (prev: T) => T) => void;
}

/**
 * 创建响应式信号
 */
export function createSignal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const listeners = new Set<Listener<T>>();

  return {
    get value() {
      return value;
    },
    set value(newValue: T) {
      value = newValue;
      listeners.forEach((listener) => listener(value));
    },
    subscribe(listener: Listener<T>) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(newValue: T) {
      this.value = newValue;
    },
    update(updater: (prev: T) => T) {
      this.value = updater(value);
    },
  };
}

/**
 * 订阅者存储（用于全局订阅管理）
 * 兼容 ranuts 的事件系统 API
 */
class SubscribersMap extends Map<string, Set<(value: any) => void>> {
  /**
   * 触发事件，调用所有订阅者
   */
  call(eventName: string, value?: any): void {
    const listeners = this.get(eventName);
    if (listeners) {
      listeners.forEach((listener) => listener(value));
    }
  }

  /**
   * 订阅事件
   */
  tap(eventName: string, listener: (value: any) => void): void {
    if (!this.has(eventName)) {
      this.set(eventName, new Set());
    }
    this.get(eventName)!.add(listener);
  }

  /**
   * 取消订阅
   */
  off(eventName: string, listener: (value: any) => void): void {
    const listeners = this.get(eventName);
    if (listeners) {
      listeners.delete(listener);
    }
  }
}

export const subscribers = new SubscribersMap();

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * 转换为字符串
 */
export function toString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

