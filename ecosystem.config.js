module.exports = {
  apps: [
    {
      name: 'cmnty-panel',
      script: 'npm',
      args: 'run start -- -p 3000 -H 0.0.0.0',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
