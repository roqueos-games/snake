// O jsdom não tem ResizeObserver, e o Snake mede o próprio tamanho com ele. No
// navegador o jogo recebe o observador de verdade; aqui basta um que não faz nada,
// porque os testes não dependem do tamanho da tela.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
