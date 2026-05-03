/**
 * OpenBB REST sidecar — Polygon/Massive + yfinance crypto keys sourced from backend/.env.
 *   pm2 start ecosystem.openbb.config.js
 *
 * AGPL-3.0: review OpenBB license before exposing publicly.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadDotEnv(relPath) {
  const env = {};
  const full = path.join(__dirname, relPath);
  if (!fs.existsSync(full)) return env;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/** Merge backend .env into PM2 env so start.sh picks up POLYGON/MASSIVE without manual export */
const merged = { ...loadDotEnv('backend/.env'), ...process.env };

module.exports = {
  apps: [
    {
      name: 'openbb-platform',
      cwd: '.',
      script: './openbb-service/start.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 5000,
      error_file: './logs/openbb-err.log',
      out_file: './logs/openbb-out.log',
      merge_logs: true,
      time: true,
      env: {
        ...merged,
        OPENBB_SETTINGS_DIR: merged.OPENBB_SETTINGS_DIR || path.join(os.homedir(), '.openbb_platform'),
        PYTHON: merged.PYTHON || 'python3'
      }
    }
  ]
};
