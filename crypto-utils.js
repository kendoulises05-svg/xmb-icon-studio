const crypto = require("crypto");
const fs = require("fs");

/* ─────────────────────────────────────
   CRYPTO
───────────────────────────────────── */
const algorithm = "aes-256-gcm";

// V1 (legacy) — SHA-256 sin salt ni iteraciones. Insegura: se conserva
// solo para poder desencriptar archivos .enc generados antes del formato V2.
function makeKeyLegacy(password) { return crypto.createHash("sha256").update(password).digest(); }

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32, {
    N: 2 ** 15, r: 8, p: 1,
    maxmem: 64 * 1024 * 1024, // default de Node es 32 MiB; estos parametros necesitan ~32 MiB + overhead
  });
}

const ENC_MAGIC   = Buffer.from("XMBE", "ascii"); // 4 bytes
const ENC_VERSION = 0x02;

function encryptFile(inputPath, outputPath, password) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(12);
  const data = fs.readFileSync(inputPath);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.concat([ENC_MAGIC, Buffer.from([ENC_VERSION])]);
  // V2: MAGIC(4) || VERSION(1) || SALT(16) || IV(12) || TAG(16) || CIPHERTEXT
  fs.writeFileSync(outputPath, Buffer.concat([header, salt, iv, tag, encrypted]));
}

function decryptFile(inputPath, outputPath, password) {
  const data = fs.readFileSync(inputPath);
  const isV2 = data.length >= 5 && data.slice(0, 4).equals(ENC_MAGIC) && data[4] === ENC_VERSION;

  let key, iv, tag, encrypted;
  if (isV2) {
    const salt = data.slice(5, 21);
    iv         = data.slice(21, 33);
    tag        = data.slice(33, 49);
    encrypted  = data.slice(49);
    key        = deriveKey(password, salt);
  } else {
    // V1 (legacy): IV(12) || TAG(16) || CIPHERTEXT, clave = SHA-256(password)
    iv         = data.slice(0, 12);
    tag        = data.slice(12, 28);
    encrypted  = data.slice(28);
    key        = makeKeyLegacy(password);
  }

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  fs.writeFileSync(outputPath, decrypted);
}

module.exports = { deriveKey, makeKeyLegacy, encryptFile, decryptFile, ENC_MAGIC, ENC_VERSION };
