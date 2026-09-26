import { describe, it, expect } from 'vitest'
import { CELL, gridToWorld, buildCenterline, frameCamera } from '../src/cena3dGeometria.js'

describe('snake3dGeometry — gridToWorld', () => {
  it('centres the board on the origin', () => {
    // 20×20 board: the centre pair of cells straddles x=z=0.
    const a = gridToWorld(9, 9, 20, 20)
    const b = gridToWorld(10, 10, 20, 20)
    expect(a.x).toBeCloseTo(-0.5 * CELL)
    expect(b.x).toBeCloseTo(0.5 * CELL)
    expect(a.z).toBeCloseTo(-0.5 * CELL)
    expect(b.z).toBeCloseTo(0.5 * CELL)
  })

  it('maps opposite corners symmetrically', () => {
    const tl = gridToWorld(0, 0, 20, 20)
    const br = gridToWorld(19, 19, 20, 20)
    expect(tl.x).toBeCloseTo(-br.x)
    expect(tl.z).toBeCloseTo(-br.z)
    // top row (gy=0) is the far side (−Z), bottom row (gy=rows-1) is near (+Z)
    expect(tl.z).toBeLessThan(br.z)
  })
})

describe('snake3dGeometry — buildCenterline', () => {
  const cols = 20
  const rows = 20

  it('returns [] for an empty body (start screen)', () => {
    expect(buildCenterline([], 0.5, false, cols, rows)).toEqual([])
    expect(buildCenterline(null, 0.5, false, cols, rows)).toEqual([])
  })

  it('returns a single point for a one-segment body', () => {
    const pts = buildCenterline([{ x: 5, y: 5 }], 0.5, false, cols, rows, 0.4)
    expect(pts).toHaveLength(1)
    expect(pts[0].y).toBe(0.4)
  })

  it('slides the head from the neck cell toward the head cell by prog', () => {
    // head at (11,10), neck at (10,10): heading +X (right).
    const snake = [
      { x: 11, y: 10 },
      { x: 10, y: 10 },
      { x: 9, y: 10 },
    ]
    const half = buildCenterline(snake, 0.5, false, cols, rows)
    const neckW = gridToWorld(10, 10, cols, rows)
    const headW = gridToWorld(11, 10, cols, rows)
    // the leading point sits halfway between the neck and head cells
    expect(half[0].x).toBeCloseTo((neckW.x + headW.x) / 2)
    // at prog=1 the head reaches its cell
    const full = buildCenterline(snake, 1, false, cols, rows)
    expect(full[0].x).toBeCloseTo(headW.x)
  })

  it('holds the tail in place while growing (grewLast), else slides it out', () => {
    const snake = [
      { x: 11, y: 10 },
      { x: 10, y: 10 },
      { x: 9, y: 10 },
    ]
    const lastW = gridToWorld(9, 10, cols, rows)
    const prevW = gridToWorld(10, 10, cols, rows)
    const grew = buildCenterline(snake, 0.5, true, cols, rows)
    expect(grew[grew.length - 1].x).toBeCloseTo(lastW.x) // stays put
    const moved = buildCenterline(snake, 0.5, false, cols, rows)
    expect(moved[moved.length - 1].x).toBeCloseTo((lastW.x + prevW.x) / 2) // slides
  })

  it('emits one point per body segment (head + middles + tail)', () => {
    const snake = Array.from({ length: 6 }, (_, i) => ({ x: 10 - i, y: 10 }))
    expect(buildCenterline(snake, 0.3, false, cols, rows)).toHaveLength(6)
  })
})

describe('snake3dGeometry — frameCamera', () => {
  it('keeps the camera above and in front, looking at the board', () => {
    const f = frameCamera(20, 20, 16 / 9)
    expect(f.position.y).toBeGreaterThan(0) // above the ground
    expect(f.position.z).toBeGreaterThan(0) // in front (+Z, near side)
    expect(f.far).toBeGreaterThan(f.near)
    expect(Number.isFinite(f.position.y)).toBe(true)
  })

  it('pulls the camera further back on a narrower (portrait) aspect', () => {
    const wide = frameCamera(20, 20, 1.6)
    const tall = frameCamera(20, 20, 0.5)
    const dist = (f) => Math.hypot(f.position.x, f.position.y, f.position.z)
    expect(dist(tall)).toBeGreaterThan(dist(wide))
  })

  it('sways the look target toward the head but stays bounded', () => {
    const base = frameCamera(20, 20, 1.6)
    const biased = frameCamera(20, 20, 1.6, 42, { x: 8, z: -8 })
    expect(biased.look.x).not.toBeCloseTo(base.look.x)
    // the sway is a fraction of the board, never a wild jump
    expect(Math.abs(biased.look.x)).toBeLessThan(10)
  })
})

describe('snake3dGeometry — a câmera antes de o canvas ter tamanho', () => {
  /**
   * `aspect` chega do canvas, e o canvas mede 0 no primeiro quadro, antes do
   * layout. `aspect > 0 ? aspect : 1` é o que segura isso: com `>=`, o zero
   * passa, o campo de visão horizontal vira 0, a distância vira Infinity e a
   * cena inteira some no primeiro quadro.
   */
  it('trata aspecto zero como quadrado em vez de mandar a câmera ao infinito', () => {
    const zero = frameCamera(20, 20, 0)
    const um = frameCamera(20, 20, 1)
    expect(Number.isFinite(zero.position.x)).toBe(true)
    expect(Number.isFinite(zero.position.y)).toBe(true)
    expect(Number.isFinite(zero.position.z)).toBe(true)
    expect(zero).toEqual(um)
  })

  it('aspecto negativo cai na mesma proteção', () => {
    expect(frameCamera(20, 20, -2)).toEqual(frameCamera(20, 20, 1))
  })
})
