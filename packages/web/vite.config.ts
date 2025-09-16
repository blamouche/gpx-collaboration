import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.VITE_WEB_PORT ? Number(env.VITE_WEB_PORT) : 5173;

  const proxyTarget = env.VITE_SERVER_PROXY ?? '';

  return {
    plugins: [react()],
    server: {
      port: serverPort,
      host: true,
      proxy: proxyTarget
        ? {
            '/health': { target: proxyTarget, changeOrigin: true },
            '/metrics': { target: proxyTarget, changeOrigin: true }
          }
        : undefined
    },
    define: {
      __APP_VERSION__: JSON.stringify(env.npm_package_version ?? '0.0.0')
    }
  };
});
