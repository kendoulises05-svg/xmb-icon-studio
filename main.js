const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, execSync } = require("child_process");
require("dotenv").config();

const pngToIco = require("png-to-ico").default;

let mainWindow;

/* ─────────────────────────────────────
   PYTHON DETECTION — prioriza .venv local
───────────────────────────────────── */
function getPythonCmd() {
  const isWin = process.platform === "win32";
  const projectRoot = __dirname;

  // Rutas posibles del venv — Windows usa Scripts/, Unix usa bin/
  const venvCandidates = isWin
    ? [
        path.join(projectRoot, ".venv", "Scripts", "python.exe"),
        path.join(projectRoot, "venv",  "Scripts", "python.exe"),
      ]
    : [
        path.join(projectRoot, ".venv", "bin", "python3"),
        path.join(projectRoot, ".venv", "bin", "python"),
        path.join(projectRoot, "venv",  "bin", "python3"),
        path.join(projectRoot, "venv",  "bin", "python"),
      ];

  // 1 — Buscar primero en el venv local
  for (const venvPy of venvCandidates) {
    if (fs.existsSync(venvPy)) {
      try {
        execSync(`"${venvPy}" --version`, { stdio: "ignore" });
        console.log("[Python] Usando venv:", venvPy);
        return venvPy;
      } catch {}
    }
  }

  // 2 — Fallback: Python global del sistema
  const globalCandidates = isWin
    ? ["python", "python3"]
    : ["python3", "python"];

  for (const cmd of globalCandidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      console.log("[Python] Usando global:", cmd);
      return cmd;
    } catch {}
  }

  console.error("[Python] No se encontró Python ni en .venv ni globalmente");
  return null;
}
const PYTHON_CMD = getPythonCmd();

/* ─────────────────────────────────────
   CRYPTO
───────────────────────────────────── */
const { deriveKey, makeKeyLegacy, encryptFile, decryptFile, ENC_MAGIC, ENC_VERSION } = require("./crypto-utils");

/* ─────────────────────────────────────
   ZIP NATIVO (sin dependencias externas)
───────────────────────────────────── */
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) | 0;
}

function createZipBuffer(files, password = null) {
  // files: [{path, name}]
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    let data = fs.readFileSync(file.path);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(data);
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);

    const cdEntry = Buffer.alloc(46 + name.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4);
    cdEntry.writeUInt16LE(20, 6);
    cdEntry.writeUInt16LE(0, 8);
    cdEntry.writeUInt16LE(8, 10);
    cdEntry.writeUInt16LE(dosTime, 12);
    cdEntry.writeUInt16LE(dosDate, 14);
    cdEntry.writeInt32LE(crc, 16);
    cdEntry.writeUInt32LE(compressed.length, 20);
    cdEntry.writeUInt32LE(data.length, 24);
    cdEntry.writeUInt16LE(name.length, 28);
    cdEntry.writeUInt16LE(0, 30); cdEntry.writeUInt16LE(0, 32);
    cdEntry.writeUInt16LE(0, 34); cdEntry.writeUInt16LE(0, 36);
    cdEntry.writeUInt32LE(0, 38);
    cdEntry.writeUInt32LE(offset, 42);
    name.copy(cdEntry, 46);

    parts.push(localHeader, compressed);
    centralDir.push(cdEntry);
    offset += localHeader.length + compressed.length;
  }

  const cdBuffer = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuffer, eocd]);
}

/* ─────────────────────────────────────
   VENTANA
───────────────────────────────────── */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 680,
    minWidth: 960, minHeight: 580,
    backgroundColor: "#090c10",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index_V7.html");
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

/* ─────────────────────────────────────
   IPC: ABRIR ARCHIVO(S)
───────────────────────────────────── */
ipcMain.handle("open-file", async (_, opts = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: opts.multi ? ["openFile", "multiSelections"] : ["openFile"],
    filters: opts.any
      ? [{ name: "Todos", extensions: ["*"] }]
      : [{ name: "Imágenes", extensions: ["png","jpg","jpeg","webp","gif","bmp"] }],
  });
  if (canceled) return null;
  return opts.multi ? filePaths : filePaths[0];
});

ipcMain.handle("open-folder", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (canceled) return null;
  return filePaths[0];
});

/* ─────────────────────────────────────
   IPC: INFO + PREVIEW
───────────────────────────────────── */
ipcMain.handle("get-image-info", async (_, filePath) => {
  try {
    const meta = await sharp(filePath).metadata();
    const stat = fs.statSync(filePath);
    const previewBuffer = await sharp(filePath)
      .resize(400, 400, { fit: "inside", kernel: "lanczos3" })
      .png().toBuffer();
    return {
      success: true,
      width: meta.width, height: meta.height,
      format: (meta.format || "").toUpperCase(),
      size: stat.size,
      preview: `data:image/png;base64,${previewBuffer.toString("base64")}`,
    };
  } catch (err) { return { success: false, error: err.message }; }
});

