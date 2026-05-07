export type GlobalFallbackTone = 'error' | 'info' | 'success';

export interface GlobalFallbackPayload {
  message: string;
  tone?: GlobalFallbackTone;
  duration?: number;
}

export const GLOBAL_FALLBACK_EVENT = 'weread-global-fallback';

export const showGlobalFallback = (payload: GlobalFallbackPayload | string): void => {
  if (typeof window === 'undefined') return;
  const detail: GlobalFallbackPayload = typeof payload === 'string' ? { message: payload } : payload;
  window.dispatchEvent(new CustomEvent<GlobalFallbackPayload>(GLOBAL_FALLBACK_EVENT, { detail }));
};
