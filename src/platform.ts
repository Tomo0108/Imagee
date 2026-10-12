import { isImageFile } from './lib/files.mjs';

export const native = window.imagee;
export const platform = native?.platform === 'darwin' ? 'mac' : native?.platform === 'win32' ? 'win' : 'web';

function toFile(image: NativeImage) { return new File([image.bytes as Uint8Array<ArrayBuffer>], image.name, { type: image.type, lastModified: image.lastModified }); }

/** Opens the system picker. Native builds use the OS dialog; the web uses a file input. */
export function pickImages(): Promise<File[]> {
  if (native) return native.pickImages().then(images => images.map(toFile));
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp';
    input.onchange = () => resolve([...(input.files || [])].filter(isImageFile));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Files passed by the OS: "Open with" on desktop, or the PWA file handler on the web. */
export function onLaunchImages(callback: (files: File[]) => void): () => void {
  if (native) {
    const take = () => void native.takeLaunchImages().then(images => { if (images.length) callback(images.map(toFile)); });
    take();
    return native.onOpenImages(take);
  }
  window.launchQueue?.setConsumer(async ({ files }) => {
    const opened = await Promise.all(files.map(handle => handle.getFile()));
    if (opened.length) callback(opened.filter(isImageFile));
  });
  return () => {};
}

/** Saves a blob. Returns the saved name, or null when the user cancelled. */
export async function saveBlob(blob: Blob, name: string, extension: string, description: string): Promise<string | null> {
  if (native) return native.saveImage(name, new Uint8Array(await blob.arrayBuffer()), extension);
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description, accept: { [blob.type]: [`.${extension}`] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob); await writable.close();
      return handle.name;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return null;
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

export function registerPwa() {
  if (!import.meta.env.PROD || native || !('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}
