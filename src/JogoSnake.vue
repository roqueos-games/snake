<template>
  <div
    ref="rootRef"
    class="ros-snake"
    :class="{ 'ros-snake--low': modoLeve }"
    :dir="estado.idioma === 'ar-AR' ? 'rtl' : 'ltr'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <canvas ref="canvasRef" class="ros-snake__canvas" />

    <!-- HUD -->
    <div v-if="status === 'playing'" class="ros-snake__hud" aria-hidden="true">
      <span class="ros-snake__score-label">{{ txt('score') }}</span>
      <span class="ros-snake__score">{{ score }}</span>
    </div>

    <div v-if="best > 0 && status === 'playing'" class="ros-snake__best-badge" aria-hidden="true">
      👑 {{ best }}
    </div>

    <!-- top-right controls -->
    <div v-if="status !== 'ready'" class="ros-snake__top-actions">
      <button
        class="ros-snake__icon-btn"
        :aria-label="txt('share')"
        @pointerdown.stop
        @click.stop="shareScore"
      >
        <Icone nome="compartilhar" :tamanho="18" />
      </button>
      <button
        class="ros-snake__icon-btn"
        :aria-label="muted ? txt('soundOff') : txt('soundOn')"
        @pointerdown.stop
        @click.stop="toggleMute"
      >
        <Icone :nome="muted ? 'mudo' : 'som'" :tamanho="18" />
      </button>
    </div>

    <!-- Start screen -->
    <div v-if="status === 'ready'" class="ros-snake__start">
      <div class="ros-snake__logo">{{ txt('title') }}</div>
      <div class="ros-snake__tagline">{{ txt('tagline') }}</div>
      <div v-if="best > 0" class="ros-snake__start-best">👑 {{ txt('best') }} · {{ best }}</div>
      <div class="ros-snake__cta">{{ txt('tapToPlay') }}</div>
    </div>

    <!-- First-run hint -->
    <div v-if="showHint && status === 'playing'" class="ros-snake__hint">
      {{ isTouch ? txt('hintTouch') : txt('hintKeys') }}
    </div>

    <!-- Game over -->
    <transition name="snake-pop">
      <div v-if="status === 'over'" class="ros-snake__over">
        <div class="ros-snake__over-title">
          {{ isRecord ? txt('newRecord') : txt('over') }}
        </div>
        <div class="ros-snake__over-score">{{ score }}</div>
        <div class="ros-snake__over-best">👑 {{ txt('best') }} · {{ best }}</div>
        <button class="ros-snake__retry" @pointerdown.stop @click.stop="start">
          <Icone nome="reiniciar" :tamanho="20" />
          {{ txt('retry') }}
        </button>
      </div>
    </transition>

    <!-- Pause overlay -->
    <div v-if="paused && status === 'playing'" class="ros-snake__pause">
      <div class="ros-snake__pause-title">{{ txt('paused') }}</div>
      <div class="ros-snake__pause-cta">{{ txt('tapToResume') }}</div>
    </div>
  </div>
</template>

<script setup>
// O Snake. Fala com o sistema só pelo `host` do jogo-sdk: placar, áudio, modo
// leve, métricas, avisos e armazenamento chegam por ele, e é por isso que o
// mesmo arquivo roda dentro do RoqueOS, no `yarn dev` do repo e no teste.
//
// A cena 3D (`cena3d.js`) veio do RoqueOS sem mudança nenhuma no que toca a GPU:
// o componente só entrega a ela o canvas e o perfil leve, que agora vem do host.
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { emModoE2E } from '@roqueos-games/jogo-sdk'
import { createGame, startGame, setDirection, stepMove, DIRS } from './engine.js'
import { createSnakeScene } from './cena3d.js'
import { criarSom } from './som.js'
import { traduzir } from './textos.js'
import Icone from './Icone.vue'

const props = defineProps({
  /** O host do contrato v1 do jogo-sdk. */
  host: { type: Object, required: true },
  /** `{ ativo, idioma, textos }`, reativo; quem escreve é o `montar` do jogo. */
  estado: { type: Object, required: true },
})

