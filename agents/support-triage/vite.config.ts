/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

// The web app is the developer debugger in devtools/web. It imports the agent and engine code it shows.
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env and .env.local, for pnpm dev:web run on its own (pnpm dev passes them in the environment, which wins).
  const env = loadEnv(mode, projectRoot, '')
  // 127.0.0.1: the devtools server listens only there.
  const devtools = `127.0.0.1:${env.DEVTOOLS_PORT || 8788}`
  return {
    root: 'devtools/web',
    // .env and .env.local stay at the project root.
    envDir: projectRoot,
    plugins: [
      react(),
      tailwindcss(),
    ],
    build: {
      outDir: `${projectRoot}/dist`,
      emptyOutDir: true,
    },
    server: {
      // Fail if the port is taken instead of moving to another: pnpm text-call and compare link to this one.
      port: Number(env.DEVTOOLS_WEB_PORT || 5173),
      strictPort: true,
      // The devtools server (devtools/server) holds the API key and relays the data connection.
      proxy: {
        '/api': `http://${devtools}`,
        '/events': { target: `ws://${devtools}`, ws: true },
      },
    },
    test: {
      // Run every test in the project, not just the Vite root.
      root: projectRoot,
    },
  }
})
