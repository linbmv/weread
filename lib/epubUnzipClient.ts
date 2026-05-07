import type { EpubUnzipEntry, EpubUnzipResponse } from '@/workers/epubWorker';
import { createRandomId } from '@/lib/utils';

const PENDING_OPERATION_TIMEOUT_MS = 120_000;

let epubWorker: Worker | null = null;

const getEpubWorker = (): Worker | null => {
  if (epubWorker) return epubWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    epubWorker = new Worker(new URL('../workers/epubWorker.ts', import.meta.url), { type: 'module' });
    return epubWorker;
  } catch {
    return null;
  }
};

const terminateEpubWorker = (worker: Worker): void => {
  worker.terminate();
  if (epubWorker === worker) {
    epubWorker = null;
  }
};

const getAbortError = (signal?: AbortSignal): Error => {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error('EPUB import aborted.');
};

// Hands the raw EPUB ArrayBuffer off to a dedicated worker for ZIP central-
// directory parsing and DEFLATE inflation. The buffer is transferred
// (zero-copy); the worker transfers each inflated entry's buffer back the
// same way. After this call the caller's `buffer` is detached.
export const unzipEpubInWorker = (
  buffer: ArrayBuffer,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<EpubUnzipEntry[]> => {
  const worker = getEpubWorker();
  if (!worker) {
    return Promise.reject(new Error('This browser does not support Web Workers required for EPUB import.'));
  }
  if (options.signal?.aborted) {
    return Promise.reject(getAbortError(options.signal));
  }

  return new Promise<EpubUnzipEntry[]>((resolve, reject) => {
    const opId = createRandomId('epub-unzip');
    let settled = false;
    let timer: number | undefined;

    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      options.signal?.removeEventListener('abort', onAbort);
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const settleSuccess = (value: EpubUnzipEntry[]): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onMessage = (event: MessageEvent<EpubUnzipResponse>): void => {
      if (event.data?.opId !== opId) return;
      if (event.data.status === 'success' && event.data.entries) {
        settleSuccess(event.data.entries);
      } else {
        settleError(new Error(event.data.message || 'EPUB unzip failed.'));
      }
    };

    const onError = (event: ErrorEvent): void => {
      settleError(new Error(event.message || 'EPUB worker error.'));
    };

    const onAbort = (): void => {
      terminateEpubWorker(worker);
      settleError(getAbortError(options.signal));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    timer = window.setTimeout(() => {
      if (settled) return;
      terminateEpubWorker(worker);
      settleError(new Error('EPUB unzip timed out.'));
    }, PENDING_OPERATION_TIMEOUT_MS);

    try {
      worker.postMessage({ type: 'unzip', opId, buffer }, [buffer]);
    } catch (error) {
      settleError(error instanceof Error ? error : new Error(String(error)));
    }
  });
};
