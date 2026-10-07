# ICO Converter XMB

<div align="center">

**Conversor de iconos con interfaz inspirada en el XrossMediaBar (XMB) de PS3**

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/Electron-Desktop%20App-47848F?logo=electron)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 📖 Descripción

**ICO Converter XMB** es una aplicación de escritorio construida con Electron que permite convertir, mejorar y proteger archivos de íconos (`.ico`) a través de una interfaz retro inspirada en el **XrossMediaBar** de PlayStation 3.

El proyecto combina procesamiento de imágenes con IA, criptografía y una experiencia de usuario cuidada al detalle, incluyendo un carrusel elíptico animado, sonido sintetizado con Web Audio API, y un diseño visual en tonos índigo/violeta.

---

## ✨ Características

- 🖼️ **Conversión de íconos** — Transforma imágenes a formato `.ico` de forma rápida y por lotes.
- 🔍 **Upscaling con IA** — Mejora la resolución de imágenes usando **Real-ESRGAN** (modelo ONNX).
- 🔐 **Encriptación segura** — Protege archivos con **AES-256-GCM**.
- 📦 **Compresión ZIP** — Empaqueta resultados automáticamente.
- 🎛️ **Interfaz estilo XMB** — Carrusel elíptico giratorio con navegación fluida, inspirado en la PS3.
- 🔊 **Sonido sintetizado** — Efectos de audio generados con Web Audio API, sin archivos de sonido externos.
- ⚡ **Procesamiento por lotes** — Convierte múltiples archivos en una sola operación.

---

## 📸 Capturas de pantalla

![Vista principal de la interfaz XMB](capturas_funcional/Interfas_inicial.png)

![select de archivo](capturas_funcional/funcion_selecionar.png)

![multiples archivos](capturas_funcional/funcion_select_multiples.png)

## 🛠️ Tecnologías

| Categoría | Tecnología |
|---|---|
| Framework de escritorio | Electron |
| IA / Upscaling | Real-ESRGAN (ONNX Runtime) |
| Encriptación | AES-256-GCM |
| Audio | Web Audio API |
| Backend de procesamiento | Python |

---

## 🚀 Instalación

### Requisitos previos

