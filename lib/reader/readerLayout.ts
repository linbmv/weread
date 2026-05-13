import type { ChapterLayoutFingerprint } from '@/lib/chapterPagination';
import { DEVICE_ENUM } from '@/lib/hooks';

export interface ReaderLayout {
  pageWidth: number;
  pageGap: number;
  pageStep: number;
  pageHeight: number;
}

export const buildChapterLayoutFingerprint = (layout: ReaderLayout): ChapterLayoutFingerprint => {
  let firstLineIndent = '0';
  let fontFamily = '';
  let fontSize = 18;
  let lineHeight = 40;
  let paragraphGap = 20;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const style = window.getComputedStyle(root);
    fontFamily = style.getPropertyValue('--reader-font-family').trim();
    const sizeValue = Number.parseFloat(style.getPropertyValue('--reader-font-size'));
    if (Number.isFinite(sizeValue) && sizeValue > 0) fontSize = sizeValue;
    const lineHeightValue = Number.parseFloat(style.getPropertyValue('--reader-line-height'));
    if (Number.isFinite(lineHeightValue) && lineHeightValue > 0) lineHeight = lineHeightValue;
    const paragraphGapValue = Number.parseFloat(style.getPropertyValue('--reader-paragraph-gap'));
    if (Number.isFinite(paragraphGapValue) && paragraphGapValue >= 0) paragraphGap = paragraphGapValue;
    firstLineIndent = style.getPropertyValue('--reader-paragraph-text-indent').trim() || '0';
  }
  return {
    firstLineIndent,
    fontFamily,
    fontSize,
    pageWidth: layout.pageWidth,
    pageHeight: layout.pageHeight,
    pageGap: layout.pageGap,
    paragraphGap,
    lineHeight,
  };
};

export const chapterFingerprintEqual = (a: ChapterLayoutFingerprint, b: ChapterLayoutFingerprint): boolean =>
  a.firstLineIndent === b.firstLineIndent &&
  a.fontFamily === b.fontFamily &&
  a.fontSize === b.fontSize &&
  a.pageWidth === b.pageWidth &&
  a.pageHeight === b.pageHeight &&
  a.pageGap === b.pageGap &&
  a.paragraphGap === b.paragraphGap &&
  a.lineHeight === b.lineHeight;

export const getVisiblePageCount = (currentDevice: DEVICE_ENUM): 1 | 2 => {
  return currentDevice === DEVICE_ENUM.DESKTOP ? 2 : 1;
};

export const getInitialPageWidth = (visiblePages: 1 | 2): number => {
  if (typeof window === 'undefined') return visiblePages === 2 ? 640 : 360;
  if (visiblePages === 2) return Math.min(Math.max(Math.floor(window.innerWidth * 0.32), 520), 760);
  return Math.min(Math.max(window.innerWidth - 64, 280), 720);
};

export const getPagedSpreadStartPage = (page: number, visiblePages: number): number => {
  const safePage = Math.max(0, Math.floor(Number.isFinite(page) ? page : 0));
  const safeVisiblePages = Math.max(1, Math.floor(Number.isFinite(visiblePages) ? visiblePages : 1));
  if (safeVisiblePages <= 1) return safePage;
  return safePage - (safePage % safeVisiblePages);
};

export const areChapterImagesReadyForPagination = (flow: HTMLElement, expectedImageCount: number): boolean => {
  if (expectedImageCount <= 0) return true;
  const images = Array.from(flow.querySelectorAll<HTMLImageElement>('.reader-content-image img'));
  const fallbackImages = Array.from(
    flow.querySelectorAll<HTMLElement>('.reader-content-image-fallback[data-reader-image-settled="true"]'),
  );
  if (images.length + fallbackImages.length < expectedImageCount) return false;
  return images.every(
    (image) =>
      image.complete &&
      (image.naturalWidth > 0 || image.naturalHeight > 0 || image.dataset.readerImageSettled === 'true'),
  );
};
