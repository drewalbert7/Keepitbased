#!/usr/bin/env bash
# Start OpenBB Platform REST API (default http://127.0.0.1:6900).
# Credentials: Polygon key is read from the same env as the Node app — export before PM2/start.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PY="${PYTHON:-python3}"
if ! command -v "$PY" &>/dev/null; then
  echo "Missing $PY — install Python 3.10+." >&2
  exit 1
fi

if [[ ! -d venv ]]; then
  "$PY" -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate

pip install -q --upgrade pip
pip install -q -r requirements.txt

SETTINGS_DIR="${OPENBB_SETTINGS_DIR:-$HOME/.openbb_platform}"
export OPENBB_SETTINGS_DIR="$SETTINGS_DIR"
mkdir -p "$SETTINGS_DIR"

# Merge provider keys into ~/.openbb_platform/.env (handles special chars in keys safely).
"$PY" <<'PY'
import os
import shlex
from pathlib import Path

settings = Path(os.environ.get("OPENBB_SETTINGS_DIR") or Path.home().joinpath(".openbb_platform"))
settings.mkdir(parents=True, exist_ok=True)
env_path = settings / ".env"

updates = {}
poly = os.environ.get("POLYGON_API_KEY") or os.environ.get("MASSIVE_API_KEY")
if poly:
    updates["POLYGON_API_KEY"] = poly.strip()
for k in ("FMP_API_KEY", "FINNHUB_API_KEY"):
    if os.environ.get(k):
        updates[k] = os.environ[k].strip()

if not updates:
    pass
else:
    lines = []
    if env_path.is_file():
        lines = env_path.read_text(encoding="utf-8", errors="replace").splitlines()
    keys_done = set()
    out = []
    for line in lines:
        if not line.strip() or line.strip().startswith("#"):
            out.append(line)
            continue
        kw = line.split("=", 1)[0].strip()
        if kw in updates:
            out.append(f"{kw}={shlex.quote(updates[kw])}")
            keys_done.add(kw)
        else:
            out.append(line)
    for kw, val in updates.items():
        if kw not in keys_done:
            out.append(f"{kw}={shlex.quote(val)}")
    env_path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY

HOST="${OPENBB_API_HOST:-127.0.0.1}"
PORT="${OPENBB_API_PORT:-6900}"

exec openbb-api --host "$HOST" --port "$PORT"
