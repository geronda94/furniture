/**
 * Чистая геометрия расстановки: габариты декора, свободные места,
 * привязка модуля к стенам/соседям. Без Vue и без записи в store —
 * побочные эффекты (state.guides) остаются в state/project.ts.
 */
import { roomBounds, roomWalls } from '../render25d/room'
import type { Instance, RoomDims } from './defaults'
import type { Prop, WallItem } from '../render25d/types'
import { clamp } from './defaults'
import {
  cornersOf,
  footprintOf,
  overlaps,
  wallFaces,
  type Box2,
  type Box3,
} from './geometry'

/** Габарит декора (центр + поворот) в мировых осях. */
export function propBox(
  x: number, y: number, w: number, d: number, rot: number,
): Box2 {
  const a = (rot * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lx, ly] of [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ]) {
    const wx = x + lx * cs - ly * sn
    const wy = y + lx * sn + ly * cs
    minX = Math.min(minX, wx)
    maxX = Math.max(maxX, wx)
    minY = Math.min(minY, wy)
    maxY = Math.max(maxY, wy)
  }
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY }
}

export interface Pt {
  x: number
  y: number
}

/** Углы декора: центр + поворот (для проверки настенных предметов). */
export function propCorners(
  x: number, y: number, w: number, d: number, rot: number,
): Pt[] {
  const a = (rot * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  return [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ].map(([lx, ly]) => ({
    x: x + lx * cs - ly * sn,
    y: y + lx * sn + ly * cs,
  }))
}

function projected(
  pts: Pt[], nx: number, ny: number,
): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of pts) {
    const v = p.x * nx + p.y * ny
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

/** Пересечение двух выпуклых многоугольников (SAT), с допуском 0.5 мм. */
export function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const nx = -(q.y - p.y)
      const ny = q.x - p.x
      const len = Math.hypot(nx, ny) || 1
      const [a0, a1] = projected(a, nx / len, ny / len)
      const [b0, b1] = projected(b, nx / len, ny / len)
      if (Math.min(a1, b1) - Math.max(a0, b0) <= 0.5) return false
    }
  }
  return true
}

/**
 * Настенный предмет (розетка, выключатель, полка, зеркало), мешающий
 * поставить модуль/декор вплотную: учитываем его выступ `depth` от стены.
 */
export function wallItemAt(
  room: RoomDims, pts: Pt[], z0: number, z1: number,
): WallItem | null {
  const walls = roomWalls(room)
  for (const item of room.wallItems ?? []) {
    const seg = walls.find((w) => w.index === item.wall)
    if (!seg) continue
    const iz0 = Number(item.z) || 0
    const iz1 = iz0 + (Number(item.h) || 0)
    if (iz1 <= z0 + 0.5 || iz0 >= z1 - 0.5) continue
    const depth = Math.max(0, Number(item.depth) || 12)
    const s0 = Number(item.x) || 0
    const s1 = s0 + (Number(item.w) || 0)
    const poly: Pt[] = [
      { x: seg.a.x + seg.dx * s0, y: seg.a.y + seg.dy * s0 },
      { x: seg.a.x + seg.dx * s1, y: seg.a.y + seg.dy * s1 },
      { x: seg.a.x + seg.dx * s1 + seg.nx * depth,
        y: seg.a.y + seg.dy * s1 + seg.ny * depth },
      { x: seg.a.x + seg.dx * s0 + seg.nx * depth,
        y: seg.a.y + seg.dy * s0 + seg.ny * depth },
    ]
    if (polygonsOverlap(pts, poly)) return item
  }
  return null
}

export function wallItemLabel(item: WallItem): string {
  const kind = String(item.kind || '')
  if (kind === 'socket' || kind === 'outlet') return 'розетка'
  if (kind === 'switch') return 'выключатель'
  if (kind === 'mirror') return 'зеркало'
  if (kind === 'shelf') return 'полка на стене'
  return 'предмет на стене'
}

export interface ModuleCollisionContext extends PropCollisionContext {
  zSpan: (inst: Instance) => [number, number]
}

