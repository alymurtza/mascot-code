/**
 * Koi ponds seen from above, by day and by night: the water, the koi and what lives with them
 * (lily pads and lotus, a turtle, fry, leaves and petals, striders, a frog, reeds, dragonflies,
 * fireflies). Each pond theme lists which of these it has.
 */

type Ctx = CanvasRenderingContext2D

const TAU = Math.PI * 2
const rnd = (a: number, b: number): number => a + Math.random() * (b - a)
const pick = <T>(a: readonly T[]): T => a[(Math.random() * a.length) | 0]

export type PondThing =
  | 'pads'
  | 'sky'
  | 'fireflies'
  | 'caustics'
  | 'turtle'
  | 'fry'
  | 'lotus'
  | 'duckweed'
  | 'leaves'
  | 'petals'
  | 'striders'
  | 'dragonflies'
  | 'frog'
  | 'bubbles'
  | 'reeds'
  | 'branch'

export interface PondLook {
  /** Water: centre, middle, edge. */
  water: [string, string, string]
  night: boolean
  things: PondThing[]
  /** How far the fish sink into the water's colour (0: clear daylight). */
  sink: number
  sinkTo: string
  /** How far things on the surface dim at night (0: not at all), and toward what. */
  dim?: number
  dimTo?: string
  /** A soft glow round the fish. */
  glow?: number
  /** Fewer fireflies. */
  fewFlies?: boolean
  /** Lotus closed for the night. */
  closed?: boolean
  pad: string
  padEdge: string
  petal: string
  heart: string
  /** Ripples and bubbles, as "r,g,b". */
  ring: string
  shadow: string
  shine: string
  koi: [string, string][]
  lotusLeaf?: string
  lotusVein?: string
  lotusPetal?: [string, string]
  lotusCore?: string
  bud?: string
  leafCols?: string[]
  turtle?: [string, string, string]
  fry?: string
  strider?: string
  dragon?: [string, string]
  reed?: string[]
  cattail?: string
  duck?: [string, string]
  frog?: [string, string, string]
  blossom?: string
  branch?: string
}

interface Fish {
  x: number
  y: number
  a: number
  turn: number
  v: number
  len: number
  c: [string, string]
}

/** One koi from above: rounded head, tapering body, swaying two-lobed tail, see-through fins,
 * markings and eyes. */
