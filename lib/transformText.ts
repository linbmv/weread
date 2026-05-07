import jschardet from 'jschardet';

export type ReaderBlockType = 'heading' | 'image' | 'paragraph';

export type ChapterTitleLevel = 1 | 2;

export interface ReaderBlock {
  id: string;
  type: ReaderBlockType;
  text: string;
  start: number;
  end: number;
  alt?: string;
  breakBefore?: boolean;
  level?: ChapterTitleLevel;
  src?: string;
  titleId?: number;
}

export interface Sequence {
  title: string;
  titleId: number;
  blockId?: string;
}

export interface TextSyntaxTree {
  sequences: Sequence[];
  totalPage: number;
  pageTitleId: number[];
  titleIdTitle: string[];
  titleIdPage: Record<string, number>;
  titleIdBlockId: Record<string, string>;
  blockIdPage: Record<string, number>;
  blockIdPageEnd: Record<string, number>;
  blocks: ReaderBlock[];
  blocksByTitleId: Map<number, ReaderBlock[]>;
  rawText: string;
}

export const CHAPTER_TITLE_START = '<caption-title>';

export const CHAPTER_TITLE_END = '</caption-title>';

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16_LE = [0xff, 0xfe];
const BOM_UTF16_BE = [0xfe, 0xff];

const ENCODING_SAMPLE_SIZE = 64 * 1024;

const matchesBom = (bytes: Uint8Array, signature: number[]): boolean => {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
};

const detectBomEncoding = (bytes: Uint8Array): string | undefined => {
  if (matchesBom(bytes, BOM_UTF8)) return 'utf-8';
  if (matchesBom(bytes, BOM_UTF16_LE)) return 'utf-16le';
  if (matchesBom(bytes, BOM_UTF16_BE)) return 'utf-16be';
  return undefined;
};

const bytesToBinaryString = (bytes: Uint8Array): string => {
  let result = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode.apply(null, Array.from(bytes.subarray(offset, offset + chunkSize)));
  }
  return result;
};

export const createEmptyTextSyntaxTree = (): TextSyntaxTree => ({
  sequences: [],
  totalPage: 0,
  pageTitleId: [],
  titleIdTitle: [],
  titleIdPage: {},
  titleIdBlockId: {},
  blockIdPage: {},
  blockIdPageEnd: {},
  blocks: [],
  blocksByTitleId: new Map(),
  rawText: '',
});

export const checkEncoding = (uint8Array: Uint8Array): string => {
  const bomEncoding = detectBomEncoding(uint8Array);
  if (bomEncoding) return bomEncoding;

  const sampleSize = Math.min(uint8Array.length, ENCODING_SAMPLE_SIZE);
  const sample = uint8Array.subarray(0, sampleSize);
  try {
    const detected = jschardet.detect(bytesToBinaryString(sample));
    if (detected?.encoding) return detected.encoding;
  } catch {
    // jschardet can throw on tiny / unusual inputs; fall back to UTF-8.
  }
  return 'utf-8';
};

export const arrayBufferToString = (arrayBuffer: ArrayBuffer | Uint8Array<ArrayBuffer>): string => {
  const uint8Array = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const encoding = checkEncoding(uint8Array);
  try {
    return new TextDecoder(encoding).decode(uint8Array);
  } catch {
    return new TextDecoder('utf-8').decode(uint8Array);
  }
};

const getAbortError = (signal?: AbortSignal): Error => {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error('File read aborted');
};

export const createReader = (
  file: File,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(getAbortError(options.signal));
      return;
    }

    const reader = new FileReader();
    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const settle = <T>(callback: (value: T) => void, value: T) => {
      cleanup();
      callback(value);
    };
    const onAbort = () => {
      if (reader.readyState === FileReader.LOADING) {
        reader.abort();
        return;
      }
      settle(reject, getAbortError(options.signal));
    };

    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        settle(resolve, new Uint8Array(result));
      } else {
        settle(reject, new Error('Unable to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => {
      settle(reject, reader.error || new Error('Failed to read file'));
    };
    reader.onabort = () => {
      settle(reject, getAbortError(options.signal));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    reader.readAsArrayBuffer(file);
  });
};

export const trim = (value: unknown): string => {
  return value == null ? '' : String(value).trim();
};
