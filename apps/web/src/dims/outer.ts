/**
 * Внешние размеры: расстояния от модуля до стен/перегородок и соседних
 * объектов по четырём сторонам. Чистая логика — без Babylon и Vue.
 *
 * Стена считается препятствием: расстояние идёт лучом до ближайшей стены,
 * поэтому объект из другой комнаты не «просвечивает» через перегородку.
 */
import type { Instance } from '../state/defaults'
import { footprintOf, zSpan } from '../state/geometry'
import type { Room } from '../render25d/types'
import { roomWalls } from '../render25d/room'
import { DIM_OUT_OBJ, DIM_OUT_WALL } from './colors'
import type { WorldPoint } from './types'

export type OuterDim = {
  gap: number
  a: WorldPoint
  b: WorldPoint
  label: string
  color: string
  hint: string
}

type DerivedMap = Record<string, { corpus: { W: number; D: number } } | undefined>

export function outerDims(
  inst: Instance,
  instances: Instance[],
  derived: DerivedMap,
  room: Room,
): OuterDim[] {
  const p = inst.params
  const d = derived[inst.id]
  const zStart = inst.z || 0
  const total = p.mount === 'wall'
    ? p.H
    : (p.plinthH || 0) + p.H + (p.worktopT || 0)
  const zEnd = zStart + total
  // Внешние расстояния рисуем у нижней плоскости объекта.
  const zMark = zStart + 4
  const box = footprintOf(
    inst.x, inst.y,
    d?.corpus.W || p.W, d?.corpus.D || p.D,
    inst.rot,
  )
  const xMid = box.x + box.w / 2
  const yMid = box.y + box.d / 2

  const wallSegs = roomWalls(room)
  const wallGap = (
    axis: 'x' | 'y',
    sign: -1 | 1,
    fixed: number,
  ): number => {
    let best = Infinity
    for (const w of wallSegs) {
      const ax = w.a.x
      const ay = w.a.y
      const bx = w.a.x + w.dx * w.len
      const by = w.a.y + w.dy * w.len
      if (axis === 'x') {
        if (Math.abs(by - ay) < 0.5) continue
        const t = (fixed - ay) / (by - ay)
        if (t < 0 || t > 1) continue
        const x = ax + (bx - ax) * t
        const gap = sign < 0 ? box.x - x : x - (box.x + box.w)
        if (gap >= 0) best = Math.min(best, gap)
      } else {
        if (Math.abs(bx - ax) < 0.5) continue
        const t = (fixed - ax) / (bx - ax)
        if (t < 0 || t > 1) continue
        const y = ay + (by - ay) * t
        const gap = sign < 0 ? box.y - y : y - (box.y + box.d)
        if (gap >= 0) best = Math.min(best, gap)
      }
    }
    return best
  }

  const gLeft = wallGap('x', -1, yMid)
  const gRight = wallGap('x', 1, yMid)
  const gBack = wallGap('y', -1, xMid)
  const gFront = wallGap('y', 1, xMid)

  let left: OuterDim = {
    gap: gLeft,
    a: { x: box.x - gLeft, y: yMid, z: zMark },
    b: { x: box.x, y: yMid, z: zMark },
    label: `← ${Math.round(gLeft)}`,
    color: DIM_OUT_WALL,
    hint: 'до стены',
  }
  let right: OuterDim = {
    gap: gRight,
    a: { x: box.x + box.w, y: yMid, z: zMark },
    b: { x: box.x + box.w + gRight, y: yMid, z: zMark },
    label: `→ ${Math.round(gRight)}`,
    color: DIM_OUT_WALL,
    hint: 'до стены',
  }
  let back: OuterDim = {
    gap: gBack,
    a: { x: xMid, y: box.y - gBack, z: zMark },
    b: { x: xMid, y: box.y, z: zMark },
    label: `↑ ${Math.round(gBack)}`,
    color: DIM_OUT_WALL,
    hint: 'до стены',
  }
  let front: OuterDim = {
    gap: gFront,
    a: { x: xMid, y: box.y + box.d, z: zMark },
    b: { x: xMid, y: box.y + box.d + gFront, z: zMark },
    label: `↓ ${Math.round(gFront)}`,
    color: DIM_OUT_WALL,
    hint: 'до стены',
  }

  for (const o of instances) {
    if (o.id === inst.id) continue
    const od = derived[o.id]
    const op = o.params
    const ot = op.mount === 'wall'
      ? op.H
      : (op.plinthH || 0) + op.H + (op.worktopT || 0)
    const oz0 = o.z || 0
    const oz1 = oz0 + ot
    if (oz1 <= zStart + 0.5 || oz0 >= zEnd - 0.5) continue
    const ob = footprintOf(
      o.x, o.y,
      od?.corpus.W || op.W, od?.corpus.D || op.D, o.rot,
    )
    const name = o.name || 'объект'
    if (ob.y < box.y + box.d - 0.5 && ob.y + ob.d > box.y + 0.5 &&
        ob.x + ob.w <= box.x + 0.5) {
      const gap = box.x - (ob.x + ob.w)
      if (gap >= 0 && gap < left.gap) {
        left = { gap, a: { x: ob.x + ob.w, y: yMid, z: zMark },
          b: { x: box.x, y: yMid, z: zMark },
          label: `← ${Math.round(gap)}`, color: DIM_OUT_OBJ,
          hint: `до «${name}»` }
      }
    }
    if (ob.y < box.y + box.d - 0.5 && ob.y + ob.d > box.y + 0.5 &&
        ob.x >= box.x + box.w - 0.5) {
      const gap = ob.x - (box.x + box.w)
      if (gap >= 0 && gap < right.gap) {
        right = { gap, a: { x: box.x + box.w, y: yMid, z: zMark },
          b: { x: ob.x, y: yMid, z: zMark },
          label: `→ ${Math.round(gap)}`, color: DIM_OUT_OBJ,
          hint: `до «${name}»` }
      }
    }
    if (ob.x < box.x + box.w - 0.5 && ob.x + ob.w > box.x + 0.5 &&
        ob.y + ob.d <= box.y + 0.5) {
      const gap = box.y - (ob.y + ob.d)
      if (gap >= 0 && gap < back.gap) {
        back = { gap, a: { x: xMid, y: ob.y + ob.d, z: zMark },
          b: { x: xMid, y: box.y, z: zMark },
          label: `↑ ${Math.round(gap)}`, color: DIM_OUT_OBJ,
          hint: `до «${name}»` }
      }
    }
    if (ob.x < box.x + box.w - 0.5 && ob.x + ob.w > box.x + 0.5 &&
        ob.y >= box.y + box.d - 0.5) {
      const gap = ob.y - (box.y + box.d)
      if (gap >= 0 && gap < front.gap) {
        front = { gap, a: { x: xMid, y: box.y + box.d, z: zMark },
          b: { x: xMid, y: ob.y, z: zMark },
          label: `↓ ${Math.round(gap)}`, color: DIM_OUT_OBJ,
          hint: `до «${name}»` }
      }
    }
  }

  return [left, right, back, front]
}
