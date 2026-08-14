const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

const { deriveKey, makeKeyLegacy, encryptFile, decryptFile, ENC_MAGIC, ENC_VERSION } = require("./crypto-utils");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xmb-crypto-test-"));
const cleanup = [];
function tmpFile(name) {
  const p = path.join(tmpDir, name);
  cleanup.push(p);
  return p;
}

let passed = 0;
function ok(label) { passed++; console.log(`[OK] ${label}`); }

/* ── Test 1: round-trip V2, contenido identico byte a byte ── */
{
  const original = Buffer.from("contenido de prueba XMB \0 con bytes nulos y \xff altos", "binary");
  const plainPath = tmpFile("t1-plain.bin");
  const encPath   = tmpFile("t1.enc");
  const outPath   = tmpFile("t1-out.bin");

  fs.writeFileSync(plainPath, original);
  encryptFile(plainPath, encPath, "clave123");
  decryptFile(encPath, outPath, "clave123");

  const result = fs.readFileSync(outPath);
  assert.ok(result.equals(original), "el contenido descifrado debe ser identico byte a byte al original");

  const encBuf = fs.readFileSync(encPath);
  assert.ok(encBuf.slice(0, 4).equals(ENC_MAGIC), "el .enc debe llevar el magic V2");
  assert.strictEqual(encBuf[4], ENC_VERSION, "el .enc debe llevar la version V2");

  ok("Round-trip V2: contenido identico byte a byte");
}

/* ── Test 2: password incorrecta debe lanzar, no producir basura ── */
{
  const plainPath = tmpFile("t2-plain.bin");
  const encPath   = tmpFile("t2.enc");
  const outPath   = tmpFile("t2-out.bin");

  fs.writeFileSync(plainPath, Buffer.from("datos secretos"));
  encryptFile(plainPath, encPath, "password-correcta");

  let threw = false;
  try {
    decryptFile(encPath, outPath, "password-incorrecta");
  } catch (e) {
    threw = true;
  }
  assert.ok(threw, "decryptFile debe lanzar con password incorrecta (auth tag invalido)");
  assert.ok(!fs.existsSync(outPath), "no debe escribirse ningun archivo de salida si la autenticacion falla");

  ok("Password incorrecta: lanza excepcion, no produce archivo de salida con basura");
}

/* ── Test 3: mismo archivo + misma password dos veces -> .enc distintos ── */
{
  const plainPath = tmpFile("t3-plain.bin");
  const encPathA  = tmpFile("t3-a.enc");
  const encPathB  = tmpFile("t3-b.enc");

  fs.writeFileSync(plainPath, Buffer.from("mismo contenido, misma password"));
  encryptFile(plainPath, encPathA, "misma-clave");
  encryptFile(plainPath, encPathB, "misma-clave");

  const encA = fs.readFileSync(encPathA);
  const encB = fs.readFileSync(encPathB);

  assert.ok(!encA.equals(encB), "dos cifrados del mismo archivo con la misma password deben diferir (salt/IV nuevos)");

  const saltA = encA.slice(5, 21);
  const saltB = encB.slice(5, 21);
  assert.ok(!saltA.equals(saltB), "las salts de cada operacion deben ser distintas");

  // Ambos deben seguir descifrando correctamente al original pese a ser distintos
  const outA = tmpFile("t3-out-a.bin");
  const outB = tmpFile("t3-out-b.bin");
  decryptFile(encPathA, outA, "misma-clave");
  decryptFile(encPathB, outB, "misma-clave");
  assert.ok(fs.readFileSync(outA).equals(fs.readFileSync(plainPath)));
  assert.ok(fs.readFileSync(outB).equals(fs.readFileSync(plainPath)));

  ok("Mismo archivo + misma password dos veces: .enc distintos (salt/IV nuevos), ambos descifran bien");
}

/* ── Test 4: archivo V1 construido a mano debe seguir abriendo ── */
{
  const algorithm = "aes-256-gcm";
  const original = Buffer.from("archivo viejo formato V1, sin magic ni salt");
  const password = "clave-vieja";

  // Construido a mano replicando EXACTAMENTE el formato V1 legacy:
  // IV(12) || TAG(16) || CIPHERTEXT, clave = SHA-256(password)
  const legacyKey = makeKeyLegacy(password);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, legacyKey, iv);
  const encrypted = Buffer.concat([cipher.update(original), cipher.final()]);
  const tag = cipher.getAuthTag();
  const v1Buf = Buffer.concat([iv, tag, encrypted]);

  assert.ok(!v1Buf.slice(0, 4).equals(ENC_MAGIC), "sanity check: el V1 a mano no debe llevar el magic V2");

  const v1Path  = tmpFile("t4-legacy.enc");
  const outPath = tmpFile("t4-out.bin");
  fs.writeFileSync(v1Path, v1Buf);

  decryptFile(v1Path, outPath, password);
  const result = fs.readFileSync(outPath);
  assert.ok(result.equals(original), "un archivo V1 construido a mano debe seguir abriendo correctamente");

  ok("Archivo V1 construido a mano: sigue abriendo via fallback legacy");
}

console.log(`\n${passed}/4 tests pasaron`);

// Limpieza
for (const f of cleanup) { try { fs.unlinkSync(f); } catch {} }
try { fs.rmdirSync(tmpDir); } catch {}
