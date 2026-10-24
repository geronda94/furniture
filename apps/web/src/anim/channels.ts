import type { SceneObject } from '../render25d/types'

/**
 * Единая модель анимации.
 *
 * Объект (модуль) содержит субобъекты (детали). У подвижного субобъекта есть
 * набор каналов (например, «открывание» у двери или «выкат» у ящика), у канала —
 * текущее значение и ключи. Один и тот же тип используется и редактором, и
 * рендерером, и будущей автогенерацией ключей (Blender/видео/презентации).
 */

export type Ease = 'linear' | 'easeInOut' | 'easeOut'

export interface Keyframe {
  /** время, сек */
  t: number
  /** значение в единицах канала */
  v: number
  ease?: Ease
}

export interface Channel {
  id: string
  label: string
  /** '°', 'мм', '%', '' */
  unit: string
  min: number
  max: number
  /** текущее статическое значение */
  value: number
  /** ключи анимации (пусто — берётся value) */
  keys: Keyframe[]
}

export type ChannelSet = Record<string, Channel>

export function channel(
  id: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  value = min,
): Channel {
  return { id, label, unit, min, max, value, keys: [] }
}

/** Ключ подвижного элемента: дверь — своя, ящик — общий на корпус+фасад. */
export function partKey(o: SceneObject, part: number): string {
  if (o.kind === 'drawerfront' || o.kind === 'drawerbox') {
    return `drawer:${o.drawer_id ?? part}`
  }
  if (o.kind === 'door') return `door:${part}`
  return `part:${part}`
}

export function isMovable(o: SceneObject): boolean {
  return o.kind === 'door' || o.kind === 'drawerfront' || o.kind === 'drawerbox'
}

/** Какие каналы есть у субобъекта по его типу. */
export function channelsFor(o: SceneObject): ChannelSet {
  if (o.kind === 'door') {
    return { open: channel('open', 'Открывание', '°', 0, 90, 0) }
  }
  if (o.kind === 'drawerfront' || o.kind === 'drawerbox') {
    const run = o.open ?? 420
    return { slide: channel('slide', 'Выкат', 'мм', 0, run, 0) }
  }
  return {}
}

/** Значение канала «по умолчанию», когда элемент полностью открыт. */
export function openValue(ch: Channel): number {
  return ch.max
}

export function closedValue(ch: Channel): number {
  return ch.min
}

/** Ключи по умолчанию: плавное открытие/закрытие. */
export function defaultKeys(ch: Channel, kind: string): Keyframe[] {
  if (ch.id === 'open') {
    if (kind === 'door') {
      return [
        { t: 0, v: ch.min, ease: 'easeInOut' },
        { t: 0.7, v: ch.max, ease: 'easeInOut' },
      ]
    }
  }
  if (ch.id === 'slide') {
    return [
      { t: 0, v: ch.min, ease: 'easeOut' },
      { t: 0.55, v: ch.max, ease: 'easeOut' },
    ]
  }
  return [
    { t: 0, v: ch.min },
    { t: 0.6, v: ch.max },
  ]
}

function ease(k: number, mode: Ease | undefined): number {
  if (mode === 'easeInOut') return k * k * (3 - 2 * k)
  if (mode === 'easeOut') return 1 - (1 - k) * (1 - k)
  return k
}

/** Значение канала в момент t (сек). */
export function evaluateChannel(ch: Channel, t: number): number {
  const keys = [...ch.keys].sort((a, b) => a.t - b.t)
  if (!keys.length) return ch.value
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t < a.t || t > b.t) continue
    const span = b.t - a.t || 1
    const k = ease((t - a.t) / span, a.ease)
    return a.v + (b.v - a.v) * k
  }
  return last.v
}

/** Значения всех каналов набора в момент t. */
export function evaluateSet(
  set: ChannelSet,
  t: number,
  animated = true,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, ch] of Object.entries(set)) {
    out[id] = animated && ch.keys.length ? evaluateChannel(ch, t) : ch.value
  }
  return out
}

/** Длительность анимации набора (сек). */
export function setDuration(set: ChannelSet): number {
  let d = 0
  for (const ch of Object.values(set)) {
    for (const k of ch.keys) d = Math.max(d, k.t)
  }
  return d
}

export function isOpen(ch: Channel): boolean {
  return ch.value > ch.min + 0.001
}