/* ─────────────────────────────────────
   IPC: PREVIEW ICO
───────────────────────────────────── */
ipcMain.handle("preview-ico-sizes", async (_, filePath) => {
  try {
    const sizes = [16, 32, 48, 64, 128, 256];
    const previews = await Promise.all(sizes.map(async size => {
      const buf = await sharp(filePath)
        .resize(size, size, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 }, kernel: "lanczos3" })
        .png().toBuffer();
      return { size, preview: `data:image/png;base64,${buf.toString("base64")}` };
    }));
    return { success: true, previews };
  } catch (err) { return { success: false, error: err.message }; }
});

/* ─────────────────────────────────────
   IPC: CONVERTIR
───────────────────────────────────── */
ipcMain.handle("convert-image", async (_, { filePath, format, icoSizes }) => {
  try {
    const ext = path.extname(filePath);
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: filePath.replace(ext, `.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (canceled) return { success: false };
    if (format === "jpg") await sharp(filePath).jpeg({ quality: 95 }).toFile(savePath);
    if (format === "png") await sharp(filePath).png({ compressionLevel: 9 }).toFile(savePath);
    if (format === "ico") {
      const sizes = (icoSizes?.length > 0) ? icoSizes : [16,32,48,64,128,256];
      const pngBuffers = await Promise.all(sizes.map(size =>
        sharp(filePath).resize(size, size, { fit:"contain", background:{r:0,g:0,b:0,alpha:0}, kernel:"lanczos3" }).png().toBuffer()
      ));
      fs.writeFileSync(savePath, await pngToIco(pngBuffers));
    }
    return { success: true, output: savePath, size: fs.statSync(savePath).size };
  } catch (err) { return { success: false, error: err.message }; }
});

/* ─────────────────────────────────────
   IPC: UPSCALE SINGLE
───────────────────────────────────── */
function runPython(args) {
  return new Promise((resolve) => {
    if (!PYTHON_CMD) {
      return resolve({ success: false, error: "Python no encontrado. Instala Python 3." });
    }
    const scriptPath = path.join(__dirname, "upscaler.py");
    const jsonArgs = JSON.stringify({
      ...args,
      input: args.input.replace(/\\/g, "/"),
      output: args.output.replace(/\\/g, "/"),
    });
    // Activar el entorno virtual: agregar su carpeta bin/Scripts al PATH
    const venvDir = path.dirname(PYTHON_CMD);
    const envWithVenv = {
      ...process.env,
      PATH: venvDir + (process.platform === "win32" ? ";" : ":") + (process.env.PATH || ""),
      VIRTUAL_ENV: path.dirname(venvDir),
      PYTHONPATH: "",          // evitar conflictos con instalaciones globales
    };
    const proc = spawn(PYTHON_CMD, [scriptPath, jsonArgs], { env: envWithVenv });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", code => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch { resolve({ success: false, error: `Respuesta inválida: ${stdout}` }); }
      } else {
        let msg = stderr || stdout || `Python exit code ${code}`;
        // Error: falta modulo
        if (msg.includes("No module named")) {
          const mod = msg.match(/No module named '([^']+)'/)?.[1] || "modulo";
          msg = `Falta instalar: pip install ${mod} onnxruntime numpy pillow`;
        }
        // Error: modelo ONNX no existe todavia
        if (msg.includes("modelo ONNX no existe") || msg.includes("ensure_onnx")) {
          msg = "Modelo Real-ESRGAN no encontrado. Usa Upscaling → Descargar Modelo.";
        }
        resolve({ success: false, error: msg });
      }
    });
    setTimeout(() => { proc.kill(); resolve({ success: false, error: "Timeout" }); }, 600000);
  });
}

/* ─────────────────────────────────────
   IPC: SETUP REAL-ESRGAN (descarga + convierte modelo)
───────────────────────────────────── */
ipcMain.handle("setup-realesrgan", async (event) => {
  return new Promise((resolve) => {
    if (!PYTHON_CMD) {
      return resolve({ success: false, error: "Python no encontrado." });
    }
    const scriptPath = path.join(__dirname, "upscaler.py");
    const venvDir    = path.dirname(PYTHON_CMD);
    const envWithVenv = {
      ...process.env,
      PATH: venvDir + (process.platform === "win32" ? ";" : ":") + (process.env.PATH || ""),
      VIRTUAL_ENV: path.dirname(venvDir),
      PYTHONPATH: "",
    };
    const proc = spawn(PYTHON_CMD, [scriptPath, "--setup"], { env: envWithVenv });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => {
      const line = d.toString();
      stdout += line;
      // Reenviar progreso al renderer
      try {
        const msg = JSON.parse(line.trim());
        if (msg.progress) event.sender.send("setup-progress", msg.progress);
      } catch {}
    });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout.trim())); }
        catch { resolve({ success: true, message: "Modelo listo." }); }
      } else {
        resolve({ success: false, error: stderr || stdout || `Exit code ${code}` });
      }
    });
    // Timeout generoso: descarga 67MB + conversion puede tardar varios minutos
    setTimeout(() => { proc.kill(); resolve({ success: false, error: "Timeout (15 min)" }); }, 900000);
  });
});

ipcMain.handle("check-realesrgan", async () => {
  const onnxPath = path.join(__dirname, "models", "realesrgan_x4plus.onnx");
  const exists   = fs.existsSync(onnxPath);
  const size     = exists ? fs.statSync(onnxPath).size : 0;
  return { exists, size, path: onnxPath };
});

ipcMain.handle("upscale-image", async (_, { filePath, targetWidth, targetHeight }) => {
  try {
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: path.join(path.dirname(filePath), `${base}_${targetWidth}x${targetHeight}.png`),
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (canceled) return { success: false };
    const result = await runPython({ input: filePath, output: savePath, width: targetWidth, height: targetHeight });
    if (result.success && fs.existsSync(savePath)) {
      result.output = savePath;
      result.fileSize = fs.statSync(savePath).size;
      // Generar preview del resultado para el comparador
      const previewBuf = await sharp(savePath)
        .resize(400, 400, { fit: "inside", kernel: "lanczos3" })
        .png().toBuffer();
      result.previewAfter = `data:image/png;base64,${previewBuf.toString("base64")}`;
    }
    return result;
  } catch (err) { return { success: false, error: err.message }; }
});

/* ─────────────────────────────────────
   IPC: BATCH UPSCALE
───────────────────────────────────── */
ipcMain.handle("batch-upscale", async (event, { files, targetWidth, targetHeight, outputDir }) => {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    const ext = path.extname(fp);
    const base = path.basename(fp, ext);
    const outPath = path.join(outputDir, `${base}_${targetWidth}x${targetHeight}.png`);

    // Notificar progreso al renderer
    event.sender.send("batch-progress", {
      current: i + 1,
      total: files.length,
      file: path.basename(fp),
    });

    const result = await runPython({ input: fp, output: outPath, width: targetWidth, height: targetHeight });
    results.push({
      file: path.basename(fp),
      success: result.success,
      error: result.error,
      time: result.time,
      output: outPath,
    });
  }
  return { success: true, results };
});

/* ─────────────────────────────────────
   IPC: ENCRIPTAR / DESENCRIPTAR
───────────────────────────────────── */
ipcMain.handle("encrypt-file", async (_, { filePath, password }) => {
  try {
    if (!password?.trim()) return { success: false, error: "Contraseña vacía" };
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: filePath + ".enc",
      filters: [{ name: "Encrypted", extensions: ["enc"] }],
    });
    if (canceled) return { success: false };
    encryptFile(filePath, savePath, password);
    return { success: true, output: savePath, size: fs.statSync(savePath).size };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle("decrypt-file", async (_, { filePath, password }) => {
  try {
    if (!password?.trim()) return { success: false, error: "Contraseña vacía" };
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: filePath.replace(/\.enc$/, ""),
    });
    if (canceled) return { success: false };
    decryptFile(filePath, savePath, password);
    return { success: true, output: savePath, size: fs.statSync(savePath).size };
  } catch (err) { return { success: false, error: "Contraseña incorrecta o archivo dañado" }; }
});

/* ─────────────────────────────────────
   IPC: COMPRIMIR ZIP
───────────────────────────────────── */
ipcMain.handle("compress-zip", async (_, { files, password }) => {
  try {
    if (!files?.length) return { success: false, error: "Sin archivos seleccionados" };

    const firstDir = path.dirname(files[0]);
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: path.join(firstDir, "comprimido.zip"),
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (canceled) return { success: false };

    const fileList = files.map(fp => ({
      path: fp,
      name: path.basename(fp),
    }));

    const zipBuffer = createZipBuffer(fileList, password || null);

    // Si hay contraseña, encriptar el ZIP con AES-256
    if (password?.trim()) {
      const key = makeKeyLegacy(password);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Guardar: magic header + iv + tag + encrypted zip
      const magic = Buffer.from("XMBZIP01");
      fs.writeFileSync(savePath, Buffer.concat([magic, iv, tag, encrypted]));
    } else {
      fs.writeFileSync(savePath, zipBuffer);
    }

    const stat = fs.statSync(savePath);
    const origSize = files.reduce((acc, fp) => acc + fs.statSync(fp).size, 0);
    const ratio = Math.round((1 - stat.size / origSize) * 100);

    return {
      success: true,
      output: savePath,
      size: stat.size,
      originalSize: origSize,
      ratio: Math.max(0, ratio),
      protected: !!(password?.trim()),
    };
  } catch (err) { return { success: false, error: err.message }; }
});

/* ─────────────────────────────────────
   IPC: SELECCIONAR ARCHIVOS PARA ZIP
───────────────────────────────────── */
ipcMain.handle("select-files-for-zip", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Todos los archivos", extensions: ["*"] }],
  });
  if (canceled) return null;
  return filePaths;
});

/* ─────────────────────────────────────
   CICLO DE VIDA
───────────────────────────────────── */
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
