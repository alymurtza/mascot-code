/**
 * Moving backdrops for the special themes, drawn on a canvas behind the page. Each theme is a
 * list of layers (stars, petals, jellyfish…); skies and hills that don't move are CSS.
 */
import type { Special } from '@shared/settings'
import { pondLayer, PONDS } from './pond'

type Ctx = CanvasRenderingContext2D
interface Layer {
  resize(w: number, h: number): void
  step(ctx: Ctx, t: number, dt: number, w: number, h: number): void
}

const TAU = Math.PI * 2
const rnd = (a: number, b: number): number => a + Math.random() * (b - a)
const pick = <T>(a: readonly T[]): T => a[(Math.random() * a.length) | 0]
/** How many of something to draw: `n` for a small preview, more (but not by area) for a window. */
const count = (n: number, w: number, h: number): number =>
  Math.max(1, Math.round(n * Math.sqrt((w * h) / (300 * 190))))
let DPR = 1

const glows = new Map<string, HTMLCanvasElement>()
/** A soft round light, drawn once per colour and reused. */
function glow(rgb: string): HTMLCanvasElement {
  let c = glows.get(rgb)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, `rgba(${rgb},1)`)
  gr.addColorStop(0.22, `rgba(${rgb},.55)`)
  gr.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  glows.set(rgb, c)
  return c
}
function sparkle(ctx: Ctx, x: number, y: number, l: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y - l)
  ctx.quadraticCurveTo(x, y, x + l, y)
  ctx.quadraticCurveTo(x, y, x, y + l)
  ctx.quadraticCurveTo(x, y, x - l, y)
  ctx.quadraticCurveTo(x, y, x, y - l)
  ctx.fill()
}
function offscreen(w: number, h: number, draw: (g: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * DPR))
  c.height = Math.max(1, Math.round(h * DPR))
  const g = c.getContext('2d')!
  g.scale(DPR, DPR)
  draw(g)
  return c
}
const hillY = (
  x: number,
  w: number,
  h: number,
  base: number,
  amp: number,
  f: number,
  ph: number
): number => h * base - Math.sin((x / w) * Math.PI * f + ph) * h * amp
function hill(
  g: Ctx,
  w: number,
  h: number,
  base: number,
  amp: number,
  f: number,
  ph: number,
  fill: string
): void {
  g.fillStyle = fill
  g.beginPath()
  g.moveTo(0, h)
  for (let x = 0; x <= w; x += 4) g.lineTo(x, hillY(x, w, h, base, amp, f, ph))
  g.lineTo(w, h)
  g.fill()
}

// ── Layers ────────────────────────────────────────────────────────────────

interface StarOpts {
  density?: number
  sparkle?: number
  maxY?: number
  colors?: string[]
}
/** Stars: small points and bright four-pointed sparkles, each twinkling on its own. */
function stars(o: StarOpts = {}): Layer {
  type Star = {
    x: number
    y: number
    r: number
    a: number
    p: number
    s: number
    big: boolean
    c: string
  }
  let list: Star[] = []
  return {
    resize(w, h) {
      list = Array.from({ length: count(80 * (o.density ?? 1), w, h) }, () => {
        const big = Math.random() < (o.sparkle ?? 0.1)
        return {
          x: rnd(0, w),
          y: rnd(0, h * (o.maxY ?? 1)),
          r: big ? rnd(1.4, 2.4) : rnd(0.35, 1),
          a: rnd(0.35, 1),
          p: rnd(0, TAU),
          s: rnd(0.5, 2),
          big,
          c: pick(o.colors ?? ['255,255,255', '210,222,255', '255,236,210'])
        }
      })
    },
    step(ctx, t) {
      for (const s of list) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.s + s.p)
        ctx.globalAlpha = s.a * (0.35 + 0.65 * tw)
        ctx.fillStyle = `rgb(${s.c})`
        if (s.big) {
          const r = s.r * (4.5 + 1.5 * tw)
          ctx.drawImage(glow(s.c), s.x - r, s.y - r, r * 2, r * 2)
          sparkle(ctx, s.x, s.y, s.r * (3 + 2.5 * tw))
        } else {
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r, 0, TAU)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
  }
}

