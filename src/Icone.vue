<template>
  <svg
    class="icone-snake"
    :width="tamanho"
    :height="tamanho"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="nome === 'reiniciar'">
      <path d="M5.2 13.5a7 7 0 1 0 1.9-6.4" />
      <path d="M4.5 4v4.5H9" />
    </template>
    <template v-else-if="nome === 'compartilhar'">
      <path d="M8 10H6.5v10h11V10H16" />
      <path d="M12 3.5v11" />
      <path d="M8.5 7 12 3.5 15.5 7" />
    </template>
    <template v-else-if="nome === 'som'">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
    </template>
    <template v-else-if="nome === 'mudo'">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      <path d="m15.5 9.5 5 5" />
      <path d="m20.5 9.5-5 5" />
    </template>
  </svg>
</template>

<script setup>
// Os ícones do Snake, desenhados aqui. O jogo roda num app Vue próprio, sem o
// Quasar do RoqueOS, então `q-icon` não existe para ele; e um jogo aberto não
// pode depender da fonte de ícones de outro produto. Desenho autoral, sem
// licença de terceiro, do catálogo comum dos jogos da roqueos-games.
defineProps({
  nome: {
    type: String,
    required: true,
    validator: (v) => ['reiniciar', 'compartilhar', 'som', 'mudo'].includes(v),
  },
  tamanho: { type: [Number, String], default: 18 },
})
</script>

<style scoped>
.icone-snake {
  display: block;
  flex: none;
}
</style>
