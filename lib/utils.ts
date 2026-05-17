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