/** Shooting stars: a bright head with a fading tail. */
function meteors(o: { rate?: number; color?: string } = {}): Layer {
  type M = { x: number; y: number; vx: number; vy: number; len: number; life: number; max: number }
  let list: M[] = []
  let W = 0
  let H = 0
  return {
    resize(w, h) {
      W = w
      H = h
    },
    step(ctx, _t, dt) {
      if (Math.random() < (o.rate ?? 0.25) * dt * count(1, W, H)) {
        const ang = rnd(0.42, 0.62)
        const sp = rnd(1.1, 1.7) * Math.min(W, 700)
        list.push({
          x: rnd(W * 0.3, W * 1.15),
          y: rnd(-H * 0.1, H * 0.35),
          vx: -Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          len: rnd(0.18, 0.32) * Math.min(W, 700),
          life: 0,
          max: rnd(0.55, 0.9)
        })
      }
      const c = o.color ?? '255,236,220'
      for (const m of list) {
        m.life += dt
        m.x += m.vx * dt
        m.y += m.vy * dt
        const a = Math.sin(Math.PI * Math.min(1, m.life / m.max))
        const sp = Math.hypot(m.vx, m.vy)
        const tx = m.x - (m.vx / sp) * m.len
        const ty = m.y - (m.vy / sp) * m.len
        const gr = ctx.createLinearGradient(m.x, m.y, tx, ty)
        gr.addColorStop(0, `rgba(${c},${a})`)
        gr.addColorStop(0.3, `rgba(${c},${a * 0.45})`)
        gr.addColorStop(1, `rgba(${c},0)`)
        ctx.strokeStyle = gr
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        ctx.globalAlpha = a
        ctx.drawImage(glow(c), m.x - 7, m.y - 7, 14, 14)
        ctx.globalAlpha = 1
      }
      list = list.filter((m) => m.life < m.max)
    }
  }
}

