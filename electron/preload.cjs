const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('imagee', {
  platform: process.platform,
  pickImages: projects => ipcRenderer.invoke('pick-images', !!projects),
  takeLaunchImages: () => ipcRenderer.invoke('take-launch-images'),
  saveImage: (name, bytes, extension) => ipcRenderer.invoke('save-image', name, bytes, extension),
  onOpenImages: callback => { const handler = () => callback(); ipcRenderer.on('open-paths', handler); return () => ipcRenderer.removeListener('open-paths', handler); },
});
