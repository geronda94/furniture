import type { Projector } from './camera'
import { patternFor, textureFor } from './textures'
import { clamp } from './math'
import { outlinePoints, roomWalls } from './room'
import type { Face, Pt, Room, ViewStyle } from './types'
import type { ShadowSpec } from './scene'

export interface DimLine {
  a: Pt
  b: Pt
  label: string
  offset: number
}

export interface RenderOptions {
  width: number
  height: number
  dpr: number
  faces: Face[]
  projector: Projector
  room: Room
  mode: 'plan' | 'persp'
  style: ViewStyle
  /** фон: тёмный для сцены, светлый для схемы */
  background?: 'dark' | 'light'
  selection: string | null
  /** все выделенные модули (группа); selection — главный */
  selections?: string[]
  /** выделенная деталь внутри selection */
  part?: number | null
  selectionLabel?: string
  shadows?: ShadowSpec[]
  dims?: DimLine[]
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
}

/**
 * Натяжение текстуры на грань.
 *
 * В перспективе проекция четырёхугольника — не параллелограмм, поэтому один
 * аффинный патч оставляет чёрный клин у четвёртого угла. Грань делится на
 * сетку, а каждая ячейка рисуется двумя треугольниками: аффинное отображение
 * треугольника в треугольник точное, поэтому покрытие без щелей и клиньев.
 * Сетка нужна только чтобы текстура не «ехала» на сильной перспективе.
 */
