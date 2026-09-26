// O Vite do repo serve dois usos: `yarn dev`, que roda o jogo sozinho no navegador com o
// host de desenvolvimento do SDK (dev/), e `yarn test`, com o Vitest. No RoqueOS quem
// compila o jogo é o Vite do próprio RoqueOS: este arquivo não vai junto.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    setupFiles: ['test/preparar.js'],
    include: ['test/**/*.spec.js'],
  },
})
