import { defineConfig } from 'vite'

export default defineConfig({
  envPrefix: 'VITE_',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
