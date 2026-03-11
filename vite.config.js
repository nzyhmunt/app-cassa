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
        // Launcher page — choose Cassa or Sala mode
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        // Cassa app (cashier / POS)
        cassa: fileURLToPath(new URL('cassa.html', import.meta.url)),
        // Sala app (room / waiter)
        sala: fileURLToPath(new URL('sala.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
