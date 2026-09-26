// O Snake inteiro, montado pelo contrato do jogo-sdk com o host falso.
//
// Nenhum mock de store, de analytics ou de i18n do RoqueOS: se o jogo ainda
// alcançasse algo do RoqueOS, este arquivo não rodaria fora dele. Os casos do
// teste que rodava no front antes da extração (ROSSnake.spec.js, 25/09/2026)
// estão todos aqui, com o nome traduzido, mais os do contrato.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { VERSAO_DO_CONTRATO } from '@roqueos-games/jogo-sdk'
import { criarHostFalso } from '@roqueos-games/jogo-sdk/host-falso'

// O jsdom não tem WebGL. A cena 3D roda de verdade, contra o mesmo dublê do three
// com que o front testava este componente.
vi.mock('three', async () => (await import('./threeStub.js')).makeThreeStub())
// A cena é a de verdade; o embrulho só deixa o teste ver com que perfil o
// componente a criou.
vi.mock('../src/cena3d.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createSnakeScene: vi.fn(original.createSnakeScene) }
})

import jogo from '../src/index.js'
import { createSnakeScene } from '../src/cena3d.js'
import ptBR from '../i18n/pt-BR.json'
import enUS from '../i18n/en-US.json'
import tela from '../src/JogoSnake.vue?raw'

// Um contexto 2D que aceita tudo: a textura do tabuleiro e o cartão de
// compartilhar desenham nele.
const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient' || p === 'createRadialGradient')
          return () => ({ addColorStop() {} })
        if (p === 'canvas') return { width: 300, height: 150 }
        return () => {}
      },
      set: () => true,
    },
  )

let el = null
let host = null
let montagem = null

// O laço do jogo anda por requestAnimationFrame. Aqui os quadros só rodam quando
// o teste manda, com 16 ms entre eles: no front o laço corria no relógio de
// verdade, e a cobra andava sozinha no meio do teste.
let quadros = []
let agora = 0
const rodarQuadros = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const fila = quadros
    quadros = []
    agora += 16
    for (const fn of fila) fn(agora)
  }
}

const palco = () => {
  el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
const montou = () =>
  vi.waitFor(() => {
    if (!el.querySelector('.ros-snake')) throw new Error('o Snake ainda não montou')
  })
const montarCom = async (h, { ativo = true } = {}) => {
  host = h
  montagem = jogo.mount(palco(), host, { windowId: 'w1', ativo })
  // O app só monta com o texto do idioma carregado.
  await montou()
  await nextTick()
}
const montar = ({ ativo = true, ...opcoesDoHost } = {}) =>
  montarCom(criarHostFalso({ jogoId: 'snake', ...opcoesDoHost }), { ativo })

const $ = (sel) => el.querySelector(sel)
const eventos = (nome) =>
  host.chamadas.filter((c) => c.capacidade === 'metricas' && c.args[0] === nome)
const nomesDeEvento = () =>
  host.chamadas.filter((c) => c.capacidade === 'metricas').map((c) => c.args[0])
const avisos = () => host.chamadas.filter((c) => c.capacidade === 'avisar').map((c) => c.args)
const tecla = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
// O jsdom não tem PointerEvent; o Vue ouve o tipo do evento, então um
// MouseEvent chamado `pointerdown` chega no mesmo ouvinte.
const tocar = (alvo, x = 200, y = 300) =>
  alvo.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  )

// Come uma e sobe até a parede de cima: fim de jogo com 1 ponto.
const comerUmaEBaterNaParede = async () => {
  window.__snake.start()
  const head = window.__snake.state.snake[0]
  window.__snake.state.food = { x: head.x + 1, y: head.y }
  window.__snake.step()
  // Tira a comida do caminho de subida. O motor é semeado com Math.random(), e
  // a comida podia nascer na coluna que a cobra vai subir: comer de novo fazia
  // o recorde virar 2 e o teste do front falhava no cara ou coroa (29/07/2026).
  const after = window.__snake.state.snake[0]
  window.__snake.state.food = { x: after.x, y: after.y + 3 }
  window.__snake.setDir('up')
  for (let i = 0; i < 25 && window.__snake.state.status === 'playing'; i++) window.__snake.step()
  await nextTick()
}

