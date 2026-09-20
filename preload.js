const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Sets
  getSets:    ()              => ipcRenderer.invoke('sets:list'),
  getSet:     (id)            => ipcRenderer.invoke('sets:get', id),
  saveSet:    (set)           => ipcRenderer.invoke('sets:save', set),
  deleteSet:  (id)            => ipcRenderer.invoke('sets:delete', id),
  importSets: ()              => ipcRenderer.invoke('sets:import'),
  exportSet:  (setId, format) => ipcRenderer.invoke('sets:export', { setId, format }),

  // Auto-updater (only fires real events when running as packaged exe)
  updater: {
    onAvailable:  (cb) => ipcRenderer.on('update:available',  (_, info) => cb(info)),
    onProgress:   (cb) => ipcRenderer.on('update:progress',   (_, info) => cb(info)),
    onDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_, info) => cb(info)),
    download: ()       => ipcRenderer.invoke('updater:download'),
    install:  ()       => ipcRenderer.invoke('updater:install'),
  },
})
