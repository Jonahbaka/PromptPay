// ═══════════════════════════════════════════════════════════════
// PromptPay :: PM2 Ecosystem Config
// Cluster mode for zero-downtime deployments
// ═══════════════════════════════════════════════════════════════

module.exports = {
  apps: [{
    name: 'upromptpay',
    script: './dist/index.js',
    exec_mode: 'cluster',
    instances: 2,

    // Zero-downtime reload: worker calls process.send('ready') after listen
    wait_ready: true,
    listen_timeout: 10000,

    // Grace period for connection draining on reload/stop
    kill_timeout: 15000,

    // Memory cap per worker (EC2 has 916MB total)
    node_args: '--max-old-space-size=384',

    // Restart on crash
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,

    // Logs
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
