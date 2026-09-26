/**
 * SNAKE 3D — pure geometry helpers (no Three.js, fully unit-testable).
 *
 * The 3D renderer (snake3d.js) turns the grid engine's state into a lush
 * third-person diorama. All the maths that decides *where* things sit in the
 * world lives here so it can be tested without a WebGL context: the grid→world
 * mapping, the interpolated body centre-line (buttery cell-to-cell motion), and
 * the camera framing that keeps the whole arena in view on any aspect ratio.
 */

// One grid cell = one world unit. The board is centred on the origin, laid on
// the ground plane (XZ); grid rows run along +Z (near the camera) to −Z (far).
export const CELL = 1

/** Grid cell (gx,gy) → world position on the ground ({x, z}); board centred. */
export function gridToWorld(gx, gy, cols, rows) {
  return {
    x: (gx - (cols - 1) / 2) * CELL,
    z: (gy - (rows - 1) / 2) * CELL,
  }
}

const lerp = (a, b, t) => a + (b - a) * t

/**
 * Interpolated centre-line of the snake in world space, at ride-height `y`.
 * `prog` (0..1) slides the head out of its previous cell and (unless the snake
 * grew this move) slides the tail out of its last cell — the same trick the 2D
 * game used for smooth motion, lifted into 3D. Returns [] for an empty body
 * (start screen) so the renderer draws nothing.
 */
export function buildCenterline(snake, prog, grewLast, cols, rows, y = 0) {
  const s = snake
  if (!s || !s.length) return []
  const P = (gx, gy) => {
    const w = gridToWorld(gx, gy, cols, rows)
    return { x: w.x, y, z: w.z }
  }
  const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y, z: lerp(a.z, b.z, t) })
  if (s.length < 2) return [P(s[0].x, s[0].y)]

  const pts = []
  // Head tip slides from the neck cell toward the current head cell.
  pts.push(mix(P(s[1].x, s[1].y), P(s[0].x, s[0].y), prog))
  for (let i = 1; i < s.length - 1; i++) pts.push(P(s[i].x, s[i].y))
  const last = s[s.length - 1]
  const prev = s[s.length - 2]
  pts.push(grewLast ? P(last.x, last.y) : mix(P(last.x, last.y), P(prev.x, prev.y), prog))
  return pts
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Camera framing for the tilted diorama. Returns the world-space `position` and
 * `look` target plus `near`/`far`, computed so the whole board fits for the
 * given aspect (pulls back on narrow/portrait viewports). Pure — the renderer
 * just copies the numbers onto its PerspectiveCamera. `headBias` gently sways
 * the look target toward the head ({x,z} in world units) without letting the
 * board leave frame.
 */
export function frameCamera(cols, rows, aspect, fovDeg = 42, headBias = null) {
  const a = aspect > 0 ? aspect : 1
  const fovV = (fovDeg * Math.PI) / 180
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * a)
  // Bounding radius of the board on the ground.
  const R = Math.hypot((cols * CELL) / 2, (rows * CELL) / 2)
  // Distance so the board fits the tighter of the two half-angles. The board is
  // tilted away from the camera so its ground footprint foreshortens — a margin
  // below 1 lets it fill the frame without clipping the near/far rows.
  const dist = (R / Math.tan(Math.min(fovV, fovH) / 2)) * 0.86
  const tilt = 0.86 // ~49° above the ground → dramatic but readable perspective
  const swayX = headBias ? clamp(headBias.x, -R * 0.18, R * 0.18) * 0.35 : 0
  const swayZ = headBias ? clamp(headBias.z, -R * 0.18, R * 0.18) * 0.35 : 0
  return {
    position: {
      x: swayX,
      y: Math.sin(tilt) * dist,
      z: Math.cos(tilt) * dist + R * 0.12,
    },
    look: { x: swayX, y: 0, z: swayZ - R * 0.04 },
    near: Math.max(0.1, dist * 0.05),
    far: dist * 4,
  }
}