function drawKoi(ctx: Ctx, f: Fish, t: number, P: PondLook): void {
  const seg = 12
  const L = f.len
  const pts: [number, number][] = []
  for (let i = 0; i < seg; i++) {
    const k = i / (seg - 1)
    const d = k * L
    const wig = Math.sin(t * 5 - i * 0.55) * L * 0.08 * Math.pow(k, 1.5)
    pts.push([
      f.x - Math.cos(f.a) * d - Math.sin(f.a) * wig,
      f.y - Math.sin(f.a) * d + Math.cos(f.a) * wig
    ])
  }
  const width = (k: number): number =>
    L *
    (k < 0.25
      ? 0.1 + 0.05 * Math.sin((k / 0.25) * (Math.PI / 2))
      : 0.15 * Math.pow(1 - (k - 0.25) / 0.75, 1.25) + 0.014)
  const normal = (i: number): [number, number] => {
    const [x0, y0] = pts[Math.max(0, i - 1)]
    const [x1, y1] = pts[Math.min(seg - 1, i + 1)]
    const l = Math.hypot(x1 - x0, y1 - y0) || 1
    return [-(y1 - y0) / l, (x1 - x0) / l]
  }
  const outline = (ox: number, oy: number): void => {
    ctx.beginPath()
    const r = width(0)
    for (let s = 0; s <= 8; s++) {
      const ang = f.a - Math.PI / 2 + (s / 8) * Math.PI
      const x = pts[0][0] + Math.cos(ang) * r + ox
      const y = pts[0][1] + Math.sin(ang) * r + oy
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let i = 0; i < seg; i++) {
      const [nx, ny] = normal(i)
      const w = width(i / (seg - 1))
      ctx.lineTo(pts[i][0] - nx * w + ox, pts[i][1] - ny * w + oy)
    }
    for (let i = seg - 1; i >= 0; i--) {
      const [nx, ny] = normal(i)
      const w = width(i / (seg - 1))
      ctx.lineTo(pts[i][0] + nx * w + ox, pts[i][1] + ny * w + oy)
    }
    ctx.closePath()
  }
  ctx.fillStyle = P.shadow
  outline(L * 0.06, L * 0.09)
  ctx.fill()
  const [tx, ty] = pts[seg - 1]
  const [px, py] = pts[seg - 3]
  const back = Math.atan2(ty - py, tx - px)
  const swing = Math.sin(t * 5 - seg * 0.55) * 0.25
  ctx.fillStyle = f.c[0]
  ctx.globalAlpha = 0.78
  for (const side of [1, -1]) {
    const ang = back + side * 0.42 + swing
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.quadraticCurveTo(
      tx + Math.cos(ang + side * 0.5) * L * 0.2,
      ty + Math.sin(ang + side * 0.5) * L * 0.2,
      tx + Math.cos(ang) * L * 0.34,
      ty + Math.sin(ang) * L * 0.34
    )
    ctx.quadraticCurveTo(
      tx + Math.cos(ang - side * 0.2) * L * 0.16,
      ty + Math.sin(ang - side * 0.2) * L * 0.16,
      tx,
      ty
    )
    ctx.fill()
  }
  const fin = Math.round((seg - 1) * 0.24)
  const [nx, ny] = normal(fin)
  ctx.globalAlpha = 0.6
  for (const side of [1, -1]) {
    const w = width(fin / (seg - 1))
    const bx = pts[fin][0] + nx * w * side
    const by = pts[fin][1] + ny * w * side
    const ang = f.a + Math.PI + side * (2.2 + Math.sin(t * 4) * 0.25) * -1
    ctx.beginPath()
    ctx.ellipse(
      bx + Math.cos(ang) * L * 0.07,
      by + Math.sin(ang) * L * 0.07,
      L * 0.1,
      L * 0.045,
      ang,
      0,
      TAU
    )
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = f.c[0]
  outline(0, 0)
  ctx.fill()
  if (f.c[1] !== f.c[0]) {
    ctx.save()
    outline(0, 0)
    ctx.clip()
    ctx.fillStyle = f.c[1]
    for (const [k, rx, ry] of [
      [0.12, 0.11, 0.09],
      [0.42, 0.13, 0.1],
      [0.7, 0.1, 0.08]
    ] as const) {
      const i = Math.round(k * (seg - 1))
      ctx.beginPath()
      ctx.ellipse(pts[i][0], pts[i][1], L * rx, L * ry, f.a + (i % 2 ? 0.4 : -0.3), 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }
  ctx.fillStyle = P.shine
  ctx.beginPath()
  ctx.ellipse(pts[3][0], pts[3][1], L * 0.16, L * 0.035, f.a, 0, TAU)
  ctx.fill()
  const [ex, ey] = normal(1)
  ctx.fillStyle = 'rgba(15,12,12,.8)'
  for (const side of [1, -1]) {
    ctx.beginPath()
    ctx.arc(
      pts[0][0] + ex * width(0) * 0.62 * side,
      pts[0][1] + ey * width(0) * 0.62 * side,
      L * 0.016,
      0,
      TAU
    )
    ctx.fill()
  }
}

/** A blurred blob, drawn once and stretched where it's needed (blurring every frame is slow). */
function softSprite(color: string, blur: number, shape: 'round' | 'leaf'): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.filter = `blur(${blur}px)`
  g.fillStyle = color
  g.beginPath()
  if (shape === 'round') g.ellipse(32, 32, 22, 22, 0, 0, TAU)
  else {
    g.moveTo(10, 32)
    g.quadraticCurveTo(32, 14, 54, 32)
    g.quadraticCurveTo(32, 50, 10, 32)
  }
  g.fill()
  return c
}

export interface PondLayer {
  resize(w: number, h: number): void
  step(ctx: Ctx, t: number, dt: number, w: number, h: number): void
}

/** A pond: draws everything itself, water included. */
export function pondLayer(P: PondLook, dpr: () => number): PondLayer {
  const has = (k: PondThing): boolean => P.things.includes(k)
  const under = document.createElement('canvas')
  const uctx = under.getContext('2d')!
  const top = document.createElement('canvas')
  const tctx = top.getContext('2d')!
  let water: HTMLCanvasElement | null = null
  let W = 0
  let H = 0
  let size = 0
  let D = 1
  const n = (k: number): number =>
    Math.max(1, Math.round(k * Math.sqrt((W * H) / (300 * 190)) * 0.55))

  type Pad = { x: number; y: number; r: number; a: number; flower: boolean }
  type Lotus = {
    x: number
    y: number
    r: number
    a: number
    ph: number
    bloom: boolean
    bud: boolean
    bx: number
    by: number
  }
  type Ring = { x: number; y: number; life: number; max: number }
  let fish: Fish[] = []
  let pads: Pad[] = []
  let rings: Ring[] = []
  let flies: { x: number; y: number; ph: number; sp: number }[] = []
  let caustics: { x: number; y: number; r: number; ph: number; sp: number }[] = []
  let turtle: { x: number; y: number; a: number; turn: number; len: number } | null = null
  let fry: {
    x: number
    y: number
    a: number
    turn: number
    kids: { ox: number; oy: number; ph: number }[]
  } | null = null
  let lotus: Lotus[] = []
  let duck: {
    x: number
    y: number
    vx: number
    vy: number
    dots: { x: number; y: number; c: number; r: number }[]
  }[] = []
  let leaves: {
    x: number
    y: number
    a: number
    va: number
    kind: 'ginkgo' | 'maple'
    c: string
    s: number
  }[] = []
  let petals: { x: number; y: number; a: number; va: number; s: number }[] = []
  let striders: { x: number; y: number; a: number; v: number; wait: number }[] = []
  let dragons: {
    x: number
    y: number
    tx: number
    ty: number
    a: number
    wait: number
    body: string
  }[] = []
  let frog: { pad: Pad; a: number; ph: number } | null = null
  let bubbles: { x: number; y: number; life: number; n: number }[] = []
  let reeds: {
    x: number
    y: number
    ang: number
    len: number
    bend: number
    ph: number
    c: string
    w: number
    tail: boolean
  }[] = []
  let branch: { x: number; y: number; r: number; rot: number; ph: number }[] = []
  const light = has('caustics') ? softSprite('rgba(255,255,240,1)', 9, 'round') : null
  const shade = has('branch') ? softSprite(P.branch ?? 'rgba(0,0,0,.1)', 4, 'leaf') : null

  function resize(w: number, h: number): void {
    W = w
    H = h
    D = dpr()
    size = Math.min(h, 600)
    for (const [c, g] of [
      [under, uctx],
      [top, tctx]
    ] as const) {
      c.width = Math.max(1, Math.round(W * D))
      c.height = Math.max(1, Math.round(H * D))
      g.setTransform(D, 0, 0, D, 0, 0)
    }
    water = document.createElement('canvas')
    water.width = under.width
    water.height = under.height
    const b = water.getContext('2d')!
    b.setTransform(D, 0, 0, D, 0, 0)
    const g = b.createRadialGradient(W * 0.45, H * 0.4, 0, W * 0.45, H * 0.4, Math.max(W, H) * 0.8)
    g.addColorStop(0, P.water[0])
    g.addColorStop(0.55, P.water[1])
    g.addColorStop(1, P.water[2])
    b.fillStyle = g
    b.fillRect(0, 0, W, H)
    if (has('sky')) {
      // Faint light from the night sky, brightest toward one corner.
      const sky = b.createLinearGradient(0, 0, W, H)
      sky.addColorStop(0, 'rgba(120,170,180,.10)')
      sky.addColorStop(0.6, 'rgba(120,170,180,0)')
      b.fillStyle = sky
      b.fillRect(0, 0, W, H)
    }

    fish = Array.from({ length: n(5) }, () => ({
      x: rnd(0, W),
      y: rnd(0, H),
      a: rnd(0, TAU),
      turn: 0,
      v: rnd(0.05, 0.09),
      len: rnd(0.1, 0.15) * size,
      c: pick(P.koi)
    }))
    pads = has('pads')
      ? Array.from({ length: n(has('lotus') ? 2 : 5) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          r: rnd(0.04, 0.07) * size,
          a: rnd(0, TAU),
          flower: Math.random() < 0.4
        }))
      : []
    rings = []
    flies = has('fireflies')
      ? Array.from({ length: n(P.fewFlies ? 5 : 14) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          ph: rnd(0, TAU),
          sp: rnd(0.6, 1.4)
        }))
      : []
    caustics = has('caustics')
      ? Array.from({ length: n(18) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          r: rnd(0.04, 0.09) * size,
          ph: rnd(0, TAU),
          sp: rnd(0.2, 0.5)
        }))
      : []
    turtle = has('turtle')
      ? { x: rnd(0, W), y: rnd(0, H), a: rnd(0, TAU), turn: 0, len: 0.12 * size }
      : null
    fry = has('fry')
      ? {
          x: rnd(0, W),
          y: rnd(0, H),
          a: rnd(0, TAU),
          turn: 0,
          kids: Array.from({ length: 11 }, () => ({
            ox: rnd(-1, 1),
            oy: rnd(-1, 1),
            ph: rnd(0, TAU)
          }))
        }
      : null
    lotus = has('lotus')
      ? Array.from({ length: n(3) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          r: rnd(0.07, 0.1) * size,
          a: rnd(0, TAU),
          ph: rnd(0, TAU),
          bloom: P.closed ? false : Math.random() < 0.7,
          bud: Math.random() < 0.8,
          bx: rnd(-1, 1),
          by: rnd(-1, 1)
        }))
      : []
    duck = has('duckweed')
      ? Array.from({ length: n(4) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          vx: rnd(-0.004, 0.004),
          vy: rnd(-0.003, 0.003),
          dots: Array.from({ length: 70 }, () => {
            const a = rnd(0, TAU)
            const d = Math.sqrt(Math.random()) * 0.09
            return {
              x: Math.cos(a) * d * 1.5,
              y: Math.sin(a) * d,
              c: Math.random() < 0.5 ? 0 : 1,
              r: rnd(0.0035, 0.006)
            }
          })
        }))
      : []
    leaves = has('leaves')
      ? Array.from({ length: n(6) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          a: rnd(0, TAU),
          va: rnd(-0.15, 0.15),
          kind: Math.random() < 0.5 ? ('ginkgo' as const) : ('maple' as const),
          c: pick(P.leafCols ?? ['#e8752a']),
          s: rnd(0.022, 0.032) * size
        }))
      : []
    petals = has('petals')
      ? Array.from({ length: n(16) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          a: rnd(0, TAU),
          va: rnd(-0.4, 0.4),
          s: rnd(0.006, 0.01) * size
        }))
      : []
    striders = has('striders')
      ? Array.from({ length: n(4) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          a: rnd(0, TAU),
          v: 0,
          wait: rnd(0, 3)
        }))
      : []
    dragons = has('dragonflies')
      ? Array.from({ length: Math.min(3, n(2)) }, () => ({
          x: rnd(0, W),
          y: rnd(0, H),
          tx: rnd(0, W),
          ty: rnd(0, H),
          a: 0,
          wait: rnd(0, 2),
          body: pick([P.dragon?.[0] ?? '#2a7fb8', '#3a9a5a', '#c0392b'])
        }))
      : []
    bubbles = []
    reeds = []
    if (has('reeds')) {
      const corners: [number, number, number][] = [
        [-0.02 * W, -0.04 * H, Math.PI / 4],
        [W * 1.02, H * 1.04, Math.PI * 1.25],
        [W * 1.03, -0.03 * H, Math.PI * 0.75]
      ]
      for (const [cx, cy, dir] of corners.slice(0, W > 500 ? 3 : 2)) {
        for (let i = 0; i < 26; i++) {
          reeds.push({
            x: cx + rnd(-0.03, 0.03) * size,
            y: cy + rnd(-0.03, 0.03) * size,
            ang: dir + rnd(-0.75, 0.75),
            len: rnd(0.18, 0.42) * size,
            bend: rnd(-0.25, 0.25),
            ph: rnd(0, TAU),
            c: pick(P.reed ?? ['#6f9a3c']),
            w: rnd(1.6, 3),
            tail: Math.random() < 0.28
          })
        }
      }
    }
    branch = has('branch')
      ? Array.from({ length: 70 }, () => {
          const a = rnd(Math.PI * 0.5, Math.PI)
          const d = Math.sqrt(Math.random()) * 0.45 * size
          return {
            x: W + Math.cos(a) * d * 1.3,
            y: Math.sin(a) * d * 0.9 - 0.02 * size,
            r: rnd(0.012, 0.022) * size,
            rot: rnd(0, TAU),
            ph: rnd(0, TAU)
          }
        })
      : []
    frog = null
    if (has('frog')) {
      const pad = pads[0] ?? { x: W * 0.6, y: H * 0.55, r: 0.06 * size, a: 0, flower: false }
      pad.r = Math.max(pad.r, 0.065 * size)
      pad.flower = false
      if (!pads.includes(pad)) pads.push(pad)
      frog = { pad, a: rnd(0, TAU), ph: rnd(0, TAU) }
    }
  }

  // ---- Under the water.
  function drawCaustics(ctx: Ctx, t: number): void {
    if (!light) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.07
    for (const k of caustics) {
      const x = k.x + Math.sin(t * k.sp + k.ph) * k.r * 0.8
      const y = k.y + Math.cos(t * k.sp * 0.8 + k.ph) * k.r * 0.6
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(k.ph + t * 0.05)
      ctx.drawImage(light, -k.r * 1.4, -k.r * 0.8, k.r * 2.8, k.r * 1.6)
      ctx.restore()
    }
    ctx.restore()
  }
  function drawTurtle(c: Ctx, t: number, dt: number): void {
    const T = turtle!
    T.turn += rnd(-1, 1) * dt * 0.8
    T.turn *= 0.98
    T.a += T.turn * dt
    T.x += Math.cos(T.a) * 0.025 * size * dt
    T.y += Math.sin(T.a) * 0.025 * size * dt
    const L = T.len
    if (T.x < -L) T.x = W + L
    if (T.x > W + L) T.x = -L
    if (T.y < -L) T.y = H + L
    if (T.y > H + L) T.y = -L
    const col = P.turtle ?? ['#5b6b3a', '#3c4a26', '#8a9a5c']
    c.save()
    c.translate(T.x, T.y)
    c.rotate(T.a)
    c.fillStyle = P.shadow
    c.beginPath()
    c.ellipse(L * 0.06, L * 0.08, L * 0.5, L * 0.4, 0, 0, TAU)
    c.fill()
    const paddle = Math.sin(t * 2.2)
    c.fillStyle = col[2]
    for (const [fx, fy, k] of [
      [0.25, 0.36, 1],
      [0.25, -0.36, -1],
      [-0.3, 0.3, -1],
      [-0.3, -0.3, 1]
    ] as const) {
      c.beginPath()
      c.ellipse(
        L * fx,
        L * fy,
        L * 0.17,
        L * 0.07,
        (fy > 0 ? 0.6 : -0.6) + paddle * 0.35 * k,
        0,
        TAU
      )
      c.fill()
    }
    c.beginPath()
    c.ellipse(L * 0.55, 0, L * 0.13, L * 0.1, 0, 0, TAU)
    c.fill()
    c.beginPath()
    c.moveTo(-L * 0.48, 0)
    c.lineTo(-L * 0.62, L * 0.03)
    c.lineTo(-L * 0.48, L * 0.05)
    c.fill()
    c.fillStyle = col[0]
    c.beginPath()
    c.ellipse(0, 0, L * 0.48, L * 0.38, 0, 0, TAU)
    c.fill()
    c.strokeStyle = col[1]
    c.lineWidth = 1.2
    c.beginPath()
    c.ellipse(0, 0, L * 0.2, L * 0.15, 0, 0, TAU)
    c.stroke()
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU
      c.beginPath()
      c.moveTo(Math.cos(a) * L * 0.2, Math.sin(a) * L * 0.15)
      c.lineTo(Math.cos(a) * L * 0.46, Math.sin(a) * L * 0.36)
      c.stroke()
    }
    c.fillStyle = 'rgba(255,255,255,.12)'
    c.beginPath()
    c.ellipse(L * 0.08, -L * 0.1, L * 0.22, L * 0.1, 0, 0, TAU)
    c.fill()
    c.restore()
  }
  function drawFry(c: Ctx, t: number, dt: number): void {
    const F = fry!
    F.turn += rnd(-1, 1) * dt * 2.5
    F.turn *= 0.97
    F.a += F.turn * dt
    F.x += Math.cos(F.a) * 0.07 * size * dt
    F.y += Math.sin(F.a) * 0.07 * size * dt
    const R = 0.05 * size
    if (F.x < -R * 2) F.x = W + R
    if (F.x > W + R * 2) F.x = -R
    if (F.y < -R * 2) F.y = H + R
    if (F.y > H + R * 2) F.y = -R
    c.fillStyle = P.fry ?? '#e9e2c8'
    for (const k of F.kids) {
      const ox = (k.ox + Math.sin(t * 1.3 + k.ph) * 0.25) * R
      const oy = (k.oy + Math.cos(t * 1.1 + k.ph) * 0.25) * R
      const x = F.x + Math.cos(F.a) * ox - Math.sin(F.a) * oy
      const y = F.y + Math.sin(F.a) * ox + Math.cos(F.a) * oy
      const l = 0.018 * size
      const a = F.a + Math.sin(t * 9 + k.ph) * 0.15
      c.beginPath()
      c.ellipse(x, y, l * 0.5, l * 0.16, a, 0, TAU)
      c.fill()
      c.beginPath()
      c.moveTo(x - Math.cos(a) * l * 0.45, y - Math.sin(a) * l * 0.45)
      c.lineTo(x - Math.cos(a + 0.4) * l * 0.8, y - Math.sin(a + 0.4) * l * 0.8)
      c.lineTo(x - Math.cos(a - 0.4) * l * 0.8, y - Math.sin(a - 0.4) * l * 0.8)
      c.fill()
    }
  }
  function swim(dt: number): void {
    for (const f of fish) {
      f.turn += rnd(-1, 1) * dt * 1.5
      f.turn *= 0.98
      f.a += f.turn * dt
      f.x += Math.cos(f.a) * f.v * size * dt
      f.y += Math.sin(f.a) * f.v * size * dt
      if (f.x < -f.len) f.x = W + f.len
      if (f.x > W + f.len) f.x = -f.len
      if (f.y < -f.len) f.y = H + f.len
      if (f.y > H + f.len) f.y = -f.len
    }
  }
  /** Everything below the surface, on its own layer, sunk into the water's colour. */
  function belowLayer(t: number, dt: number): void {
    uctx.globalCompositeOperation = 'source-over'
    uctx.clearRect(0, 0, W, H)
    swim(dt)
    for (const f of fish) drawKoi(uctx, f, t, P)
    if (turtle) drawTurtle(uctx, t, dt)
    if (fry) drawFry(uctx, t, dt)
    if (P.sink) {
      uctx.globalCompositeOperation = 'source-atop'
      uctx.fillStyle = P.sinkTo
      uctx.globalAlpha = P.sink
      uctx.fillRect(0, 0, W, H)
      uctx.globalAlpha = 1
      uctx.globalCompositeOperation = 'source-over'
    }
  }

  // ---- On the surface.
  function drawRipples(ctx: Ctx, dt: number): void {
    // Now and then a drop or a fish touches the surface: thin rings that spread quickly, then
    // slow, fading in and out.
    if (Math.random() < 0.18 * dt * n(1))
      rings.push({ x: rnd(0, W), y: rnd(0, H), life: 0, max: rnd(0.05, 0.09) * size })
    ctx.lineWidth = 0.7
    for (const r of rings) {
      r.life += dt
      const p = r.life / 4
      for (const k of [1, 0.72, 0.48]) {
        const q = Math.min(1, p / k)
        const rad = r.max * (1 - Math.pow(1 - q, 3)) * k * 1.6
        const a = (P.night ? 0.16 : 0.32) * Math.sin(Math.PI * Math.min(1, p * 1.05)) * k
        if (a <= 0 || rad <= 0) continue
        ctx.strokeStyle = `rgba(${P.ring},${a})`
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, TAU)
        ctx.stroke()
      }
    }
    rings = rings.filter((r) => r.life < 4)
  }
  function drawPads(c: Ctx, dt: number): void {
    for (const p of pads) {
      p.a += 0.03 * dt
      c.fillStyle = P.pad
      c.beginPath()
      c.moveTo(p.x, p.y)
      c.arc(p.x, p.y, p.r, p.a + 0.3, p.a + TAU - 0.05)
      c.closePath()
      c.fill()
      c.strokeStyle = P.padEdge
      c.lineWidth = 0.8
      c.stroke()
      if (p.flower) {
        const s = p.r * 0.35
        if (has('fireflies')) {
          c.shadowColor = P.petal
          c.shadowBlur = 8
        }
        c.fillStyle = P.petal
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU
          c.beginPath()
          c.ellipse(
            p.x + Math.cos(a) * s * 0.6,
            p.y + Math.sin(a) * s * 0.6,
            s * 0.6,
            s * 0.3,
            a,
            0,
            TAU
          )
          c.fill()
        }
        c.shadowBlur = 0
        c.fillStyle = P.heart
        c.beginPath()
        c.arc(p.x, p.y, s * 0.3, 0, TAU)
        c.fill()
      }
    }
  }
  function drawLotusFlower(c: Ctx, x: number, y: number, r: number, t: number, ph: number): void {
    const [inner, outer] = P.lotusPetal ?? ['#ffffff', '#f6a9c4']
    for (const [count, len, off] of [
      [9, 1, 0],
      [8, 0.78, 0.35],
      [6, 0.52, 0.1]
    ] as const) {
      for (let k = 0; k < count; k++) {
        const a = (k / count) * TAU + off + ph + Math.sin(t * 0.3 + ph) * 0.03
        const g = c.createLinearGradient(x, y, x + Math.cos(a) * r * len, y + Math.sin(a) * r * len)
        g.addColorStop(0, inner)
        g.addColorStop(1, outer)
        c.fillStyle = g
        c.beginPath()
        c.moveTo(x, y)
        c.quadraticCurveTo(
          x + Math.cos(a - 0.38) * r * len * 0.75,
          y + Math.sin(a - 0.38) * r * len * 0.75,
          x + Math.cos(a) * r * len,
          y + Math.sin(a) * r * len
        )
        c.quadraticCurveTo(
          x + Math.cos(a + 0.38) * r * len * 0.75,
          y + Math.sin(a + 0.38) * r * len * 0.75,
          x,
          y
        )
        c.fill()
        c.strokeStyle = 'rgba(200,90,130,.25)'
        c.lineWidth = 0.6
        c.stroke()
      }
    }
    c.fillStyle = P.lotusCore ?? '#f2cf4a'
    c.beginPath()
    c.arc(x, y, r * 0.18, 0, TAU)
    c.fill()
    c.fillStyle = 'rgba(120,100,20,.5)'
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU
      c.beginPath()
      c.arc(x + Math.cos(a) * r * 0.09, y + Math.sin(a) * r * 0.09, r * 0.025, 0, TAU)
      c.fill()
    }
  }
  function drawBud(c: Ctx, x: number, y: number, r: number, a: number): void {
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, P.lotusPetal?.[0] ?? '#ffffff')
    g.addColorStop(1, P.bud ?? '#f39bbb')
    c.fillStyle = g
    c.beginPath()
    c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    c.quadraticCurveTo(
      x + Math.cos(a + 1.6) * r,
      y + Math.sin(a + 1.6) * r,
      x + Math.cos(a + Math.PI) * r * 0.6,
      y + Math.sin(a + Math.PI) * r * 0.6
    )
    c.quadraticCurveTo(
      x + Math.cos(a - 1.6) * r,
      y + Math.sin(a - 1.6) * r,
      x + Math.cos(a) * r,
      y + Math.sin(a) * r
    )
    c.fill()
    c.strokeStyle = 'rgba(160,60,100,.35)'
    c.lineWidth = 0.6
    c.beginPath()
    c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    c.lineTo(x + Math.cos(a + Math.PI) * r * 0.5, y + Math.sin(a + Math.PI) * r * 0.5)
    c.stroke()
  }
  function drawLotus(c: Ctx, t: number, dt: number): void {
    for (const L of lotus) {
      L.a += 0.02 * dt
      const x = L.x + Math.sin(t * 0.2 + L.ph) * 2
      const y = L.y + Math.cos(t * 0.17 + L.ph) * 2
      c.fillStyle = P.shadow
      c.beginPath()
      c.arc(x + L.r * 0.05, y + L.r * 0.07, L.r, 0, TAU)
      c.fill()
      c.fillStyle = P.lotusLeaf ?? '#5aa04f'
      c.beginPath()
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * TAU
        const rr = L.r * (1 + 0.035 * Math.sin(a * 7 + L.ph))
        const px = x + Math.cos(a + L.a) * rr
        const py = y + Math.sin(a + L.a) * rr
        if (k) c.lineTo(px, py)
        else c.moveTo(px, py)
      }
      c.fill()
      c.strokeStyle = P.lotusVein ?? 'rgba(220,255,200,.35)'
      c.lineWidth = 0.8
      for (let k = 0; k < 11; k++) {
        const a = L.a + (k / 11) * TAU
        c.beginPath()
        c.moveTo(x, y)
        c.lineTo(x + Math.cos(a) * L.r * 0.92, y + Math.sin(a) * L.r * 0.92)
        c.stroke()
      }
      const fx = x + L.bx * L.r * 1.1
      const fy = y + L.by * L.r * 1.1
      if (L.bloom) drawLotusFlower(c, fx, fy, L.r * 0.55, t, L.ph)
      else if (L.bud) drawBud(c, fx, fy, L.r * 0.3, L.ph)
    }
  }
  function drawDuck(c: Ctx, dt: number): void {
    const col = P.duck ?? ['#7fbf4a', '#9ad25c']
    for (const p of duck) {
      p.x += p.vx * size * dt
      p.y += p.vy * size * dt
      if (p.x < -0.15 * size) p.x = W + 0.12 * size
      if (p.x > W + 0.15 * size) p.x = -0.12 * size
      if (p.y < -0.1 * size) p.y = H + 0.08 * size
      if (p.y > H + 0.1 * size) p.y = -0.08 * size
      for (const d of p.dots) {
        c.fillStyle = col[d.c]
        c.beginPath()
        c.arc(p.x + d.x * size, p.y + d.y * size, d.r * size, 0, TAU)
        c.fill()
      }
    }
  }
  function maple(c: Ctx, s: number): void {
    // Five pointed lobes fanned over the top, a short stem below.
    const lobes = [
      -Math.PI / 2 - 1.85,
      -Math.PI / 2 - 0.95,
      -Math.PI / 2,
      -Math.PI / 2 + 0.95,
      -Math.PI / 2 + 1.85
    ]
    const len = [0.62, 0.85, 1, 0.85, 0.62]
    c.beginPath()
    c.moveTo(0, s * 0.12)
    lobes.forEach((a, k) => {
      const r = s * len[k]
      c.lineTo(Math.cos(a - 0.22) * r * 0.45, Math.sin(a - 0.22) * r * 0.45)
      c.lineTo(Math.cos(a - 0.12) * r * 0.75, Math.sin(a - 0.12) * r * 0.75)
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      c.lineTo(Math.cos(a + 0.12) * r * 0.75, Math.sin(a + 0.12) * r * 0.75)
      c.lineTo(Math.cos(a + 0.22) * r * 0.45, Math.sin(a + 0.22) * r * 0.45)
      if (k < lobes.length - 1)
        c.lineTo(Math.cos(a + 0.47) * r * 0.22, Math.sin(a + 0.47) * r * 0.22)
    })
    c.closePath()
    c.fill()
    c.strokeStyle = 'rgba(80,30,10,.35)'
    c.lineWidth = 0.7
    c.beginPath()
    c.moveTo(0, s * 0.1)
    c.lineTo(0, s * 0.75)
    c.stroke()
    for (const a of lobes) {
      c.beginPath()
      c.moveTo(0, 0)
      c.lineTo(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6)
      c.stroke()
    }
  }
  function ginkgo(c: Ctx, s: number): void {
    c.beginPath()
    c.moveTo(0, s * 0.35)
    c.arc(0, s * 0.35, s, -Math.PI * 0.85, -Math.PI * 0.53)
    c.lineTo(0, -s * 0.45)
    c.arc(0, s * 0.35, s, -Math.PI * 0.47, -Math.PI * 0.15)
    c.closePath()
    c.fill()
    c.strokeStyle = 'rgba(120,90,10,.35)'
    c.lineWidth = 0.6
    c.beginPath()
    c.moveTo(0, s * 0.35)
    c.lineTo(0, s * 0.95)
    c.stroke()
  }
  function drawLeaves(c: Ctx, t: number, dt: number): void {
    for (const L of leaves) {
      L.x += (0.012 + Math.sin(t * 0.2 + L.va * 10) * 0.006) * size * dt
      L.y += Math.sin(t * 0.3 + L.va * 20) * 0.006 * size * dt
      L.a += L.va * dt
      if (L.x > W + L.s * 2) {
        L.x = -L.s * 2
        L.y = rnd(0, H)
      }
      const shape = L.kind === 'maple' ? maple : ginkgo
      c.save()
      c.translate(L.x + L.s * 0.12, L.y + L.s * 0.16)
      c.rotate(L.a)
      c.fillStyle = P.shadow
      shape(c, L.s)
      c.restore()
      c.save()
      c.translate(L.x, L.y)
      c.rotate(L.a)
      c.fillStyle = L.c
      shape(c, L.s)
      c.restore()
    }
  }
  function drawPetals(c: Ctx, t: number, dt: number): void {
    c.fillStyle = P.blossom ?? '#f9c6d6'
    for (const p of petals) {
      p.x += (0.01 + Math.sin(t * 0.4 + p.va * 9) * 0.006) * size * dt
      p.y += Math.cos(t * 0.33 + p.va * 7) * 0.006 * size * dt
      p.a += p.va * dt
      if (p.x > W + 10) {
        p.x = -10
        p.y = rnd(0, H)
      }
      c.save()
      c.translate(p.x, p.y)
      c.rotate(p.a)
      c.beginPath()
      c.moveTo(0, -p.s)
      c.quadraticCurveTo(p.s, -p.s * 0.2, 0, p.s)
      c.quadraticCurveTo(-p.s, -p.s * 0.2, 0, -p.s)
      c.fill()
      c.restore()
    }
  }
  function drawStriders(c: Ctx, dt: number): void {
    const col = P.strider ?? 'rgba(40,40,30,.7)'
    for (const s of striders) {
      s.wait -= dt
      if (s.wait < 0) {
        s.a += rnd(-1.2, 1.2)
        s.v = rnd(0.25, 0.45) * size
        s.wait = rnd(1.5, 4)
      }
      s.x += Math.cos(s.a) * s.v * dt
      s.y += Math.sin(s.a) * s.v * dt
      s.v *= Math.pow(0.04, dt)
      if (s.x < 0) s.x = W
      if (s.x > W) s.x = 0
      if (s.y < 0) s.y = H
      if (s.y > H) s.y = 0
      const l = 0.012 * size
      c.save()
      c.translate(s.x, s.y)
      c.rotate(s.a)
      c.lineWidth = 0.7
      for (const [dx, ex, ey] of [
        [0.3, 1.1, 0.9],
        [0, 0.2, 1.6],
        [-0.2, -1.4, 1.3]
      ] as const) {
        for (const side of [1, -1]) {
          c.strokeStyle = col
          c.beginPath()
          c.moveTo(dx * l, 0)
          c.lineTo(ex * l, ey * l * side)
          c.stroke()
          // the dimple each foot makes in the water
          c.strokeStyle = `rgba(${P.ring},${P.night ? 0.25 : 0.5})`
          c.beginPath()
          c.arc(ex * l, ey * l * side, l * 0.18, 0, TAU)
          c.stroke()
        }
      }
      c.fillStyle = col
      c.beginPath()
      c.ellipse(0, 0, l * 0.55, l * 0.12, 0, 0, TAU)
      c.fill()
      c.restore()
    }
  }
  function drawFrog(c: Ctx, t: number): void {
    if (!frog) return
    const col = P.frog ?? ['#5f9a3a', '#c9d98a', '#2a3a1c']
    const s = 0.03 * size
    c.save()
    c.translate(frog.pad.x, frog.pad.y)
    c.rotate(frog.a)
    c.fillStyle = 'rgba(0,0,0,.18)'
    c.beginPath()
    c.ellipse(s * 0.1, s * 0.15, s * 0.95, s * 0.75, 0, 0, TAU)
    c.fill()
    c.fillStyle = col[0]
    for (const side of [1, -1]) {
      c.beginPath()
      c.ellipse(-s * 0.45, side * s * 0.62, s * 0.55, s * 0.22, side * 0.5, 0, TAU)
      c.fill()
      c.beginPath()
      c.ellipse(s * 0.5, side * s * 0.5, s * 0.3, s * 0.1, side * -0.7, 0, TAU)
      c.fill()
    }
    c.beginPath()
    c.ellipse(0, 0, s * 0.8, s * 0.55, 0, 0, TAU)
    c.fill()
    c.fillStyle = 'rgba(0,0,0,.18)'
    for (const [dx, dy] of [
      [-0.3, 0.15],
      [0, -0.22],
      [-0.1, 0.3],
      [0.25, 0.05]
    ]) {
      c.beginPath()
      c.arc(dx * s, dy * s, s * 0.08, 0, TAU)
      c.fill()
    }
    // its throat, pulsing
    const puff = 0.12 + Math.max(0, Math.sin(t * 2.5 + frog.ph)) * 0.08
    c.fillStyle = col[1]
    c.beginPath()
    c.ellipse(s * 0.62, 0, s * puff, s * puff * 1.4, 0, 0, TAU)
    c.fill()
    for (const side of [1, -1]) {
      c.fillStyle = col[0]
      c.beginPath()
      c.arc(s * 0.45, side * s * 0.28, s * 0.17, 0, TAU)
      c.fill()
      c.fillStyle = col[2]
      c.beginPath()
      c.arc(s * 0.5, side * s * 0.3, s * 0.08, 0, TAU)
      c.fill()
      c.fillStyle = P.night ? 'rgba(255,250,210,.9)' : 'rgba(255,255,255,.7)'
      c.beginPath()
      c.arc(s * 0.52, side * s * 0.27, s * 0.03, 0, TAU)
      c.fill()
    }
    c.restore()
  }
  function drawBubbles(c: Ctx, dt: number): void {
    if (Math.random() < 0.5 * dt * n(1))
      bubbles.push({ x: rnd(0, W), y: rnd(0, H), life: 0, n: 1 + ((Math.random() * 3) | 0) })
    for (const b of bubbles) {
      b.life += dt
      for (let k = 0; k < b.n; k++) {
        const p = b.life - k * 0.25
        if (p < 0 || p > 1.4) continue
        const x = b.x + k * 3
        const y = b.y - k * 2
        if (p < 1.1) {
          const r = 1.2 + p * 2.2
          c.strokeStyle = `rgba(${P.ring},${0.55 * (1 - p / 1.1)})`
          c.lineWidth = 0.8
          c.beginPath()
          c.arc(x, y, r, 0, TAU)
          c.stroke()
          c.fillStyle = `rgba(${P.ring},${0.35 * (1 - p / 1.1)})`
          c.beginPath()
          c.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, TAU)
          c.fill()
        } else {
          c.strokeStyle = `rgba(${P.ring},${0.35 * (1 - (p - 1.1) / 0.3)})`
          c.lineWidth = 0.6
          c.beginPath()
          c.arc(x, y, 4 + (p - 1.1) * 25, 0, TAU)
          c.stroke()
        }
      }
    }
    bubbles = bubbles.filter((b) => b.life < 2.2)
  }
  /** Everything floating, on one layer, dimmed a little at night. */
  function surfaceLayer(t: number, dt: number): void {
    tctx.globalCompositeOperation = 'source-over'
    tctx.clearRect(0, 0, W, H)
    if (has('duckweed')) drawDuck(tctx, dt)
    drawPads(tctx, dt)
    if (has('lotus')) drawLotus(tctx, t, dt)
    if (has('frog')) drawFrog(tctx, t)
    if (has('leaves')) drawLeaves(tctx, t, dt)
    if (has('petals')) drawPetals(tctx, t, dt)
    if (has('striders')) drawStriders(tctx, dt)
    if (has('bubbles')) drawBubbles(tctx, dt)
    if (P.dim) {
      tctx.globalCompositeOperation = 'source-atop'
      tctx.globalAlpha = P.dim
      tctx.fillStyle = P.dimTo ?? '#000'
      tctx.fillRect(0, 0, W, H)
      tctx.globalAlpha = 1
      tctx.globalCompositeOperation = 'source-over'
    }
  }

  // ---- Above the water.
  function drawReeds(ctx: Ctx, t: number): void {
    for (const pass of [0, 1]) {
      for (const r of reeds) {
        const sway = Math.sin(t * 0.7 + r.ph) * 0.035
        const ex = r.x + Math.cos(r.ang + sway) * r.len
        const ey = r.y + Math.sin(r.ang + sway) * r.len
        const mx = r.x + Math.cos(r.ang + r.bend + sway) * r.len * 0.55
        const my = r.y + Math.sin(r.ang + r.bend + sway) * r.len * 0.55
        const ox = pass ? 0 : r.len * 0.05
        const oy = pass ? 0 : r.len * 0.08
        const shadow = P.night ? 'rgba(0,0,0,.35)' : 'rgba(20,60,40,.16)'
        ctx.strokeStyle = pass ? r.c : shadow
        ctx.lineWidth = r.w
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(r.x + ox, r.y + oy)
        ctx.quadraticCurveTo(mx + ox, my + oy, ex + ox, ey + oy)
        ctx.stroke()
        if (r.tail) {
          const ta = Math.atan2(ey - my, ex - mx)
          ctx.fillStyle = pass ? (P.cattail ?? '#7a4b2a') : shadow
          ctx.beginPath()
          ctx.ellipse(
            ex + ox - Math.cos(ta) * 0.03 * size,
            ey + oy - Math.sin(ta) * 0.03 * size,
            0.035 * size,
            0.009 * size,
            ta,
            0,
            TAU
          )
          ctx.fill()
        }
      }
    }
  }
  function drawBranch(ctx: Ctx, t: number): void {
    if (!shade) return
    const sx = Math.sin(t * 0.45) * 0.012 * size
    const sy = Math.cos(t * 0.38) * 0.008 * size
    for (const b of branch) {
      const w = Math.sin(t * 1.1 + b.ph) * 0.15
      ctx.save()
      ctx.translate(b.x + sx, b.y + sy)
      ctx.rotate(b.rot + w)
      ctx.drawImage(shade, -b.r * 1.6, -b.r * 1.6, b.r * 3.2, b.r * 3.2)
      ctx.restore()
    }
    ctx.strokeStyle = P.branch ?? 'rgba(0,0,0,.1)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(W + 10 + sx, -10 + sy)
    ctx.quadraticCurveTo(
      W - 0.25 * size + sx,
      0.12 * size + sy,
      W - 0.48 * size + sx,
      0.2 * size + sy
    )
    ctx.stroke()
  }
  function drawDragons(ctx: Ctx, t: number, dt: number): void {
    for (const d of dragons) {
      d.wait -= dt
      const dx = d.tx - d.x
      const dy = d.ty - d.y
      const dist = Math.hypot(dx, dy)
      if (d.wait < 0 && dist < 2) {
        d.tx = rnd(0.05, 0.95) * W
        d.ty = rnd(0.05, 0.95) * H
        d.wait = rnd(0.8, 2.5)
      }
      if (dist > 1) {
        const sp = Math.min(dist, 0.5 * size * dt)
        d.x += (dx / dist) * sp
        d.y += (dy / dist) * sp
        d.a = Math.atan2(dy, dx)
      }
      const hx = Math.sin(t * 7 + d.tx) * 0.6
      const hy = Math.cos(t * 6 + d.ty) * 0.6
      const l = 0.075 * size
      for (const pass of [0, 1]) {
        ctx.save()
        ctx.translate(d.x + hx + (pass ? 0 : l * 0.9), d.y + hy + (pass ? 0 : l * 1.2))
        ctx.rotate(d.a)
        const flick = 0.75 + Math.sin(t * 60) * 0.25
        ctx.fillStyle = pass ? (P.dragon?.[1] ?? 'rgba(220,240,255,.45)') : 'rgba(10,40,40,.10)'
        ctx.strokeStyle = 'rgba(60,80,90,.35)'
        ctx.lineWidth = 0.6
        for (const [wx, side, wl] of [
          [0.12, 1, 0.55],
          [0.12, -1, 0.55],
          [-0.05, 1, 0.48],
          [-0.05, -1, 0.48]
        ] as const) {
          ctx.beginPath()
          ctx.ellipse(
            wx * l,
            side * wl * l * 0.5 * flick,
            wl * l * 0.5,
            l * 0.09,
            side * 0.15,
            0,
            TAU
          )
          ctx.fill()
          if (pass) ctx.stroke()
        }
        ctx.fillStyle = pass ? d.body : 'rgba(10,40,40,.14)'
        ctx.beginPath()
        ctx.ellipse(-l * 0.25, 0, l * 0.55, l * 0.035, 0, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(l * 0.12, 0, l * 0.13, l * 0.06, 0, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(l * 0.3, 0, l * 0.07, 0, TAU)
        ctx.fill()
        ctx.restore()
      }
    }
  }
  function drawFlies(ctx: Ctx, t: number, dt: number): void {
    for (const f of flies) {
      f.x += Math.cos(t * 0.3 * f.sp + f.ph) * 6 * dt
      f.y += Math.sin(t * 0.37 * f.sp + f.ph * 2) * 5 * dt
      const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * f.sp * 1.6 + f.ph))
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 9)
      g.addColorStop(0, `rgba(230,255,150,${a})`)
      g.addColorStop(1, 'rgba(230,255,150,0)')
      ctx.fillStyle = g
      ctx.fillRect(f.x - 9, f.y - 9, 18, 18)
    }
  }

  return {
    resize,
    step(ctx, t, dt) {
      if (!water || !W) return
      const raw = (draw: () => void): void => {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        draw()
        ctx.restore()
      }
      raw(() => ctx.drawImage(water!, 0, 0))
      if (has('caustics')) drawCaustics(ctx, t)
      belowLayer(t, dt)
      raw(() => {
        if (P.glow) {
          ctx.shadowColor = 'rgba(255,140,80,.55)'
          ctx.shadowBlur = P.glow * D
        }
        ctx.drawImage(under, 0, 0)
      })
      drawRipples(ctx, dt)
      surfaceLayer(t, dt)
      raw(() => ctx.drawImage(top, 0, 0))
      if (has('branch')) drawBranch(ctx, t)
      if (has('reeds')) drawReeds(ctx, t)
      if (has('dragonflies')) drawDragons(ctx, t, dt)
      if (has('fireflies')) drawFlies(ctx, t, dt)
    }
  }
}

