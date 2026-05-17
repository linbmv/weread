import { buildResourcePlaceholderUrl } from '@/lib/bookResources';
import type { BookResourceRecord } from '@/lib/bookResources';
import type { ReaderBookDocument, ReaderDocumentChapter } from '@/lib/readerDocument';
import { unzipEpubInWorker } from '@/lib/epubUnzipClient';

export interface EpubParseResult {
  document: ReaderBookDocument;
  resources: BookResourceRecord[];
  coverResourceKey?: string;
}

interface ManifestItem {
  href: string;
  id: string;
  mediaType: string;
  properties: string;
}

const decoder = new TextDecoder('utf-8');

const IMAGE_MEDIA_TYPES = new Set(['image/gif', 'image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml', 'image/webp']);

const BLOCK_TAGS = new Set(['blockquote', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'p']);

const INLINE_TAGS = new Set(['em', 'span', 'strong']);

const DANGEROUS_TAGS = new Set([
  'audio',
  'canvas',
  'embed',
  'iframe',
  'math',
  'object',
  'script',
  'style',
  'svg',
  'video',
]);

const normalizePath = (value: string): string => {
  const parts: string[] = [];
  value.split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') {
      parts.pop();
      return;
    }
    parts.push(part);
  });
  return parts.join('/');
};

const dirname = (value: string): string => {
  const index = value.lastIndexOf('/');
  return index === -1 ? '' : value.slice(0, index + 1);
};

const resolvePath = (base: string, href: string): string => {
  const [path] = href.split('#');
  if (!path) return normalizePath(base);
  return normalizePath(path.startsWith('/') ? path.slice(1) : `${base}${path}`);
};

const stripFragment = (href: string): string => href.split('#')[0];

const getTagText = (root: ParentNode, tagName: string): string => {
  return root.querySelector(tagName)?.textContent?.trim() || '';
};

const getLocalNameText = (root: Document | Element, localName: string): string => {
  const items = Array.from(root.getElementsByTagName('*'));
  return items.find((item) => item.localName.toLowerCase() === localName.toLowerCase())?.textContent?.trim() || '';
};

const decodeXml = (bytes: Uint8Array): string => {
  const utf8Text = decoder.decode(bytes);
  const encodingMatch = /^<\?xml[^>]*encoding=["']([^"']+)["'][^>]*\?>/iu.exec(utf8Text.slice(0, 200));
  const encoding = encodingMatch?.[1];
  if (!encoding || /^utf-?8$/iu.test(encoding)) return utf8Text;
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return utf8Text;
  }
};

const parseXml = (value: string, type: DOMParserSupportedType = 'application/xml'): Document => {
  return new DOMParser().parseFromString(value, type);
};

const getContainerOpfPath = (files: Map<string, Uint8Array>): string => {
  const containerBytes = files.get('META-INF/container.xml');
  if (!containerBytes) throw new Error('Invalid EPUB: META-INF/container.xml is missing.');
  const container = parseXml(decodeXml(containerBytes));
  const rootFile = container.querySelector('rootfile');
  const fullPath = rootFile?.getAttribute('full-path');
  if (!fullPath) throw new Error('Invalid EPUB: OPF path is missing.');
  return normalizePath(fullPath);
};

const getManifest = (opf: Document): Map<string, ManifestItem> => {
  const manifest = new Map<string, ManifestItem>();
  Array.from(opf.querySelectorAll('manifest > item')).forEach((item) => {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    if (!id || !href) return;
    manifest.set(id, {
      href,
      id,
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    });
  });
  return manifest;
};

const getCoverItem = (opf: Document, manifest: Map<string, ManifestItem>): ManifestItem | undefined => {
  const explicit = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/u).includes('cover-image'));
  if (explicit && IMAGE_MEDIA_TYPES.has(explicit.mediaType)) return explicit;
  const metaCoverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content') || '';
  const fallback = metaCoverId ? manifest.get(metaCoverId) : undefined;
  return fallback && IMAGE_MEDIA_TYPES.has(fallback.mediaType) ? fallback : undefined;
};

