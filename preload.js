// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getQueue:      () => ipcRenderer.invoke('get-queue'),
  updateStatus: (orderId, status) => ipcRenderer.invoke('update-status', orderId, status),
  processBatch:  indices => ipcRenderer.invoke('process-batch', indices),
  updateReady: (orderId, blanks, prints) =>
    ipcRenderer.invoke('update-ready', orderId, blanks, prints),
  deleteOrder:   (orderName) => ipcRenderer.invoke('delete-order', orderName),
  setBundle:  (orderIds, name) => ipcRenderer.invoke('set-bundle', orderIds, name)
});