const DAY_KOI: [string, string][] = [
  ['#f07a2a', '#ffffff'],
  ['#ffffff', '#e84a2a'],
  ['#f2a33a', '#f2a33a'],
  ['#e85a2a', '#1d1d1d']
]
const NIGHT_KOI: [string, string][] = [
  ['#ff8a3d', '#fff4ea'],
  ['#f4efe6', '#ff5a36'],
  ['#ffb34a', '#ffb34a'],
  ['#ff6a3a', '#141414']
]
const DAY_PAD = { pad: '#4f9a4a', padEdge: 'rgba(30,80,30,.4)', petal: '#f7c1d4', heart: '#f6d34a' }
const NIGHT_PAD = {
  pad: '#17432f',
  padEdge: 'rgba(140,210,170,.22)',
  petal: '#d9a3b6',
  heart: '#d8b955'
}

/** The pond themes. */
export const PONDS = {
  koi: {
    water: ['#cdeee8', '#a9ddd5', '#8fcfc6'],
    night: false,
    things: ['pads'],
    sink: 0,
    sinkTo: '#8fcfc6',
    ...DAY_PAD,
    ring: '255,255,255',
    shadow: 'rgba(20,70,70,.2)',
    shine: 'rgba(255,255,255,.22)',
    koi: DAY_KOI
  },
  garden: {
    water: ['#d6f0e8', '#b6e0d5', '#98cfc3'],
    night: false,
    things: ['caustics', 'pads', 'turtle', 'fry', 'lotus', 'leaves', 'striders', 'dragonflies'],
    sink: 0.08,
    sinkTo: '#98cfc3',
    ...DAY_PAD,
    ring: '255,255,255',
    shadow: 'rgba(20,70,70,.2)',
    shine: 'rgba(255,255,255,.22)',
    koi: DAY_KOI,
    lotusLeaf: '#5aa04f',
    lotusVein: 'rgba(220,255,200,.35)',
    lotusPetal: ['#ffffff', '#f6a9c4'],
    lotusCore: '#f2cf4a',
    bud: '#f39bbb',
    leafCols: ['#f2c230', '#e8752a', '#d9472b'],
    turtle: ['#5b6b3a', '#3c4a26', '#8a9a5c'],
    fry: '#e9e2c8',
    strider: 'rgba(40,40,30,.7)',
    dragon: ['#2a7fb8', 'rgba(220,240,255,.45)']
  },
  reeds: {
    water: ['#dbefd8', '#bfe0c4', '#a2d0b0'],
    night: false,
    things: [
      'pads',
      'reeds',
      'duckweed',
      'frog',
      'petals',
      'bubbles',
      'branch',
      'striders',
      'dragonflies'
    ],
    sink: 0.06,
    sinkTo: '#a2d0b0',
    ...DAY_PAD,
    ring: '255,255,255',
    shadow: 'rgba(20,70,50,.2)',
    shine: 'rgba(255,255,255,.22)',
    koi: DAY_KOI,
    reed: ['#6f9a3c', '#86ad4a', '#5a8433'],
    cattail: '#7a4b2a',
    duck: ['#7fbf4a', '#9ad25c'],
    frog: ['#5f9a3a', '#c9d98a', '#2a3a1c'],
    blossom: '#f9c6d6',
    strider: 'rgba(40,40,30,.7)',
    dragon: ['#c0392b', 'rgba(255,240,230,.45)'],
    branch: 'rgba(30,70,40,.13)'
  },
  stillnight: {
    water: ['#0c2b31', '#07191d', '#030b0d'],
    night: true,
    things: ['pads', 'sky'],
    sink: 0.55,
    sinkTo: '#0a2329',
    ...NIGHT_PAD,
    ring: '190,225,230',
    shadow: 'rgba(0,0,0,.3)',
    shine: 'rgba(200,235,240,.22)',
    koi: NIGHT_KOI
  },
  nightgarden: {
    water: ['#0d2a2c', '#08191b', '#030b0c'],
    night: true,
    things: ['pads', 'turtle', 'lotus', 'frog', 'bubbles', 'striders', 'fireflies'],
    sink: 0.55,
    sinkTo: '#0a2224',
    dim: 0.35,
    dimTo: '#061517',
    fewFlies: true,
    closed: true,
    ...NIGHT_PAD,
    ring: '190,225,230',
    shadow: 'rgba(0,0,0,.3)',
    shine: 'rgba(200,235,240,.22)',
    koi: NIGHT_KOI,
    lotusLeaf: '#2f6a3d',
    lotusVein: 'rgba(160,220,180,.25)',
    lotusPetal: ['#f3e3ea', '#e48cad'],
    lotusCore: '#e3c04a',
    bud: '#e88fb0',
    turtle: ['#4a5a33', '#2e3a20', '#76865a'],
    frog: ['#4f8a34', '#b8c87a', '#1f2a14'],
    strider: 'rgba(180,220,210,.5)'
  },
  glowkoi: {
    water: ['#071417', '#040c0e', '#010405'],
    night: true,
    things: ['pads', 'fireflies'],
    sink: 0.3,
    sinkTo: '#051012',
    glow: 14,
    pad: '#163d2c',
    padEdge: 'rgba(150,255,180,.18)',
    petal: '#ffb9d6',
    heart: '#ffe27a',
    ring: '170,255,220',
    shadow: 'rgba(0,0,0,.45)',
    shine: 'rgba(255,255,255,.25)',
    koi: [
      ['#ff7a3a', '#ffe9da'],
      ['#ffeedd', '#ff4d3a'],
      ['#ffb03d', '#ffb03d'],
      ['#ff6236', '#1a1a1a']
    ]
  }
} satisfies Record<string, PondLook>
