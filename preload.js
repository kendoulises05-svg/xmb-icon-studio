const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openFile:            (opts) => ipcRenderer.invoke("open-file", opts),
  openFolder:          ()     => ipcRenderer.invoke("open-folder"),
  getImageInfo:        (fp)   => ipcRenderer.invoke("get-image-info", fp),
  previewIcoSizes:     (fp)   => ipcRenderer.invoke("preview-ico-sizes", fp),
  convertImage:        (data) => ipcRenderer.invoke("convert-image", data),
  upscaleImage:        (data) => ipcRenderer.invoke("upscale-image", data),
  batchUpscale:        (data) => ipcRenderer.invoke("batch-upscale", data),
  encryptFile:         (data) => ipcRenderer.invoke("encrypt-file", data),
  decryptFile:         (data) => ipcRenderer.invoke("decrypt-file", data),
  compressZip:         (data) => ipcRenderer.invoke("compress-zip", data),
  selectFilesForZip:   ()     => ipcRenderer.invoke("select-files-for-zip"),
  // Ruta real de un archivo arrastrado (File.path ya no existe desde Electron 32)
  getPathForFile:      (file) => webUtils.getPathForFile(file),

  // Real-ESRGAN setup
  setupRealESRGAN:     ()     => ipcRenderer.invoke("setup-realesrgan"),
  checkRealESRGAN:     ()     => ipcRenderer.invoke("check-realesrgan"),

  // Eventos
  onBatchProgress:     (cb)   => ipcRenderer.on("batch-progress",   (_, d) => cb(d)),
  onSetupProgress:     (cb)   => ipcRenderer.on("setup-progress",   (_, d) => cb(d)),
  offBatchProgress:    ()     => ipcRenderer.removeAllListeners("batch-progress"),
  offSetupProgress:    ()     => ipcRenderer.removeAllListeners("setup-progress"),
});
