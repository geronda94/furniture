export type Vec3 = [number, number, number]

export interface Pt {
  x: number
  y: number
}

export interface SceneObject {
  name: string
  hinge?: 'left' | 'right'
  drawer_id?: number
  open?: number
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  kind: string
  role: string
  sec?: number
}

export type OpeningKind = 'window' | 'door' | 'arch'
export type WallItemKind = 'shelf' | 'mirror' | 'socket' | 'switch'

export interface WallItem {
  id: string
  kind: WallItemKind
  /** индекс стены/перегородки */
  wall: number
  /** смещение вдоль стены и высота низа, мм */
  x: number
  z: number
  w: number
  h: number
  /** выступ от стены, мм */
  depth: number
}

export interface RoomSurface {
  enabled: boolean
  /** ключ материала в project.materials */
  material: string
  /** толщина покрытия, мм */
  t?: number
}

export interface Room {
  w: number
  d: number
  h: number
  floor?: RoomSurface
  ceiling?: RoomSurface
  wallItems?: WallItem[]
  /** толщина стен наружу от внутренней грани, мм */
  wallT?: number
  /** контур комнаты в плане, мм; если нет — прямоугольник w×d */
  outline?: [number, number][]
  /** внутренние перегородки (две точки в плане) */
  partitions?: { a: [number, number]; b: [number, number]; wallT?: number }[]
  openings?: Opening[]
}

export interface Material {
  name: string
  color: string
  accent?: string
  pattern: 'solid' | 'wood' | 'stone' | 'metal'
  /** data URL или URL реальной бесшовной текстуры */
  texture?: string
  /** мм на один тайл текстуры */
  texScale?: number
}

export type WallIndex = number

export type ViewStyle = 'schematic' | 'realistic'

export interface Opening {
  id: string
  kind: OpeningKind
  /** дверь открыта в комнату */
  open?: boolean
  /** сторона петли */
  hinge?: 'left' | 'right'
  /** угол открывания, градусы */
  angle?: number
  /** 0 — задняя (y=d), 1 — правая (x=w), 2 — передняя, 3 — левая (x=0) */
  wall: WallIndex
  /** смещение вдоль стены, мм */
  x: number
  w: number
  z0: number
  z1: number
}

export type Materials = Record<string, Material>

/** Гранулярная часть изделия, к которой применяется материал. */
export type MaterialPart =
  | 'carcass'
  | 'sides'
  | 'shelf'
  | 'divider'
  | 'door'
  | 'drawerFront'
  | 'drawerBox'
  | 'back'
  | 'worktop'
  | 'plinth'
  | 'leg'

export type MaterialScope = 'all' | 'floor' | 'wall'

/** Глобальная переменная материала (декор + к чему применяется). */
export interface MaterialVariable {
  id: string
  name: string
  enabled: boolean
  scope: MaterialScope
  parts: MaterialPart[]
  material: Material
}

export interface Camera {
  yaw: number
  pitch: number
  /** орто: пикселей на мм */
  zoom: number
  target: Vec3
  projection?: 'ortho' | 'persp'
  /** перспектива: расстояние от цели до глаза, мм */
  distance?: number
  /** перспектива: вертикальный угол обзора, градусы */
  fov?: number
}

export interface Placement {
  id: string
  x: number
  y: number
  rot: number
  /** подъём над полом, мм (навесная мебель) */
  z?: number
}

export interface PlacedObject {
  object: SceneObject
  placement: Placement
  /** значения каналов субобъекта: { open: 45 } / { slide: 300 } */
  anim?: Record<string, number>
  /** индекс детали внутри модуля (для выделения элементов) */
  part?: number
  /** материалы конкретного модуля (переопределения проекта) */
  materials?: Materials
  /** итоговый материал конкретной детали (после глобальных переменных) */
  material?: Material
}

export interface Face {
  pts: Pt[]
  depth: number
  /** ближайшая к глазу точка грани (для сортировки) */
  dmin: number
  normal: Vec3
  p00: Pt
  p10: Pt
  p01: Pt
  uLen: number
  vLen: number
  uvOrigin: Vec3
  uvU: Vec3
  uvV: Vec3
  color: string
  material: Material
  objectId?: string
  part?: number
  kind: string
  alpha?: number
}
