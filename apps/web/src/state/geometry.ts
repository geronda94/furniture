/**
 * Чистая геометрия плана: объёмы, повороты, грани стен.
 *
 * Вынесено из `state/project.ts` (P2-5, docs/26): здесь нет реактивного
 * состояния — только функции над координатами в миллиметрах. Модуль можно
 * тестировать и переиспользовать без Vue.
 */
import type { Room } from '../render25d/types'
import { outlinePoints, pointInPoly, roomWalls } from '../render25d/room'
import type { Instance } from './project'

export interface Box2 {
  x: number
  y: number
  w: number
  d: number
}

export interface Box3 extends Box2 {
  z0: number
  z1: number
}

/** Вертикальный габарит модуля: Z + полная высота (цоколь/столешница). */
export function zSpan(inst: Instance): [number, number] {
  const p = inst.params
  const h = p.mount === 'wall'
    ? p.H
    : (p.plinthH || 0) + p.H + (p.worktopT || 0)
  const z0 = inst.z || 0
  return [z0, z0 + h]
}

export function normalizeRot(deg: number): number {
  const r = Math.round(deg / 90) * 90
  return ((r % 360) + 360) % 360
}

/** Габарит повёрнутого модуля в мировых осях (AABB). */
export function footprintOf(
  x: number,
  y: number,
  W: number,
  D: number,
  rot: number,
): Box2 {
  const a = (rot * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lx, ly] of [
    [0, 0],
    [W, 0],
    [W, D],
    [0, D],
  ]) {
    const wx = x + lx * cs - ly * sn
    const wy = y + lx * sn + ly * cs
    if (wx < minX) minX = wx
    if (wx > maxX) maxX = wx
    if (wy < minY) minY = wy
    if (wy > maxY) maxY = wy
  }
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY }
}

/** Пересечение объёмов: по плану И по высоте. Навесной над напольным — ок. */
export function overlaps(a: Box3, b: Box3): boolean {
  const eps = 0.05
  return (
    a.x < b.x + b.w - eps &&
    a.x + a.w > b.x + eps &&
    a.y < b.y + b.d - eps &&
    a.y + a.d > b.y + eps &&
    a.z0 < b.z1 - 0.5 &&
    a.z1 > b.z0 + 0.5
  )
}

export function distanceToSeg(
  x: number, y: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const vx = bx - ax
  const vy = by - ay
  const len = vx * vx + vy * vy
  const t = len < 1e-9 ? 0 : Math.max(0, Math.min(1,
    ((x - ax) * vx + (y - ay) * vy) / len))
  return Math.hypot(x - (ax + vx * t), y - (ay + vy * t))
}

export function insideOrEdge(x: number, y: number, pts: { x: number; y: number }[], tol = 1.5): boolean {
  if (pointInPoly(x, y, pts)) return true
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (distanceToSeg(x, y, a.x, a.y, b.x, b.y) <= tol) return true
  }
  return false
}

export function cornersOf(x: number, y: number, W: number, D: number, rot: number) {
  const a = (rot * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  return [[0, 0], [W, 0], [W, D], [0, D]].map(([lx, ly]) => ({
    x: x + lx * cs - ly * sn,
    y: y + lx * sn + ly * cs,
  }))
}

export interface WallFace {
  wall: number
  outer: boolean
  /** точка на внутренней грани */
  ax: number
  ay: number
  /** нормаль в сторону помещения */
  nx: number
  ny: number
  /** направление вдоль стены и её длина */
  dx: number
  dy: number
  len: number
  /** толщина стены */
  t: number
}

/** Внутренние грани стен, к которым можно прижать модуль. */
export function wallFaces(room: Room): WallFace[] {
  const outline = outlinePoints(room)
  const out: WallFace[] = []
  for (const w of roomWalls(room)) {
    if (w.outer) {
      out.push({ wall: w.index, outer: true, ax: w.a.x, ay: w.a.y,
        nx: w.nx, ny: w.ny, dx: w.dx, dy: w.dy, len: w.len, t: w.t })
      continue
    }
    for (const [off, nx, ny] of [
      [0, w.nx, w.ny],
      [-w.t, -w.nx, -w.ny],
    ] as const) {
      const ax = w.a.x + w.nx * off
      const ay = w.a.y + w.ny * off
      const sx = ax + nx * 24
      const sy = ay + ny * 24
      if (insideOrEdge(sx, sy, outline, 0.5)) {
        out.push({ wall: w.index, outer: false, ax, ay, nx, ny,
          dx: w.dx, dy: w.dy, len: w.len, t: w.t })
      }
    }
  }
  return out
}
