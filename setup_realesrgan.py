#!/usr/bin/env python3
"""
setup_realesrgan.py — Descarga y convierte Real-ESRGAN a ONNX
SIN depender de basicsr ni realesrgan.

Implementa la arquitectura RRDB directamente con torch puro.

Dependencias (solo para este script, una sola vez):
    pip install torch torchvision

Runtime (upscaler.py) solo necesita:
    pip install onnxruntime numpy pillow

Uso:
    python setup_realesrgan.py
"""
import sys, os, urllib.request

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
ONNX_PATH  = os.path.join(MODELS_DIR, 'realesrgan_x4plus.onnx')
PTH_PATH   = os.path.join(MODELS_DIR, 'RealESRGAN_x4plus.pth')
PTH_URL    = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'

def step(msg): print(f'\n[+] {msg}', flush=True)
def ok(msg):   print(f'    OK: {msg}', flush=True)
def fail(msg): print(f'    ERROR: {msg}', flush=True); sys.exit(1)

# ── Verificar torch ───────────────────────────────────────────────────────
step('Verificando torch...')
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    ok(f'torch {torch.__version__}')
except ImportError:
    fail('torch no instalado.\n        Ejecuta: pip install torch torchvision')

# ── Arquitectura RRDB implementada directamente (sin basicsr) ─────────────
class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat,             num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat+num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat+2*num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat+3*num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat+4*num_grow_ch, num_feat,   3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat([x, x1], 1)))
        x3 = self.lrelu(self.conv3(torch.cat([x, x1, x2], 1)))
        x4 = self.lrelu(self.conv4(torch.cat([x, x1, x2, x3], 1)))
        x5 = self.conv5(torch.cat([x, x1, x2, x3, x4], 1))
        return x5 * 0.2 + x

class RRDB(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x

class RRDBNet(nn.Module):
    """
    Arquitectura exacta de RealESRGAN_x4plus:
      num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4
    """
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64,
                 num_block=23, num_grow_ch=32, scale=4):
        super().__init__()
        self.scale = scale

        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)

        # Upsampling x4 = 2 × PixelShuffle(2)
        self.conv_up1  = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2  = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr   = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu     = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat      = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat      = feat + body_feat

        # Upsample x2 x2 = x4
        feat = self.lrelu(self.conv_up1(
            F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(
            F.interpolate(feat, scale_factor=2, mode='nearest')))

        out = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out

# ── Descargar .pth ────────────────────────────────────────────────────────
os.makedirs(MODELS_DIR, exist_ok=True)

if os.path.exists(PTH_PATH) and os.path.getsize(PTH_PATH) > 10*1024*1024:
    step('Modelo .pth ya existe')
    ok(f'{os.path.getsize(PTH_PATH)/1024/1024:.1f} MB — omitiendo descarga')
else:
    step(f'Descargando RealESRGAN_x4plus.pth (~67 MB)...')
    print(f'    URL: {PTH_URL}', flush=True)

    def reporthook(count, block_size, total_size):
        pct  = min(count * block_size / total_size * 100, 100)
        done = int(pct / 2)
        sys.stdout.write(f'\r    [{"#"*done:<50}] {pct:5.1f}%')
        sys.stdout.flush()

    try:
        urllib.request.urlretrieve(PTH_URL, PTH_PATH, reporthook)
        print()
        ok(f'Descargado: {os.path.getsize(PTH_PATH)/1024/1024:.1f} MB')
    except Exception as e:
        # Si falla la descarga automatica, dar instrucciones manuales
        if os.path.exists(PTH_PATH):
            os.remove(PTH_PATH)
        print()
        print(f'\n    [!] Descarga automatica fallida: {e}')
        print(f'\n    Descarga manual:')
        print(f'    1. Abre en tu navegador:')
        print(f'       {PTH_URL}')
        print(f'    2. Guarda el archivo como:')
        print(f'       {PTH_PATH}')
        print(f'    3. Vuelve a ejecutar este script.')
        sys.exit(1)

# ── Cargar pesos en la arquitectura ──────────────────────────────────────
step('Cargando pesos del modelo...')
try:
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32, scale=4)

    state = torch.load(PTH_PATH, map_location='cpu')

    # El .pth puede tener los pesos bajo distintas claves
    if isinstance(state, dict):
        if 'params_ema' in state:
            state = state['params_ema']
            ok('Usando pesos params_ema')
        elif 'params' in state:
            state = state['params']
            ok('Usando pesos params')
        else:
            ok('Usando state_dict directo')

    model.load_state_dict(state, strict=True)
    model.eval()
    ok(f'Modelo cargado — {sum(p.numel() for p in model.parameters()):,} parametros')
except Exception as e:
    fail(f'Error cargando pesos: {e}')

# ── Exportar a ONNX ───────────────────────────────────────────────────────
step('Exportando a ONNX (puede tardar 1-3 minutos)...')
try:
    dummy = torch.zeros(1, 3, 64, 64)

    torch.onnx.export(
        model,
        dummy,
        ONNX_PATH,
        input_names    = ['input'],
        output_names   = ['output'],
        dynamic_axes   = {
            'input':  {0: 'batch', 2: 'height', 3: 'width'},
            'output': {0: 'batch', 2: 'height', 3: 'width'},
        },
        opset_version       = 11,
        do_constant_folding = True,
        verbose             = False,
    )
    size_mb = os.path.getsize(ONNX_PATH) / 1024 / 1024
    ok(f'ONNX guardado: {size_mb:.1f} MB')
    ok(f'Ruta: {ONNX_PATH}')
except Exception as e:
    fail(f'Error exportando ONNX: {e}')

# ── Verificacion rapida ───────────────────────────────────────────────────
step('Verificando modelo ONNX...')
try:
    import onnxruntime as ort
    import numpy as np
    sess    = ort.InferenceSession(ONNX_PATH, providers=['CPUExecutionProvider'])
    dummy_np = np.zeros((1, 3, 32, 32), dtype=np.float32)
    out     = sess.run(None, {'input': dummy_np})[0]
    ok(f'Test OK — entrada 32x32 → salida {out.shape[2]}x{out.shape[3]} (x{out.shape[2]//32})')
except ImportError:
    print('    [!] onnxruntime no instalado — verificacion omitida')
    print('        Instala con: pip install onnxruntime')
except Exception as e:
    fail(f'Verificacion ONNX fallida: {e}')

print(f'\n{"="*58}')
print('  Real-ESRGAN listo para usar.')
print()
print('  Ahora puedes desinstalar torch para ahorrar espacio:')
print('  pip uninstall torch torchvision -y')
print()
print('  El upscaler solo necesita:')
print('  pip install onnxruntime numpy pillow')
print(f'{"="*58}\n')
