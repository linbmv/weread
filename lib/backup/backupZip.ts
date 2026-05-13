const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;

export interface BackupZipEntryInput {
  data: Blob | Uint8Array | string;
  path: string;
}

export interface BackupZipEntry {
  data: Uint8Array;
  path: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const normalizePath = (path: string): string => {
  return path
    .replace(/\\/gu, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
};

const toBytes = async (data: Blob | Uint8Array | string): Promise<Uint8Array> => {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
};

const writeUint16 = (view: DataView, offset: number, value: number): void => {
  view.setUint16(offset, value, true);
};

const writeUint32 = (view: DataView, offset: number, value: number): void => {
  view.setUint32(offset, value >>> 0, true);
};

const createLocalHeader = (name: Uint8Array, data: Uint8Array, crc: number): Uint8Array => {
  const header = new Uint8Array(30 + name.byteLength);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, ZIP_UTF8_FLAG);
  writeUint16(view, 8, ZIP_STORE_METHOD);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, 0);
  writeUint32(view, 14, crc);
  writeUint32(view, 18, data.byteLength);
  writeUint32(view, 22, data.byteLength);
  writeUint16(view, 26, name.byteLength);
  writeUint16(view, 28, 0);
  header.set(name, 30);
  return header;
};

const createCentralDirectoryHeader = (
  name: Uint8Array,
  data: Uint8Array,
  crc: number,
  localHeaderOffset: number,
): Uint8Array => {
  const header = new Uint8Array(46 + name.byteLength);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, ZIP_UTF8_FLAG);
  writeUint16(view, 10, ZIP_STORE_METHOD);
  writeUint16(view, 12, 0);
  writeUint16(view, 14, 0);
  writeUint32(view, 16, crc);
  writeUint32(view, 20, data.byteLength);
  writeUint32(view, 24, data.byteLength);
  writeUint16(view, 28, name.byteLength);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, localHeaderOffset);
  header.set(name, 46);
  return header;
};

const createEndOfCentralDirectory = (entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) => {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralDirectorySize);
  writeUint32(view, 16, centralDirectoryOffset);
  writeUint16(view, 20, 0);
  return header;
};

export const createBackupZip = async (entries: BackupZipEntryInput[]): Promise<Blob> => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (!path) continue;
    const name = encoder.encode(path);
    const data = await toBytes(entry.data);
    const crc = crc32(data);
    const localHeader = createLocalHeader(name, data, crc);
    const centralHeader = createCentralDirectoryHeader(name, data, crc, offset);
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const endHeader = createEndOfCentralDirectory(centralParts.length, centralDirectorySize, centralDirectoryOffset);
  return new Blob([...localParts, ...centralParts, endHeader] as BlobPart[], { type: 'application/zip' });
};

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const minOffset = Math.max(0, bytes.byteLength - 0xffff - 22);
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    if (view.getUint32(0, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  return -1;
};

export const readBackupZip = async (file: Blob): Promise<Map<string, BackupZipEntry>> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) throw new Error('Invalid BDZ archive.');

  const eocd = new DataView(bytes.buffer, bytes.byteOffset + eocdOffset, 22);
  const entryCount = eocd.getUint16(10, true);
  const centralDirectoryOffset = eocd.getUint32(16, true);
  const result = new Map<string, BackupZipEntry>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    const central = new DataView(bytes.buffer, bytes.byteOffset + offset, 46);
    if (central.getUint32(0, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid BDZ central directory.');
    }
    const method = central.getUint16(10, true);
    if (method !== ZIP_STORE_METHOD) {
      throw new Error('Unsupported BDZ compression method.');
    }
    const compressedSize = central.getUint32(20, true);
    const nameLength = central.getUint16(28, true);
    const extraLength = central.getUint16(30, true);
    const commentLength = central.getUint16(32, true);
    const localHeaderOffset = central.getUint32(42, true);
    const nameStart = offset + 46;
    const path = normalizePath(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));

    const local = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset, 30);
    if (local.getUint32(0, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error('Invalid BDZ local file header.');
    }
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (path) {
      result.set(path, { data, path });
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return result;
};