const getSpineHrefs = (opf: Document, manifest: Map<string, ManifestItem>): ManifestItem[] => {
  return Array.from(opf.querySelectorAll('spine > itemref'))
    .map((item) => manifest.get(item.getAttribute('idref') || ''))
    .filter((item): item is ManifestItem => Boolean(item && /x?html?/iu.test(item.mediaType)));
};

const getNavTitleMap = (navDocument: Document, base: string): Map<string, string> => {
  const map = new Map<string, string>();
  const navElements = Array.from(navDocument.querySelectorAll('nav'));
  const tocNavElements = navElements.filter((nav) => {
    const type = `${nav.getAttribute('epub:type') || ''} ${nav.getAttribute('type') || ''} ${nav.getAttribute('role') || ''}`;
    return /\btoc\b/iu.test(type);
  });
  const roots = tocNavElements.length > 0 ? tocNavElements : navElements;
  roots.forEach((root) => {
    Array.from(root.querySelectorAll('a[href]')).forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      const title = anchor.textContent?.trim() || '';
      if (!href || !title) return;
      map.set(resolvePath(base, stripFragment(href)), title);
    });
  });
  return map;
};

const getNcxTitleMap = (ncxDocument: Document, base: string): Map<string, string> => {
  const map = new Map<string, string>();
  Array.from(ncxDocument.querySelectorAll('navPoint')).forEach((point) => {
    const src = point.querySelector('content')?.getAttribute('src') || '';
    const title = point.querySelector('navLabel text')?.textContent?.trim() || '';
    if (!src || !title) return;
    map.set(resolvePath(base, stripFragment(src)), title);
  });
  return map;
};

const getTocTitleMap = (
  opf: Document,
  manifest: Map<string, ManifestItem>,
  files: Map<string, Uint8Array>,
  opfBase: string,
): Map<string, string> => {
  const navItem = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/u).includes('nav'));
  if (navItem) {
    const navPath = resolvePath(opfBase, navItem.href);
    const navBytes = files.get(navPath);
    if (navBytes) return getNavTitleMap(parseXml(decodeXml(navBytes), 'text/html'), dirname(navPath));
  }

  const tocId = opf.querySelector('spine')?.getAttribute('toc') || '';
  const ncxItem =
    manifest.get(tocId) || Array.from(manifest.values()).find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxPath = resolvePath(opfBase, ncxItem.href);
    const ncxBytes = files.get(ncxPath);
    if (ncxBytes) return getNcxTitleMap(parseXml(decodeXml(ncxBytes)), dirname(ncxPath));
  }

  return new Map();
};

interface SanitizeContext {
  resourceKeyByPath: Map<string, string>;
  chapterBase: string;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error('EPUB parse aborted.');
};

// Yield the main thread between expensive sanitize passes so a multi-megabyte
// EPUB does not block input / paint for seconds at a time. Uses the Scheduler
// API when available (Chrome 129+, smarter prioritisation) and falls back to
// a postTask-shaped setTimeout(0) elsewhere.
interface SchedulerYield {
  yield: () => Promise<void>;
}
const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: SchedulerYield }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const sanitizeElement = (element: Element, context: SanitizeContext): Node | undefined => {
  const tagName = element.tagName.toLowerCase();
  if (DANGEROUS_TAGS.has(tagName)) return undefined;

  if (tagName === 'img') {
    const img = document.createElement('img');
    const src = element.getAttribute('src') || '';
    const resourcePath =
      context.resourceKeyByPath.get(resolvePath(context.chapterBase, src)) ||
      context.resourceKeyByPath.get(normalizePath(src));
    if (!resourcePath) return undefined;
    img.setAttribute('src', buildResourcePlaceholderUrl(resourcePath));
    img.setAttribute('data-resource-key', resourcePath);
    const alt = element.getAttribute('alt');
    if (alt) img.setAttribute('alt', alt);
    return img;
  }

  const safeTag = BLOCK_TAGS.has(tagName) || INLINE_TAGS.has(tagName) ? tagName : 'span';
  const safeElement = document.createElement(safeTag);
  Array.from(element.childNodes).forEach((child) => {
    const safeChild = sanitizeNode(child, context);
    if (safeChild) safeElement.appendChild(safeChild);
  });
  return safeElement;
};

