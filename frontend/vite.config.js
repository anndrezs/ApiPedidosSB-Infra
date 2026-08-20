import { defineConfig } from 'vite'

export default defineConfig({
  envPrefix: 'VITE_',
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