const host = props.host
const txt = (chave, valores) => traduzir(props.estado.textos, chave, valores)

// ── Reactive UI (engine state is NON-reactive — perf) ────────────────────────
const rootRef = ref(null)
const canvasRef = ref(null)
const status = ref('ready') // 'ready' | 'playing' | 'over'
const score = ref(0)
const best = ref(0)
const isRecord = ref(false)
const muted = ref(false)
const paused = ref(false)
const showHint = ref(false)
const isTouch = ref(false)
const modoLeve = ref(false)

// ── Engine + 3D renderer internals (plain) ───────────────────────────────────
let game = null
let renderer = null // snake3d scene (or a no-op if WebGL is unavailable)
let W = 0
let H = 0
let rafId = 0
let lastT = 0
let running = false
let resizeObserver = null
let pararIdentidade = null

// animation timing
let accum = 0 // seconds accumulated toward the next grid move
let moveInterval = 0.15 // seconds (mirrors engine.interval)
let grewLast = false
let timeSec = 0 // wall-clock for slither / apple pulse + bob

const pendingTimers = new Set()
const later = (fn, ms) => {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
  return id
}

// ── Audio (procedural) ───────────────────────────────────────────────────────
const som = criarSom(host.audio, () => muted.value)
// Chamado de dentro do gesto (toque, clique, tecla), sem `await` antes: o iOS
// só libera o áudio assim.
const primeAudio = () => {
  try {
    host.audio.destravar()?.catch?.(() => {})
  } catch {
    /* best-effort */
  }
}

const buzz = (p) => {
  try {
    navigator.vibrate?.(p)
  } catch {
    /* best-effort */
  }
}

// As chaves `best`, `muted` e `seen` viram `roqueos:snake:<chave>` no host, as
// mesmas de antes da extração: quem já jogava não perde o recorde nem volta a
// ver a dica, e a galeria continua lendo o best dali.
const toggleMute = () => {
  muted.value = !muted.value
  if (muted.value) som.calarFundo()
  host.armazenamento.gravar('muted', muted.value ? '1' : '0')
}

// ── Geometry / render ─────────────────────────────────────────────────────────
const resize = () => {
  if (!rootRef.value) return
  const r = rootRef.value.getBoundingClientRect()
  W = r.width || 480
  H = r.height || 640
  renderer?.resize(W, H)
}

