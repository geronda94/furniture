import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'

// Хосты, с которых разрешено открывать dev/preview-сервер.
// Дополнительные можно передать через VITE_ALLOWED_HOSTS=host1,host2
const allowedHosts = (
  process.env.VITE_ALLOWED_HOSTS || '5176.it2b.top,.it2b.top'
)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': apiTarget,
    },
  },
  preview: {
    host: true,
    allowedHosts,
  },
})
