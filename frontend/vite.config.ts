import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        name: '香港网球天气助手',
        short_name: '网球天气',
        description: '按球场看逐小时降雨预报，到场上报实况，验证预报可信度',
        lang: 'zh-HK',
        display: 'standalone',
        start_url: '/',
        background_color: '#d9ecff',
        theme_color: '#16a34a',
        icons: [
          // 设计源文件是 public/icon.svg；改图标后跑 `npm run icons` 重新出图。
          // 构图已收在 maskable 安全区内，一份资源同时服务启动屏与桌面圆形裁切。
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
