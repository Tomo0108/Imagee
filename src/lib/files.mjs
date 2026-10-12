export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'];

/** @typedef {'png'|'jpeg'|'webp'|'avif'} ExportFormat */
/** @type {{ id: ExportFormat, label: string, mime: string, extension: string, lossy: boolean, alpha: boolean }[]} */
export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', extension: 'png', lossy: false, alpha: true },
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', lossy: true, alpha: false },
  { id: 'webp', label: 'WebP', mime: 'image/webp', extension: 'webp', lossy: true, alpha: true },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', extension: 'avif', lossy: true, alpha: true },
];

/** @param {{ type?: string, name?: string }} file */
export function isImageFile(file) {
  if (file.type && file.type.startsWith('image/') && file.type !== 'image/svg+xml') return true;
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
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
