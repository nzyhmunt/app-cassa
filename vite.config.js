import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'url'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { appConfig } from './src/utils/index.js'
import { injectLogoIcon, getMimeType } from './src/utils/pwaManifest.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * Vite plugin: injects appConfig.pwaLogo as an additional maskable icon entry
 * into the cassa and sala web app manifests.
 *
 * - Dev mode: intercepts manifest requests via a Connect middleware and returns
 *   the patched JSON on the fly.
 * - Production build: post-processes the copied manifest files in the output
 *   directory after Rollup finishes writing all assets (closeBundle hook).
 */
function pwaManifestPlugin() {
  /** @type {import('vite').ResolvedConfig} */
  let resolvedConfig

  return {
    name: 'pwa-manifest-logo',

    configResolved(config) {
      resolvedConfig = config
    },

    // Dev-server middleware: patch manifest responses on the fly.
    configureServer(server) {
      if (!appConfig.pwaLogo) return
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.endsWith('.webmanifest')) return next()

        const basename = path.basename(url)
        const manifestPath = path.join(__dirname, 'public', basename)
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
          manifest.icons = injectLogoIcon(manifest.icons, appConfig.pwaLogo)
          res.setHeader('Content-Type', 'application/manifest+json')
          res.end(JSON.stringify(manifest, null, 2))
        } catch {
          next()
        }
      })
    },

    // Production build: post-process manifest files in the output directory.
    closeBundle() {
      if (!appConfig.pwaLogo) return
      const outDir = resolvedConfig?.build?.outDir ?? 'dist'
      for (const name of ['cassa.webmanifest', 'sala.webmanifest']) {
        const outPath = path.join(__dirname, outDir, name)
        try {
          const manifest = JSON.parse(readFileSync(outPath, 'utf8'))
          manifest.icons = injectLogoIcon(manifest.icons, appConfig.pwaLogo)
          writeFileSync(outPath, JSON.stringify(manifest, null, 2))
        } catch {
          // File may not exist in partial builds — skip silently.
        }
      }
    },

    // All HTML pages: replace the favicon and apple-touch-icon link tags with
    // the custom logo URL so they stay in sync with the PWA manifest icons.
    transformIndexHtml(html) {
      if (!appConfig.pwaLogo) return html
      // HTML-escape the URL so that any stray `&`, `"`, `<` or `>` characters
      // in the configured value do not break the generated HTML attribute.
      const logoUrl = appConfig.pwaLogo
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const mimeType = getMimeType(appConfig.pwaLogo)

      // Replace <link rel="icon"> with the custom logo.
      let out = html.replace(
        /<link\s[^>]*rel=["']icon["'][^>]*\/?>/gi,
        `<link rel="icon" type="${mimeType}" href="${logoUrl}" />`,
      )

      // Replace <link rel="apple-touch-icon"> if already present, otherwise
      // inject one right after the favicon tag.
      const atiRegex = /<link\s[^>]*rel=["']apple-touch-icon["'][^>]*\/?>/gi
      const atiTag = `<link rel="apple-touch-icon" href="${logoUrl}" />`
      if (atiRegex.test(out)) {
        out = out.replace(atiRegex, atiTag)
      } else {
        out = out.replace(
          `<link rel="icon" type="${mimeType}" href="${logoUrl}" />`,
          `<link rel="icon" type="${mimeType}" href="${logoUrl}" />\n    ${atiTag}`,
        )
      }

      return out
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    tailwindcss(),
    pwaManifestPlugin(),
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