/** Пересечение модуля (корпуса) со стенами, проёмами, мебелью и декором. */
export function moduleCollides(
  inst: Instance, x: number, y: number, W: number, D: number,
  rot: number, ctx: ModuleCollisionContext,
): boolean {
  if (!ctx.roomContains(x, y, W, D, rot)) return true
  const [z0, z1] = ctx.zSpan(inst)
  if (ctx.wallBodyHit(x, y, W, D, rot, z0, z1)) return true
  if (wallItemAt(ctx.room, cornersOf(x, y, W, D, rot), z0, z1)) return true
  const flat = footprintOf(x, y, W, D, rot)
  const r: Box3 = { ...flat, z0, z1 }
  if (ctx.instances.some(
    (i) => i.id !== inst.id && overlaps(r, ctx.footprint(i)),
  )) return true
  // Декор (кроме ковра) — тоже препятствие.
  return ctx.props.some((pr) => {
    if (pr.type === 'rug') return false
    const pz0 = Number(pr.z) || 0
    const pb = propBox(pr.x, pr.y, pr.w, pr.d, pr.rot ?? 0)
    return overlaps(r, { ...pb, z0: pz0, z1: pz0 + (Number(pr.h) || 0) })
  })
}

export interface PropCollisionContext {
  room: RoomDims
  instances: Instance[]
  props: Prop[]
  roomContains: (x: number, y: number, W: number, D: number, rot: number) => boolean
  wallBodyHit: (
    x: number, y: number, W: number, D: number, rot: number,
    z0: number, z1: number,
  ) => boolean
  footprint: (inst: Instance) => Box3
}

/** Декор не входит в стены, мебель и другой декор (ковёр — покрытие пола). */
export function propCollides(
  prop: Prop, x: number, y: number, ctx: PropCollisionContext,
): boolean {
  const flat = propBox(x, y, prop.w, prop.d, prop.rot ?? 0)
  if (!ctx.roomContains(flat.x, flat.y, flat.w, flat.d, 0)) return true
  const z0 = Number(prop.z) || 0
  const z1 = z0 + (Number(prop.h) || 0)
  if (ctx.wallBodyHit(flat.x, flat.y, flat.w, flat.d, 0, z0, z1)) return true
  if (prop.type !== 'rug' && wallItemAt(
    ctx.room,
    propCorners(x, y, prop.w, prop.d, prop.rot ?? 0),
    z0, z1,
  )) return true
  const box: Box3 = { ...flat, z0, z1 }
  return ctx.instances.some((i) => overlaps(box, ctx.footprint(i)))
    || ctx.props.some((p) => {
      if (p.id === prop.id) return false
      if (p.type === 'rug' || prop.type === 'rug') return false
      const pb = propBox(p.x, p.y, p.w, p.d, p.rot ?? 0)
      const pz0 = Number(p.z) || 0
      return overlaps(box, { ...pb, z0: pz0, z1: pz0 + (Number(p.h) || 0) })
    })
}

/** Подобрать место для декора: центр комнаты или кольцо вокруг него. */
export function findPropSpot(
  room: RoomDims, instances: Instance[], props: Prop[],
  w: number, d: number, h = 0,
  isValid?: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const pad = 120
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (const inst of instances) {
    const b = footprintOf(inst.x, inst.y, inst.params.W, inst.params.D, inst.rot)
    boxes.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.d })
  }
  for (const pr of props) {
    boxes.push({
      x0: pr.x - pr.w / 2, y0: pr.y - pr.d / 2,
      x1: pr.x + pr.w / 2, y1: pr.y + pr.d / 2,
    })
  }
  const fits = (x: number, y: number): boolean => {
    const x0 = x - w / 2, x1 = x + w / 2
    const y0 = y - d / 2, y1 = y + d / 2
    if (x0 < pad || y0 < pad) return false
    if (x1 > room.w - pad || y1 > room.d - pad) return false
    if (wallItemAt(room, propCorners(x, y, w, d, 0), 0, h)) return false
    if (isValid) return isValid(x, y)
    return !boxes.some((b) =>
      x1 > b.x0 - 60 && x0 < b.x1 + 60 && y1 > b.y0 - 60 && y0 < b.y1 + 60)
  }
  const cx = room.w / 2
  const cy = room.d / 2
  if (fits(cx, cy)) return { x: Math.round(cx), y: Math.round(cy) }
  for (let r = 200; r <= Math.max(room.w, room.d); r += 200) {
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180
      const x = cx + Math.cos(rad) * r
      const y = cy + Math.sin(rad) * r
      if (fits(x, y)) return { x: Math.round(x), y: Math.round(y) }
    }
  }
  return { x: Math.round(cx), y: Math.round(cy) }
}