describe('Snake pelo jogo-sdk', () => {
  let origCtx
  beforeEach(() => {
    window.__ROS_E2E__ = {}
    origCtx = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2d())
    quadros = []
    agora = 0
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      quadros.push(fn)
      return quadros.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    montagem?.desmontar()
    el?.remove()
    montagem = null
    el = null
    host = null
    HTMLCanvasElement.prototype.getContext = origCtx
    delete window.__ROS_E2E__
    delete window.__snake
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('é um jogo do SDK, com o id que o catálogo e o recorde usam', () => {
    expect(jogo.id).toBe('snake')
    expect(jogo.versaoDoContrato).toBe(VERSAO_DO_CONTRATO)
    expect(jogo.capacidades).toEqual([])
  })

  it('abre na tela inicial, com o motor parado', async () => {
    await montar()
    expect($('.ros-snake__logo').textContent).toBe(ptBR.title)
    expect($('.ros-snake__tagline').textContent).toBe(ptBR.tagline)
    expect($('.ros-snake__cta').textContent).toBe(ptBR.tapToPlay)
    expect($('.ros-snake__hud')).toBeNull()
    expect(window.__snake.state.status).toBe('idle')
    expect(window.__snake.state.snake).toHaveLength(0)
  })

  it('desenha quadros na tela inicial sem estourar com a cobra vazia (regressão)', async () => {
    // O laço lia s[0].x num corpo vazio, lançava e matava o canvas na tela
    // inicial. Os quadros têm de rodar limpos, e o laço tem de continuar vivo.
    await montar()
    expect(window.__snake.state.snake).toHaveLength(0)
    expect(() => rodarQuadros(4)).not.toThrow()
    expect(quadros).toHaveLength(1)
    expect($('.ros-snake__logo')).not.toBeNull()
  })

  it('fala o idioma do host, e troca quando o host troca', async () => {
    await montar({ idioma: 'en-US' })
    expect($('.ros-snake__cta').textContent).toBe(enUS.tapToPlay)
    host.disparar('idioma', 'pt-BR')
    await vi.waitFor(() => expect($('.ros-snake__cta').textContent).toBe(ptBR.tapToPlay))
  })

  it('o primeiro toque começa: o placar aparece e registra game_start', async () => {
    await montar()
    tocar($('.ros-snake'))
    await nextTick()
    expect(window.__snake.state.status).toBe('playing')
    expect($('.ros-snake__hud')).not.toBeNull()
    expect(eventos('game_start').map((c) => c.args)).toEqual([['game_start', {}]])
  })

  it('destrava o áudio dentro do gesto, sem esperar nada (o iOS exige)', async () => {
    await montar()
    expect(host.contar('audio', 'destravar')).toBe(0)
    tocar($('.ros-snake'))
    expect(host.contar('audio', 'destravar')).toBe(1)
    tecla('ArrowUp')
    expect(host.contar('audio', 'destravar')).toBe(1) // já jogando: a seta só vira
  })

  it('uma seta do teclado começa a partida e enfileira a curva', async () => {
    await montar()
    tecla('ArrowUp')
    expect(window.__snake.state.status).toBe('playing')
    // para cima é permitido contra a direita inicial → vai para a fila
    expect(window.__snake.state.queue.length).toBe(1)
  })

  it('recusa a meia-volta (direita → esquerda é ignorado)', async () => {
    await montar()
    window.__snake.start()
    window.__snake.setDir('left')
    expect(window.__snake.state.queue.length).toBe(0)
  })

  it('o laço anda a cobra uma casa a cada intervalo do motor', async () => {
    await montar()
    window.__snake.start()
    const x0 = window.__snake.state.snake[0].x
    rodarQuadros(10) // o 1º quadro não conta tempo; 9 × 16 ms = 0,144 s < 0,15 s
    expect(window.__snake.state.snake[0].x).toBe(x0)
    rodarQuadros(1) // 0,160 s: um passo
    expect(window.__snake.state.snake[0].x).toBe(x0 + 1)
  })

  it('comer faz a cobra crescer e soma um ponto', async () => {
    await montar()
    window.__snake.start()
    const head = window.__snake.state.snake[0]
    window.__snake.state.food = { x: head.x + 1, y: head.y }
    window.__snake.step()
    await nextTick()
    expect(window.__snake.state.snake).toHaveLength(4)
    expect($('.ros-snake__score').textContent).toBe('1')
  })

  it('bater na parede acaba a partida e guarda o recorde novo, no local e na conta', async () => {
    await montar()
    await comerUmaEBaterNaParede()
    expect(window.__snake.state.status).toBe('over')
    expect($('.ros-snake__over')).not.toBeNull()
    expect($('.ros-snake__over-title').textContent.trim()).toBe(ptBR.newRecord)
    expect(eventos('game_over').map((c) => c.args)).toEqual([['game_over', { score: 1 }]])
    expect(host.storage.getItem('roqueos:snake:best')).toBe('1')
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 1 }))
  })

  it('fim de jogo abaixo do recorde é "Fim de jogo", e o recorde fica', async () => {
    const h = criarHostFalso({ jogoId: 'snake' })
    h.storage.setItem('roqueos:snake:best', '9')
    await montarCom(h)
    await comerUmaEBaterNaParede()
    expect($('.ros-snake__over-title').textContent.trim()).toBe(ptBR.over)
    expect(host.storage.getItem('roqueos:snake:best')).toBe('9')
  })

  it('os eventos de uma partida têm os nomes de antes da extração', async () => {
    await montar()
    await comerUmaEBaterNaParede()
    expect(nomesDeEvento()).toEqual(['game_start', 'game_over'])
  })

  it('o som liga e desliga na mesma chave de antes da extração', async () => {
    await montar()
    tocar($('.ros-snake'))
    await nextTick()
    const botoes = el.querySelectorAll('.ros-snake__icon-btn')
    botoes[botoes.length - 1].click() // o som é a última ação do canto
    expect(host.storage.getItem('roqueos:snake:muted')).toBe('1')
    await nextTick()
    expect(botoes[botoes.length - 1].getAttribute('aria-label')).toBe(ptBR.soundOff)
    botoes[botoes.length - 1].click()
    expect(host.storage.getItem('roqueos:snake:muted')).toBe('0')
  })

  it('o som desligado de antes volta desligado', async () => {
    const h = criarHostFalso({ jogoId: 'snake' })
    h.storage.setItem('roqueos:snake:muted', '1')
    await montarCom(h)
    tocar($('.ros-snake'))
    await nextTick()
    const botoes = el.querySelectorAll('.ros-snake__icon-btn')
    expect(botoes[botoes.length - 1].getAttribute('aria-label')).toBe(ptBR.soundOff)
  })

  it('a dica aparece só na primeira partida, e a chave `seen` é a de antes', async () => {
    await montar()
    window.__snake.start()
    await nextTick()
    // Teclado ou toque depende do que o jsdom diz ter; o texto é um dos dois.
    expect([ptBR.hintKeys, ptBR.hintTouch]).toContain($('.ros-snake__hint').textContent.trim())
    expect(host.storage.getItem('roqueos:snake:seen')).toBe('1')

    montagem.desmontar()
    el.remove()
    const h = criarHostFalso({ jogoId: 'snake' })
    h.storage.setItem('roqueos:snake:seen', '1')
    await montarCom(h)
    window.__snake.start()
    await nextTick()
    expect($('.ros-snake__hint')).toBeNull()
  })

  it('o recorde da conta maior que o local vem para a tela e para a chave da galeria', async () => {
    const h = criarHostFalso({ jogoId: 'snake' })
    await h.placar.salvar({ best: 50 })
    await montarCom(h)
    await vi.waitFor(() => expect(host.storage.getItem('roqueos:snake:best')).toBe('50'))
    await nextTick()
    expect($('.ros-snake__start-best').textContent).toContain('50')
  })

  it('o recorde local maior que o da conta sobe para a conta', async () => {
    const h = criarHostFalso({ jogoId: 'snake' })
    h.storage.setItem('roqueos:snake:best', '30')
    await montarCom(h)
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 30 }))
  })

  it('convidado não tem placar na conta: o recorde fica só no armazenamento', async () => {
    // Para convidado, o host do RoqueOS devolve null no carregar e false no
    // salvar, sem nem tocar no Firestore.
    const h = criarHostFalso({ jogoId: 'snake' })
    h.placar.carregar = vi.fn(async () => null)
    h.placar.salvar = vi.fn(async () => false)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    await montarCom(h)
    await vi.waitFor(() => expect(h.placar.carregar).toHaveBeenCalled())
    expect(h.placar.salvar).not.toHaveBeenCalled() // não há recorde local para subir
    await comerUmaEBaterNaParede()
    expect($('.ros-snake__over-title').textContent.trim()).toBe(ptBR.newRecord)
    expect(host.storage.getItem('roqueos:snake:best')).toBe('1')
    await vi.waitFor(() => expect(h.placar.salvar).toHaveBeenCalledWith({ best: 1 }))
    expect(erro).not.toHaveBeenCalled()
    erro.mockRestore()
  })

  it('entrar na conta com o jogo aberto busca o recorde da conta de novo', async () => {
    await montar()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(2))
  })

  it('só a janela ativa ouve o teclado', async () => {
    await montar({ ativo: false })
    tecla('ArrowUp')
    tecla(' ')
    await nextTick()
    expect(eventos('game_start')).toHaveLength(0)
    expect($('.ros-snake__start')).not.toBeNull()

    montagem.ativar(true)
    tecla('ArrowUp')
    await nextTick()
    expect(eventos('game_start')).toHaveLength(1)
    expect($('.ros-snake__start')).toBeNull()
  })

  it('perder o foco pausa a partida e para o laço; o toque solta a pausa', async () => {
    await montar()
    window.__snake.start()
    await nextTick()
    montagem.ativar(false)
    await nextTick()
    expect($('.ros-snake__pause')).not.toBeNull()
    const cabeca = { ...window.__snake.state.snake[0] }
    rodarQuadros(30)
    expect(window.__snake.state.snake[0]).toEqual(cabeca)

    montagem.ativar(true)
    await nextTick()
    expect($('.ros-snake__pause')).not.toBeNull() // voltar o foco não solta sozinho
    tocar($('.ros-snake'))
    await nextTick()
    expect($('.ros-snake__pause')).toBeNull()
    rodarQuadros(12)
    expect(window.__snake.state.snake[0]).not.toEqual(cabeca)
  })

  it('espaço pausa e despausa a partida', async () => {
    await montar()
    window.__snake.start()
    tecla(' ')
    await nextTick()
    expect($('.ros-snake__pause')).not.toBeNull()
    tecla(' ')
    await nextTick()
    expect($('.ros-snake__pause')).toBeNull()
  })

  it('o perfil leve do host chega no jogo e na cena 3D', async () => {
    await montar({ modoLeve: true })
    expect($('.ros-snake').classList.contains('ros-snake--low')).toBe(true)
    expect(createSnakeScene).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      lowEnd: true,
    })
  })

  it('sem perfil leve, a cena 3D recebe o perfil cheio', async () => {
    await montar()
    expect($('.ros-snake').classList.contains('ros-snake--low')).toBe(false)
    expect(createSnakeScene).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      lowEnd: false,
    })
  })

  describe('compartilhar', () => {
    // O jsdom não gera PNG de canvas nem URL de blob, e não tem `navigator.share`.
    // Cada teste põe o que precisa; aqui se guarda e se devolve o que havia.
    let origToBlob
    let origCriar
    let origRevogar
    beforeEach(() => {
      origToBlob = HTMLCanvasElement.prototype.toBlob
      origCriar = URL.createObjectURL
      origRevogar = URL.revokeObjectURL
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        cb(new Blob(['png'], { type: 'image/png' }))
      }
    })
    afterEach(() => {
      HTMLCanvasElement.prototype.toBlob = origToBlob
      URL.createObjectURL = origCriar
      URL.revokeObjectURL = origRevogar
      delete navigator.share
    })

    const botaoCompartilhar = async () => {
      window.__snake.start()
      await nextTick()
      return el.querySelectorAll('.ros-snake__icon-btn')[0]
    }

    it('sem compartilhamento nativo, baixa a imagem e avisa com o texto do jogo', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:snake')
      URL.revokeObjectURL = vi.fn()
      const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      await montar()
      ;(await botaoCompartilhar()).click()
      await vi.waitFor(() => expect(avisos()).toEqual([[ptBR.shareSaved, { tipo: 'sucesso' }]]))
      expect(clique).toHaveBeenCalledTimes(1)
      clique.mockRestore()
    })

    it('compartilhamento que falha avisa erro com o texto que era do sistema', async () => {
      navigator.share = vi.fn(async () => {
        throw new Error('falhou')
      })
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
      await montar()
      ;(await botaoCompartilhar()).click()
      await vi.waitFor(() => expect(avisos()).toEqual([[ptBR.operationFailed, { tipo: 'erro' }]]))
      expect(erro).toHaveBeenCalled()
      erro.mockRestore()
    })

    it('cancelar o compartilhamento não avisa nada', async () => {
      navigator.share = vi.fn(async () => {
        throw new DOMException('cancelou', 'AbortError')
      })
      await montar()
      ;(await botaoCompartilhar()).click()
      await vi.waitFor(() => expect(navigator.share).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 10))
      expect(avisos()).toEqual([])
    })
  })

  it('desmontar solta tudo: o gancho, a tela e o teclado', async () => {
    await montar()
    expect(window.__snake).toBeTruthy()
    montagem.desmontar()
    expect(window.__snake).toBeUndefined()
    expect(el.querySelector('.ros-snake')).toBeNull()
    tecla('ArrowUp')
    expect(eventos('game_start')).toHaveLength(0)
    // Desmontar de novo acontece de verdade (a janela fecha e o componente em
    // volta desmonta depois) e não pode lançar.
    expect(() => montagem.desmontar()).not.toThrow()
  })

  it('desmontar antes de o texto chegar não monta nada depois', async () => {
    host = criarHostFalso({ jogoId: 'snake' })
    montagem = jogo.mount(palco(), host, { ativo: true })
    montagem.desmontar()
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelector('.ros-snake')).toBeNull()
  })

  it('toda chave que a tela usa existe no pt-BR', () => {
    const usadas = [...tela.matchAll(/txt\('([\w.]+)'/g)].map((m) => m[1])
    expect(usadas.length).toBeGreaterThan(15)
    const faltando = usadas.filter((k) => typeof ptBR[k] !== 'string')
    expect(faltando).toEqual([])
  })
})
