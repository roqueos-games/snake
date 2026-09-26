/**
 * SNAKE — pure, deterministic engine for the RoqueOS Games gallery.
 *
 * Grid-based classic snake with a modern feel: a move advances the head one
 * cell in the current direction; eating food grows the tail and speeds the
 * board up; the run ends on a wall or a self-bite. Everything here is framework-
 * free and seed-deterministic (mulberry32) so it's fully unit-testable and the
 * cover-capture bot can drive a reproducible frame.
 *
 * The component owns rendering, sound and the animation loop — it calls
 * `stepMove` once per move interval (which shrinks with score) and interpolates
 * cell-to-cell for buttery motion. No Vue / DOM / timers in here.
 */

// Deterministic PRNG (shared shape with the other native-game engines).
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

export const DEFAULT_COLS = 20
export const DEFAULT_ROWS = 20

// Move interval (ms) ramps from slow → fast as the score climbs. Pure so the
// component and tests agree on difficulty.
export const BASE_INTERVAL = 150
export const MIN_INTERVAL = 62
export function intervalForScore(score) {
  // Every food shaves the interval; clamp so it never becomes unplayable.
  const i = BASE_INTERVAL - Math.floor(score / 2) * 6
  return Math.max(MIN_INTERVAL, i)
}

export const cellKey = (x, y) => `${x},${y}`
export const sameCell = (a, b) => a.x === b.x && a.y === b.y

/** True when `dir` reverses `current` (illegal — would bite the neck). */
export function isReverse(current, dir) {
  return current.x + dir.x === 0 && current.y + dir.y === 0
}

/** Pick a food cell from the free (non-snake) cells, deterministically. */
export function placeFood(cols, rows, snake, rng) {
  const occupied = new Set(snake.map((s) => cellKey(s.x, s.y)))
  const free = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!occupied.has(cellKey(x, y))) free.push({ x, y })
    }
  }
  if (!free.length) return null // board full → win/impossible
  const idx = Math.floor(rng() * free.length)
  return free[idx]
}

export function createGame(seed = 1, opts = {}) {
  const cols = opts.cols || DEFAULT_COLS
  const rows = opts.rows || DEFAULT_ROWS
  return {
    status: 'idle', // 'idle' | 'playing' | 'over'
    seed: seed >>> 0,
    cols,
    rows,
    snake: [],
    dir: { ...DIRS.right },
    queue: [], // buffered direction inputs (≤2), applied one per move
    food: null,
    score: 0,
    best: opts.best || 0,
    moves: 0,
    grow: 0, // pending tail-growth segments
    interval: BASE_INTERVAL,
    ateThisStep: false,
    rng: mulberry32(seed),
  }
}

export function startGame(state) {
  const cx = Math.floor(state.cols / 2)
  const cy = Math.floor(state.rows / 2)
  state.rng = mulberry32(state.seed)
  state.snake = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ]
  state.dir = { ...DIRS.right }
  state.queue = []
  state.score = 0
  state.moves = 0
  state.grow = 0
  state.interval = BASE_INTERVAL
  state.ateThisStep = false
  state.food = placeFood(state.cols, state.rows, state.snake, state.rng)
  state.status = 'playing'
  return state
}

/**
 * Queue a direction change. Rejects a direct 180° reversal against the last
 * *committed or queued* direction (so a quick two-tap can't fold the snake).
 * Buffers up to 2 turns for responsive cornering.
 */
export function setDirection(state, dir) {
  if (state.status !== 'playing' || !dir) return state
  const ref = state.queue.length ? state.queue[state.queue.length - 1] : state.dir
  if (isReverse(ref, dir)) return state
  if (state.queue.length >= 2) return state
  // Ignore a no-op (same as reference) so the buffer stays meaningful.
  if (ref.x === dir.x && ref.y === dir.y) return state
  state.queue.push({ ...dir })
  return state
}

/** Advance the snake by exactly one cell. Returns the mutated state. */
export function stepMove(state) {
  if (state.status !== 'playing') return state
  state.ateThisStep = false
  if (state.queue.length) state.dir = state.queue.shift()

  const head = state.snake[0]
  const nx = head.x + state.dir.x
  const ny = head.y + state.dir.y

  // Wall collision (classic — no wrap).
  if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) {
    state.status = 'over'
    return state
  }

  // Self collision. The current tail cell is free *unless* we're growing this
  // move (ate last step), because the tail won't move out.
  const willGrow = state.grow > 0
  const body = willGrow ? state.snake : state.snake.slice(0, -1)
  for (const seg of body) {
    if (seg.x === nx && seg.y === ny) {
      state.status = 'over'
      return state
    }
  }

  state.snake.unshift({ x: nx, y: ny })
  if (state.food && nx === state.food.x && ny === state.food.y) {
    state.score += 1
    state.grow += 1
    state.ateThisStep = true
    state.food = placeFood(state.cols, state.rows, state.snake, state.rng)
    state.interval = intervalForScore(state.score)
    if (!state.food) {
      // Board fully filled — a perfect run.
      state.status = 'over'
    }
  }

  if (state.grow > 0) {
    state.grow -= 1
  } else {
    state.snake.pop()
  }

  state.moves += 1
  if (state.score > state.best) state.best = state.score
  return state
}

export const isOver = (state) => state.status === 'over'