/** Push the current engine snapshot into the 3D scene and draw one frame. */
const renderFrame = () => {
  if (!renderer || !game) return
  const prog = status.value === 'playing' && !paused.value ? Math.min(1, accum / moveInterval) : 1
  try {
    renderer.setState(game, { prog, grewLast, status: status.value, time: timeSec })
    renderer.render()
  } catch {
    /* renderer hiccup — skip this frame, the loop keeps running */
  }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
const advance = () => {
  stepMove(game)
  grewLast = game.ateThisStep
  if (game.ateThisStep) {
    score.value = game.score
    if (score.value > best.value) {
      best.value = score.value
      isRecord.value = true
    }
    som.comer(game.score)
    buzz(12)
    moveInterval = game.interval / 1000
  }
  if (game.status === 'over') endGame()
}

const step = (dt) => {
  timeSec += dt
  if (status.value === 'playing' && !paused.value) {
    accum += dt
    let guard = 0
    while (accum >= moveInterval && status.value === 'playing' && guard < 4) {
      accum -= moveInterval
      advance()
      guard++
    }
  }

  const frac = game ? Math.min(1, game.score / 40) : 0
  som.nivelDoFundo(status.value === 'playing' && !paused.value ? 0.3 + frac * 0.7 : 0)

  renderFrame()
}

const tick = (now) => {
  if (!running) return
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0
  lastT = now
  step(dt)
  rafId = requestAnimationFrame(tick)
}

const startLoop = () => {
  if (running || !renderer) return
  running = true
  lastT = 0
  rafId = requestAnimationFrame(tick)
}

const stopLoop = () => {
  running = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

// ── Game flow ────────────────────────────────────────────────────────────────
const seenBefore = () => host.armazenamento.ler('seen') === '1'

const start = () => {
  startGame(game)
  status.value = 'playing'
  score.value = 0
  isRecord.value = false
  accum = 0
  grewLast = false
  moveInterval = game.interval / 1000
  showHint.value = !seenBefore()
  if (showHint.value) {
    later(() => (showHint.value = false), 4500)
    host.armazenamento.gravar('seen', '1')
  }
  som.ligarFundo()
  host.metricas.evento('game_start')
}

const endGame = () => {
  status.value = 'over'
  som.morrer()
  buzz([30, 60, 30])
  if (isRecord.value) persistScores()
  som.nivelDoFundo(0)
  host.metricas.evento('game_over', { score: game.score })
}

// ── Input ────────────────────────────────────────────────────────────────────
let swipeAnchor = null
const SWIPE_MIN = 22

const applyDir = (dir) => {
  if (status.value !== 'playing' || paused.value) return
  setDirection(game, dir)
}

const onPointerDown = (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (e.pointerType !== 'mouse') isTouch.value = true
  primeAudio()
  if (paused.value) {
    paused.value = false
    return
  }
  if (status.value === 'ready' || status.value === 'over') {
    start()
    return
  }
  swipeAnchor = { x: e.clientX, y: e.clientY }
}

const onPointerMove = (e) => {
  if (!swipeAnchor || status.value !== 'playing' || paused.value) return
  const dx = e.clientX - swipeAnchor.x
  const dy = e.clientY - swipeAnchor.y
  if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return
  if (Math.abs(dx) > Math.abs(dy)) applyDir(dx > 0 ? DIRS.right : DIRS.left)
  else applyDir(dy > 0 ? DIRS.down : DIRS.up)
  // re-anchor so a continuous drag can chain turns (draw a path with the finger)
  swipeAnchor = { x: e.clientX, y: e.clientY }
}

const onPointerUp = () => {
  swipeAnchor = null
}

const KEY_DIRS = {
  ArrowUp: DIRS.up,
  ArrowDown: DIRS.down,
  ArrowLeft: DIRS.left,
  ArrowRight: DIRS.right,
  w: DIRS.up,
  s: DIRS.down,
  a: DIRS.left,
  d: DIRS.right,
  W: DIRS.up,
  S: DIRS.down,
  A: DIRS.left,
  D: DIRS.right,
}

// Só a janela ativa ouve o teclado. O ouvinte é do `window`, então com duas
// janelas de jogo abertas a seta viraria as duas cobras; o `ativo` vem do host
// (a janela em foco, no RoqueOS).
const onKey = (e) => {
  if (!props.estado.ativo) return
  if (e.key === ' ' || e.key === 'Enter') {
    if (status.value === 'ready' || status.value === 'over') {
      e.preventDefault()
      primeAudio()
      start()
    } else if (status.value === 'playing') {
      paused.value = !paused.value
    }
    return
  }
  const dir = KEY_DIRS[e.key]
  if (!dir) return
  e.preventDefault()
  if (status.value === 'ready') {
    primeAudio()
    start()
    applyDir(dir)
    return
  }
  applyDir(dir)
}

// ── Persistence ──────────────────────────────────────────────────────────────
const loadLocal = () => {
  best.value = parseInt(host.armazenamento.ler('best'), 10) || 0
  muted.value = host.armazenamento.ler('muted') === '1'
}

const persistScores = () => {
  host.armazenamento.gravar('best', String(best.value))
  Promise.resolve()
    .then(() => host.placar.salvar({ best: best.value }))
    .catch(() => {})
}

// O placar da conta ganha do local quando é maior, e o local sobe quando é o
// maior. Convidado não tem placar na conta: o host devolve null no carregar e
// ignora o salvar, e o recorde dele fica só no armazenamento.
const syncRemote = async () => {
  try {
    const remoto = await host.placar.carregar()
    const daConta = Number(remoto?.best) || 0
    if (daConta > best.value) {
      best.value = daConta
      host.armazenamento.gravar('best', String(daConta))
    }
    if (best.value > daConta) await host.placar.salvar({ best: best.value })
  } catch (err) {
    console.error('[Snake] Score sync failed:', err)
  }
}

// ── Share ────────────────────────────────────────────────────────────────────
const composeShareCard = () => {
  const w = 1080
  const h = 1350
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#04120c')
  grad.addColorStop(1, '#0a1a24')
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  // Force a fresh frame so the WebGL buffer holds the current scene (the
  // renderer keeps preserveDrawingBuffer on) before we snapshot it.
  try {
    renderer?.render()
  } catch {
    /* best-effort */
  }
  if (canvasRef.value) {
    const src = canvasRef.value
    const scale = Math.min((w - 160) / src.width, 760 / src.height)
    g.drawImage(
      src,
      (w - src.width * scale) / 2,
      330 + (760 - src.height * scale) / 2,
      src.width * scale,
      src.height * scale,
    )
  }
  g.textAlign = 'center'
  g.fillStyle = 'rgba(255,255,255,0.82)'
  g.font = '600 44px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText(txt('score').toUpperCase(), w / 2, 150)
  g.fillStyle = '#ffffff'
  g.font = '200 300px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText(String(score.value), w / 2, 420)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = '700 52px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText(`${txt('title')} · RoqueOS`, w / 2, h - 120)
  g.fillStyle = 'rgba(255,255,255,0.65)'
  g.font = '400 36px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText('roqueos.com.br', w / 2, h - 62)
  return c
}

const shareScore = async () => {
  try {
    const text = txt('shareText', { score: score.value })
    const url = 'https://roqueos.com.br'
    let blob = null
    try {
      blob = await new Promise((res) => composeShareCard().toBlob(res, 'image/png'))
    } catch {
      blob = null
    }
    if (blob && navigator.share && navigator.canShare) {
      const file = new File([blob], 'snake-score.png', { type: 'image/png' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: txt('title') })
        return
      }
    }
    if (navigator.share) {
      await navigator.share({ text, url, title: txt('title') })
      return
    }
    if (blob) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'snake-score.png'
      a.click()
      later(() => URL.revokeObjectURL(a.href), 4000)
      host.avisar(txt('shareSaved'), { tipo: 'sucesso' })
    }
  } catch (err) {
    if (err?.name === 'AbortError') return
    console.error('[Snake] Share failed:', err)
    host.avisar(txt('operationFailed'), { tipo: 'erro' })
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
// Perder o foco pausa a partida e para o laço: janela de fundo não gasta GPU.
watch(
  () => props.estado.ativo,
  (ativo) => {
    if (!ativo) {
      if (status.value === 'playing') paused.value = true
      som.nivelDoFundo(0)
      stopLoop()
    } else {
      startLoop()
    }
  },
)

const onVisibility = () => {
  if (document.hidden) {
    if (status.value === 'playing') paused.value = true
    som.nivelDoFundo(0)
    stopLoop()
  } else if (props.estado.ativo) {
    startLoop()
  }
}

onMounted(() => {
  modoLeve.value = Boolean(host.desempenho.modoLeve())
  isTouch.value = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  loadLocal()
  game = createGame(Math.floor(Math.random() * 1e9) || 1, { best: best.value })
  renderer = createSnakeScene(canvasRef.value, { lowEnd: modoLeve.value })
  resize()
  syncRemote()
  // Quem entra na conta com o jogo aberto vê o recorde da conta sem reabrir.
  pararIdentidade = host.identidade.aoMudar(() => syncRemote())
  startLoop()

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(rootRef.value)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKey)

  if (emModoE2E()) {
    window.__snake = {
      get state() {
        return game
      },
      start,
      setDir: (name) => applyDir(DIRS[name]),
      step: () => advance(),
      // Cover aid: instantly lay a photogenic, tightly-coiled snake + food (no
      // death risk) — a long serpentine that snakes across several rows so the
      // cover reads as a lively, grown snake rather than a straight line.
      stage: () => {
        startGame(game)
        status.value = 'playing'
        const cols = game.cols
        const loLeft = 5
        const loRight = cols - 6 // ~9-wide serpentine band, centred
        const body = []
        let x = loRight
        let y = 6
        let dir = -1
        for (let i = 0; i < 28; i++) {
          body.push({ x, y })
          if ((dir === -1 && x <= loLeft) || (dir === 1 && x >= loRight)) {
            y += 1
            dir *= -1
          } else {
            x += dir
          }
        }
        game.snake = body
        game.dir = { ...DIRS.up }
        game.score = 25
        score.value = 25
        game.food = { x: loRight + 2, y: 4 }
        grewLast = false
        accum = 0
        moveInterval = 999 // freeze auto-advance so the cover frame stays put
      },
    }
  }
})

onUnmounted(() => {
  stopLoop()
  som.pararFundo()
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKey)
  resizeObserver?.disconnect()
  pararIdentidade?.()
  if (emModoE2E()) delete window.__snake
  renderer?.dispose()
  renderer = null
})
</script>

