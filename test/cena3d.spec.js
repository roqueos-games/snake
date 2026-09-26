import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The premium 3D scene renders through the shared headless three stub; the pure
// framing/centre-line maths is covered separately in snake3dGeometry.spec.js.
vi.mock('three', async () => (await import('./threeStub.js')).makeThreeStub())

import { createSnakeScene } from '../src/cena3d.js'
import { createGame, startGame } from '../src/engine.js'
import { gridToWorld, buildCenterline } from '../src/cena3dGeometria.js'

const ctx2dStub = {
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  fillRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  arc() {},
  stroke() {},
  fill() {},
  set fillStyle(_v) {},
  set strokeStyle(_v) {},
  set lineWidth(_v) {},
}

describe('snake3d — createSnakeScene (premium fixed-camera arena)', () => {
  let getCtxSpy
  beforeEach(() => {
    getCtxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2dStub)
  })
  afterEach(() => {
    getCtxSpy?.mockRestore()
    vi.restoreAllMocks()
  })

  it('returns a no-op renderer when no canvas is given', () => {
    const r = createSnakeScene(null)
    expect(r.ok).toBe(false)
    // no-op methods must be safe to call
    expect(() => {
      r.setState({}, {})
      r.resize(100, 100)
      r.render()
      r.dispose()
    }).not.toThrow()
  })

  it('builds a live scene and exposes the renderer contract', () => {
    const r = createSnakeScene(document.createElement('canvas'))
    expect(r.ok).toBe(true)
    expect(typeof r.setState).toBe('function')
    expect(typeof r.resize).toBe('function')
    expect(typeof r.render).toBe('function')
    expect(typeof r.dispose).toBe('function')
    r.dispose()
  })

  it('renders a running game state without throwing (snake + food)', () => {
    const r = createSnakeScene(document.createElement('canvas'))
    const game = startGame(createGame(7))
    expect(() => {
      r.resize(800, 600)
      r.setState(game, { prog: 0.5, grewLast: false, status: 'playing', time: 1.2 })
      r.render()
    }).not.toThrow()
    // after several moves (longer body + interpolation) it still renders
    for (let i = 0; i < 12; i++) game.snake.unshift({ x: game.snake[0].x + 1, y: game.snake[0].y })
    expect(() =>
      r.setState(game, { prog: 0.2, grewLast: true, status: 'playing', time: 3 }),
    ).not.toThrow()
    r.dispose()
  })

  it('handles the game-over state (dead colouring) without throwing', () => {
    const r = createSnakeScene(document.createElement('canvas'))
    const game = startGame(createGame(9))
    expect(() => r.setState(game, { prog: 1, status: 'over', time: 0 })).not.toThrow()
    r.dispose()
  })

  it('builds in low-end mode too', () => {
    const r = createSnakeScene(document.createElement('canvas'), { lowEnd: true })
    expect(r.ok).toBe(true)
    const game = startGame(createGame(3))
    expect(() => {
      r.setState(game, { prog: 0.4, status: 'playing', time: 2 })
      r.render()
    }).not.toThrow()
    r.dispose()
  })
})

describe('snake3d: ONDE a cena põe cada peça', () => {
  /**
   * Os testes acima provam que a cena não estoura. Isso é necessário e não é
   * suficiente: a cena inteira é aritmética de coordenada, e um sinal trocado
   * não lança exceção nenhuma -- ele desenha a cobra ao lado da comida. As
   * afirmações abaixo são as que sobrevivem a um redesenho visual, porque não
   * falam de estilo: falam do contrato entre o tabuleiro do jogo e o mundo 3D.
   */
  const cena = () => {
    const r = createSnakeScene(document.createElement('canvas'))
    r.resize(800, 600)
    return r
  }

  it('a gema fica exatamente na casa da comida', () => {
    const r = cena()
    const game = startGame(createGame(7))
    for (const [fx, fy] of [
      [0, 0],
      [3, 5],
      [game.cols - 1, game.rows - 1],
    ]) {
      game.food = { x: fx, y: fy }
      r.setState(game, { prog: 1, status: 'playing', time: 0 })
      const { gema } = r.posicoesParaTeste()
      const alvo = gridToWorld(fx, fy, game.cols, game.rows)
      expect(gema.visivel).toBe(true)
      expect(gema.x).toBeCloseTo(alvo.x, 6)
      expect(gema.z).toBeCloseTo(alvo.z, 6)
      expect(gema.y).toBeGreaterThan(0) // a gema flutua acima do chão
    }
    r.dispose()
  })

  it('sem comida no tabuleiro, a gema some em vez de ficar na origem', () => {
    const r = cena()
    const game = startGame(createGame(7))
    game.food = null
    r.setState(game, { prog: 1, status: 'playing', time: 0 })
    expect(r.posicoesParaTeste().gema.visivel).toBe(false)
    r.dispose()
  })

  it('a cabeça fica no primeiro ponto da linha central, e olha para onde anda', () => {
    const r = cena()
    const game = startGame(createGame(7))
    r.setState(game, { prog: 1, status: 'playing', time: 0 })
    const { cabeca, cauda } = r.posicoesParaTeste()
    const pts = buildCenterline(game.snake, 1, false, game.cols, game.rows, 0)
    expect(pts.length).toBeGreaterThanOrEqual(2)
    expect(cabeca.visivel).toBe(true)
    expect(cabeca.x).toBeCloseTo(pts[0].x, 6)
    expect(cabeca.z).toBeCloseTo(pts[0].z, 6)
    // O giro aponta do segundo ponto para o primeiro: é a direção do passo.
    expect(cabeca.giroY).toBeCloseTo(Math.atan2(pts[0].x - pts[1].x, pts[0].z - pts[1].z), 6)
    // A cauda fica do outro lado, e não em cima da cabeça.
    expect(cauda.visivel).toBe(true)
    expect(Math.hypot(cauda.x - cabeca.x, cauda.z - cabeca.z)).toBeGreaterThan(0)
    r.dispose()
  })

  it('nenhuma peça vai parar num número inválido', () => {
    const r = cena()
    const game = startGame(createGame(7))
    for (const prog of [0, 0.5, 1]) {
      r.setState(game, { prog, grewLast: true, status: 'playing', time: prog * 3 })
      const pos = r.posicoesParaTeste()
      for (const peca of Object.values(pos)) {
        for (const [k, v] of Object.entries(peca)) {
          if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true)
        }
      }
    }
    r.dispose()
  })

  it('a cena sem canvas devolve posições nulas em vez de estourar', () => {
    expect(createSnakeScene(null).posicoesParaTeste()).toBeNull()
  })
})
