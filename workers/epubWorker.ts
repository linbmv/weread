/// <reference lib="webworker" />
// EPUB ZIP parser and DEFLATE inflater that runs off the main thread.
// Receives the raw EPUB ArrayBuffer (transferred, zero-copy) and posts back
// a list of inflated entries with their underlying buffers transferred.
//
// DOM parsing and HTML sanitization remain on the main thread because
// DOMParser is unavailable in workers. This worker only handles bytes.

declare const self: DedicatedWorkerGlobalScope;

interface ZipEntry {
  compressedSize: number;
  compressionMethod: number;
  dataOffset: number;
  name: string;
  uncompressedSize: number;
}

interface UnzipRequest {
  type: 'unzip';
  opId: string;
  buffer: ArrayBuffer;
}

export interface EpubUnzipEntry {
  path: string;
  bytes: ArrayBuffer;
}

export interface EpubUnzipResponse {
  opId: string;
  status: 'success' | 'error';
  entries?: EpubUnzipEntry[];
  message?: string;
}

const decoder = new TextDecoder('utf-8');

const getUint16 = (view: DataView, offset: number): number => view.getUint16(offset, true);

const getUint32 = (view: DataView, offset: number): number => view.getUint32(offset, true);

const normalizePath = (value: string): string => {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
};

// ZIP spec hard limits. 0xffff is the maximum entry count for ZIP v2 (without
// ZIP64); anything beyond that is either truncated or malicious.
const MAX_ZIP_ENTRIES = 0xffff;
const EOCD_SIGNATURE_SIZE = 22;
const CENTRAL_DIRECTORY_HEADER_FIXED_SIZE = 46;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;

const findEocd = (view: DataView): number => {
  // Guard against tiny / truncated inputs before we start scanning backwards.
  if (view.byteLength < EOCD_SIGNATURE_SIZE) {
    throw new Error('Invalid EPUB: file is too small to contain a ZIP directory.');
  }
  const minOffset = Math.max(0, view.byteLength - 0xffff - EOCD_SIGNATURE_SIZE);
  for (let offset = view.byteLength - EOCD_SIGNATURE_SIZE; offset >= minOffset; offset--) {
    if (getUint32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid EPUB: ZIP central directory not found.');
};

const parseZipEntries = (bytes: Uint8Array): ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocd(view);
  const entryCount = getUint16(view, eocdOffset + 10);
  const centralDirectoryOffset = getUint32(view, eocdOffset + 16);

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error(`Invalid EPUB: entry count ${entryCount} exceeds ZIP limit.`);
  }
  if (centralDirectoryOffset >= view.byteLength) {
    throw new Error('Invalid EPUB: central directory offset is out of range.');
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + CENTRAL_DIRECTORY_HEADER_FIXED_SIZE > view.byteLength) {
      throw new Error('Invalid EPUB: truncated central directory entry.');
    }
    if (getUint32(view, offset) !== 0x02014b50) {
      throw new Error('Invalid EPUB: ZIP entry header is corrupted.');
    }
    const compressionMethod = getUint16(view, offset + 10);
    const compressedSize = getUint32(view, offset + 20);
    const uncompressedSize = getUint32(view, offset + 24);
    const fileNameLength = getUint16(view, offset + 28);
    const extraLength = getUint16(view, offset + 30);
    const commentLength = getUint16(view, offset + 32);
    const localHeaderOffset = getUint32(view, offset + 42);

    const nameStart = offset + CENTRAL_DIRECTORY_HEADER_FIXED_SIZE;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > view.byteLength) {
      throw new Error('Invalid EPUB: file name extends past end of archive.');
    }
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));

    if (localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE > view.byteLength) {
      throw new Error(`Invalid EPUB: local header offset out of range for ${name}.`);
    }
    if (getUint32(view, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid EPUB: local header not found for ${name}.`);
    }
    const localFileNameLength = getUint16(view, localHeaderOffset + 26);
    const localExtraLength = getUint16(view, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE + localFileNameLength + localExtraLength;
    if (dataOffset + compressedSize > view.byteLength) {
      throw new Error(`Invalid EPUB: compressed data for ${name} extends past end of archive.`);
    }
    entries.push({
      compressedSize,
      compressionMethod,
      dataOffset,
      name: normalizePath(name),
      uncompressedSize,
    });
    offset += CENTRAL_DIRECTORY_HEADER_FIXED_SIZE + fileNameLength + extraLength + commentLength;
  }
  return entries;
};

const inflateWith = async (bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> => {
  // Feed the compressed slice directly into a ReadableStream — avoids the
  // intermediate Blob copy that the previous `new Blob([bytes]).stream()`
  // implementation performed, which mattered for large EPUBs with many
  // entries.
   
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
   
  const stream = source.pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const inflateRaw = async (bytes: Uint8Array): Promise<Uint8Array> => {
  try {
    return await inflateWith(bytes, 'deflate-raw');
  } catch {
    return inflateWith(bytes, 'deflate');
  }
};

const toOwnedBuffer = (view: Uint8Array): ArrayBuffer => {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.slice().buffer as ArrayBuffer;
};

const unzip = async (buffer: ArrayBuffer): Promise<EpubUnzipEntry[]> => {
  const bytes = new Uint8Array(buffer);
  const entries = parseZipEntries(bytes);
  const result: EpubUnzipEntry[] = [];

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    let inflated: Uint8Array;
    if (entry.compressionMethod === 0) {
      inflated = new Uint8Array(compressed);
    } else if (entry.compressionMethod === 8) {
      inflated = await inflateRaw(compressed);
      if (entry.uncompressedSize && inflated.byteLength > entry.uncompressedSize) {
        inflated = inflated.subarray(0, entry.uncompressedSize);
      }
    } else {
      throw new Error(`Unsupported EPUB ZIP compression method: ${entry.compressionMethod}.`);
    }
    result.push({ path: entry.name, bytes: toOwnedBuffer(inflated) });
  }
  return result;
};

self.addEventListener('message', (event: MessageEvent<UnzipRequest>) => {
  const { type, opId, buffer } = event.data;
  if (type !== 'unzip') return;
  unzip(buffer)
    .then((entries) => {
      const response: EpubUnzipResponse = { opId, status: 'success', entries };
      self.postMessage(
        response,
        entries.map((entry) => entry.bytes),
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const response: EpubUnzipResponse = { opId, status: 'error', message };
      self.postMessage(response);
    });
});

export {};