<style scoped lang="scss">
.ros-snake {
  // Os tokens do RoqueOS que o jogo usa. Cada um herda o do sistema quando ele
  // existe (o tema do RoqueOS continua alcançando o jogo) e cai no valor que o
  // tema padrão do RoqueOS dá hoje quando o jogo roda sozinho, porque fora do
  // RoqueOS não há `tokens-root.scss` nenhum carregado.
  --ros-snake-texto: var(--ros-text, rgba(255, 255, 255, 0.95));
  --ros-snake-texto-suave: var(--ros-text-muted, rgba(255, 255, 255, 0.72));
  --ros-snake-texto-100: var(--ros-text-100, rgb(255, 255, 255));
  --ros-snake-sombra-50: var(--ros-shadow-50, rgba(0, 0, 0, 0.5));
  --ros-snake-sombra-60: var(--ros-shadow-60, rgba(0, 0, 0, 0.6));
  --ros-snake-veu-30: var(--ros-scrim-30, rgba(0, 0, 0, 0.3));
  --ros-snake-veu-40: var(--ros-scrim-40, rgba(0, 0, 0, 0.4));
  --ros-snake-veu-50: var(--ros-scrim-50, rgba(0, 0, 0, 0.5));
  --ros-snake-veu-55: var(--ros-scrim-55, rgba(0, 0, 0, 0.55));
  --ros-snake-veu-70: var(--ros-scrim-70, rgba(0, 0, 0, 0.7));
  --ros-snake-preto-rgb: var(--ros-black-rgb, 0, 0, 0);
  --ros-snake-desfoque: var(--ros-backdrop-blur, blur(20px));
  // Cores de identidade do jogo, como custom property para que um tema
  // consiga alcançá-las.
  --ros-snake-bg-1: #74bdda;
  --ros-snake-bg-2: #4c93b0;
  --ros-snake-bg-3: #37718a;
  --ros-snake-bg-4: #4f8f73;
  --ros-snake-bg-5: #2f5f30;
  --ros-snake-fg-1: rgba(134, 239, 172, 0.85);
  --ros-snake-bg-6: #86efac;
  --ros-snake-bg-7: #22d3ee;
  --ros-snake-bg-8: #3b82f6;
  --ros-snake-shadow-1: rgba(34, 197, 94, 0.4);
  --ros-snake-bg-9: #22c55e;
  --ros-snake-bg-10: #16a34a;
  --ros-snake-shadow-2: rgba(34, 197, 94, 0.45);
}

