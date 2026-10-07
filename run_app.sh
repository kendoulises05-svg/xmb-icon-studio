#!/usr/bin/env bash
# ============================================================
#  ICO Converter XMB: lanzador para Linux
#  Equivalente a run_app.bat (Windows), pero sin rutas fijas:
#  se ubica a partir de donde esta el propio script.
# ============================================================
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

LOG="${XDG_CACHE_HOME:-$HOME/.cache}/ico-converter-xmb.log"
mkdir -p "$(dirname "$LOG")"

# Desde el icono del escritorio no hay terminal a la vista:
# los errores se muestran en una ventana si hay kdialog/zenity.
avisar() {
  echo "[ICO Converter XMB] $1" >&2
  [ -t 2 ] && return 0
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --title "ICO Converter XMB" --error "$1" >/dev/null 2>&1 || true
  elif command -v zenity >/dev/null 2>&1; then
    zenity --error --title="ICO Converter XMB" --text="$1" >/dev/null 2>&1 || true
  fi
}
morir() { avisar "$1"$'\n\n'"Detalles en: $LOG"; exit 1; }

command -v node >/dev/null 2>&1 || morir "No se encontro Node.js. Instalalo con: sudo apt install nodejs npm"
command -v npm  >/dev/null 2>&1 || morir "No se encontro npm. Instalalo con: sudo apt install npm"

# Electron trae binarios por sistema operativo: si faltan o vienen
# de otra plataforma (p. ej. una copia hecha en Windows), se reinstalan.
if [ ! -x "node_modules/electron/dist/electron" ]; then
  echo "Instalando dependencias de Node para Linux (puede tardar)..." | tee -a "$LOG"
  rm -rf node_modules
  npm install >>"$LOG" 2>&1 || morir "Fallo 'npm install'."
fi

# El venv solo hace falta para el upscaling con IA; sin el, el resto funciona.
if [ ! -x ".venv/bin/python3" ]; then
  echo "Aviso: no hay .venv de Linux; el upscaling con IA no funcionara." | tee -a "$LOG"
  echo "  Para habilitarlo: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" | tee -a "$LOG"
fi

echo "=== $(date '+%F %T') arrancando ICO Converter XMB ===" >>"$LOG"
exec npm start >>"$LOG" 2>&1
