import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'url'

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
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        // Waiter app (new standalone entry)
        waiter: fileURLToPath(new URL('waiter.html', import.meta.url)),
      },
    },
  },
})
