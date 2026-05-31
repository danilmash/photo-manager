/** Расширения RAW, поддерживаемые бэкендом (см. app/assets/image_formats.py). */
export const RAW_UPLOAD_EXTENSIONS = [
  '3fr',
  'arw',
  'cr2',
  'cr3',
  'dcr',
  'dng',
  'erf',
  'kdc',
  'mrw',
  'nef',
  'nrw',
  'orf',
  'pef',
  'raf',
  'raw',
  'rw2',
  'rwl',
  'sr2',
  'srf',
  'srw',
  'x3f',
] as const;

const RAW_MIME_PREFIXES = ['image/x-', 'image/vnd.adobe'] as const;

const RAW_EXTENSION_SET = new Set<string>(RAW_UPLOAD_EXTENSIONS);

export const UPLOAD_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'image/heic',
  'image/heif',
  ...RAW_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`),
].join(',');

export function fileExtension(filename: string | null | undefined): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function isRawImage(
  filename: string | null | undefined,
  mimeType: string | null | undefined,
): boolean {
  const mime = (mimeType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (RAW_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return true;
  }
  if (mime === 'image/x-adobe-dng' || mime === 'image/dng') {
    return true;
  }
  return RAW_EXTENSION_SET.has(fileExtension(filename));
}
