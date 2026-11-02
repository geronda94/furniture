/** Общие типы размерной разметки (2D-оверлей над 3D). */

export type DimPoint = { x: number; y: number }
export type WorldPoint = { x: number; y: number; z: number }

/** Локальная грань детали: от a до b, доля [from..to] вдоль ребра. */
export type EdgeSpec = {
  a: [number, number, number]
  b: [number, number, number]
  from?: number
  to?: number
}

/** Готовая линия размера в экранных координатах. */
export type DimLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  tx: number
  ty: number
  label: string
  color: string
  labelW: number
  marker: string
  /** Подсказка «до стены» / «до «…»». */
  hint: string
  /** Проекции реальных граней (у межобъектного размера их две). */
  edges: [number, number, number, number][]
}