.ros-snake {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  background: radial-gradient(
      130% 95% at 50% 6%,
      var(--ros-snake-bg-1) 0%,
      var(--ros-snake-bg-2) 34%,
      transparent 64%
    ),
    linear-gradient(
      180deg,
      var(--ros-snake-bg-3) 0%,
      var(--ros-snake-bg-4) 46%,
      var(--ros-snake-bg-5) 100%
    );

  &__canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  &__hud {
    position: absolute;
    top: 14px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    pointer-events: none;
  }

  &__score-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--ros-snake-fg-1);
  }

  &__score {
    font-size: 32px;
    font-weight: 800;
    line-height: 1;
    color: var(--ros-snake-texto);
    text-shadow: 0 2px 16px var(--ros-snake-sombra-50);
    font-variant-numeric: tabular-nums;
  }

  &__best-badge {
    position: absolute;
    top: 14px;
    left: 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ros-snake-texto-suave);
    background: var(--ros-snake-veu-30);
    padding: 4px 10px;
    border-radius: 999px;
    pointer-events: none;
  }

  &__top-actions {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    z-index: 5;

    @media (max-width: 768px) {
      top: 52px;
    }
  }

  &__icon-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(var(--ros-snake-preto-rgb), 0.32);
    color: var(--ros-snake-texto-suave);
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
      background: var(--ros-snake-veu-55);
      color: var(--ros-snake-texto);
    }
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  &__start {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: clamp(44px, 15%, 130px);
    pointer-events: none;
  }

  &__logo {
    font-size: clamp(44px, 12vw, 66px);
    font-weight: 800;
    letter-spacing: 12px;
    margin-left: 12px;
    background: linear-gradient(
      120deg,
      var(--ros-snake-bg-6) 5%,
      var(--ros-snake-bg-7) 55%,
      var(--ros-snake-bg-8) 95%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 26px var(--ros-snake-shadow-1));
  }

  &__tagline {
    margin-top: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--ros-snake-texto-suave);
    letter-spacing: 0.3px;
    text-align: center;
    padding: 0 26px;
  }

  &__start-best {
    margin-top: 22px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ros-snake-texto);
    background: var(--ros-snake-veu-30);
    padding: 6px 14px;
    border-radius: 999px;
  }

  &__cta {
    position: absolute;
    bottom: calc(16% + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--ros-snake-texto);
    animation: snake-pulse 1.6s ease-in-out infinite;
  }

  &__hint {
    position: absolute;
    bottom: calc(24px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: min(88%, 460px);
    text-align: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--ros-snake-texto);
    background: var(--ros-snake-veu-40);
    padding: 8px 16px;
    border-radius: 999px;
    pointer-events: none;
    animation: snake-pulse 2s ease-in-out infinite;
  }

  // ── Game over ───────────────────────────────────────────────────────────────
  &__over {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--ros-snake-veu-50);
    backdrop-filter: var(--ros-snake-desfoque);
    -webkit-backdrop-filter: var(--ros-snake-desfoque);
  }

  &__over-title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 1px;
    color: var(--ros-snake-texto-100);
    text-shadow: 0 2px 18px var(--ros-snake-sombra-60);
  }

  &__over-score {
    font-size: 78px;
    font-weight: 200;
    line-height: 1;
    color: var(--ros-snake-texto-100);
    font-variant-numeric: tabular-nums;
  }

  &__over-best {
    font-size: 14px;
    font-weight: 600;
    color: var(--ros-snake-texto-suave);
    margin-bottom: 12px;
  }

  &__retry {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 11px 24px;
    border: none;
    border-radius: 999px;
    background: linear-gradient(135deg, var(--ros-snake-bg-9), var(--ros-snake-bg-10));
    color: var(--ros-snake-texto-100);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 22px var(--ros-snake-shadow-2);
    transition: transform 0.15s ease;

    &:hover {
      transform: translateY(-2px);
    }
  }

  // ── Pause ───────────────────────────────────────────────────────────────────
  &__pause {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(var(--ros-snake-preto-rgb), 0.44);
    pointer-events: none;
  }

  &__pause-title {
    font-size: 26px;
    font-weight: 700;
    color: var(--ros-snake-texto);
    letter-spacing: 2px;
  }

  &__pause-cta {
    font-size: 14px;
    color: var(--ros-snake-texto-suave);
  }
}

@keyframes snake-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.snake-pop-enter-active {
  transition:
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.3s ease;
}

.snake-pop-enter-from {
  transform: scale(0.7);
  opacity: 0;
}

// O perfil leve vem do host (`desempenho.modoLeve`), não do atributo que o
// RoqueOS põe no <html>: fora do RoqueOS esse atributo não existe.
.ros-snake--low .ros-snake__over {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: var(--ros-snake-veu-70);
}
</style>