/** A bank of soft clouds or mist drifting sideways. */
function clouds(
  o: {
    color?: string
    n?: number
    top?: number
    bottom?: number
    alpha?: number
    speed?: number
  } = {}
): Layer {
  let puffs: { x: number; y: number; r: number }[] = []
  let W = 0
  return {
    resize(w, h) {
      W = w
      puffs = Array.from({ length: count(o.n ?? 20, w, h) }, () => ({
        x: rnd(-0.1, 1.1) * w,
        y: rnd(o.top ?? -0.05, o.bottom ?? 0.22) * h,
        r: rnd(0.12, 0.26) * Math.min(w, h * 1.6)
      }))
    },
    step(ctx, _t, dt) {
      const g = glow(o.color ?? '255,255,255')
      ctx.globalAlpha = o.alpha ?? 0.9
      for (const p of puffs) {
        p.x += (o.speed ?? 0.012) * W * dt
        if (p.x - p.r > W) p.x = -p.r
        ctx.drawImage(g, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
      }
      ctx.globalAlpha = 1
    }
  }
}

type Shape = (ctx: Ctx, s: number) => void
const petal: Shape = (ctx, s) => {
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.bezierCurveTo(s * 1.1, -s * 0.9, s * 0.8, s * 0.7, 0, s)
  ctx.bezierCurveTo(-s * 0.8, s * 0.7, -s * 1.1, -s * 0.9, 0, -s)
  ctx.fill()
}
const leaf: Shape = (ctx, s) => {
  ctx.beginPath()
  ctx.moveTo(0, -s * 1.6)
  ctx.quadraticCurveTo(s * 0.9, 0, 0, s * 1.6)
  ctx.quadraticCurveTo(-s * 0.9, 0, 0, -s * 1.6)
  ctx.fill()
  ctx.strokeStyle = 'rgba(30,60,20,.3)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(0, -s * 1.5)
  ctx.lineTo(0, s * 1.5)
  ctx.stroke()
}

/** Petals or leaves tumbling down, turning over as they fall. */
function tumble(o: {
  colors: string[]
  shape: Shape
  size?: number
  density?: number
  wind?: number
}): Layer {
  type It = {
    x: number
    y: number
    z: number
    rot: number
    spin: number
    flip: number
    fs: number
    p: number
    c: string
  }
  let items: It[] = []
  let W = 0
  let H = 0
  let unit = 1
  return {
    resize(w, h) {
      W = w
      H = h
      unit = Math.min(h, 600) / 170
      items = Array.from({ length: count(38 * (o.density ?? 1), w, h) }, () => ({
        x: rnd(0, w),
        y: rnd(0, h),
        z: rnd(0.35, 1),
        rot: rnd(0, TAU),
        spin: rnd(-2, 2),
        flip: rnd(0, TAU),
        fs: rnd(1.5, 3.5),
        p: rnd(0, TAU),
        c: pick(o.colors)
      }))
    },
    step(ctx, t, dt) {
      for (const it of items) {
        it.y += (0.05 + 0.1 * it.z) * Math.min(H, 600) * dt
        it.x += (Math.sin(t * 0.8 + it.p) * 14 - (o.wind ?? 10)) * it.z * unit * dt
        it.rot += it.spin * dt
        it.flip += it.fs * dt
        if (it.y > H + 8) {
          it.y = -8
          it.x = rnd(0, W * 1.2)
        }
        if (it.x < -10) it.x = W + 10
        const s = (o.size ?? 3) * (0.6 + 0.6 * it.z) * unit
        ctx.save()
        ctx.translate(it.x, it.y)
        ctx.rotate(it.rot)
        ctx.scale(Math.cos(it.flip), 1)
        ctx.globalAlpha = 0.55 + 0.45 * it.z
        ctx.fillStyle = it.c
        o.shape(ctx, s)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }
  }
}

/** Birds gliding past, wings beating. */
function birds(o: { n?: number; color?: string } = {}): Layer {
  let list: { x: number; y: number; s: number; v: number; p: number }[] = []
  let W = 0
  let H = 0
  return {
    resize(w, h) {
      W = w
      H = h
      list = Array.from({ length: o.n ?? 4 }, () => ({
        x: rnd(0, w),
        y: rnd(0.12, 0.45) * h,
        s: rnd(2.5, 4.5),
        v: rnd(0.04, 0.08),
        p: rnd(0, TAU)
      }))
    },
    step(ctx, t, dt) {
      ctx.strokeStyle = o.color ?? 'rgba(70,55,80,.55)'
      ctx.lineWidth = 1.2
      ctx.lineCap = 'round'
      const unit = Math.min(H, 600) / 170
      for (const b of list) {
        b.x += b.v * Math.min(W, 900) * dt
        b.y += Math.sin(t + b.p) * 0.02 * H * dt
        if (b.x > W + 10) {
          b.x = -10
          b.y = rnd(0.12, 0.45) * H
        }
        const f = Math.sin(t * 7 + b.p) * b.s * 0.6
        const s = b.s * unit
        ctx.beginPath()
        ctx.moveTo(b.x - s, b.y - f)
        ctx.quadraticCurveTo(b.x - s * 0.4, b.y - s * 0.2, b.x, b.y)
        ctx.quadraticCurveTo(b.x + s * 0.4, b.y - s * 0.2, b.x + s, b.y - f)
        ctx.stroke()
      }
    }
  }
}

/** Scenery that doesn't move, drawn once per size. */
function scene(draw: (g: Ctx, w: number, h: number) => void): Layer {
  let img: HTMLCanvasElement | null = null
  return {
    resize(w, h) {
      img = offscreen(w, h, (g) => draw(g, w, h))
    },
    step(ctx, _t, _dt, w, h) {
      if (img) ctx.drawImage(img, 0, 0, w, h)
    }
  }
}

function branch(
  g: Ctx,
  x: number,
  y: number,
  ang: number,
  len: number,
  wid: number,
  depth: number,
  flowers: [number, number][]
): void {
  const x2 = x + Math.cos(ang) * len
  const y2 = y + Math.sin(ang) * len
  g.strokeStyle = '#5b3a3a'
  g.lineCap = 'round'
  g.lineWidth = wid
  g.beginPath()
  g.moveTo(x, y)
  g.quadraticCurveTo((x + x2) / 2 + rnd(-6, 6), (y + y2) / 2 + rnd(-6, 6), x2, y2)
  g.stroke()
  for (let i = 0; i < 3 + depth; i++) {
    const k = rnd(0.3, 1)
    flowers.push([x + (x2 - x) * k + rnd(-5, 5), y + (y2 - y) * k + rnd(-5, 5)])
  }
  if (depth > 0) {
    branch(g, x2, y2, ang + rnd(0.25, 0.55), len * 0.68, wid * 0.62, depth - 1, flowers)
    branch(g, x2, y2, ang - rnd(0.25, 0.55), len * 0.62, wid * 0.6, depth - 1, flowers)
  }
}
function blossomScene(g: Ctx, w: number, h: number): void {
  hill(g, w, h, 0.9, 0.05, 1.4, 1, '#f6dbe2')
  for (let i = 0; i < count(6, w, h); i++) {
    const x = rnd(0, w)
    const y = hillY(x, w, h, 0.9, 0.05, 1.4, 1)
    g.globalAlpha = 0.55
    g.drawImage(glow('243,180,198'), x - h * 0.14, y - h * 0.2, h * 0.28, h * 0.28)
  }
  g.globalAlpha = 1
  hill(g, w, h, 0.97, 0.03, 1, 2.5, '#f0cbd5')
  const flowers: [number, number][] = []
  const size = Math.min(w, h * 1.6)
  branch(g, w + 4, h * 0.04, Math.PI * 0.86, size * 0.28, Math.max(2.5, size * 0.018), 3, flowers)
  const unit = Math.min(h, 600) / 170
  for (const [x, y] of flowers) {
    const s = rnd(2, 3.6) * unit
    g.fillStyle = pick(['#f7b7c8', '#f9c8d4', '#f4a7bd'])
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU
      g.beginPath()
      g.arc(x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 0.7, s * 0.62, 0, TAU)
      g.fill()
    }
    g.fillStyle = '#d9476c'
    g.beginPath()
    g.arc(x, y, s * 0.3, 0, TAU)
    g.fill()
  }
}

/** Jellyfish pulsing upward, trailing tentacles. */
function jellyfish(): Layer {
  type J = { x: number; y: number; s: number; p: number; c: string }
  let list: J[] = []
  let W = 0
  let H = 0
  return {
    resize(w, h) {
      W = w
      H = h
      const size = Math.min(h, 600)
      list = Array.from({ length: count(5, w, h) }, () => ({
        x: rnd(0.05, 0.95) * w,
        y: rnd(0.1, 1) * h,
        s: rnd(0.035, 0.065) * size,
        p: rnd(0, TAU),
        c: pick(['255,140,220', '140,200,255', '190,150,255', '255,190,140'])
      }))
    },
    step(ctx, t, dt) {
      for (const j of list) {
        const pulse = Math.sin(t * 1.8 + j.p)
        j.y -= (0.015 + 0.03 * Math.max(0, pulse)) * Math.min(H, 600) * dt
        j.x += Math.sin(t * 0.4 + j.p) * 0.01 * W * dt
        if (j.y < -j.s * 4) {
          j.y = H + j.s * 2
          j.x = rnd(0.05, 0.95) * W
        }
        const rx = j.s * (1 + 0.12 * pulse)
        const ry = j.s * (0.85 - 0.15 * pulse)
        ctx.globalAlpha = 0.5
        const r = j.s * 3.2
        ctx.drawImage(glow(j.c), j.x - r, j.y - r, r * 2, r * 2)
        ctx.globalAlpha = 1
        ctx.strokeStyle = `rgba(${j.c},.55)`
        ctx.lineWidth = 0.9
        for (let k = 0; k < 5; k++) {
          const bx = j.x + (k - 2) * rx * 0.35
          ctx.beginPath()
          ctx.moveTo(bx, j.y)
          for (let i = 1; i <= 8; i++)
            ctx.lineTo(
              bx + Math.sin(t * 2.4 - i * 0.7 + k + j.p) * j.s * 0.18 * (i / 8),
              j.y + i * j.s * 0.32
            )
          ctx.stroke()
        }
        ctx.fillStyle = `rgba(${j.c},.45)`
        ctx.beginPath()
        ctx.ellipse(j.x, j.y, rx, ry, 0, Math.PI, 0)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = `rgba(${j.c},.9)`
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,.35)'
        ctx.beginPath()
        ctx.ellipse(j.x - rx * 0.3, j.y - ry * 0.5, rx * 0.25, ry * 0.18, -0.4, 0, TAU)
        ctx.fill()
      }
    }
  }
}

