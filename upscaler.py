#!/usr/bin/env python3
"""
upscaler.py — Real-ESRGAN x4 via ONNX (sin PyTorch en runtime)

PRIMERA VEZ:
  El script detecta si existe el modelo ONNX.
  Si no existe, lo descarga como .pth y lo convierte a ONNX automaticamente.
  Conversion requiere torch (solo una vez). Despues solo usa onnxruntime.

Modelos soportados:
  RealESRGAN_x4plus        — fotos y arte general (mejor para tu caso)
  RealESRGAN_x4plus_anime  — anime/ilustraciones
  RealESRGAN_x2plus        — upscale x2 mas conservador

Dependencias runtime:   pip install onnxruntime numpy pillow
Dependencias setup:     pip install torch torchvision basicsr realesrgan  (solo para conversion)
"""
import sys, json, os, time

MODELS_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
ONNX_PATH   = os.path.join(MODELS_DIR, 'realesrgan_x4plus.onnx')
PTH_PATH    = os.path.join(MODELS_DIR, 'RealESRGAN_x4plus.pth')
PTH_URL     = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'
TILE_SIZE   = 256   # procesar en tiles para no agotar RAM
TILE_PAD    = 10

# ── Verificar dependencias minimas ────────────────────────────────────────
def check_deps():
    missing = []
    for pkg, imp in [('onnxruntime','onnxruntime'),
                     ('numpy','numpy'), ('Pillow','PIL')]:
        try:
            __import__(imp)
        except ImportError:
            missing.append(pkg)
    return missing

missing = check_deps()
if missing:
    print(json.dumps({'success': False,
        'error': f"Faltan dependencias runtime: pip install {' '.join(missing)}"}))
    sys.exit(1)

import numpy as np
import onnxruntime as ort
from PIL import Image

# ── Descargar modelo .pth ─────────────────────────────────────────────────
def download_pth():
    import urllib.request
    os.makedirs(MODELS_DIR, exist_ok=True)
    print(json.dumps({'progress': 'Descargando modelo Real-ESRGAN x4plus (67MB)...'}), flush=True)

    def progress(count, block, total):
        pct = min(count * block / total * 100, 100)
        if int(pct) % 10 == 0:
            sys.stderr.write(f'\r  Descargando... {pct:.0f}%')
            sys.stderr.flush()

    urllib.request.urlretrieve(PTH_URL, PTH_PATH, progress)
    sys.stderr.write('\n')
    return os.path.exists(PTH_PATH)

# ── Convertir .pth -> .onnx ───────────────────────────────────────────────
def convert_pth_to_onnx():
    """
    Convierte RealESRGAN_x4plus.pth a ONNX.
    Requiere: pip install torch torchvision basicsr realesrgan
    """
    try:
        import torch
        from basicsr.archs.rrdbnet_arch import RRDBNet
    except ImportError:
        return False, "Para convertir el modelo instala: pip install torch torchvision basicsr realesrgan"

    print(json.dumps({'progress': 'Convirtiendo modelo a ONNX (una sola vez)...'}), flush=True)

    try:
        # Arquitectura RRDBNet x4 (23 bloques — modelo estandar)
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                        num_block=23, num_grow_ch=32, scale=4)

        state = torch.load(PTH_PATH, map_location='cpu')
        # El .pth puede tener el state_dict bajo 'params_ema' o directo
        if 'params_ema' in state:
            state = state['params_ema']
        elif 'params' in state:
            state = state['params']

        model.load_state_dict(state, strict=True)
        model.eval()

        # Exportar a ONNX con entrada dinamica
        dummy = torch.zeros(1, 3, 64, 64)
        os.makedirs(MODELS_DIR, exist_ok=True)

        torch.onnx.export(
            model, dummy, ONNX_PATH,
            input_names  = ['input'],
            output_names = ['output'],
            dynamic_axes = {'input':  {0:'batch', 2:'height', 3:'width'},
                            'output': {0:'batch', 2:'height', 3:'width'}},
            opset_version = 11,
            do_constant_folding = True,
        )
        return True, None

    except Exception as e:
        return False, str(e)

# ── Setup: descargar + convertir si no hay ONNX ───────────────────────────
def ensure_onnx():
    if os.path.exists(ONNX_PATH) and os.path.getsize(ONNX_PATH) > 1024*1024:
        return True, None  # ya existe y tiene tamano razonable

    # Necesitamos construirlo
    if not os.path.exists(PTH_PATH):
        ok = download_pth()
        if not ok:
            return False, f"No se pudo descargar el modelo desde:\n{PTH_URL}\nDescargalo manualmente y coloca el .pth en:\n{MODELS_DIR}"

    ok, err = convert_pth_to_onnx()
    if not ok:
        # Torch no disponible — dar instrucciones claras
        return False, (
            f"El modelo ONNX no existe. Para generarlo:\n"
            f"  1. pip install torch torchvision basicsr realesrgan\n"
            f"  2. Ejecuta este script una vez con --setup\n"
            f"  O descarga el ONNX pre-exportado y coloca en:\n"
            f"     {ONNX_PATH}\n"
            f"Detalle: {err}"
        )
    return True, None

