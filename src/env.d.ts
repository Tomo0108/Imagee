/// <reference types="vite/client" />
interface NativeImage { name: string; type: string; bytes: Uint8Array; lastModified: number }
interface Window {
  imagee?: {
    platform: string;
    pickImages(projects?: boolean): Promise<NativeImage[]>;
    takeLaunchImages(): Promise<NativeImage[]>;
    saveImage(name: string, bytes: Uint8Array, extension: string): Promise<string | null>;
    onOpenImages(callback: () => void): () => void;
  };
  showSaveFilePicker?: (options: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
  launchQueue?: { setConsumer(consumer: (params: { files: FileSystemFileHandle[] }) => void): void };
}
declare module '*.mjs';
