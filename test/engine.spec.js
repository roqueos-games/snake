import { describe, it, expect } from 'vitest'
import {
  mulberry32,
  DIRS,
  intervalForScore,
  BASE_INTERVAL,
  MIN_INTERVAL,
  isReverse,
  placeFood,
  createGame,
  startGame,
  setDirection,
  stepMove,
  isOver,
  sameCell,
} from '../src/engine.js'

const play = (seed = 7, opts) => startGame(createGame(seed, opts))

describe('snake/engine — determinism', () => {
  it('same seed → identical food sequence', () => {
    const a = play(42)
    const b = play(42)
    expect(a.food).toEqual(b.food)
    // Eat-independent: driving the same inputs yields the same food again.
    setDirection(a, DIRS.up)
    setDirection(b, DIRS.up)
    stepMove(a)
    stepMove(b)
    expect(a.snake).toEqual(b.snake)
  })

  it('mulberry32 is stable for a seed', () => {
    const r = mulberry32(1)
    const seq = [r(), r(), r()]
    const r2 = mulberry32(1)
    expect([r2(), r2(), r2()]).toEqual(seq)
  })
})

describe('snake/engine — start', () => {
  it('spawns a 3-cell snake heading right with food placed off-body', () => {
    const s = play(3)
    expect(s.status).toBe('playing')
    expect(s.snake).toHaveLength(3)
    expect(s.dir).toEqual(DIRS.right)
    expect(s.food).toBeTruthy()
    expect(s.snake.some((seg) => sameCell(seg, s.food))).toBe(false)
  })
})

describe('snake/engine — direction rules', () => {
  it('rejects a direct 180° reversal', () => {
    const s = play()
    // moving right → cannot go left
    setDirection(s, DIRS.left)
    expect(s.queue).toHaveLength(0)
  })

  it('accepts a legal turn and buffers up to two', () => {
    const s = play()
    setDirection(s, DIRS.up)
    setDirection(s, DIRS.left)
    expect(s.queue).toHaveLength(2)
    // third is ignored (buffer full)
    setDirection(s, DIRS.down)
    expect(s.queue).toHaveLength(2)
  })

  it('reversal check honors the last queued dir, not just committed', () => {
    const s = play()
    setDirection(s, DIRS.up) // now facing up in the buffer
    setDirection(s, DIRS.down) // 180° vs queued up → rejected
    expect(s.queue).toHaveLength(1)
  })

  it('isReverse detects opposites only', () => {
    expect(isReverse(DIRS.right, DIRS.left)).toBe(true)
    expect(isReverse(DIRS.up, DIRS.down)).toBe(true)
    expect(isReverse(DIRS.up, DIRS.left)).toBe(false)
  })
})

describe('snake/engine — movement + growth', () => {
  it('advances one cell per step and keeps length without food', () => {
    const s = play()
    const len = s.snake.length
    const hx = s.snake[0].x
    stepMove(s)
    expect(s.snake[0].x).toBe(hx + 1)
    expect(s.snake).toHaveLength(len)
    expect(s.moves).toBe(1)
  })

  it('grows and scores when eating, and never leaves food on the body', () => {
    const s = play()
    // Force food directly in front of the head so the next step eats it.
    const head = s.snake[0]
    s.food = { x: head.x + 1, y: head.y }
    stepMove(s)
    expect(s.score).toBe(1)
    expect(s.ateThisStep).toBe(true)
    expect(s.snake).toHaveLength(4) // grew by one
    expect(s.food).toBeTruthy()
    expect(s.snake.some((seg) => sameCell(seg, s.food))).toBe(false)
  })

  it('speeds up as the score climbs (interval shrinks, clamped)', () => {
    expect(intervalForScore(0)).toBe(BASE_INTERVAL)
    expect(intervalForScore(4)).toBeLessThan(BASE_INTERVAL)
    expect(intervalForScore(999)).toBe(MIN_INTERVAL)
  })
})

describe('snake/engine — death', () => {
  it('ends on a wall hit', () => {
    const s = play(1, { cols: 6, rows: 6 })
    // Drive up into the top wall.
    setDirection(s, DIRS.up)
    for (let i = 0; i < 10 && !isOver(s); i++) stepMove(s)
    expect(s.status).toBe('over')
  })

  it('ends on a self-bite', () => {
    const s = play()
    // A length-5 horizontal snake (short snakes can't bite — the tail always
    // vacates). A U-turn up→left→down folds the head back into the body.
    s.snake = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ]
    s.dir = { ...DIRS.right }
    s.food = { x: 0, y: 0 }
    setDirection(s, DIRS.up)
    stepMove(s)
    setDirection(s, DIRS.left)
    stepMove(s)
    setDirection(s, DIRS.down)
    stepMove(s)
    expect(s.status).toBe('over')
  })

  it('does not move once over', () => {
    const s = play(1, { cols: 5, rows: 5 })
    setDirection(s, DIRS.up)
    for (let i = 0; i < 10; i++) stepMove(s)
    const frozen = JSON.stringify(s.snake)
    stepMove(s)
    expect(JSON.stringify(s.snake)).toBe(frozen)
  })
})

describe('snake/engine — placeFood', () => {
  it('never returns an occupied cell and is null when full', () => {
    const rng = mulberry32(5)
    const snake = []
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) snake.push({ x, y })
    expect(placeFood(2, 2, snake, rng)).toBeNull()
    const f = placeFood(3, 3, snake, rng)
    expect(f).toBeTruthy()
    expect(snake.some((s) => sameCell(s, f))).toBe(false)
  })
})

describe('snake/engine — best score', () => {
  it('tracks the best across the run', () => {
    const s = play()
    const head = s.snake[0]
    s.food = { x: head.x + 1, y: head.y }
    stepMove(s)
    expect(s.best).toBe(1)
  })
})
