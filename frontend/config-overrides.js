module.exports = function override(config, env) {
  // Override webpack dev server configuration to fix allowedHosts issue
  return {
    ...config,
    devServer: {
      ...config.devServer,
      allowedHosts: 'all',
      host: 'localhost',
      port: 3000,
      historyApiFallback: true,
    }
  };
};