const sanitizeNode = (node: Node, context: SanitizeContext): Node | undefined => {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  return sanitizeElement(node as Element, context);
};

const sanitizeBodyHtml = (body: HTMLElement, context: SanitizeContext): string => {
  const container = document.createElement('div');
  Array.from(body.childNodes).forEach((child) => {
    const safeChild = sanitizeNode(child, context);
    if (safeChild) container.appendChild(safeChild);
  });
  return container.innerHTML;
};

const getChapterText = (body: HTMLElement): string => {
  return (body.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const getFallbackChapterTitle = (path: string, order: number): string => {
  const fileName =
    path
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/u, '') || '';
  return fileName || `Chapter ${order + 1}`;
};

const buildResourceMap = (
  manifest: Map<string, ManifestItem>,
  files: Map<string, Uint8Array>,
  opfBase: string,
): {
  resourceKeyByPath: Map<string, string>;
  resourceFiles: { path: string; mediaType: string; bytes: Uint8Array }[];
} => {
  const resourceKeyByPath = new Map<string, string>();
  const resourceFiles: { path: string; mediaType: string; bytes: Uint8Array }[] = [];
  Array.from(manifest.values()).forEach((item) => {
    if (!IMAGE_MEDIA_TYPES.has(item.mediaType)) return;
    const path = resolvePath(opfBase, item.href);
    const bytes = files.get(path);
    if (!bytes) return;
    resourceKeyByPath.set(path, path);
    resourceFiles.push({ path, mediaType: item.mediaType, bytes });
  });
  return { resourceKeyByPath, resourceFiles };
};

// Build BookResourceRecord[] without copying image bytes.
// Each Uint8Array view already owns its own ArrayBuffer (transferred from the
// worker), so wrapping it in a Blob is enough — Blob takes a reference and
// later Blob storage in IndexedDB is a structured-clone anyway.
// The source map is cleared eagerly so the GC can reclaim memory before
// chapter HTML parsing kicks in.
const toResourceRecords = (
  bookId: string,
  resources: { path: string; mediaType: string; bytes: Uint8Array }[],
  files: Map<string, Uint8Array>,
): BookResourceRecord[] => {
  const records = resources.map((resource) => {
    const record: BookResourceRecord = {
      bookId,
      resourceKey: resource.path,
      mediaType: resource.mediaType,
      blob: new Blob([resource.bytes as BlobPart], { type: resource.mediaType }),
      size: resource.bytes.byteLength,
    };
    files.delete(resource.path);
    return record;
  });
  return records;
};

export const parseEpubToReaderDocument = async (
  content: Uint8Array<ArrayBuffer> | ArrayBuffer,
  fileName: string,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<EpubParseResult> => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('This browser does not support EPUB XML parsing.');
  }

  throwIfAborted(options.signal);

  // Hand the raw EPUB bytes to a worker (transferable, zero-copy) and get back
  // a flat list of inflated entries with their underlying ArrayBuffers
  // transferred back. This keeps DEFLATE off the main thread and avoids the
  // 4x byte copies the previous implementation incurred.
  const buffer = content instanceof ArrayBuffer ? content : content.buffer;
  const entries = await unzipEpubInWorker(buffer, { signal: options.signal });
  throwIfAborted(options.signal);
  const files = new Map<string, Uint8Array>();
  for (const [index, entry] of entries.entries()) {
    if (index % 50 === 0) throwIfAborted(options.signal);
    files.set(entry.path, new Uint8Array(entry.bytes));
  }
  // Allow the entries list to be GC'd; underlying ArrayBuffers are kept alive
  // through the Map values until each is explicitly removed below.
  entries.length = 0;

  const opfPath = getContainerOpfPath(files);
  throwIfAborted(options.signal);
  const opfBytes = files.get(opfPath);
  if (!opfBytes) throw new Error('Invalid EPUB: OPF file is missing.');

  const opfBase = dirname(opfPath);
  const opf = parseXml(decodeXml(opfBytes));
  files.delete(opfPath);
  const manifest = getManifest(opf);
  const spineItems = getSpineHrefs(opf, manifest);
  const tocTitleMap = getTocTitleMap(opf, manifest, files, opfBase);
  const { resourceKeyByPath, resourceFiles } = buildResourceMap(manifest, files, opfBase);
  const title = getLocalNameText(opf, 'title') || fileName.replace(/\.epub$/iu, '');
  const author = getLocalNameText(opf, 'creator');
  const coverItem = getCoverItem(opf, manifest);
  const coverResourceKey = coverItem ? resolvePath(opfBase, coverItem.href) : undefined;
  const cover = coverResourceKey ? buildResourcePlaceholderUrl(coverResourceKey) : undefined;

  // Wrap image bytes into Blobs and drop them from `files` immediately so the
  // 30–80MB of decoded image memory can be reclaimed before we start
  // DOMParser-ing chapter HTML.
  const resources = resourceFiles.length ? toResourceRecords('', resourceFiles, files) : [];
  resourceFiles.length = 0;
  throwIfAborted(options.signal);

  const chapters: ReaderDocumentChapter[] = [];

  for (let spineIndex = 0; spineIndex < spineItems.length; spineIndex++) {
    if (spineIndex % 3 === 0) {
      throwIfAborted(options.signal);
      // Yield every few chapters so the browser can paint loading UI and
      // respond to user input. sanitizeBodyHtml is recursive over an entire
      // chapter's DOM tree, so a 200-chapter book without yields could
      // otherwise lock the main thread for >5 seconds.
      if (spineIndex > 0) await yieldToMain();
    }
    const item = spineItems[spineIndex];
    const chapterPath = resolvePath(opfBase, item.href);
    const chapterBytes = files.get(chapterPath);
    if (!chapterBytes) continue;
    const parsed = parseXml(decodeXml(chapterBytes), 'text/html');
    files.delete(chapterPath);
    const body = parsed.body;
    const chapterBase = dirname(chapterPath);
    const bodyTitle =
      tocTitleMap.get(chapterPath) ||
      getTagText(body, 'h1') ||
      getTagText(body, 'h2') ||
      getTagText(parsed, 'title') ||
      getFallbackChapterTitle(chapterPath, chapters.length);
    const html = sanitizeBodyHtml(body, { resourceKeyByPath, chapterBase });
    const text = getChapterText(body);
    if (!text && !html.includes('<img')) continue;
    chapters.push({
      html,
      // Stable id: based on spine index only, not the running chapter counter.
      // This way skipping empty entries above does not shift later ids,
      // so existing annotations remain anchored after re-imports or library upgrades.
      id: `epub-spine-${spineIndex}`,
      order: chapters.length,
      text,
      title: bodyTitle,
    });
  }

  throwIfAborted(options.signal);
  files.clear();

  const rawText = chapters.map((chapter) => `${chapter.title}\n${chapter.text}`).join('\n\n');

  const document: ReaderBookDocument = {
    author,
    chapters,
    cover,
    rawText,
    sourceType: 'epub',
    title,
    version: 1,
  };

  return {
    document,
    resources,
    coverResourceKey,
  };
};

export const finalizeEpubResources = (resources: BookResourceRecord[], bookId: string): BookResourceRecord[] => {
  return resources.map((record) => ({ ...record, bookId }));
};