/** Paper lanterns rising over the water, mirrored below. */
function lanterns(): Layer {
  type L = { x: number; y: number; s: number; v: number; p: number }
  let list: L[] = []
  let W = 0
  let H = 0
  const hz = 0.8
  return {
    resize(w, h) {
      W = w
      H = h
      const size = Math.min(h, 600)
      list = Array.from({ length: count(12, w, h) }, () => ({
        x: rnd(0, w),
        y: rnd(0.05, 0.78) * h,
        s: rnd(0.018, 0.035) * size,
        v: rnd(0.012, 0.03),
        p: rnd(0, TAU)
      }))
    },
    step(ctx, t, dt) {
      ctx.fillStyle = '#0a0814'
      ctx.beginPath()
      ctx.moveTo(0, H * hz)
      for (let x = 0; x <= W; x += 6)
        ctx.lineTo(x, H * hz - (Math.sin((x / W) * 5 + 1) * 0.5 + 0.5) * H * 0.05)
      ctx.lineTo(W, H * hz)
      ctx.fill()
      for (const l of list) {
        l.y -= l.v * H * dt
        l.x += Math.sin(t * 0.5 + l.p) * 0.008 * W * dt
        if (l.y < -l.s * 3) {
          l.y = H * hz - l.s
          l.x = rnd(0, W)
        }
        const f = 0.85 + 0.15 * Math.sin(t * 9 + l.p)
        const k = Math.min(1, (H * hz - l.y) / (H * 0.1))
        for (const [y, a, mirror] of [
          [l.y, 1, false],
          [2 * H * hz - l.y, 0.25, true]
        ] as const) {
          if (mirror && y > H) continue
          ctx.globalAlpha = a * f * k
          const r = l.s * 3.2
          ctx.drawImage(glow('255,170,70'), l.x - r, y - r, r * 2, r * 2)
          const gr = ctx.createLinearGradient(0, y - l.s, 0, y + l.s)
          gr.addColorStop(0, '#ffcf7a')
          gr.addColorStop(1, '#ff8a3a')
          ctx.fillStyle = gr
          ctx.beginPath()
          ctx.roundRect(l.x - l.s * 0.55, y - l.s * 0.7, l.s * 1.1, l.s * 1.4, l.s * 0.35)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
  }
}

/** Bamboo stalks swaying in rows. */
function bamboo(): Layer {
  type S = { x: number; w: number; col: string; node: string; p: number }
  let stalks: S[] = []
  let H = 0
  return {
    resize(w, h) {
      H = h
      stalks = []
      const size = Math.min(h, 600)
      for (const [n, wid, col, node] of [
        [8, 0.012, '#b9d6a4', '#a3c48c'],
        [5, 0.02, '#86b86a', '#6f9f55'],
        [3, 0.03, '#5a9a43', '#477f34']
      ] as const) {
        const m = count(n, w, h)
        for (let i = 0; i < m; i++)
          stalks.push({ x: ((i + rnd(0, 1)) / m) * w, w: size * wid, col, node, p: rnd(0, TAU) })
      }
    },
    step(ctx, t) {
      for (const s of stalks) {
        const sway = Math.sin(t * 0.7 + s.p) * H * 0.025
        ctx.strokeStyle = s.col
        ctx.lineWidth = s.w
        ctx.lineCap = 'butt'
        ctx.beginPath()
        ctx.moveTo(s.x, H + 2)
        ctx.quadraticCurveTo(s.x, H * 0.4, s.x + sway, -4)
        ctx.stroke()
        ctx.strokeStyle = s.node
        ctx.lineWidth = 1
        for (let k = 1; k < 7; k++) {
          const tk = k / 7
          const y = H - tk * (H + 4)
          const x = s.x + sway * tk * tk
          ctx.beginPath()
          ctx.moveTo(x - s.w / 2, y)
          ctx.lineTo(x + s.w / 2, y)
          ctx.stroke()
          if (s.w > Math.min(H, 600) * 0.015 && k % 2) {
            ctx.save()
            ctx.translate(x + s.w / 2, y)
            ctx.rotate(0.9 + Math.sin(t + s.p + k) * 0.1)
            ctx.fillStyle = s.col
            leaf(ctx, s.w * 0.7)
            ctx.restore()
          }
        }
      }
    }
  }
}

/** Hot air balloons drifting over the hills. */
function balloons(): Layer {
  type B = { x: number; y: number; s: number; v: number; p: number; c: [string, string] }
  let list: B[] = []
  let img: HTMLCanvasElement | null = null
  let W = 0
  let H = 0
  return {
    resize(w, h) {
      W = w
      H = h
      img = offscreen(w, h, (g) => {
        hill(g, w, h, 0.82, 0.06, 1.5, 0.2, '#b7d3a4')
        hill(g, w, h, 0.92, 0.04, 1.1, 2, '#9cc58a')
      })
      const size = Math.min(h, 600)
      list = Array.from({ length: count(5, w, h) }, (_, i) => ({
        x: rnd(0, w),
        y: (i % 2 ? rnd(0.06, 0.16) : rnd(0.62, 0.7)) * h,
        s: rnd(0.045, 0.075) * size,
        v: rnd(0.008, 0.02),
        p: rnd(0, TAU),
        c: pick([
          ['#e2475b', '#f6c344'],
          ['#3d86f0', '#ffffff'],
          ['#8a63c9', '#f6c344'],
          ['#2b9d8f', '#f28b5a'],
          ['#f28b5a', '#ffffff']
        ] as [string, string][])
      }))
    },
    step(ctx, t, dt) {
      if (img) ctx.drawImage(img, 0, 0, W, H)
      for (const b of list) {
        b.x += b.v * Math.min(W, 900) * dt
        const y = b.y + Math.sin(t * 0.6 + b.p) * H * 0.02
        if (b.x > W + b.s * 2) b.x = -b.s * 2
        const s = b.s
        ctx.save()
        ctx.beginPath()
        ctx.arc(b.x, y, s, Math.PI * 0.9, Math.PI * 0.1)
        ctx.quadraticCurveTo(b.x + s * 0.9, y + s * 0.9, b.x + s * 0.25, y + s * 1.35)
        ctx.lineTo(b.x - s * 0.25, y + s * 1.35)
        ctx.quadraticCurveTo(
          b.x - s * 0.9,
          y + s * 0.9,
          b.x - s * Math.cos(Math.PI * 0.1),
          y + s * Math.sin(Math.PI * 0.1)
        )
        ctx.closePath()
        ctx.clip()
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = b.c[k % 2]
          ctx.fillRect(b.x - s + (k * s) / 3, y - s, s / 3 + 0.5, s * 2.5)
        }
        const sh = ctx.createLinearGradient(b.x - s, 0, b.x + s, 0)
        sh.addColorStop(0, 'rgba(255,255,255,.25)')
        sh.addColorStop(1, 'rgba(0,0,0,.18)')
        ctx.fillStyle = sh
        ctx.fillRect(b.x - s, y - s, s * 2, s * 2.5)
        ctx.restore()
        ctx.strokeStyle = 'rgba(90,60,40,.7)'
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(b.x - s * 0.25, y + s * 1.35)
        ctx.lineTo(b.x - s * 0.15, y + s * 1.65)
        ctx.moveTo(b.x + s * 0.25, y + s * 1.35)
        ctx.lineTo(b.x + s * 0.15, y + s * 1.65)
        ctx.stroke()
        ctx.fillStyle = '#8a5a3c'
        ctx.fillRect(b.x - s * 0.18, y + s * 1.62, s * 0.36, s * 0.26)
      }
    }
  }
}

const RECIPES: Record<Special, () => Layer[]> = {
  aurora: () => [stars({ density: 0.7, sparkle: 0.06, maxY: 0.7 })],
  meteor: () => [stars({ density: 1.1, sparkle: 0.08 }), meteors({ rate: 1.6 })],
  jellyfish: () => [stars({ density: 0.5, sparkle: 0, colors: ['150,200,255'] }), jellyfish()],
  lanterns: () => [stars({ density: 0.5, sparkle: 0.05, maxY: 0.45 }), lanterns()],
  blossom: () => [
    scene(blossomScene),
    tumble({
      colors: ['#f7b7c8', '#f4a7bd', '#fbd1dc'],
      shape: petal,
      size: 2.6,
      density: 1.3,
      wind: 12
    })
  ],
  mountains: () => [
    clouds({ color: '255,255,255', n: 14, top: 0.45, bottom: 0.8, alpha: 0.55, speed: 0.02 }),
    birds({ n: 3, color: 'rgba(60,70,90,.45)' })
  ],
  dunes: () => [birds({ n: 2, color: 'rgba(90,60,30,.4)' })],
  bamboo: () => [
    bamboo(),
    tumble({
      colors: ['#7fb35f', '#9cc77a', '#5f9a43'],
      shape: leaf,
      size: 2.2,
      density: 0.5,
      wind: 8
    })
  ],
  koi: () => [pondLayer(PONDS.koi, () => DPR)],
  garden: () => [pondLayer(PONDS.garden, () => DPR)],
  reeds: () => [pondLayer(PONDS.reeds, () => DPR)],
  stillnight: () => [pondLayer(PONDS.stillnight, () => DPR)],
  nightgarden: () => [pondLayer(PONDS.nightgarden, () => DPR)],
  glowkoi: () => [pondLayer(PONDS.glowkoi, () => DPR)],
  balloons: () => [
    clouds({ color: '255,255,255', n: 10, top: 0.05, bottom: 0.35, alpha: 0.7, speed: 0.01 }),
    balloons()
  ]
}

/**
 * Runs a backdrop on `canvas` until the returned function is called. It pauses while the window
 * is hidden, and draws one still frame when the system asks for less motion.
 */
export function runBackdrop(
  canvas: HTMLCanvasElement,
  key: Special,
  options: { fps?: number; still?: boolean } = {}
): () => void {
  const layers = RECIPES[key]()
  const ctx = canvas.getContext('2d')
  if (!ctx || layers.length === 0) return () => {}
  DPR = Math.min(1.5, window.devicePixelRatio || 1)
  let w = 0
  let h = 0
  let t = rnd(0, 20)
  let last = performance.now()
  let frame = 0
  let visible = true
  const draw = (dt: number): void => {
    if (!w) return
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    ctx.clearRect(0, 0, w, h)
    t += dt
    for (const l of layers) l.step(ctx, t, dt, w, h)
  }
  const size = (): void => {
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    w = r.width
    h = r.height
    canvas.width = Math.round(w * DPR)
    canvas.height = Math.round(h * DPR)
    layers.forEach((l) => l.resize(w, h))
    draw(0)
  }
  const resize = new ResizeObserver(size)
  resize.observe(canvas)
  const seen = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
  seen.observe(canvas)
  const minGap = 1000 / (options.fps ?? 30)
  const loop = (now: number): void => {
    frame = requestAnimationFrame(loop)
    if (now - last < minGap - 2) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (!document.hidden && visible && !options.still) draw(dt)
  }
  frame = requestAnimationFrame(loop)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    seen.disconnect()
  }
}
