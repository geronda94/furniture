import type { Instance } from '../state/project'
import type { SceneObject } from '../render25d/types'

export interface ElementInfo {
  index: number
  name: string
  /** имя для списка: «Полка 2», «Фасад дверь (левая)» */
  title: string
  /** номер ящика (1..n) для деталей ящика */
  drawerId?: number
  kind: string
  role: string
  /** ширина (X), высота (Z), глубина (Y) — мм */
  w: number
  h: number
  d: number
  x: number
  y: number
  z: number
}

export interface GapInfo {
  label: string
  /** мм */
  size: number
  from: number
  to: number
}

export interface ElementGroup {
  key: string
  label: string
  elements: ElementInfo[]
}

export interface ModuleInfo {
  W: number
  H: number
  D: number
  totalH: number
  elements: ElementInfo[]
  shelves: GapInfo[]
  facades: ElementInfo[]
  facadeGaps: GapInfo[]
  drawers: ElementInfo[]
  /** иерархия: объект → группы субобъектов */
  groups: ElementGroup[]
}

function plate(o: SceneObject): boolean {
  return o.kind === 'corpus' && o.sz <= 30 && o.sx > 200 && o.sy > 150
}

function byZ(a: SceneObject, b: SceneObject): number {
  return a.z - b.z
}

function byX(a: SceneObject, b: SceneObject): number {
  return a.x - b.x
}

/**
 * Размеры модуля и его элементов: габарит, полки (расстояния между ними),
 * фасады (двери/ящики) и просветы между ними.
 */
