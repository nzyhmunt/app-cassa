import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      input: {
        // POS / cashier app (existing)
        main: resolve(__dirname, 'index.html'),
        // Waiter app (new standalone entry)
        waiter: resolve(__dirname, 'waiter.html'),
      },
    },
  },
})
