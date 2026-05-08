// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getQueue:      () => ipcRenderer.invoke('get-queue'),
  updateStatus: (orderId, status) => ipcRenderer.invoke('update-status', orderId, status),
  updateStatuses: (orderIds, status) => ipcRenderer.invoke('update-statuses', orderIds, status),
  processBatch:  indices => ipcRenderer.invoke('process-batch', indices),
  updateReady: (orderId, blanks, prints, blanksOrdered, printsOrdered) =>
    ipcRenderer.invoke('update-ready', orderId, blanks, prints, blanksOrdered, printsOrdered),
  deleteOrder:   (orderName) => ipcRenderer.invoke('delete-order', orderName),
  setBundle:  (orderIds, name) => ipcRenderer.invoke('set-bundle', orderIds, name),
  updateBundleStatus: (bundleName, status) =>
    ipcRenderer.invoke('update-bundle-status', bundleName, status),
  addFile: (orderId, file) => ipcRenderer.invoke('add-file', orderId, file),
  removeFiles: (orderId, names) => ipcRenderer.invoke('remove-files', orderId, names),
  updateNotes: (orderId, notes) => ipcRenderer.invoke('update-notes', orderId, notes),
  updateName:  (orderId, name) => ipcRenderer.invoke('update-name', orderId, name),
  updateProgress: (orderId, progress) => ipcRenderer.invoke('update-progress', orderId, progress),
  downloadAsset: (url, filename) => ipcRenderer.invoke('download-asset', url, filename)
});

contextBridge.exposeInMainWorld('getAssetPath', file =>
  ipcRenderer.sendSync('get-asset-path', file)
);
