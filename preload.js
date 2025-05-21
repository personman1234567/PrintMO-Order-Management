// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getQueue:      () => ipcRenderer.invoke('get-queue'),
  updateStatus: (orderId, status) => ipcRenderer.invoke('update-status', orderId, status),
  processBatch:  indices => ipcRenderer.invoke('process-batch', indices),
  deleteOrder:   (orderName) => ipcRenderer.invoke('delete-order', orderName)
});
