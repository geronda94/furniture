import type { Material } from './types'

const TEX_SIZE = 256
const cache = new Map<string, HTMLCanvasElement>()
const imageCache = new Map<string, HTMLCanvasElement>()
const imagePending = new Set<string>()

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = TEX_SIZE
  c.height = TEX_SIZE
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas 2d недоступен')
  return [c, ctx]
}

function wood(color: string, accent: string): HTMLCanvasElement {
  const [c, ctx] = makeCanvas()
  const rand = rng(hash(color + accent))
  ctx.fillStyle = color
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  // мягкие широкие полосы
  for (let i = 0; i < 18; i++) {
    const x = rand() * TEX_SIZE
    const w = 4 + rand() * 18
    const k = 1 + Math.floor(rand() * 4)
    const phase = rand() * Math.PI * 2
    ctx.globalAlpha = 0.02 + rand() * 0.035
    ctx.fillStyle = accent
    ctx.beginPath()
    for (let y = 0; y <= TEX_SIZE; y += 4) {
      const xx = x + Math.sin((y / TEX_SIZE) * Math.PI * 2 * k + phase) * 5
      if (y === 0) ctx.moveTo(xx, y)
      else ctx.lineTo(xx, y)
    }
    for (let y = TEX_SIZE; y >= 0; y -= 4) {
      const xx =
        x + w + Math.sin((y / TEX_SIZE) * Math.PI * 2 * k + phase) * 5
      ctx.lineTo(xx, y)
    }
    ctx.closePath()
    ctx.fill()
  }

  // тонкие волокна
  ctx.globalAlpha = 1
  for (let i = 0; i < 44; i++) {
    const x = rand() * TEX_SIZE
    const k = 1 + Math.floor(rand() * 5)
    const phase = rand() * Math.PI * 2
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.025 + rand() * 0.05
    ctx.lineWidth = 0.6 + rand() * 0.7
    ctx.beginPath()
    for (let y = 0; y <= TEX_SIZE; y += 6) {
      const xx =
        x +
        Math.sin((y / TEX_SIZE) * Math.PI * 2 * k + phase) * (1 + rand() * 0.9)
      if (y === 0) ctx.moveTo(xx, y)
      else ctx.lineTo(xx, y)
    }
    ctx.stroke()
  }

  return c
}

function stone(color: string, accent: string): HTMLCanvasElement {
  const [c, ctx] = makeCanvas()
  const rand = rng(hash(color + accent))
  ctx.fillStyle = color
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  for (let i = 0; i < 260; i++) {
    const x = rand() * TEX_SIZE
    const y = rand() * TEX_SIZE
    const r = rand() * 1.2 + 0.25
    ctx.globalAlpha = 0.012 + rand() * 0.035
    ctx.fillStyle = rand() > 0.5 ? accent : '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // прожилки
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.025 + rand() * 0.04
    ctx.strokeStyle = accent
    ctx.lineWidth = 0.6 + rand() * 0.8
    ctx.beginPath()
    let x = rand() * TEX_SIZE
    let y = 0
    ctx.moveTo(x, y)
    while (y < TEX_SIZE) {
      x += (rand() - 0.5) * 34
      y += 10 + rand() * 22
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return c
}

function metal(color: string, accent: string): HTMLCanvasElement {
  const [c, ctx] = makeCanvas()
  const rand = rng(hash(color + accent))
  ctx.fillStyle = color
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
  for (let x = 0; x < TEX_SIZE; x++) {
    ctx.globalAlpha = 0.02 + rand() * 0.06
    ctx.fillStyle = rand() > 0.5 ? accent : '#ffffff'
    ctx.fillRect(x, 0, 1, TEX_SIZE)
  }
  return c
}

export function textureFor(m: Material): HTMLCanvasElement | null {
  // Реальная загруженная текстура важнее процедурной.
  if (m.texture) {
    const hit = imageCache.get(m.texture)
    if (hit) return hit
    if (!imagePending.has(m.texture)) {
      imagePending.add(m.texture)
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = 512
        c.height = 512
        const g = c.getContext('2d')
        if (g) {
          g.drawImage(img, 0, 0, 512, 512)
          imageCache.set(m.texture as string, c)
        }
        imagePending.delete(m.texture as string)
        window.dispatchEvent(new CustomEvent('furniture:texture'))
      }
      img.onerror = () => {
        imagePending.delete(m.texture as string)
      }
      img.src = m.texture
    }
    return null
  }

  if (m.pattern === 'solid') return null
  const accent = m.accent || m.color
  const key = `${m.pattern}|${m.color}|${accent}`
  const hit = cache.get(key)
  if (hit) return hit
  const tex =
    m.pattern === 'wood'
      ? wood(m.color, accent)
      : m.pattern === 'stone'
        ? stone(m.color, accent)
        : metal(m.color, accent)
  cache.set(key, tex)
  return tex
}

const patterns = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, CanvasPattern>
>()

export function patternFor(
  ctx: CanvasRenderingContext2D,
  m: Material,
  tex: HTMLCanvasElement,
  ox = 0,
  oy = 0,
): CanvasPattern | null {
  let byKey = patterns.get(ctx)
  if (!byKey) {
    byKey = new Map()
    patterns.set(ctx, byKey)
  }
  const base = m.texture
    ? `img|${m.texture.length}|${m.texture.slice(-64)}`
    : `${m.pattern}|${m.color}|${m.accent || ''}`
  const key = `${base}|${ox.toFixed(4)}|${oy.toFixed(4)}`
  const hit = byKey.get(key)
  if (hit) return hit
  const p = ctx.createPattern(tex, 'repeat')
  if (!p) return null
  // один тайл = один UV-юнит (масштаб в мм задаёт material.texScale);
  // ox/oy сдвигают фазу — иначе каждая ячейка начинает тайл с себя
  p.setTransform(
    new DOMMatrix([1 / tex.width, 0, 0, 1 / tex.height, ox, oy]),
  )
  byKey.set(key, p)
  return p
}
