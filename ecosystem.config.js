module.exports = {
  apps: [
    {
      name: 'keepitbased-api',
      script: './backend/server.js',
      instances: 1,
      exec_mode: 'cluster',
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
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=1024',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s'
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