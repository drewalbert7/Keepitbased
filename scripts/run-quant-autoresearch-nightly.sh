#!/usr/bin/env bash
# Nightly Quant AGI autoresearch (bounded Karpathy-style loop: synthetic audit → optional LLM → sandbox git → SQLite).
# Intended for cron/systemd timer. Overlap-safe: skips if another run holds the lock.
#
# Env (optional):
#   QUANT_AUTORESEARCH_NIGHTS   iterations per invocation (default 3, matches config nightly_max_iterations)
#   QUANT_AGI_PYTHON            interpreter path (default: quant_agi/.venv_test/bin/python)
#   QUANT_AUTORESEARCH_LOG      append log (default: quant_agi/logs/autoresearch-nightly.log)
#   QUANT_AUTORESEARCH_LOCK     flock path (default: /tmp/keepitbased-quant-autoresearch.nightly.lock)
#
# Crontab example (3:15 UTC daily):
#   15 3 * * * /home/you/keepitbased/scripts/run-quant-autoresearch-nightly.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QAGI="$ROOT/quant_agi"
LOCK="${QUANT_AUTORESEARCH_LOCK:-/tmp/keepitbased-quant-autoresearch.nightly.lock}"
LOG="${QUANT_AUTORESEARCH_LOG:-$QAGI/logs/autoresearch-nightly.log}"
NIGHTS="${QUANT_AUTORESEARCH_NIGHTS:-3}"
PYTHON="${QUANT_AGI_PYTHON:-$QAGI/.venv_test/bin/python}"

mkdir -p "$QAGI/logs"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

if [[ ! -x "$PYTHON" ]]; then
  echo "$(ts) ERROR: Python not executable at $PYTHON — set QUANT_AGI_PYTHON or create quant_agi venv" | tee -a "$LOG"
  exit 1
fi

if command -v flock >/dev/null 2>&1; then
  exec {lkfd}>"$LOCK"
  if ! flock -n "$lkfd"; then
    echo "$(ts) SKIP another autoresearch run holds $LOCK" | tee -a "$LOG"
    exit 0
  fi
else
  echo "$(ts) WARN flock not installed; overlapping runs are possible" | tee -a "$LOG"
fi

echo "$(ts) START main.py run-loop --nights $NIGHTS (pid=$$)" | tee -a "$LOG"
cd "$QAGI"
set +e
nice -n 10 "$PYTHON" main.py run-loop --nights "$NIGHTS"
code=$?
set -e
echo "$(ts) END exit=$code" | tee -a "$LOG"
exit "$code"
