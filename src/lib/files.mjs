export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'];
/** Everything the library can open: images, Photoshop documents and Imagee projects. */
export const OPEN_ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,.psd,.imagee';

/** @typedef {'png'|'jpeg'|'webp'|'avif'} ExportFormat */
/** @type {{ id: ExportFormat, label: string, mime: string, extension: string, lossy: boolean, alpha: boolean }[]} */
export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', extension: 'png', lossy: false, alpha: true },
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', lossy: true, alpha: false },
  { id: 'webp', label: 'WebP', mime: 'image/webp', extension: 'webp', lossy: true, alpha: true },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', extension: 'avif', lossy: true, alpha: true },
];

/** How an opened file is imported: an Imagee project, a Photoshop document, or a plain image.
 * @param {{ type?: string, name?: string }} file @returns {'imagee' | 'psd' | 'image' | null} */
export function fileKind(file) {
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'imagee' || file.type === 'application/x-imagee') return 'imagee';
  if (ext === 'psd' || file.type === 'image/vnd.adobe.photoshop' || file.type === 'image/psd') return 'psd';
  return isImageFile(file) ? 'image' : null;
}

/** @param {{ type?: string, name?: string }} file */
export function isImageFile(file) {
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'psd' || ext === 'imagee' || file.type === 'image/vnd.adobe.photoshop') return false;
  if (file.type && file.type.startsWith('image/') && file.type !== 'image/svg+xml') return true;
  return IMAGE_EXTENSIONS.includes(ext);
}

/** File name without its extension. @param {string} name */
export function baseName(name) {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).trim() || 'image';
}

/** @param {string} name @param {string} extension */
export function exportName(name, extension) { return `${baseName(name)}.${extension}`; }

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** Output size after scaling, at least 1px on each side.
 * @param {number} width @param {number} height @param {number} percent */
export function scaledSize(width, height, percent) {
  const ratio = Math.max(1, Math.min(400, percent)) / 100;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** @typedef {{ id: string, name: string, size: number, added: number, opened: number, favorite: boolean }} SortableProject */
/** @template {SortableProject} T @param {T[]} items @param {'recent'|'name'|'size'} sort @param {string} query @param {'all'|'recent'|'favorites'} filter @returns {T[]} */
export function visibleProjects(items, sort, query, filter) {
  const q = query.trim().toLowerCase();
  const filtered = items.filter(item => (filter !== 'favorites' || item.favorite) && (filter !== 'recent' || item.opened > 0) && (!q || item.name.toLowerCase().includes(q)));
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  return filtered.sort((a, b) => {
    if (sort === 'name') return collator.compare(a.name, b.name);
    if (sort === 'size') return b.size - a.size;
    return Math.max(b.opened, b.added) - Math.max(a.opened, a.added);
  });
}