export interface SnapPlacement {
  x: number
  y: number
  guideX: number | null
  guideY: number | null
}

/**
 * Привязать модуль к стенам и соседям. Чистая версия: ничего не пишет
 * в store, возвращает направляющие для подсветки.
 */
export function snapPlacement(
  inst: Instance,
  x: number,
  y: number,
  room: RoomDims,
  instances: Instance[],
  withGuides: boolean,
): SnapPlacement {
  const box = footprintOf(x, y, inst.params.W, inst.params.D, inst.rot)
  const ox = box.x - x
  const oy = box.y - y
  const W = box.w
  const D = box.d
  const SNAP = 60
  const others = instances
    .filter((i) => i.id !== inst.id)
    .map((i) => footprintOf(
      i.x, i.y, i.params.W, i.params.D, i.rot,
    ))

  const b = roomBounds(room)
  const xCands: { value: number; guide: number }[] = [
    { value: b.minX, guide: b.minX },
    { value: b.maxX - W, guide: b.maxX },
  ]
  const yCands: { value: number; guide: number }[] = [
    { value: b.minY, guide: b.minY },
    { value: b.maxY - D, guide: b.maxY },
  ]
  // внутренние грани стен: прижимаем к ним, а не к осевой линии
  const corners = cornersOf(x, y, W, D, inst.rot)
  for (const f of wallFaces(room)) {
    let sMin = Infinity
    let sMax = -Infinity
    for (const p of corners) {
      const s = (p.x - f.ax) * f.dx + (p.y - f.ay) * f.dy
      sMin = Math.min(sMin, s)
      sMax = Math.max(sMax, s)
    }
    if (sMax < -5 || sMin > f.len + 5) continue
    if (Math.abs(f.nx) > 0.9) {
      const v = f.nx > 0 ? f.ax : f.ax - W
      xCands.push({ value: v, guide: f.ax })
    }
    if (Math.abs(f.ny) > 0.9) {
      const v = f.ny > 0 ? f.ay : f.ay - D
      yCands.push({ value: v, guide: f.ay })
    }
  }
  for (const o of others) {
    xCands.push({ value: o.x, guide: o.x })
    xCands.push({ value: o.x + o.w, guide: o.x + o.w })
    xCands.push({ value: o.x - W, guide: o.x })
    xCands.push({ value: o.x + o.w - W, guide: o.x + o.w })
    yCands.push({ value: o.y, guide: o.y })
    yCands.push({ value: o.y + o.d, guide: o.y + o.d })
    yCands.push({ value: o.y - D, guide: o.y })
    yCands.push({ value: o.y + o.d - D, guide: o.y + o.d })
  }

  const pick = (
    val: number,
    cands: { value: number; guide: number }[],
  ): { value: number; guide: number } | null => {
    let best: { value: number; guide: number } | null = null
    for (const c of cands) {
      if (Math.abs(c.value - val) > SNAP) continue
      if (!best || Math.abs(c.value - val) < Math.abs(best.value - val)) {
        best = c
      }
    }
    return best
  }

  const sx = pick(box.x, xCands)
  const sy = pick(box.y, yCands)
  const nx = clamp(Math.round((sx ? sx.value : box.x) / 10) * 10, b.minX, b.maxX - W)
  const ny = clamp(Math.round((sy ? sy.value : box.y) / 10) * 10, b.minY, b.maxY - D)

  return {
    x: nx - ox,
    y: ny - oy,
    guideX: withGuides && sx ? sx.guide : null,
    guideY: withGuides && sy ? sy.guide : null,
  }
}
