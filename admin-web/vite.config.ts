import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // 后台接口（契约 §5.3）：admin controller 自带 admin/v1 前缀、豁免全局前缀
      '/admin': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