- [Node.js](https://nodejs.org/) (v18 o superior recomendado)
- [Python](https://www.python.org/) 3.9+ (para el módulo de upscaling)
- Git

### Pasos

1. Clona el repositorio:
   ```bash
   git clone https://github.com/kendoulises05-svg/xmb-icon-studio.git
   cd xmb-icon-studio
   ```

2. Instala las dependencias de Node:
   ```bash
   npm install
   ```

3. Instala las dependencias de Python en un entorno virtual:
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt        # Linux
   .venv\Scripts\pip install -r requirements.txt    # Windows
   ```
   `main.js` detecta solo el `.venv` del proyecto (`.venv/bin/python3` en Linux, `.venv\Scripts\python.exe`
   en Windows). En distribuciones recientes (Ubuntu 23.04+, Kubuntu, Debian 12+) `pip install` fuera de
   un venv falla por PEP 668, así que el venv es obligatorio.

   > ⚠️ `node_modules/` y `.venv/` contienen binarios del sistema operativo donde se crearon
   > (Electron, sharp, Python). Si copias el proyecto de Windows a Linux o al revés, bórralos y
   > reinstálalos; `run_app.sh` reinstala `node_modules` automáticamente si detecta que falta Electron.

4. Configura las variables de entorno:
   - Crea un archivo `.env` en la raíz del proyecto (no incluido por seguridad)
   - Agrega las variables necesarias para la encriptación (ver `.env.example` si está disponible)

5. Descarga los modelos de Real-ESRGAN:
   - Los modelos `.pth` / `.onnx` no están incluidos en el repositorio por su tamaño
   - Colócalos en la carpeta `models/`

---

## ▶️ Uso

Ejecuta la aplicación en modo desarrollo:

```bash
npm start
```

O usa el lanzador de tu sistema:

| Sistema | Lanzador |
|---|---|
| Linux | `./run_app.sh` |
| Windows | `run_app.bat` |

`run_app.sh` no tiene rutas fijas (se ubica a partir de su propia carpeta), verifica Node y las
dependencias, y guarda el registro en `~/.cache/ico-converter-xmb.log`. Si falla al lanzarse desde un
icono, muestra el error en una ventana (`kdialog`/`zenity`).

#### Acceso directo en Linux (KDE, GNOME, etc.)

Crea `~/.local/share/applications/ico-converter-xmb.desktop` (cambia la ruta por la de tu clon):

```ini
[Desktop Entry]
Type=Application
Name=ICO Converter XMB
Exec="/ruta/a/xmb-icon-studio/run_app.sh"
Icon=/ruta/a/xmb-icon-studio/assets/icon.png
Terminal=false
Categories=Graphics;
StartupWMClass=ico-converter-xmb
```

Dale permiso de ejecución (`chmod +x`) y cópialo a `~/Desktop` si lo quieres en el escritorio.

---

## 📦 Empaquetado

El proyecto usa [electron-builder](https://www.electron.build/) (incluido en `devDependencies`):

```bash
npm run build   # carpeta lista para ejecutar en dist/linux-unpacked/ (prueba rápida)
npm run dist    # instalable del sistema actual: dist/ico-converter-xmb-<versión>-x86_64.AppImage en Linux
```

En Linux, el AppImage necesita `libfuse2` (`sudo apt install libfuse2t64` en Ubuntu 24.04+).

**Qué incluye el paquete:** el código de la app, `assets/` y el modelo `models/realesrgan_x4plus.onnx`
(+ `.onnx.data`). No incluye el `.pth` ni `.env`. `upscaler.py`, el modelo y los binarios nativos de
`sharp` se dejan fuera del `app.asar` (`asarUnpack`) porque un proceso externo como Python no puede leer
dentro de un `.asar`.

> ⚠️ `models/` no está en el repositorio: antes de empaquetar, coloca el modelo ONNX ahí (ver
> *Instalación*, paso 5). Si falta, el paquete se genera igual pero sin modelo, y el AppImage no puede
> descargarlo después porque su contenido es de solo lectura.

**Python en la app empaquetada:** el entorno de Python no se empaqueta (un venv no es portable entre
máquinas). La app busca el intérprete en este orden:

1. La variable de entorno `XMB_PYTHON` (ruta a un `python3` concreto), si existe.
2. Un venv en la carpeta de datos de la app: `~/.config/ico-converter-xmb/venv` en Linux.
3. El `python3` del sistema.

Para habilitar el upscaling con IA en la app empaquetada (Linux), crea ese venv una sola vez:

```bash
python3 -m venv ~/.config/ico-converter-xmb/venv
~/.config/ico-converter-xmb/venv/bin/pip install onnxruntime numpy pillow
```

Sin él, la conversión, el cifrado y la compresión funcionan igual; solo el upscaling muestra un aviso
con el comando a ejecutar. En modo desarrollo (`npm start`) se sigue usando el `.venv` del proyecto.

---

## 🔐 Formato de archivos `.enc`

Los archivos generados por **Seguridad → Encriptar** usan AES-256-GCM. Desde la versión con formato **V2**, la estructura en disco es:

```
"XMBE" (4 bytes, magic) | 0x02 (1 byte, versión) | SALT (16 bytes) | IV (12 bytes) | TAG (16 bytes) | CIPHERTEXT
```

La clave se deriva de la contraseña con **scrypt** (`N=2^15, r=8, p=1`, salt aleatoria de 16 bytes por archivo), no directamente de la contraseña en texto plano.

**Compatibilidad hacia atrás:** los archivos `.enc` generados antes de este cambio (formato **V1**, sin los 5 bytes de magic/versión al inicio: `IV(12) | TAG(16) | CIPHERTEXT`) se siguen pudiendo desencriptar sin ninguna acción del usuario. `main.js` detecta el formato por la presencia del header V2 y usa la ruta correspondiente automáticamente.

⚠️ **Importante:** los archivos V1 se cifraron con un KDF débil (SHA-256 de la contraseña, sin salt ni iteraciones), vulnerable a fuerza bruta offline. Si tienes archivos `.enc` antiguos con datos sensibles, se recomienda desencriptarlos y volver a encriptarlos para que queden protegidos con el nuevo formato V2.

---

## 📁 Estructura del proyecto

```
ico_converter_xmb_v2/
├── main.js              # Proceso principal de Electron
├── preload.js           # Script de preload
├── script.js             # Lógica del frontend
├── upscaler.py           # Módulo de upscaling con Real-ESRGAN
├── setup_realesrgan.py   # Configuración del modelo de IA
├── fix_basicsr.py        # Utilidad de compatibilidad
├── index_V7.html          # Interfaz principal
├── style_V7.css           # Estilos de la interfaz XMB
├── crypto-utils.js        # Cifrado AES-256-GCM (formatos V1/V2)
├── run_app.sh             # Lanzador para Linux
├── requirements.txt       # Dependencias de Python
├── modelos/               # Versiones anteriores de la interfaz
└── assets/                # Recursos gráficos (wallpaper, icono de la app)
```

---

## 🗺️ Roadmap

- [ ] Empaquetado como instalador (`.exe`)
- [x] Soporte para Linux (ejecución desde el código y AppImage)
- [ ] Soporte para macOS
- [ ] Documentación técnica ampliada

---

## 📄 Licencia

Este proyecto está bajo la licencia **MIT**. Consulta el archivo `LICENSE` para más detalles.

---

## 👤 Autor

**Kendo Ulises**

## Créditos
Este proyecto usa [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (BSD 3-Clause License) para el upscaling de imágenes.
