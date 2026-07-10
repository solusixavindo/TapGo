module.exports = {
  apps: [
    {
      name: "tapgo-api",
      cwd: __dirname,
      script: "dist/server.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "512M",
      time: true,
      env: {
        NODE_ENV: "production"
      },
      env_production: {
        NODE_ENV: "production"
      }
    }
  ]
};