function drawFaceTexture(
  ctx: CanvasRenderingContext2D,
  f: Face,
  tex: HTMLCanvasElement,
  projector?: Projector,
): void {
  const s = f.material.texScale ?? 500
  const su = f.uLen / s
  const sv = f.vLen / s

  let at: ((a: number, b: number) => { x: number; y: number }) | null = null
  if (projector) {
    const o = f.uvOrigin
    const u = f.uvU
    const v = f.uvV
    at = (a, b) => {
      const p = projector.point([
        o[0] + u[0] * a + v[0] * b,
        o[1] + u[1] * a + v[1] * b,
        o[2] + u[2] * a + v[2] * b,
      ])
      return { x: p.x, y: p.y }
    }
  }

  // насколько сильно четырёхугольник отличается от параллелограмма
  let n = 1
  if (at) {
    const A = at(0, 0)
    const B = at(1, 0)
    const C = at(1, 1)
    const D = at(0, 1)
    const err = Math.hypot(
      C.x - (B.x + D.x - A.x),
      C.y - (B.y + D.y - A.y),
    )
    const diag = Math.hypot(C.x - A.x, C.y - A.y) || 1
    const rel = err / diag
    n = rel > 0.05 ? 4 : rel > 0.003 ? 2 : 1
  }

  const tri = (
    t0: [number, number],
    t1: [number, number],
    t2: [number, number],
    q0: { x: number; y: number },
    q1: { x: number; y: number },
    q2: { x: number; y: number },
  ): void => {
    // раздуваем треугольник на доли пикселя: иначе между ячейками
    // остаются волосяные щели, через которые видна подложка
    const gx = (q0.x + q1.x + q2.x) / 3
    const gy = (q0.y + q1.y + q2.y) / 3
    const grow = (q: { x: number; y: number }) => {
      const dx = q.x - gx
      const dy = q.y - gy
      const l = Math.hypot(dx, dy) || 1
      const k = 1 + 0.8 / l
      return { x: gx + dx * k, y: gy + dy * k }
    }
    const p0 = grow(q0)
    const p1 = grow(q1)
    const p2 = grow(q2)
    const ex = t1[0] - t0[0]
    const ey = t1[1] - t0[1]
    const fx = t2[0] - t0[0]
    const fy = t2[1] - t0[1]
    const det = ex * fy - fx * ey
    if (Math.abs(det) < 1e-9) return
    const e1x = p1.x - p0.x
    const e1y = p1.y - p0.y
    const e2x = p2.x - p0.x
    const e2y = p2.y - p0.y
    const a = (e1x * fy - e2x * ey) / det
    const b = (e1y * fy - e2y * ey) / det
    const c = (e2x * ex - e1x * fx) / det
    const d = (e2y * ex - e1y * fx) / det

    ctx.save()
    ctx.transform(
      a,
      b,
      c,
      d,
      p0.x - a * t0[0] - c * t0[1],
      p0.y - b * t0[0] - d * t0[1],
    )
    ctx.beginPath()
    ctx.moveTo(t0[0], t0[1])
    ctx.lineTo(t1[0], t1[1])
    ctx.lineTo(t2[0], t2[1])
    ctx.closePath()
    ctx.fillStyle =
      patternFor(ctx, f.material, tex, t0[0] % 1, t0[1] % 1) ?? f.color
    ctx.fill()
    ctx.restore()
  }

  if (!at) {
    // без проектора (плоский случай) — один аффинный патч на всю грань
    const pat = patternFor(ctx, f.material, tex)
    if (!pat) return
    path(ctx, f.pts)
    ctx.clip()
    ctx.transform(
      (f.p10.x - f.p00.x) / su,
      (f.p10.y - f.p00.y) / su,
      (f.p01.x - f.p00.x) / sv,
      (f.p01.y - f.p00.y) / sv,
      f.p00.x,
      f.p00.y,
    )
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, su, sv)
    return
  }

  // клип по контуру грани. Треугольники пола расширяем на доли пикселя,
  // иначе на общих рёбрах остаются волосяные швы.
  let clipPts = f.pts
  if (f.pts.length === 3) {
    const gx = (f.pts[0].x + f.pts[1].x + f.pts[2].x) / 3
    const gy = (f.pts[0].y + f.pts[1].y + f.pts[2].y) / 3
    clipPts = f.pts.map((q) => {
      const dx = q.x - gx
      const dy = q.y - gy
      const l = Math.hypot(dx, dy) || 1
      const k = 1 + 0.9 / l
      return { x: gx + dx * k, y: gy + dy * k }
    })
  }
  path(ctx, clipPts)
  ctx.clip()

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a0 = i / n
      const a1 = (i + 1) / n
      const b0 = j / n
      const b1 = (j + 1) / n
      const A = at(a0, b0)
      const B = at(a1, b0)
      const C = at(a1, b1)
      const D = at(a0, b1)
      const ua = a0 * su
      const ub = a1 * su
      const va = b0 * sv
      const vb = b1 * sv
      tri([ua, va], [ub, va], [ub, vb], A, B, C)
      tri([ua, va], [ub, vb], [ua, vb], A, C, D)
    }
  }
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  f: Face,
  style: ViewStyle,
  projector?: Projector,
): void {
  const tex = textureFor(f.material)
  const alpha = f.alpha ?? 1

  ctx.save()
  ctx.globalAlpha = alpha

  if (tex) {
    const pat = patternFor(ctx, f.material, tex)
    if (pat) {
      // подложка цветом грани: закрывает швы ячеек и клинья перспективы
      if (alpha >= 1) {
        path(ctx, f.pts)
        ctx.fillStyle = f.color
        ctx.fill()
      }
      drawFaceTexture(ctx, f, tex, projector)
    } else {
      path(ctx, f.pts)
      ctx.fillStyle = f.color
      ctx.fill()
    }
  } else {
    path(ctx, f.pts)
    ctx.fillStyle = f.color
    ctx.fill()
  }
  ctx.restore()

  // у пола не рисуем контур: треугольники триангуляции дают видимые швы
  if (f.kind === 'floor') return

  path(ctx, f.pts)
  if (style === 'realistic') {
    ctx.strokeStyle = 'rgba(6, 8, 10, 0.13)'
    ctx.lineWidth = 0.6
  } else {
    ctx.strokeStyle = 'rgba(8, 10, 12, 0.34)'
    ctx.lineWidth = 1
  }
  ctx.stroke()
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  floorFaces: Face[],
  projector: Projector,
  room: Room,
): void {
  ctx.save()
  // отсекаем по всем треугольникам пола, а не по первому
  ctx.beginPath()
  for (const f of floorFaces) {
    const pts = f.pts
    if (!pts.length) continue
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
  }
  ctx.clip()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = 1

  for (let x = 0; x <= room.w; x += 200) {
    const a = projector.point([x, 0, 0])
    const b = projector.point([x, room.d, 0])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  for (let y = 0; y <= room.d; y += 200) {
    const a = projector.point([0, y, 0])
    const b = projector.point([room.w, y, 0])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawShadows(
  ctx: CanvasRenderingContext2D,
  shadows: ShadowSpec[],
): void {
  if (!shadows.length) return
  ctx.save()
  ctx.filter = 'blur(12px)'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
  for (const s of shadows) {
    path(ctx, s.pts)
    ctx.fill()
  }
  ctx.restore()
}

function planPoint(
  seg: { a: Pt; dx: number; dy: number; nx: number; ny: number },
  s: number,
  depth: number,
): [number, number, number] {
  return [
    seg.a.x + seg.dx * s - seg.nx * depth,
    seg.a.y + seg.dy * s - seg.ny * depth,
    0,
  ]
}

function drawPlanWalls(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  room: Room,
): void {
  const wt = clamp(room.wallT ?? 100, 40, 300)
  const openings = room.openings ?? []
  const walls = roomWalls(room)

  const quad = (seg: (typeof walls)[number], s0: number, s1: number) => {
    const pts: Pt[] = [
      planPoint(seg, s0, 0),
      planPoint(seg, s1, 0),
      planPoint(seg, s1, wt),
      planPoint(seg, s0, wt),
    ].map((p) => {
      const q = projector.point(p)
      return { x: q.x, y: q.y }
    })
    return pts
  }

  const footprint = (seg: (typeof walls)[number], s0: number, s1: number) => {
    if (s1 - s0 < 1) return
    const pts = quad(seg, s0, s1)
    path(ctx, pts)
    ctx.fillStyle = 'rgba(58, 64, 74, 0.96)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  const windowSymbol = (seg: (typeof walls)[number], s0: number, s1: number) => {
    const d = wt / 2
    const a = projector.point(planPoint(seg, s0, d))
    const b = projector.point(planPoint(seg, s1, d))
    ctx.strokeStyle = 'rgba(143, 185, 204, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(143, 185, 204, 0.45)'
    ctx.lineWidth = 1
    for (const dep of [wt * 0.22, wt * 0.78]) {
      const c = projector.point(planPoint(seg, s0, dep))
      const e = projector.point(planPoint(seg, s1, dep))
      ctx.beginPath()
      ctx.moveTo(c.x, c.y)
      ctx.lineTo(e.x, e.y)
      ctx.stroke()
    }
  }

  const doorSymbol = (
    seg: (typeof walls)[number],
    s0: number,
    s1: number,
    hingeRight: boolean,
  ) => {
    const r = Math.max(100, s1 - s0)
    const hs = hingeRight ? s1 : s0
    const hx = seg.a.x + seg.dx * hs
    const hy = seg.a.y + seg.dy * hs
    const sign = hingeRight ? -1 : 1
    const along: [number, number] = [seg.dx * sign, seg.dy * sign]
    const inward: [number, number] = [seg.nx, seg.ny]

    ctx.save()
    ctx.strokeStyle = 'rgba(224, 163, 62, 0.85)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * (Math.PI / 2)
      const x = hx + r * (Math.cos(a) * along[0] + Math.sin(a) * inward[0])
      const y = hy + r * (Math.cos(a) * along[1] + Math.sin(a) * inward[1])
      const q = projector.point([x, y, 0])
      if (i === 0) ctx.moveTo(q.x, q.y)
      else ctx.lineTo(q.x, q.y)
    }
    ctx.stroke()
    ctx.setLineDash([])

    const ex = hx + r * inward[0]
    const ey = hy + r * inward[1]
    const pe = projector.point([ex, ey, 0])
    const ph = projector.point([hx, hy, 0])
    ctx.strokeStyle = 'rgba(224, 163, 62, 0.7)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ph.x, ph.y)
    ctx.lineTo(pe.x, pe.y)
    ctx.stroke()
    ctx.restore()
  }

  for (const seg of walls) {
    const L = seg.len
    const ops = openings
      .filter((o) => o.wall === seg.index)
      .sort((a, b) => a.x - b.x)
    let cursor = 0
    for (const o of ops) {
      const x0 = clamp(o.x, 0, L)
      const x1 = clamp(o.x + o.w, 0, L)
      footprint(seg, cursor, x0)
      if (o.kind === 'window') windowSymbol(seg, x0, x1)
      else doorSymbol(seg, x0, x1, o.hinge === 'right')
      cursor = Math.max(cursor, x1)
    }
    footprint(seg, cursor, L)
  }
}

/** Яркость CSS-цвета (0..1) — по sRGB. */
function colorLum(css: string): number {
  let r = 120
  let g = 120
  let b = 120
  const rgb = css.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
  if (rgb) {
    r = Number(rgb[1])
    g = Number(rgb[2])
    b = Number(rgb[3])
  } else if (css.startsWith('#')) {
    let h = css.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h, 16)
    if (Number.isFinite(n)) {
      r = (n >> 16) & 255
      g = (n >> 8) & 255
      b = n & 255
    }
  }
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export interface Ink {
  /** цвет линий и текста */
  ink: string
  /** подложка/обводка противоположного тона */
  halo: string
  /** фон плашки под текстом */
  plate: string
  /** текст на плашке */
  text: string
}

const INK_DARK: Ink = {
  ink: 'rgba(28, 32, 39, 0.95)',
  halo: 'rgba(255, 255, 255, 0.65)',
  plate: 'rgba(255, 255, 255, 0.9)',
  text: '#1c2027',
}

const INK_LIGHT: Ink = {
  ink: 'rgba(240, 201, 122, 0.98)',
  halo: 'rgba(10, 12, 15, 0.6)',
  plate: 'rgba(15, 17, 20, 0.9)',
  text: '#f0d29a',
}

/** Верхняя видимая поверхность под точкой (для контраста). */
export function inkAt(
  faces: Face[] | undefined,
  x: number,
  y: number,
): Ink {
  if (faces) {
    for (let i = faces.length - 1; i >= 0; i--) {
      const f = faces[i]
      if (!pointInPoly(x, y, f.pts)) continue
      return colorLum(f.color) > 0.42 ? INK_DARK : INK_LIGHT
    }
  }
  return INK_LIGHT
}

export function drawDims(
  ctx: CanvasRenderingContext2D,
  dims: DimLine[],
  faces?: Face[],
): void {
  ctx.save()
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const d of dims) {
    const dx = d.b.x - d.a.x
    const dy = d.b.y - d.a.y
    const L = Math.hypot(dx, dy) || 1
    const nx = (-dy / L) * d.offset
    const ny = (dx / L) * d.offset
    const a2 = { x: d.a.x + nx, y: d.a.y + ny }
    const b2 = { x: d.b.x + nx, y: d.b.y + ny }

    const ink = inkAt(faces, (d.a.x + d.b.x) / 2, (d.a.y + d.b.y) / 2)
    // выноски (хало + линия), чтобы читались на любом фоне
    for (const pass of [
      { color: ink.halo, width: 2.6 },
      { color: ink.ink, width: 1 },
    ]) {
      ctx.strokeStyle = pass.color
      ctx.lineWidth = pass.width
      ctx.beginPath()
      ctx.moveTo(d.a.x, d.a.y)
      ctx.lineTo(a2.x, a2.y)
      ctx.moveTo(d.b.x, d.b.y)
      ctx.lineTo(b2.x, b2.y)
      ctx.stroke()
    }

    for (const pass of [
      { color: ink.halo, width: 3 },
      { color: ink.ink, width: 1.2 },
    ]) {
      ctx.strokeStyle = pass.color
      ctx.lineWidth = pass.width
      ctx.beginPath()
      ctx.moveTo(a2.x, a2.y)
      ctx.lineTo(b2.x, b2.y)
      ctx.stroke()
    }

    const ux = dx / L
    const uy = dy / L
    ctx.beginPath()
    ctx.moveTo(a2.x - ux * 3 - ny * 0.18, a2.y - uy * 3 - nx * 0.18)
    ctx.lineTo(a2.x + ux * 3 + ny * 0.18, a2.y + uy * 3 + nx * 0.18)
    ctx.moveTo(b2.x - ux * 3 - ny * 0.18, b2.y - uy * 3 - nx * 0.18)
    ctx.lineTo(b2.x + ux * 3 + ny * 0.18, b2.y + uy * 3 + nx * 0.18)
    ctx.stroke()

    const mx = (a2.x + b2.x) / 2
    const my = (a2.y + b2.y) / 2
    const tw = ctx.measureText(d.label).width
    const plate = inkAt(faces, mx, my)
    ctx.fillStyle = plate.plate
    ctx.strokeStyle = plate.halo
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(mx - tw / 2 - 5, my - 8.5, tw + 10, 17, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = plate.text
    ctx.fillText(d.label, mx, my + 0.5)
  }
  ctx.restore()
}

export function renderView(
  ctx: CanvasRenderingContext2D,
  o: RenderOptions,
): void {
  const { width, height, dpr, faces, projector, room, mode, style, selection } =
    o

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const g = ctx.createLinearGradient(0, 0, 0, height)
  if (o.background === 'light') {
    g.addColorStop(0, '#f7f7f4')
    g.addColorStop(1, '#e6e6e1')
  } else if (style === 'realistic' && mode === 'persp') {
    g.addColorStop(0, '#20252c')
    g.addColorStop(1, '#101317')
  } else {
    g.addColorStop(0, '#15181d')
    g.addColorStop(1, '#0e1013')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)

  // Всё, что не привязано к модулю (пол, стены, окна, двери), — фон;
  // мебель уже отсортирована топологически (см. sortBoxes).
  const roomFaces = faces.filter((f) => !f.objectId)
  const objectFaces = faces.filter((f) => f.objectId)

  if (mode === 'plan') {
    const floorFaces = roomFaces.filter((f) => f.kind === 'floor')
    if (floorFaces.length) {
      // в плане пол — один полигон контура: без диагональных швов
      const outlinePts = outlinePoints(room).map((q) => projector.point([q.x, q.y, 0]))
      ctx.save()
      ctx.beginPath()
      if (outlinePts.length) {
        ctx.moveTo(outlinePts[0].x, outlinePts[0].y)
        for (let i = 1; i < outlinePts.length; i++) {
          ctx.lineTo(outlinePts[i].x, outlinePts[i].y)
        }
        ctx.closePath()
      }
      ctx.fillStyle = floorFaces[0].color
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      const flat: Face = { ...floorFaces[0], pts: outlinePts }
      drawGrid(ctx, [flat], projector, room)
      drawPlanWalls(ctx, projector, room)
      for (const f of objectFaces) drawFace(ctx, f, style, projector)
    } else {
      for (const f of faces) drawFace(ctx, f, style, projector)
    }
  } else {
    for (const f of roomFaces) drawFace(ctx, f, style, projector)
    if (style === 'realistic' && o.shadows?.length && projector.f[2] < -0.15) {
      drawShadows(ctx, o.shadows)
    }
    for (const f of objectFaces) drawFace(ctx, f, style, projector)
  }

  if (selection && o.part != null) {
    let pminX = Infinity
    let pminY = Infinity
    let pmaxX = -Infinity
    let pmaxY = -Infinity
    for (const f of objectFaces) {
      if (f.objectId !== selection || f.part !== o.part) continue
      for (const p of f.pts) {
        if (p.x < pminX) pminX = p.x
        if (p.y < pminY) pminY = p.y
        if (p.x > pmaxX) pmaxX = p.x
        if (p.y > pmaxY) pmaxY = p.y
      }
    }
    if (Number.isFinite(pminX)) {
      ctx.save()
      const pink = inkAt(
        faces,
        (pminX + pmaxX) / 2,
        (pminY + pmaxY) / 2,
      )
      ctx.strokeStyle = pink.halo
      ctx.lineWidth = 3
      ctx.setLineDash([3, 3])
      ctx.strokeRect(pminX - 2, pminY - 2, pmaxX - pminX + 4, pmaxY - pminY + 4)
      ctx.strokeStyle = pink.ink
      ctx.lineWidth = 1.4
      ctx.strokeRect(pminX - 2, pminY - 2, pmaxX - pminX + 4, pmaxY - pminY + 4)
      ctx.setLineDash([])
      ctx.restore()
    }
  }

  const selectedIds = o.selections?.length
    ? o.selections
    : selection
      ? [selection]
      : []
  for (const sid of selectedIds) {
    const isPrimary = sid === selection
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const f of objectFaces) {
      if (f.objectId !== sid) continue
      for (const p of f.pts) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
    }
    if (Number.isFinite(minX)) {
      ctx.save()
      const ink = inkAt(
        faces,
        (minX + maxX) / 2,
        (minY + maxY) / 2,
      )
      ctx.strokeStyle = ink.halo
      ctx.lineWidth = 3
      ctx.setLineDash([5, 4])
      ctx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8)
      ctx.strokeStyle = ink.ink
      ctx.lineWidth = 1.4
      ctx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8)
      ctx.setLineDash([])

      if (isPrimary && o.selectionLabel) {
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        const tw = ctx.measureText(o.selectionLabel).width
        const lx = minX - 4
        const ly = minY - 16
        const plate = inkAt(faces, lx + tw / 2, ly)
        ctx.fillStyle = plate.plate
        ctx.strokeStyle = plate.halo
        ctx.beginPath()
        ctx.roundRect(lx, ly - 8, tw + 12, 16, 3)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = plate.text
        ctx.fillText(o.selectionLabel, lx + 6, ly + 0.5)
      }
      ctx.restore()
    }
  }

  if (o.dims?.length) drawDims(ctx, o.dims, faces)
}

export function pointInPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Верхний видимый элемент модуля под точкой (part — индекс детали). */
export function pickPart(
  faces: Face[],
  x: number,
  y: number,
): { objectId: string; part: number } | null {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i]
    if (!f.objectId || f.part == null) continue
    if (!pointInPoly(x, y, f.pts)) continue
    return { objectId: f.objectId, part: f.part }
  }
  return null
}

/** Верхний видимый объект под точкой. Стена/пол могут «закрыть» клик. */
export function pickObject(
  faces: Face[],
  x: number,
  y: number,
): string | null {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i]
    if (!pointInPoly(x, y, f.pts)) continue
    return f.objectId ?? null
  }
  return null
}

export function facesToSvg(
  faces: Face[],
  width: number,
  height: number,
  background = '#171b21',
): string {
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${background}"/>`,
  ]
  for (const f of faces) {
    const d =
      f.pts
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        )
        .join(' ') + ' Z'
    const alpha = f.alpha != null ? ` fill-opacity="${f.alpha}"` : ''
    out.push(
      `<path d="${d}" fill="${f.color}"${alpha} stroke="rgba(8,10,12,.34)" stroke-width="1"/>`,
    )
  }
  out.push('</svg>')
  return out.join('\n')
}
