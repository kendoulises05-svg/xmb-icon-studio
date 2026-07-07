#!/usr/bin/env python3
"""
fix_basicsr.py — Parchea basicsr para Python 3.12+

El problema: basicsr usa 'from distutils.version import LooseVersion'
que fue eliminada en Python 3.12.
El fix: reemplazar con 'from packaging.version import Version as LooseVersion'

Ejecutar UNA SOLA VEZ despues de instalar basicsr:
    python fix_basicsr.py
"""
import sys, os, site

def find_basicsr_file():
    """Buscar arch_util.py en todos los site-packages."""
    candidates = site.getsitepackages()
    # Incluir el venv actual si existe
    if hasattr(site, 'getusersitepackages'):
        try:
            candidates.append(site.getusersitepackages())
        except Exception:
            pass

    for sp in candidates:
        path = os.path.join(sp, 'basicsr', 'archs', 'arch_util.py')
        if os.path.exists(path):
            return path
    return None

def main():
    print(f'Python {sys.version}')
    print()

    # 1 — Verificar que packaging este disponible (viene con pip)
    try:
        from packaging.version import Version
        print('[OK] packaging disponible')
    except ImportError:
        print('[!] Instalando packaging...')
        import subprocess
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'packaging', '-q'])
        print('[OK] packaging instalado')

    # 2 — Localizar el archivo a parchear
    target = find_basicsr_file()
    if not target:
        print('[ERROR] basicsr no encontrado en site-packages.')
        print('        Asegurate de tener el .venv activo y basicsr instalado.')
        sys.exit(1)

    print(f'[OK] basicsr encontrado: {target}')

    # 3 — Leer contenido
    with open(target, 'r', encoding='utf-8') as f:
        content = f.read()

    OLD_LINE = 'from distutils.version import LooseVersion'
    NEW_LINE = 'from packaging.version import Version as LooseVersion'

    if OLD_LINE not in content:
        if NEW_LINE in content:
            print('[OK] Ya estaba parcheado anteriormente.')
        else:
            print('[?] La linea de distutils no se encontro — puede que ya este corregido.')
        sys.exit(0)

    # 4 — Aplicar el parche
    patched = content.replace(OLD_LINE, NEW_LINE)

    # Backup
    backup = target + '.bak'
    with open(backup, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'[OK] Backup guardado: {backup}')

    with open(target, 'w', encoding='utf-8') as f:
        f.write(patched)

    print(f'[OK] Parche aplicado:')
    print(f'     - {OLD_LINE}')
    print(f'     + {NEW_LINE}')

    # 5 — Verificar que ahora importa correctamente
    print()
    print('[...] Verificando importacion de basicsr...')
    import importlib, subprocess
    result = subprocess.run(
        [sys.executable, '-c', 'from basicsr.archs.rrdbnet_arch import RRDBNet; print("OK")'],
        capture_output=True, text=True
    )
    if 'OK' in result.stdout:
        print('[OK] basicsr importa correctamente')
        print()
        print('='*55)
        print('  Parche completado. Ahora ejecuta:')
        print('  python setup_realesrgan.py')
        print('='*55)
    else:
        print('[ERROR] basicsr sigue fallando:')
        print(result.stderr[:500])
        print()
        print('Puede haber otro error distinto. Comparte el mensaje completo.')
        sys.exit(1)

if __name__ == '__main__':
    main()
