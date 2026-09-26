/**
 * SNAKE 3D — Three.js diorama renderer over the pure grid engine.
 *
 * A premium, fixed-angle arena: a dark polished board with a subtly-lit grid and
 * a metal frame, viewed from a steady 3/4 camera that keeps the WHOLE board in
 * frame (no head-following sway). A glossy emerald tube-snake slithers and casts
 * soft shadows, and the food is a glowing faceted gem that lights the board
 * around it. The engine (src/utils/snake/engine.js) stays the source of truth;
 * this only renders a snapshot of its state each frame.
 *
 * Defensive by design: the whole scene build is wrapped so a missing WebGL
 * context (jsdom / a starved GPU) degrades to a no-op renderer — the component's
 * game logic and overlays keep working. Geometry maths lives in the pure,
 * unit-tested snake3dGeometry.js.
 */
import * as THREE from 'three'
import { buildCenterline, frameCamera, gridToWorld, CELL } from './cena3dGeometria.js'

const NOOP = {
  ok: false,
  setState() {},
  resize() {},
  render() {},
  dispose() {},
  posicoesParaTeste: () => null,
}

// ── Procedural textures ──────────────────────────────────────────────────────
// Dark polished board with a faint grid — reads the cells without shouting.
function boardTexture(cols, rows) {
  const cell = 32
  const cv = document.createElement('canvas')
  cv.width = cols * cell
  cv.height = rows * cell
  const g = cv.getContext('2d')
  if (!g) return null
  const grad = g.createRadialGradient(
    cv.width / 2,
    cv.height / 2,
    cv.width * 0.1,
    cv.width / 2,
    cv.height / 2,
    cv.width * 0.72,
  )
  grad.addColorStop(0, '#37425a')
  grad.addColorStop(1, '#1d2536')
  g.fillStyle = grad
  g.fillRect(0, 0, cv.width, cv.height)
  // checker so cells are legible
  g.fillStyle = 'rgba(255,255,255,0.04)'
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) if ((x + y) % 2 === 0) g.fillRect(x * cell, y * cell, cell, cell)
  // hairline grid, soft cyan
  g.strokeStyle = 'rgba(150,220,240,0.22)'
  g.lineWidth = 1
  for (let x = 0; x <= cols; x++) {
    g.beginPath()
    g.moveTo(x * cell + 0.5, 0)
    g.lineTo(x * cell + 0.5, cv.height)
    g.stroke()
  }
  for (let y = 0; y <= rows; y++) {
    g.beginPath()
    g.moveTo(0, y * cell + 0.5)
    g.lineTo(cv.width, y * cell + 0.5)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function scalesTexture() {
  const w = 128
  const h = 64
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')
  if (!g) return null
  const grad = g.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#0f5a2a') // deep jade back
  grad.addColorStop(0.42, '#229a44')
  grad.addColorStop(0.78, '#5fd873')
  grad.addColorStop(1, '#c8f0b0') // pale belly
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  const rows = 8
  const cols = 12
  const rh = h / rows
  const cw = w / cols
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const cx = c * cw + (r % 2 ? cw / 2 : 0)
      const cy = r * rh + rh * 0.7
      g.beginPath()
      g.arc(cx, cy, cw * 0.62, Math.PI * 1.05, Math.PI * 1.95)
      g.strokeStyle = 'rgba(10,50,14,0.5)'
      g.lineWidth = 1.4
      g.stroke()
      g.beginPath()
      g.arc(cx, cy - 1, cw * 0.5, Math.PI * 1.1, Math.PI * 1.9)
      g.strokeStyle = 'rgba(220,255,190,0.3)'
      g.lineWidth = 1
      g.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createSnakeScene(canvas, { lowEnd = false } = {}) {
  if (!canvas) return NOOP
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowEnd,
      alpha: true,
      preserveDrawingBuffer: true, // so the share card can snapshot the frame
    })
  } catch {
    return NOOP
  }

  try {
    renderer.setClearColor(0x000000, 0)
    if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace
    try {
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
    } catch {
      /* stub — no tone mapping */
    }
    if (!lowEnd) {
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
    }

    const scene = new THREE.Scene()

    // Premium backdrop — a soft radial glow behind the arena so the frame reads
    // like a spotlit stage instead of a black void.
    let bgTex = null
    try {
      const bcv = document.createElement('canvas')
      bcv.width = bcv.height = 256
      const bg = bcv.getContext('2d')
      if (bg) {
        const rad = bg.createRadialGradient(128, 96, 20, 128, 128, 190)
        rad.addColorStop(0, '#2b3550')
        rad.addColorStop(0.45, '#151b2b')
        rad.addColorStop(1, '#070910')
        bg.fillStyle = rad
        bg.fillRect(0, 0, 256, 256)
        bgTex = new THREE.CanvasTexture(bcv)
        if (THREE.SRGBColorSpace) bgTex.colorSpace = THREE.SRGBColorSpace
        scene.background = bgTex
      }
    } catch {
      /* stub — leave transparent */
    }

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260)
    scene.add(camera)

    // Soft studio reflections on the glossy board + snake (skipped on the stub).
    try {
      const gcv = document.createElement('canvas')
      gcv.width = 16
      gcv.height = 64
      const gg = gcv.getContext('2d')
      const grd = gg.createLinearGradient(0, 0, 0, 64)
      grd.addColorStop(0, '#3a4a63')
      grd.addColorStop(0.5, '#20293a')
      grd.addColorStop(1, '#090c14')
      gg.fillStyle = grd
      gg.fillRect(0, 0, 16, 64)
      const envTex = new THREE.CanvasTexture(gcv)
      envTex.mapping = THREE.EquirectangularReflectionMapping
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromEquirectangular(envTex).texture
      pmrem.dispose()
      envTex.dispose()
    } catch {
      /* stub / unsupported — direct lights still render */
    }

    // ── Lights — cool key + warm rim over a dark arena ──────────────────────────
    scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x14203a, 0.75))
    scene.add(new THREE.AmbientLight(0xffffff, 0.22))
    const key = new THREE.DirectionalLight(0xfff2dc, 2.2)
    key.position.set(-8, 17, 9)
    if (!lowEnd) {
      key.castShadow = true
      key.shadow.mapSize.set(2048, 2048)
      const sc = key.shadow.camera
      sc.left = -16
      sc.right = 16
      sc.top = 16
      sc.bottom = -16
      sc.near = 1
      sc.far = 52
      key.shadow.bias = -0.0004
    }
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x7fc0ff, 0.9)
    rim.position.set(9, 6, -11)
    scene.add(rim)
    // soft front fill so the board + snake never sink into darkness
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.5)
    fill.position.set(3, 8, 14)
    scene.add(fill)

    let cols = 20
    let rows = 20

    // ── Dark reflective floor (catches soft shadow + a hint of the board) ───────
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      lowEnd
        ? new THREE.MeshLambertMaterial({ color: 0x0a0d13 })
        : new THREE.MeshStandardMaterial({
            color: 0x0a0d13,
            roughness: 0.55,
            metalness: 0.4,
            envMapIntensity: 0.5,
          }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.35
    floor.receiveShadow = !lowEnd
    scene.add(floor)

    // ── Board (polished slab + grid top) inside a metal frame ───────────────────
    const boardGroup = new THREE.Group()
    scene.add(boardGroup)
    let boardTex = boardTexture(cols, rows)
    const boardTopMat = lowEnd
      ? new THREE.MeshLambertMaterial({ map: boardTex, color: boardTex ? 0xffffff : 0x1a1e28 })
      : new THREE.MeshStandardMaterial({
          map: boardTex,
          color: 0xffffff,
          roughness: 0.36,
          metalness: 0.5,
          envMapIntensity: 0.9,
        })
    const boardTop = new THREE.Mesh(new THREE.PlaneGeometry(cols * CELL, rows * CELL), boardTopMat)
    boardTop.rotation.x = -Math.PI / 2
    boardTop.position.y = 0
    boardTop.receiveShadow = !lowEnd
    boardGroup.add(boardTop)
    // slab underneath for thickness
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(cols * CELL, 0.5, rows * CELL),
      new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.7, metalness: 0.3 }),
    )
    slab.position.y = -0.26
    slab.receiveShadow = !lowEnd
    boardGroup.add(slab)
    // metal frame rails around the edge
    const frameMat = lowEnd
      ? new THREE.MeshLambertMaterial({ color: 0x2a2f3a })
      : new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.34, metalness: 0.85 })
    const halfW = (cols * CELL) / 2
    const halfD = (rows * CELL) / 2
    const railT = 0.32
    const railH = 0.42
    const addRail = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, railH, d), frameMat)
      m.position.set(x, railH / 2 - 0.28, z)
      m.castShadow = !lowEnd
      m.receiveShadow = !lowEnd
      boardGroup.add(m)
    }
    const span = 2 * halfW + railT * 2
    addRail(span, railT, 0, -halfD - railT / 2)
    addRail(span, railT, 0, halfD + railT / 2)
    addRail(railT, 2 * halfD, -halfW - railT / 2, 0)
    addRail(railT, 2 * halfD, halfW + railT / 2, 0)

    // ── Snake ───────────────────────────────────────────────────────────────────
    const bodyRadius = CELL * 0.42
    const scalesTex = scalesTexture()
    const bodyMat = lowEnd
      ? new THREE.MeshLambertMaterial({ map: scalesTex, color: scalesTex ? 0xffffff : 0x3fb84a })
      : new THREE.MeshPhysicalMaterial({
          map: scalesTex,
          color: 0xffffff,
          roughness: 0.2,
          metalness: 0.12,
          clearcoat: 1,
          clearcoatRoughness: 0.1,
          sheen: 1,
          sheenColor: new THREE.Color(0x9effc9),
          sheenRoughness: 0.35,
          iridescence: 0.35,
          iridescenceIOR: 1.35,
          emissive: new THREE.Color(0x145a24),
          emissiveIntensity: 0.55,
          envMapIntensity: 1.5,
        })
    const deadColor = new THREE.Color(0xc0504a)
    const liveColor = new THREE.Color(0xffffff)
    const radial = lowEnd ? 7 : 14
    if (bodyMat.side !== undefined) bodyMat.side = THREE.DoubleSide

    const snakeGroup = new THREE.Group()
    scene.add(snakeGroup)
    let tubeMesh = null

    const head = new THREE.Group()
    const snout = new THREE.Mesh(
      new THREE.SphereGeometry(bodyRadius * 1.28, lowEnd ? 12 : 22, lowEnd ? 10 : 18),
      bodyMat,
    )
    snout.scale.set(1, 0.86, 1.25)
    snout.castShadow = !lowEnd
    head.add(snout)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.3 })
    const eyeHi = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      emissive: 0x333333,
    })
    for (const sgn of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(bodyRadius * 0.3, 12, 10), eyeMat)
      eye.position.set(sgn * bodyRadius * 0.55, bodyRadius * 0.4, bodyRadius * 0.55)
      head.add(eye)
      const hi = new THREE.Mesh(new THREE.SphereGeometry(bodyRadius * 0.1, 8, 8), eyeHi)
      hi.position.set(sgn * bodyRadius * 0.5, bodyRadius * 0.5, bodyRadius * 0.72)
      head.add(hi)
    }
    const tongueMat = new THREE.MeshBasicMaterial({ color: 0xff3b6b })
    const tongue = new THREE.Group()
    for (const sgn of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.3), tongueMat)
      fork.position.set(sgn * 0.06, 0, bodyRadius * 1.35 + 0.12)
      fork.rotation.y = sgn * 0.3
      tongue.add(fork)
    }
    head.add(tongue)
    snakeGroup.add(head)

    const tailLen = bodyRadius * 2.8
    const tailGeo = new THREE.ConeGeometry(bodyRadius * 1.04, tailLen, radial, 1)
    tailGeo.rotateX?.(Math.PI / 2)
    const tail = new THREE.Mesh(tailGeo, bodyMat)
    tail.castShadow = !lowEnd
    tail.visible = false
    snakeGroup.add(tail)

    // ── Food: a glowing faceted gem that lights the board around it ─────────────
    const gem = new THREE.Group()
    const gemMat = lowEnd
      ? new THREE.MeshLambertMaterial({ color: 0xffc247, emissive: 0xff8a00 })
      : new THREE.MeshPhysicalMaterial({
          color: 0xffd36b,
          roughness: 0.12,
          metalness: 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          emissive: new THREE.Color(0xff8a1e),
          emissiveIntensity: 0.9,
          envMapIntensity: 1.2,
        })
    const gemBody = new THREE.Mesh(new THREE.IcosahedronGeometry(CELL * 0.4, 0), gemMat)
    gemBody.castShadow = !lowEnd
    gem.add(gemBody)
    const gemGlow = new THREE.PointLight(0xffb84a, lowEnd ? 0 : 1.6, 6, 2)
    gem.add(gemGlow)
    gem.visible = false
    scene.add(gem)

    // ── Eat sparkles — glowing motes that burst when the snake feeds ─────────────
    const sparks = []
    const sparkGeo = new THREE.SphereGeometry(0.13, 8, 8)
    const sparkGroup = new THREE.Group()
    scene.add(sparkGroup)
    for (let i = 0; i < (lowEnd ? 0 : 16); i++) {
      const m = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd27a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      m.visible = false
      m.userData = { life: 0, vx: 0, vy: 0, vz: 0 }
      sparkGroup.add(m)
      sparks.push(m)
    }
    const burstSparks = (x, y, z) => {
      for (const m of sparks) {
        const a = Math.random() * Math.PI * 2
        const sp = 1.4 + Math.random() * 2.4
        m.visible = true
        m.position.set(x, y, z)
        m.scale.setScalar(0.5 + Math.random() * 0.9)
        m.userData.life = 1
        m.userData.vx = Math.cos(a) * sp
        m.userData.vz = Math.sin(a) * sp
        m.userData.vy = 1.8 + Math.random() * 2.4
      }
    }
    let lastFoodKey = null
    let lastTime = 0
    let composer = null // set async when bloom loads (below)

    // ── State plumbing ──────────────────────────────────────────────────────────
    let W = 480
    let H = 640

    // Fixed framing — the whole board stays in view; NO head-follow sway. Pull
    // ~15% closer than the exact fit so the board fills the frame (premium).
    const applyFraming = () => {
      const f = frameCamera(cols, rows, W / Math.max(1, H), 42, null)
      const k = 0.85
      camera.position.set(
        f.look.x + (f.position.x - f.look.x) * k,
        f.look.y + (f.position.y - f.look.y) * k,
        f.look.z + (f.position.z - f.look.z) * k,
      )
      camera.near = f.near
      camera.far = f.far
      camera.lookAt(f.look.x, f.look.y, f.look.z)
      camera.updateProjectionMatrix()
    }

    const rebuildBoard = () => {
      boardTex?.dispose?.()
      boardTex = boardTexture(cols, rows)
      if (boardTopMat.map !== undefined) boardTopMat.map = boardTex
      boardTop.geometry?.dispose?.()
      boardTop.geometry = new THREE.PlaneGeometry(cols * CELL, rows * CELL)
      slab.geometry?.dispose?.()
      slab.geometry = new THREE.BoxGeometry(cols * CELL, 0.5, rows * CELL)
    }

    const resize = (w, h) => {
      W = w || W
      H = h || H
      const dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2)
      renderer.setPixelRatio(dpr)
      renderer.setSize(W, H, false)
      camera.aspect = W / Math.max(1, H)
      applyFraming()
      try {
        composer?.setSize(W, H)
      } catch {
        /* best-effort */
      }
    }

    const disposeTube = () => {
      if (tubeMesh) {
        snakeGroup.remove(tubeMesh)
        tubeMesh.geometry?.dispose?.()
        tubeMesh = null
      }
    }

    const setState = (game, opts = {}) => {
      if (!game) return
      if (game.cols !== cols || game.rows !== rows) {
        cols = game.cols
        rows = game.rows
        rebuildBoard()
        applyFraming()
      }
      const prog = opts.prog == null ? 1 : opts.prog
      const grewLast = !!opts.grewLast
      const time = opts.time || 0
      const dead = opts.status === 'over'
      let headWorld = null

      if (bodyMat.color) bodyMat.color.copy(dead ? deadColor : liveColor)

      const pts = buildCenterline(game.snake, prog, grewLast, cols, rows, bodyRadius)
      disposeTube()
      if (pts.length >= 2) {
        const amp = dead ? 0 : 0.07
        const v3 = pts.map((p, i) => {
          const y = bodyRadius + Math.sin(i * 0.55 - time * 7) * amp
          return new THREE.Vector3(p.x, y, p.z)
        })
        const curve = new THREE.CatmullRomCurve3(v3)
        const tubular = Math.max(8, Math.min(420, (pts.length - 1) * (lowEnd ? 4 : 7)))
        const geo = new THREE.TubeGeometry(curve, tubular, bodyRadius, radial, false)
        if (scalesTex) scalesTex.repeat.set(Math.max(2, pts.length * 0.6), 1)
        tubeMesh = new THREE.Mesh(geo, bodyMat)
        tubeMesh.castShadow = !lowEnd
        snakeGroup.add(tubeMesh)

        const h0 = v3[0]
        const h1 = v3[1] || v3[0]
        head.visible = true
        head.position.set(h0.x, h0.y, h0.z)
        headWorld = h0
        head.rotation.y = Math.atan2(h0.x - h1.x, h0.z - h1.z)
        tongue.visible = !dead && (time * 3) % 2 < 1

        const tp = v3[v3.length - 1]
        const bp = v3[v3.length - 2] || tp
        let dx = tp.x - bp.x
        let dz = tp.z - bp.z
        const dl = Math.hypot(dx, dz) || 1
        dx /= dl
        dz /= dl
        tail.visible = true
        tail.rotation.set(0, Math.atan2(dx, dz), 0)
        const off = tailLen / 2 - bodyRadius * 0.55
        tail.position.set(tp.x + dx * off, tp.y, tp.z + dz * off)
      } else {
        head.visible = false
        tail.visible = false
      }

      // Food gem — glowing, bobbing, spinning.
      if (game.food) {
        const w = gridToWorld(game.food.x, game.food.y, cols, rows)
        const pulse = 1 + 0.09 * Math.sin(time * 3)
        const bob = Math.sin(time * 2) * 0.07
        gem.visible = true
        gem.position.set(w.x, CELL * 0.44 + bob, w.z)
        gem.scale.setScalar(pulse)
        gemBody.rotation.set(time * 0.7, time * 0.9, 0)
        if (gemMat.emissiveIntensity !== undefined)
          gemMat.emissiveIntensity = 0.75 + 0.35 * Math.sin(time * 3)
        if (gemGlow.intensity !== undefined && !lowEnd)
          gemGlow.intensity = 1.3 + 0.5 * Math.sin(time * 3)
      } else {
        gem.visible = false
      }

      // Eat sparkle — food only relocates when eaten → burst at the head.
      const foodKey = game.food ? game.food.x + ',' + game.food.y : null
      if (foodKey && lastFoodKey && foodKey !== lastFoodKey && headWorld && !dead) {
        burstSparks(headWorld.x, headWorld.y, headWorld.z)
      }
      lastFoodKey = foodKey

      // Advance the glowing motes (fall + fade).
      const dt = Math.min(0.05, Math.max(0, time - lastTime))
      lastTime = time
      for (const m of sparks) {
        if (!m.visible) continue
        m.userData.life -= dt * 1.8
        if (m.userData.life <= 0) {
          m.visible = false
          continue
        }
        m.userData.vy -= dt * 6
        m.position.x += m.userData.vx * dt
        m.position.y += m.userData.vy * dt
        m.position.z += m.userData.vz * dt
        if (m.material) m.material.opacity = Math.max(0, m.userData.life) * 0.9
      }
      // No per-frame head reframing — the camera is fixed.
    }

    const render = () => {
      try {
        if (composer) composer.render()
        else renderer.render(scene, camera)
      } catch {
        /* context lost — ignore, next frame retries */
      }
    }

    const dispose = () => {
      disposeTube()
      try {
        scene.traverse((o) => {
          o.geometry?.dispose?.()
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.())
          else o.material?.dispose?.()
        })
      } catch {
        /* best-effort */
      }
      boardTex?.dispose?.()
      scalesTex?.dispose?.()
      bgTex?.dispose?.()
      sparkGeo?.dispose?.()
      try {
        composer?.dispose?.()
      } catch {
        /* best-effort */
      }
      renderer.dispose?.()
    }

    // ── Bloom glow (premium) — loaded lazily so a missing GL context / the unit
    //    stub degrades to a plain render. Only bright emissive bits (gem, snake
    //    glow, specular highlights) bloom, thanks to a high threshold. ──────────
    if (!lowEnd) {
      ;(async () => {
        try {
          const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
            import('three/examples/jsm/postprocessing/EffectComposer.js'),
            import('three/examples/jsm/postprocessing/RenderPass.js'),
            import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
          ])
          const c = new EffectComposer(renderer)
          c.addPass(new RenderPass(scene, camera))
          c.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.62, 0.55, 0.82))
          c.setSize(W, H)
          composer = c
        } catch {
          /* bloom unavailable — plain render path stays */
        }
      })()
    }

    /**
     * Costura de teste: ONDE a cena pôs as peças que o jogo controla.
     *
     * A cena é aritmética de coordenada do começo ao fim, e um erro de sinal
     * aqui não estoura nada -- ele desenha a cobra ao lado da comida. Sem uma
     * janela para as posições, o único teste possível é "não lançou exceção",
     * que é exatamente o teste que deixa esse defeito passar. Só leitura, e só
     * do que tem contrato com o jogo (cabeça, cauda e a gema da comida).
     */
    const posicoesParaTeste = () => ({
      cabeca: {
        visivel: head.visible,
        x: head.position.x,
        y: head.position.y,
        z: head.position.z,
        giroY: head.rotation.y,
      },
      cauda: { visivel: tail.visible, x: tail.position.x, z: tail.position.z },
      gema: {
        visivel: gem.visible,
        x: gem.position.x,
        y: gem.position.y,
        z: gem.position.z,
      },
    })

    return { ok: true, setState, resize, render, dispose, posicoesParaTeste }
  } catch {
    try {
      renderer.dispose?.()
    } catch {
      /* ignore */
    }
    return NOOP
  }
}
