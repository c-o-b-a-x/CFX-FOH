// PM2 config — run with: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'ticket-order-bot',
      cwd: __dirname,
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      time: true,
    },
  ],
};
