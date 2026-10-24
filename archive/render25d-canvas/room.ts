import type { Pt, Room } from './types'

export interface WallSeg {
  index: number
  /** начало и конец стены в плане (мм) */
  a: Pt
  b: Pt
  /** единичный вектор вдоль стены */
  dx: number
  dy: number
  /** единичная нормаль внутрь комнаты (для наружных стен) */
  nx: number
  ny: number
  len: number
  /** наружная стена контура или внутренняя перегородка */
  outer: boolean
}

export function outlinePoints(room: Room): Pt[] {
  const pts = (room as Room & { outline?: [number, number][] }).outline
  if (Array.isArray(pts) && pts.length >= 3) {
    return pts.map(([x, y]) => ({ x: Number(x) || 0, y: Number(y) || 0 }))
  }
  return [
    { x: 0, y: 0 },
    { x: room.w, y: 0 },
    { x: room.w, y: room.d },
    { x: 0, y: room.d },
  ]
}

export function pointInPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function makeWall(
  index: number,
  a: Pt,
  b: Pt,
  outer: boolean,
  outline: Pt[],
): WallSeg | null {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len = Math.hypot(vx, vy)
  if (len < 1) return null
  const dx = vx / len
  const dy = vy / len
  let nx = -dy
  let ny = dx
  if (outer) {
    // нормаль должна смотреть внутрь контура
    const mx = (a.x + b.x) / 2 + nx * 2
    const my = (a.y + b.y) / 2 + ny * 2
    if (!pointInPoly(mx, my, outline)) {
      nx = -nx
      ny = -ny
    }
  }
  return { index, a, b, dx, dy, nx, ny, len, outer }
}

export function roomWalls(room: Room): WallSeg[] {
  const outline = outlinePoints(room)
  const out: WallSeg[] = []
  for (let i = 0; i < outline.length; i++) {
    const w = makeWall(i, outline[i], outline[(i + 1) % outline.length], true, outline)
    if (w) out.push(w)
  }
  const parts = (room as Room & {
    partitions?: { a: [number, number]; b: [number, number] }[]
  }).partitions
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (!p?.a || !p?.b) continue
      const w = makeWall(
        out.length,
        { x: Number(p.a[0]) || 0, y: Number(p.a[1]) || 0 },
        { x: Number(p.b[0]) || 0, y: Number(p.b[1]) || 0 },
        false,
        outline,
      )
      if (w) out.push(w)
    }
  }
  return out
}

export function roomWall(room: Room, index: number): WallSeg | null {
  return roomWalls(room).find((w) => w.index === index) ?? null
}

export function roomWallLength(room: Room, index: number): number {
  return roomWall(room, index)?.len ?? 0
}

export function roomBounds(room: Room): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const pts = outlinePoints(room)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}


function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const c1 = cross(a, b, p)
  const c2 = cross(b, c, p)
  const c3 = cross(c, a, p)
  return (c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6) ||
    (c1 <= 1e-6 && c2 <= 1e-6 && c3 <= 1e-6)
}

/** Триангуляция простого полигона (ear clipping) для пола и заливок. */
export function triangulate(input: Pt[]): [Pt, Pt, Pt][] {
  if (input.length < 3) return []
  let pts = input.map((p) => ({ x: p.x, y: p.y }))
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  if (area < 0) pts = pts.reverse()
  const out: [Pt, Pt, Pt][] = []
  let guard = 0
  while (pts.length > 3 && guard++ < 500) {
    let clipped = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      if (cross(a, b, c) <= 1e-6) continue
      let has = false
      for (const p of pts) {
        if (p === a || p === b || p === c) continue
        if (inTriangle(p, a, b, c)) { has = true; break }
      }
      if (has) continue
      out.push([a, b, c])
      pts.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (pts.length === 3) out.push([pts[0], pts[1], pts[2]])
  return out
}


export function polygonArea(input: Pt[]): number {
  let a = 0
  for (let i = 0; i < input.length; i++) {
    const p = input[i]
    const q = input[(i + 1) % input.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}