# ── Procesamiento en tiles (evita OOM en imagenes grandes) ────────────────
def upscale_tile(sess, tile_rgb):
    """Procesa un tile numpy HxWx3 uint8 -> HxWx3 uint8 (x4)."""
    # Normalizar: [0,255] -> [0,1], HWC -> NCHW
    inp = tile_rgb.astype(np.float32) / 255.0
    inp = np.transpose(inp, (2, 0, 1))[np.newaxis]  # 1,3,H,W

    out = sess.run(None, {'input': inp})[0]          # 1,3,H*4,W*4

    # NCHW -> HWC, clip, uint8
    out = np.transpose(out[0], (1, 2, 0))
    out = np.clip(out * 255.0, 0, 255).astype(np.uint8)
    return out

def upscale_tiled(sess, img_np, scale=4):
    """
    Divide la imagen en tiles con padding, escala cada uno y reensambla.
    Evita artefactos en bordes usando TILE_PAD de overlap.
    """
    h, w = img_np.shape[:2]
    oh, ow = h * scale, w * scale
    output = np.zeros((oh, ow, 3), dtype=np.uint8)

    tiles_x = max(1, -(-w // TILE_SIZE))  # ceil division
    tiles_y = max(1, -(-h // TILE_SIZE))

    for ty in range(tiles_y):
        for tx in range(tiles_x):
            # Coordenadas del tile con padding
            x1 = tx * TILE_SIZE
            y1 = ty * TILE_SIZE
            x2 = min(x1 + TILE_SIZE, w)
            y2 = min(y1 + TILE_SIZE, h)

            # Padding (para evitar artefactos de borde)
            x1p = max(0, x1 - TILE_PAD)
            y1p = max(0, y1 - TILE_PAD)
            x2p = min(w, x2 + TILE_PAD)
            y2p = min(h, y2 + TILE_PAD)

            tile      = img_np[y1p:y2p, x1p:x2p]
            tile_out  = upscale_tile(sess, tile)

            # Calcular cuanto recortar del padding en la salida
            pad_left   = (x1 - x1p) * scale
            pad_top    = (y1 - y1p) * scale
            pad_right  = tile_out.shape[1] - (x2p - x2) * scale
            pad_bottom = tile_out.shape[0] - (y2p - y2) * scale

            crop = tile_out[pad_top:pad_bottom, pad_left:pad_right]

            # Pegar en output
            ox1, oy1 = x1 * scale, y1 * scale
            ox2, oy2 = ox1 + crop.shape[1], oy1 + crop.shape[0]
            output[oy1:oy2, ox1:ox2] = crop

    return output

# ── Pipeline principal ────────────────────────────────────────────────────
def upscale(input_path, output_path, target_w, target_h):
    ok, err = ensure_onnx()
    if not ok:
        return None, err

    # Cargar sesion ONNX
    providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
    sess = ort.InferenceSession(ONNX_PATH, providers=providers)
    used_provider = sess.get_providers()[0]

    img            = Image.open(input_path).convert('RGB')
    orig_w, orig_h = img.size
    img_np         = np.array(img)

    # Real-ESRGAN escala x4 fijo
    # Si el target no es exactamente x4, ajustamos despues
    esrgan_w = orig_w * 4
    esrgan_h = orig_h * 4

    # Procesar en tiles
    out_np = upscale_tiled(sess, img_np, scale=4)

    # Si el resultado x4 no coincide con el target, resize final con Lanczos
    result = Image.fromarray(out_np)
    if result.size != (target_w, target_h):
        result = result.resize((target_w, target_h), Image.LANCZOS)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    result.save(output_path, 'PNG', optimize=False)

    return {'width': result.width, 'height': result.height,
            'provider': used_provider,
            'esrgan_size': f'{esrgan_w}x{esrgan_h}'}, None

# ── CLI: --setup para forzar descarga/conversion ─────────────────────────
if __name__ == '__main__':
    # Modo setup: python upscaler.py --setup
    if len(sys.argv) == 2 and sys.argv[1] == '--setup':
        print('Verificando modelo Real-ESRGAN...')
        ok, err = ensure_onnx()
        if ok:
            print(json.dumps({'success': True, 'message': f'Modelo listo: {ONNX_PATH}'}))
        else:
            print(json.dumps({'success': False, 'error': err}))
        sys.exit(0 if ok else 1)

    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Sin argumentos'}))
        sys.exit(1)

    try:
        data     = json.loads(sys.argv[1])
        inp      = data['input']
        out      = data['output']
        target_w = int(data['width'])
        target_h = int(data['height'])

        if not os.path.exists(inp):
            raise FileNotFoundError(f"Archivo no encontrado: {inp}")
        if target_w < 1 or target_h < 1:
            raise ValueError(f"Dimensiones invalidas: {target_w}x{target_h}")

        t0              = time.time()
        result, err     = upscale(inp, out, target_w, target_h)
        elapsed         = round(time.time() - t0, 2)

        if result is None:
            print(json.dumps({'success': False, 'error': err}))
            sys.exit(1)

        print(json.dumps({'success': True, 'time': elapsed, **result}))

    except json.JSONDecodeError as e:
        print(json.dumps({'success': False, 'error': f'JSON invalido: {e}'}))
        sys.exit(1)
    except FileNotFoundError as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
