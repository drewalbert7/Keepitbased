module.exports = {
  apps: [
    {
      name: 'keepitbased-api',
      script: './backend/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        PYTHON_SERVICE_URL: 'http://127.0.0.1:5001',
        // PM2 vars are applied before backend/.env; dotenv does not overwrite existing keys.
        // Critical dip emails are capped per user; daily Grok briefing is separate (digest budget).
        ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL: 'true'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        PYTHON_SERVICE_URL: 'http://127.0.0.1:5001',
        ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL: 'true'
      },
      error_file: './logs/api-err.log',
      out_file: './logs/api-out.log',
      log_file: './logs/api-combined.log',
      time: true,
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=1024',
      kill_timeout: 8000,
      restart_delay: 4000,
      exp_backoff_restart_delay: 150,
      max_restarts: 15,
      min_uptime: '15s'
    },
    {
      name: 'stock-service',
      script: './start.sh',
      cwd: './python-service',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 5001,
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LLM_MODEL: process.env.LLM_MODEL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
        GROK_API_KEY: process.env.GROK_API_KEY,
        XAI_API_KEY: process.env.XAI_API_KEY,
        GROK_BASE_URL: process.env.GROK_BASE_URL,
        PATH: process.env.PATH
      },
      error_file: './logs/stock-service-err.log',
      out_file: './logs/stock-service-out.log',
      log_file: './logs/stock-service-combined.log',
      time: true,
      watch: false,
      restart_delay: 10000,
      max_restarts: 5,
      min_uptime: '30s'
    },
    {
      name: 'quant-agi-api',
      script: '.venv_test/bin/python',
      args: 'main.py serve --host 0.0.0.0 --port 8844',
      cwd: './quant_agi',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/quant-agi-api-err.log',
      out_file: './logs/quant-agi-api-out.log',
      time: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'quant-agi-frontend',
      script: 'npm',
      args: 'start -- --port 3010',
      cwd: './quant_agi/frontend',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/quant-agi-frontend-err.log',
      out_file: './logs/quant-agi-frontend-out.log',
      time: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};