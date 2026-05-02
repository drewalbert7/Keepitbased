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
        PYTHON_SERVICE_URL: 'http://127.0.0.1:5001'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        PYTHON_SERVICE_URL: 'http://127.0.0.1:5001'
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
    }
  ]
};