export function moduleInfo(inst: Instance, objects: SceneObject[] | undefined): ModuleInfo | null {
  if (!objects?.length) return null

  const totals = new Map<string, number>()
  for (const o of objects) {
    totals.set(o.name, (totals.get(o.name) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const titleOf = (o: SceneObject): string => {
    const n = (seen.get(o.name) ?? 0) + 1
    seen.set(o.name, n)
    const isDrawer = o.kind === 'drawerbox' || o.kind === 'drawerfront'
    if (isDrawer) {
      if (o.kind === 'drawerfront') return 'Фасад'
      const short = o.name.replace(/^Ящик\s+/, '')
      return (totals.get(o.name) ?? 0) > 1 ? `${short} ${n}` : short
    }
    if ((totals.get(o.name) ?? 0) > 1) {
      if (o.kind === 'door' && o.hinge) {
        return `${o.name} (${o.hinge === 'left' ? 'левая' : 'правая'})`
      }
      if (o.kind === 'leg') return o.name
      return `${o.name} ${n}`
    }
    return o.name
  }

  const elements: ElementInfo[] = objects.map((o, index) => ({
    index,
    name: o.name,
    title: titleOf(o),
    drawerId:
      o.kind === 'drawerbox' || o.kind === 'drawerfront'
        ? (o.drawer_id ?? 0)
        : undefined,
    kind: o.kind,
    role: o.role,
    w: o.sx,
    h: o.sz,
    d: o.sy,
    x: o.x,
    y: o.y,
    z: o.z,
  }))

  let W = inst.params.W
  let D = inst.params.D
  let totalH = 0
  for (const o of objects) {
    totalH = Math.max(totalH, o.z + o.sz)
    W = Math.max(W, o.x + o.sx)
    D = Math.max(D, o.y + o.sy)
  }

  // расстояния считаем внутри отсека: у каждого отсека свой набор полок
  const shelves: GapInfo[] = []
  const shelfGroups = new Map<string, SceneObject[]>()
  for (const o of objects.filter(plate)) {
    const key = `${Math.round(o.x)}|${Math.round(o.sx)}`
    const arr = shelfGroups.get(key) ?? []
    arr.push(o)
    shelfGroups.set(key, arr)
  }
  const ordered = [...shelfGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [, group] of ordered) {
    if (!group.some((o) => o.name === 'Полка')) continue
    // добавляем дно и крышу, которые перекрывают этот отсек
    const gx0 = Math.min(...group.map((o) => o.x))
    const gx1 = Math.max(...group.map((o) => o.x + o.sx))
    const cover = objects.filter(
      (o) =>
        plate(o) &&
        o.name !== 'Полка' &&
        o.x <= gx0 + 1 &&
        o.x + o.sx >= gx1 - 1,
    )
    const plates = [...group, ...cover].sort(byZ)
    const shelfNames = new Map<SceneObject, string>()
    group
      .slice()
      .sort(byZ)
      .forEach((o, i) => shelfNames.set(o, `Полка ${i + 1}`))
    const names = plates.map((o) => shelfNames.get(o) ?? o.name)
    for (let i = 0; i < plates.length - 1; i++) {
      const a = plates[i]
      const b = plates[i + 1]
      const from = a.z + a.sz
      const to = b.z
      const size = Math.round(to - from)
      if (size > 0) {
        shelves.push({
          label: `${names[i]} → ${names[i + 1]}`,
          size,
          from,
          to,
        })
      }
    }
  }

  const facadeObjects = objects
    .filter((o) => o.kind === 'door' || o.kind === 'drawerfront')
    .sort((a, b) => (a.z !== b.z ? b.z - a.z : a.x - b.x))

  const facades = facadeObjects.map((o) => elements[objects.indexOf(o)])
  const facadeGaps: GapInfo[] = []
  for (const row of [facadeObjects]) {
    const sorted = [...row].sort(byX)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (Math.abs(a.z - b.z) > 1) continue
      const from = a.x + a.sx
      const to = b.x
      const size = Math.round(to - from)
      if (size > 0 && size < 40) {
        facadeGaps.push({
          label: `просвет ${i + 1}`,
          size,
          from,
          to,
        })
      }
    }
  }

  const groupOf = (e: ElementInfo): { key: string; label: string } => {
    if (e.drawerId) {
      return { key: `drawer-${e.drawerId}`, label: `Ящик ${e.drawerId}` }
    }
    if (e.kind === 'door') return { key: 'facades', label: 'Фасады' }
    if (e.kind === 'leg') return { key: 'legs', label: 'Опоры' }
    if (e.kind === 'back') return { key: 'back', label: 'Задняя стенка' }
    if (e.kind === 'worktop' || e.kind === 'plinth') {
      return { key: 'outer', label: 'Столешница и цоколь' }
    }
    return { key: 'corpus', label: 'Корпус' }
  }
  const buckets = new Map<string, ElementGroup>()
  for (const e of elements) {
    const g = groupOf(e)
    if (!buckets.has(g.key)) {
      buckets.set(g.key, { key: g.key, label: g.label, elements: [] })
    }
    buckets.get(g.key)!.elements.push(e)
  }
  const order = (key: string): number => {
    if (key === 'corpus') return 0
    if (key === 'facades') return 10
    if (key.startsWith('drawer-')) return 20 + Number(key.slice(7))
    if (key === 'back') return 100
    if (key === 'outer') return 110
    return 120
  }
  const groups = [...buckets.values()].sort(
    (a, b) => order(a.key) - order(b.key),
  )

  return {
    groups,
    W: Math.round(W),
    H: Math.round(inst.params.H),
    D: Math.round(D),
    totalH: Math.round(totalH),
    elements,
    shelves,
    facades,
    facadeGaps,
    drawers: facadeObjects
      .filter((o) => o.kind === 'drawerfront')
      .map((o) => elements[objects.indexOf(o)]),
  }
}

export interface NeighborGap {
  /** «до Полка 2» / «от крышки» */
  label: string
  /** просвет между деталями, мм */
  distance: number
  /** координата ближней грани выбранной детали */
  from: number
  /** координата ближней грани соседа */
  to: number
}

export interface PartRelations {
  above?: NeighborGap
  below?: NeighborGap
  left?: NeighborGap
  right?: NeighborGap
  /** расстояния до габарита модуля, мм */
  toLeft: number
  toRight: number
  toTop: number
  toBottom: number
  toFront: number
  toBack: number
}

function relationTitle(info: ModuleInfo, e: ElementInfo): string {
  return e.title
}

/**
 * Соседние элементы и просветы вокруг выбранной детали:
 * сверху/снизу — полки, крышка, дно, ящики; слева/справа — стенки и
 * перегородки. Это ответ на «на каком расстоянии следующая полка».
 */
export function relationsFor(
  info: ModuleInfo,
  index: number | null | undefined,
): PartRelations | null {
  if (index == null) return null
  const e = info.elements[index]
  if (!e) return null
  const isFacade = e.kind === 'door' || e.kind === 'drawerfront'
  const isDrawer = !!e.drawerId
  const pool = info.elements.filter((x) => {
    if (x.index === e.index) return false
    if (isFacade) return x.kind === 'door' || x.kind === 'drawerfront'
    if (isDrawer) {
      return x.kind === 'drawerbox' || x.kind === 'drawerfront' ||
        x.kind === 'corpus'
    }
    return x.kind === 'corpus' || x.kind === 'drawerbox'
  })

  const xOverlap = (a: ElementInfo, b: ElementInfo) =>
    a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1
  const zOverlap = (a: ElementInfo, b: ElementInfo) =>
    a.z < b.z + b.h - 1 && a.z + a.h > b.z + 1

  const out: PartRelations = {
    toLeft: Math.round(e.x),
    toRight: Math.round(info.W - (e.x + e.w)),
    toTop: Math.round(info.totalH - (e.z + e.h)),
    toBottom: Math.round(e.z),
    toFront: Math.round(e.y),
    toBack: Math.round(info.D - (e.y + e.d)),
  }
  let bestAbove = Infinity
  let bestBelow = Infinity
  let bestLeft = Infinity
  let bestRight = Infinity
  for (const c of pool) {
    if (xOverlap(e, c)) {
      const above = c.z - (e.z + e.h)
      if (above >= -0.5 && above < bestAbove) {
        bestAbove = above
        out.above = {
          label: `до «${relationTitle(info, c)}»`,
          distance: Math.round(above),
          from: e.z + e.h,
          to: c.z,
        }
      }
      const below = e.z - (c.z + c.h)
      if (below >= -0.5 && below < bestBelow) {
        bestBelow = below
        out.below = {
          label: `до «${relationTitle(info, c)}»`,
          distance: Math.round(below),
          from: c.z + c.h,
          to: e.z,
        }
      }
    }
    if (zOverlap(e, c)) {
      const right = c.x - (e.x + e.w)
      if (right >= -0.5 && right < bestRight) {
        bestRight = right
        out.right = {
          label: `до «${relationTitle(info, c)}»`,
          distance: Math.round(right),
          from: e.x + e.w,
          to: c.x,
        }
      }
      const left = e.x - (c.x + c.w)
      if (left >= -0.5 && left < bestLeft) {
        bestLeft = left
        out.left = {
          label: `до «${relationTitle(info, c)}»`,
          distance: Math.round(left),
          from: c.x + c.w,
          to: e.x,
        }
      }
    }
  }
  return out
}

/** Крупные подписи размеров: ширина × высота × глубина. */
export function sizeLabel(e: ElementInfo): string {
  const a = Math.round(e.w)
  const b = Math.round(e.h)
  const c = Math.round(e.d)
  if (e.kind === 'door' || e.kind === 'drawerfront') return `${a} × ${b}`
  return `${a} × ${b} × ${c}`
}
