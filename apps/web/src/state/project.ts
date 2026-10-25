import { computed, reactive } from 'vue'
import {
  apiGetProject,
  apiHandles,
  apiHardware,
  apiListProjects,
  apiPutProject,
  apiRestoreVersion,
  apiSolve,
  type HandleInfo,
  type RunnerInfo,
  type SolveResponse,
} from '../api'
import {
  channelsFor,
  defaultKeys,
  evaluateChannel,
  evaluateSet,
  isMovable,
  partKey,
  setDuration,
  type Channel,
  type ChannelSet,
  type Keyframe,
} from '../anim/channels'
import type {
  Camera,
  Material,
  MaterialPart,
  MaterialScope,
  MaterialVariable,
  Materials,
  Opening,
  OpeningKind,
  Room,
  RoomSurface,
  ViewStyle,
  WallIndex,
  WallItem,
  WallItemKind,
} from '../render25d/types'
import { outlinePoints, pointInPoly, roomBounds, roomWallLength, roomWalls } from '../render25d/room'
import {
  partGroupKey,
  partUid,
  resolveMaterial,
  resolveObjectMaterial,
} from '../material/vars'

export type Frame = 'inset' | 'overlay'
export type Hardware = 'blum' | 'hettich' | 'gtv'
export type BackKind = 'dvp' | 'same' | 'cardboard' | 'none'
export type Reinforce = 'auto' | 'on' | 'off'

/** Политика кромки: типы по видимости + переопределения по деталям. */
export interface EdgePolicy {
  /** тип/толщина для видимых кромок (pvc_2, abs_2, …) */
  visible?: string
  /** тип/толщина для скрытых кромок (pvc_04, …) */
  hidden?: string
  /** имя детали (можно с * на конце) → сторона → auto|none|тип */
  byPart?: Record<string, Record<string, string>>
  /** показывать ли кромку в BOM/превью (данные не удаляются) */
  show?: boolean
}

/** Блок компоновки фасадов сверху вниз. height=0 — высота по остатку. */
export interface FrontBlock {
  type: 'doors' | 'drawers'
  count: number
  height: number
}

export interface Params {
  W: number
  H: number
  D: number
  doors: number
  drawers: number
  shelves: number
  frame: Frame
  hardware: Hardware
  /** id направляющих ящиков из specs/hardware.yaml */
  runners: string
  /** высоты фасадов ящиков, мм (последний добирает остаток) */
  drawerHeights?: number[]
  /** толщина ЛДСП, мм */
  t: number
  /** задняя стенка: ДВП / тот же ЛДСП / картон / нет */
  back: BackKind
  /** толщина задней стенки, мм */
  backT: number
  /** крыша корпуса */
  roof: boolean
  /** царги: auto — только когда нужны, on — всегда, off — нет */
  reinforce: Reinforce
  /** произвольная компоновка фасадов сверху вниз */
  fronts?: FrontBlock[]
  /** напольный или навесной модуль */
  mount: 'floor' | 'wall'
  /** прямоугольные вырезы в столешнице, мм от левого/переднего края */
  cutouts?: { x: number; y: number; w: number; h: number }[]
  /** высота цоколя, мм (0 — без цоколя) */
  plinthH: number
  /** толщина столешницы, мм (0 — без столешницы) */
  worktopT: number
  /** зазоры фасадов, мм (наследуются из глобальных переменных проекта) */
  gapSide: number
  gapBetween: number
  gapTop: number
  gapBottom: number
  /** явные внутренние перегородки (0 — без перегородок) */
  dividers: number
  /** id ручки из specs/hardware.yaml */
  handle: string
  /** материал фасадов: ЛДСП или МДФ */
  facadeMaterial?: 'ldsp' | 'mdf'
  /** тип фасада: гладкий, фрезерованный, с ручкой, push, профиль */
  facadeStyle?: 'flat' | 'milled' | 'handle' | 'push' | 'profile'
  /** id крепежа корпуса: confirmat | minifix | dowel */
  fastener?: string
  /** id опоры полок: system32 | lock-pin | minifix-shelf | dowel-shelf */
  shelfSupport?: string
  /** id газового патрона (пусто — без патрона) */
  gasStrut?: string
  /** id крепления опор/колёс из specs/hardware.yaml.legs */
  legMount?: string
  /** скрытый крепёж корпуса: авто выбирает минификс вместо евровинта */
  hiddenFasteners?: boolean
  /** переопределения крепежа по классу соединения */
  connectionOverrides?: Record<string, string>
  /** политика кромки: типы и переопределения по деталям */
  edges?: EdgePolicy
  /** сверлить ряды System 32 на боковинах */
  system32?: boolean
}

/** Глобальные переменные проекта: значения по умолчанию для всех модулей. */
export interface ProjectGlobals {
  t: number
  back: BackKind
  backT: number
  roof: boolean
  reinforce: Reinforce
  frame: Frame
  hardware: Hardware
  runners: string
  plinthH: number
  worktopT: number
  gapSide: number
  gapBetween: number
  gapTop: number
  gapBottom: number
  /** применять изменения сразу ко всем модулям без собственных переопределений */
  autoApply: boolean
}

export type ManagedParam =
  | 't' | 'back' | 'backT' | 'roof' | 'reinforce' | 'frame'
  | 'hardware' | 'runners' | 'plinthH' | 'worktopT'
  | 'gapSide' | 'gapBetween' | 'gapTop' | 'gapBottom'

export const MANAGED_PARAMS: ManagedParam[] = [
  't', 'back', 'backT', 'roof', 'reinforce', 'frame',
  'hardware', 'runners', 'plinthH', 'worktopT',
  'gapSide', 'gapBetween', 'gapTop', 'gapBottom',
]

export const defaultGlobals = (): ProjectGlobals => ({
  t: 16,
  back: 'dvp',
  backT: 4,
  roof: true,
  reinforce: 'auto',
  frame: 'inset',
  hardware: 'blum',
  runners: 'tandem-21',
  plinthH: 100,
  worktopT: 38,
  gapSide: 2,
  gapBetween: 3,
  gapTop: 2,
  gapBottom: 2,
  autoApply: true,
})

export interface Instance {
  id: string
  product: string
  name?: string
  x: number
  y: number
  /** высота над полом, мм (навесная мебель) */
  z: number
  rot: number
  /** напольная мебель: Z залочен, пока не разлочат */
  zLocked: boolean
  params: Params
  /** переопределения параметров относительно глобальных переменных проекта */
  overrides?: ManagedParam[]
  /** материалы только для этого модуля (перекрывают материалы проекта) */
  materials?: Materials
  /** зона/этаж: к модулю применяются переменные с той же зоной */
  zone?: string
  /** материал конкретной детали (ключ — индекс; legacy) */
  partMaterials?: Record<string, Material>
  /** материал всех одинаковых деталей (группа: имя+секция+ящик) */
  partMaterialGroups?: Record<string, Material>
  /** материал конкретной детали (ключ — устойчивый uid: группа+позиция) */
  partOverrides?: Record<string, Material>
  /** выполненные шаги сборки (индексы) */
  assemblyDone?: number[]
  /** анимация субобъектов: ключ (door:N | drawer:N) → набор каналов */
  anim?: Record<string, ChannelSet>
  /** @deprecated миграция старых проектов */
  legacyDoorsOpen?: boolean
  legacyDrawersOpen?: boolean
}

export interface ModulePreset {
  key: string
  label: string
  hint: string
  /** группа каталога: Тумбы, Ящики, Мойки, Комбинированные */
  group: string
  params: Partial<Params>
}

export const MODULE_PRESETS: ModulePreset[] = [
  {
    key: 'base600',
    label: 'Тумба 600',
    hint: '1 дверь',
    group: 'Тумбы',
    params: { W: 600, H: 720, D: 560, doors: 1, drawers: 0, shelves: 1 },
  },
  {
    key: 'base800',
    label: 'Тумба 800',
    hint: '2 двери',
    group: 'Тумбы',
    params: { W: 800, H: 720, D: 560, doors: 2, drawers: 0, shelves: 2 },
  },
  {
    key: 'drawers600',
    label: 'Ящики 600',
    hint: '3 ящика',
    group: 'Ящики',
    params: { W: 600, H: 720, D: 560, doors: 0, drawers: 3, shelves: 0 },
  },
  {
    key: 'drawers-cabinet',
    label: 'Тумба с ящиками',
    hint: '3 ящика · фурнитура',
    group: 'Ящики',
    params: {
      W: 600,
      H: 720,
      D: 560,
      doors: 0,
      drawers: 3,
      shelves: 0,
      runners: 'tandem-21',
    },
  },
  {
    key: 'sink800',
    label: 'Мойка 800',
    hint: '2 двери',
    group: 'Мойки',
    params: { W: 800, H: 720, D: 560, doors: 2, drawers: 0, shelves: 1 },
  },
  {
    key: 'wardrobe1200',
    label: 'Шкаф 1200',
    hint: 'высокий · 3 двери',
    group: 'Шкафы',
    params: { W: 1200, H: 2400, D: 600, doors: 3, shelves: 5 },
  },
  {
    key: 'chest900',
    label: 'Комод 900',
    hint: '3 ящика',
    group: 'Комоды',
    params: { W: 900, H: 900, D: 500, doors: 0, drawers: 3, shelves: 0 },
  },
  {
    key: 'nightstand',
    label: 'Тумба 450',
    hint: '1 дверь · 550',
    group: 'Тумбы',
    params: { W: 450, H: 550, D: 400, doors: 1, shelves: 1 },
  },
  {
    key: 'tall600',
    label: 'Пенал 600',
    hint: 'высокий · 2 двери',
    group: 'Пеналы',
    params: { W: 600, H: 2100, D: 560, doors: 2, shelves: 4 },
  },
  {
    key: 'open600',
    label: 'Открытая 600',
    hint: 'без фасадов',
    group: 'Открытые',
    params: { W: 600, H: 720, D: 560, doors: 0, drawers: 0, shelves: 3 },
  },
  {
    key: 'island',
    label: 'Остров 1200',
    hint: 'без цоколя · 2 двери',
    group: 'Острова',
    params: { W: 1200, H: 720, D: 700, doors: 2, shelves: 2, plinthH: 0 },
  },
  {
    key: 'wall600',
    label: 'Навесной 600',
    hint: '2 двери · на стену',
    group: 'Навесные',
    params: { W: 600, H: 720, D: 300, doors: 2, shelves: 2, mount: 'wall' },
  },
  {
    key: 'wall800',
    label: 'Навесной 800',
    hint: '2 двери · глубина 300',
    group: 'Навесные',
    params: { W: 800, H: 720, D: 300, doors: 2, shelves: 3, mount: 'wall' },
  },
  {
    key: 'mix900',
    label: 'Микс 900',
    hint: 'ящик + 2 двери',
    group: 'Комбинированные',
    params: { W: 900, H: 720, D: 560, doors: 2, drawers: 1, shelves: 2 },
  },
  {
    key: 'tech-fridge',
    label: 'Ниша под холодильник',
    hint: 'открытый корпус 700×1900, без фасада',
    group: 'Техника',
    params: { W: 700, H: 1900, D: 650, doors: 0, drawers: 0, shelves: 0,
      plinthH: 0, worktopT: 0, back: 'none', roof: true },
  },
  {
    key: 'tech-oven',
    label: 'Ниша под духовку',
    hint: 'открытая ниша 600×600',
    group: 'Техника',
    params: { W: 600, H: 600, D: 560, doors: 0, drawers: 0, shelves: 1,
      plinthH: 0, worktopT: 0, back: 'none', roof: true },
  },
  {
    key: 'tech-microwave',
    label: 'Ниша под СВЧ',
    hint: 'открытая ниша 600×450',
    group: 'Техника',
    params: { W: 600, H: 450, D: 560, doors: 0, drawers: 0, shelves: 1,
      plinthH: 0, worktopT: 0, back: 'none', roof: true },
  },
  {
    key: 'tech-cooktop',
    label: 'Тумба под варочную панель',
    hint: '3 ящика + вырез в столешнице',
    group: 'Техника',
    params: { W: 600, H: 720, D: 560, doors: 0, drawers: 3, shelves: 0,
      cutouts: [{ x: 60, y: 90, w: 480, h: 360 }] },
  },
  {
    key: 'tech-sink',
    label: 'Тумба под мойку',
    hint: '2 двери + вырез под мойку',
    group: 'Техника',
    params: { W: 800, H: 720, D: 560, doors: 2, drawers: 0, shelves: 1,
      cutouts: [{ x: 150, y: 100, w: 500, h: 400 }] },
  },
  {
    key: 'base400',
    label: 'Тумба 400',
    hint: '1 дверь · узкая',
    group: 'Тумбы',
    params: { W: 400, H: 720, D: 560, doors: 1, shelves: 1 },
  },
  {
    key: 'base500',
    label: 'Тумба 500',
    hint: '1 дверь',
    group: 'Тумбы',
    params: { W: 500, H: 720, D: 560, doors: 1, shelves: 2 },
  },
  {
    key: 'base900',
    label: 'Тумба 900',
    hint: '2 двери',
    group: 'Тумбы',
    params: { W: 900, H: 720, D: 560, doors: 2, shelves: 2 },
  },
  {
    key: 'base1000',
    label: 'Тумба 1000',
    hint: '2 двери',
    group: 'Тумбы',
    params: { W: 1000, H: 720, D: 560, doors: 2, shelves: 2 },
  },
  {
    key: 'sink600',
    label: 'Мойка 600',
    hint: '1 дверь · под мойку',
    group: 'Мойки',
    params: { W: 600, H: 720, D: 560, doors: 1, shelves: 0 },
  },
  {
    key: 'sink900',
    label: 'Мойка 900',
    hint: '2 двери · под мойку',
    group: 'Мойки',
    params: { W: 900, H: 720, D: 560, doors: 2, shelves: 0 },
  },
  {
    key: 'drawers450',
    label: 'Ящики 450',
    hint: '3 ящика · узкие',
    group: 'Ящики',
    params: { W: 450, H: 720, D: 560, doors: 0, drawers: 3, shelves: 0 },
  },
  {
    key: 'drawers800',
    label: 'Ящики 800',
    hint: '4 ящика',
    group: 'Ящики',
    params: { W: 800, H: 720, D: 560, doors: 0, drawers: 4, shelves: 0 },
  },
  {
    key: 'wall400',
    label: 'Навесной 400',
    hint: '1 дверь · на стену',
    group: 'Навесные',
    params: { W: 400, H: 720, D: 300, doors: 1, shelves: 2, mount: 'wall' },
  },
  {
    key: 'wall900',
    label: 'Навесной 900',
    hint: '2 двери · на стену',
    group: 'Навесные',
    params: { W: 900, H: 720, D: 300, doors: 2, shelves: 3, mount: 'wall' },
  },
  {
    key: 'wardrobe1500',
    label: 'Шкаф 1500',
    hint: '3 двери · высокий',
    group: 'Шкафы',
    params: { W: 1500, H: 2400, D: 600, doors: 3, shelves: 5 },
  },
  {
    key: 'wardrobe1800',
    label: 'Шкаф 1800',
    hint: '4 двери · высокий',
    group: 'Шкафы',
    params: { W: 1800, H: 2400, D: 600, doors: 4, shelves: 6 },
  },
  {
    key: 'tall400',
    label: 'Пенал 400',
    hint: 'высокий · 1 дверь',
    group: 'Пеналы',
    params: { W: 400, H: 2100, D: 560, doors: 1, shelves: 4 },
  },
  {
    key: 'open400',
    label: 'Открытая 400',
    hint: 'без фасадов',
    group: 'Открытые',
    params: { W: 400, H: 720, D: 560, doors: 0, drawers: 0, shelves: 3 },
  },
  {
    key: 'open800',
    label: 'Открытая 800',
    hint: 'без фасадов',
    group: 'Открытые',
    params: { W: 800, H: 720, D: 560, doors: 0, drawers: 0, shelves: 3 },
  },
  {
    key: 'island1500',
    label: 'Остров 1500',
    hint: 'без цоколя · 3 двери',
    group: 'Острова',
    params: { W: 1500, H: 720, D: 700, doors: 3, shelves: 2, plinthH: 0 },
  },
]

export type RoomBase = { w: number; d: number; h: number }

export interface RoomDims extends RoomBase {
  wallT: number
  openings: Opening[]
  outline?: [number, number][]
  partitions?: { a: [number, number]; b: [number, number]; wallT?: number }[]
  floor: RoomSurface
  ceiling: RoomSurface
  wallItems: WallItem[]
}

export interface SavedView {
  id: string
  name: string
  camera: Camera
  wallMode: 'cutaway' | 'low'
  viewMode: ViewStyle
}

export interface Folder {
  id: string
  name: string
  ids: string[]
}

export interface LogEntry {
  time: string
  label: string
}

export interface Finish {
  id: string
  name: string
  kind: 'floor' | 'ceiling' | 'wall'
  x: number
  y: number
  w: number
  d: number
  material: string
  color: string
  tileW: number
  tileH: number
  grout: number
  waste: number
  price_m2: number
}

export interface Project {
  schema: string
  name: string
  /** id цеха из specs/shops.yaml (или профиль specs/<id>.yaml) */
  shop: string
  /** рынок/валюта из specs/markets.yaml */
  market: string
  /** поставщик фурнитуры из specs/suppliers.yaml */
  supplier: string
  room: RoomDims
  instances: Instance[]
  folders: Folder[]
  globals: ProjectGlobals
  materials: Materials
  materialVars: MaterialVariable[]
  /** отделка: плитка, ламинат, паркет и т.д. с расчётом площади/плитки */
  finishes?: Finish[]
  /** явный список зон/этажей (пустые зоны тоже можно завести) */
  zones?: string[]
  views: SavedView[]
  log?: LogEntry[]
}

export const PROJECT_SCHEMA = 'furniture/project@0'

export const DEFAULT_MATERIALS: Materials = {
  corpus: {
    name: 'ЛДСП Дуб натуральный',
    color: '#d9c3a3',
    accent: '#b7956c',
    pattern: 'wood',
    texScale: 650,
  },
  facade: {
    name: 'ЛДСП Графит',
    color: '#3b434b',
    accent: '#2b3238',
    pattern: 'solid',
  },
  worktop: {
    name: 'Столешница графит',
    color: '#24282c',
    accent: '#181b1e',
    pattern: 'stone',
    texScale: 1200,
  },
  plinth: {
    name: 'Цоколь антрацит',
    color: '#171a1d',
    accent: '#0e1012',
    pattern: 'solid',
  },
  back: {
    name: 'ДВП светлая',
    color: '#efede7',
    accent: '#ddd9d0',
    pattern: 'solid',
  },
  drawer: {
    name: 'Ящик металл',
    color: '#9aa0a6',
    accent: '#7c8288',
    pattern: 'metal',
  },
  floor: {
    name: 'Пол — дуб',
    color: '#8b7a63',
    accent: '#6a5c49',
    pattern: 'wood',
    texScale: 1100,
  },
  ceiling: {
    name: 'Потолок',
    color: '#efeee9',
    accent: '#ddd9d0',
    pattern: 'solid',
  },
  leg: {
    name: 'Ножка',
    color: '#1b1c1e',
    accent: '#101112',
    pattern: 'solid',
  },
}

export const MATERIAL_ROLES: { key: string; label: string }[] = [
  { key: 'corpus', label: 'Корпус' },
  { key: 'facade', label: 'Фасады' },
  { key: 'worktop', label: 'Столешница' },
  { key: 'plinth', label: 'Цоколь' },
  { key: 'back', label: 'Задняя стенка' },
  { key: 'drawer', label: 'Ящики' },
  { key: 'floor', label: 'Пол' },
  { key: 'ceiling', label: 'Потолок' },
]

/** Параметры модуля, которые берутся из глобальных переменных проекта. */
export function globalsToParams(g: ProjectGlobals): Pick<Params, ManagedParam> {
  return {
    t: g.t,
    back: g.back,
    backT: g.backT,
    roof: g.roof,
    reinforce: g.reinforce,
    frame: g.frame,
    hardware: g.hardware,
    runners: g.runners,
    plinthH: g.plinthH,
    worktopT: g.worktopT,
    gapSide: g.gapSide,
    gapBetween: g.gapBetween,
    gapTop: g.gapTop,
    gapBottom: g.gapBottom,
  }
}

export const defaultParams = (): Params => ({
  W: 600,
  H: 720,
  D: 560,
  doors: 1,
  drawers: 0,
  shelves: 2,
  frame: 'inset',
  hardware: 'blum',
  runners: 'tandem-21',
  t: 16,
  back: 'dvp',
  backT: 4,
  roof: true,
  reinforce: 'auto',
  mount: 'floor',
  plinthH: 100,
  worktopT: 38,
  gapSide: 2,
  gapBetween: 3,
  gapTop: 2,
  gapBottom: 2,
  dividers: 0,
  handle: 'bar-128',
})

/** Разумное число дверей по ширине (для новых модулей и смены ширины). */
export function suggestDoors(W: number): number {
  if (W <= 500) return 1
  if (W <= 1000) return 2
  if (W <= 1500) return 3
  return Math.min(6, Math.max(1, Math.ceil(W / 550)))
}

export function defaultProject(): Project {
  return {
    schema: PROJECT_SCHEMA,
    name: 'Кухня — демо',
    shop: 'shop-ro-bucuresti',
    market: 'ro',
    supplier: 'generic',
    room: {
      w: 3600,
      d: 2800,
      h: 2700,
      wallT: 100,
      floor: { enabled: true, material: 'floor', t: 0 },
      ceiling: { enabled: false, material: 'ceiling', t: 0 },
      wallItems: [],
      openings: [
        {
          id: 'o1',
          kind: 'window',
          wall: 0,
          x: 200,
          w: 1200,
          z0: 900,
          z1: 2200,
        },
        {
          id: 'o2',
          kind: 'door',
          wall: 3,
          x: 800,
          w: 900,
          z0: 0,
          z1: 2100,
        },
      ],
    },
    instances: [
      {
        id: 'i1',
        product: 'base-cabinet',
        name: 'Тумба 800',
        x: 400,
        y: 2240,
        z: 0,
        rot: 0,
        zLocked: true,
        params: defaultParams(),
      },
    ],
    folders: [],
    globals: defaultGlobals(),
    materials: JSON.parse(JSON.stringify(DEFAULT_MATERIALS)),
    materialVars: [],
    finishes: [],
    zones: [],
    views: [],
    log: [],
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
}

function sanitizeParams(p: Params): Params {
  const fronts = Array.isArray(p.fronts)
    ? p.fronts
        .filter((b) => b && (b.type === 'doors' || b.type === 'drawers'))
        .slice(0, 12)
        .map((b) => ({
          type: b.type,
          count: clamp(Math.round(b.count), 1, 6),
          height: clamp(Math.round(Number(b.height) || 0), 0, 2000),
        }))
    : []
  const cutouts = Array.isArray(p.cutouts)
    ? p.cutouts
        .filter((c) => c && Number(c.w) > 0 && Number(c.h) > 0)
        .slice(0, 8)
        .map((c) => ({
          x: clamp(Math.round(Number(c.x) || 0), 0, 3000),
          y: clamp(Math.round(Number(c.y) || 0), 0, 1200),
          w: clamp(Math.round(Number(c.w) || 0), 20, 3000),
          h: clamp(Math.round(Number(c.h) || 0), 20, 1200),
        }))
    : []
  const back: BackKind = (['dvp', 'same', 'cardboard', 'none'] as const)
    .includes(p.back)
    ? p.back
    : 'dvp'
  const reinforce: Reinforce = (['auto', 'on', 'off'] as const)
    .includes(p.reinforce)
    ? p.reinforce
    : 'auto'
  return {
    W: clamp(Math.round(p.W), 200, 3000),
    H: clamp(Math.round(p.H), 200, 2600),
    D: clamp(Math.round(p.D), 200, 900),
    doors: clamp(Math.round(p.doors), 0, 6),
    drawers: clamp(Math.round(p.drawers), 0, 6),
    shelves: clamp(Math.round(p.shelves), 0, 8),
    dividers: clamp(Math.round(Number(p.dividers) || 0), 0, 4),
    handle: String(p.handle || 'bar-128'),
    fastener: String(p.fastener || 'auto'),
    facadeMaterial: p.facadeMaterial === 'mdf' ? 'mdf' : 'ldsp',
    facadeStyle: (['flat', 'milled', 'handle', 'push', 'profile'] as const)
      .includes(p.facadeStyle as never) ? p.facadeStyle : 'handle',
    connectionOverrides: (p.connectionOverrides && typeof p.connectionOverrides === 'object')
      ? Object.fromEntries(
          Object.entries(p.connectionOverrides)
            .filter(([k]) => ['carcass', 'divider', 'drawer'].includes(k))
            .map(([k, v]) => [k, String(v)]),
        )
      : undefined,
    hiddenFasteners: p.hiddenFasteners === true,
    edges: (p.edges && typeof p.edges === 'object')
      ? JSON.parse(JSON.stringify(p.edges)) as EdgePolicy
      : undefined,
    shelfSupport: String(p.shelfSupport || 'system32'),
    gasStrut: String(p.gasStrut || ''),
    legMount: String(p.legMount || 'leg-plate-60'),
    system32: p.system32 !== false,
    frame: p.frame === 'overlay' ? 'overlay' : 'inset',
    hardware: (['blum', 'hettich', 'gtv'] as const).includes(p.hardware)
      ? p.hardware
      : 'blum',
    runners: p.runners || 'tandem-21',
    t: [10, 16, 18, 22].includes(Number(p.t)) ? Number(p.t) : 16,
    back,
    backT: clamp(Math.round(Number(p.backT) || 4), 1, 18),
    roof: p.roof !== false,
    reinforce,
    mount: p.mount === 'wall' ? 'wall' : 'floor',
    plinthH: clamp(Math.round(Number(p.plinthH ?? 100)), 0, 300),
    worktopT: clamp(Math.round(Number(p.worktopT ?? 38)), 0, 80),
    gapSide: clamp(Number(p.gapSide ?? 2), 0, 10),
    gapBetween: clamp(Number(p.gapBetween ?? 3), 1, 8),
    gapTop: clamp(Number(p.gapTop ?? 2), 0, 10),
    gapBottom: clamp(Number(p.gapBottom ?? 2), 0, 10),
    fronts: fronts.length ? fronts : undefined,
    cutouts: cutouts.length ? cutouts : undefined,
    drawerHeights:
      Array.isArray(p.drawerHeights) && p.drawerHeights.length
        ? p.drawerHeights
            .map((v) => clamp(Math.round(Number(v)), 100, 600))
            .filter((v) => v > 0)
        : undefined,
  }
}

function normalizeMaterialVars(raw: unknown): MaterialVariable[] {
  if (!Array.isArray(raw)) return []
  const parts = new Set<MaterialPart>([
    'carcass', 'sides', 'shelf', 'divider', 'door', 'drawerFront',
    'drawerBox', 'back', 'worktop', 'plinth', 'leg',
  ])
  return raw
    .filter((v) => v && typeof v === 'object')
    .slice(0, 60)
    .map((v, i): MaterialVariable | null => {
      const r = v as Partial<MaterialVariable>
      const material = sanitizeMaterial(r.material)
      if (!material) return null
      const scope: MaterialScope = r.scope === 'floor' || r.scope === 'wall'
        ? r.scope : 'all'
      const selected = Array.isArray(r.parts)
        ? [...new Set(r.parts.filter((p): p is MaterialPart => parts.has(p as MaterialPart)))]
        : []
      return {
        id: String(r.id || `mv${i + 1}`),
        name: String(r.name || `Переменная ${i + 1}`),
        enabled: r.enabled !== false,
        scope,
        zone: String(r.zone || '').trim() || undefined,
        parts: selected.length ? selected : ['carcass' as MaterialPart],
        material,
      }
    })
    .filter((v): v is MaterialVariable => !!v)
}

export function wallLength(wall: WallIndex, room: RoomDims): number {
  return roomWallLength(room as Room, wall)
}

function clampOpening(o: Opening, room: RoomDims): Opening {
  const L = wallLength(o.wall, room)
  const w = clamp(Math.round(o.w), 200, Math.min(L, 6000))
  const x = clamp(Math.round(o.x), 0, Math.max(0, L - w))
  const z0 = clamp(Math.round(o.z0), 0, room.h - 200)
  const z1 = clamp(Math.round(o.z1), z0 + 100, room.h)
  return { ...o, x, w, z0, z1 }
}

function normalizeOpenings(
  raw: Opening[] | undefined,
  room: RoomDims,
): Opening[] {
  const src = Array.isArray(raw) ? raw : []
  return src
    .filter((o) => o && (o.kind === 'window' || o.kind === 'door' || o.kind === 'arch'))
    .map((o) =>
      clampOpening(
        {
          id: o.id || `o${Math.random().toString(36).slice(2, 7)}`,
          kind: o.kind,
          wall: Math.max(0, Math.round(Number(o.wall) || 0)),
          x: Number(o.x) || 0,
          w: Number(o.w) || 900,
          z0: Number(o.z0) || 0,
          z1: Number(o.z1) || 2100,
          open: !!o.open,
          hinge: o.hinge === 'right' ? 'right' : 'left',
          angle: clamp(Number(o.angle) || 80, 0, 120),
          wallT: clamp(Math.round(Number(o.wallT) || room.wallT), 40, 400),
          frameT: clamp(Math.round(Number(o.frameT) || 70), 20, 300),
          sillDepth: clamp(Math.round(Number(o.sillDepth) || 250), 40, 800),
          casing: clamp(Math.round(Number(o.casing) || 70), 0, 300),
          material: String(o.material || 'ПВХ'),
          price: Math.max(0, Number(o.price) || 0),
        },
        room,
      ),
    )
}

function sanitizeMaterial(raw: unknown): Material | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<Material>
  const color = typeof m.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.color)
    ? m.color
    : '#b9b7b1'
  const pattern = (['solid', 'wood', 'stone', 'metal'] as const)
    .includes(m.pattern as Material['pattern'])
    ? (m.pattern as Material['pattern'])
    : 'solid'
  return {
    name: String(m.name || 'Материал'),
    color,
    accent: typeof m.accent === 'string' ? m.accent : color,
    pattern,
    texture: typeof m.texture === 'string' && m.texture ? m.texture : undefined,
    texScale: Number(m.texScale) > 0 ? Number(m.texScale) : undefined,
  }
}

function normalizeMaterials(raw: unknown): Materials {
  const out: Materials = { ...DEFAULT_MATERIALS }
  if (!raw || typeof raw !== 'object') return out
  for (const [role, value] of Object.entries(raw as Record<string, unknown>)) {
    const m = sanitizeMaterial(value)
    if (m) out[role] = m
  }
  return out
}

/** Переопределения материалов модуля: только заданные роли, без дефолтов. */
function normalizeMaterialOverrides(raw: unknown): Materials | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Materials = {}
  for (const [role, value] of Object.entries(raw as Record<string, unknown>)) {
    const m = sanitizeMaterial(value)
    if (m) out[role] = m
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeGlobals(raw: unknown): ProjectGlobals {
  const g = { ...defaultGlobals(), ...((raw ?? {}) as Partial<ProjectGlobals>) }
  return {
    t: [10, 16, 18, 22].includes(Number(g.t)) ? Number(g.t) : 16,
    back: (['dvp', 'same', 'cardboard', 'none'] as const).includes(g.back)
      ? g.back : 'dvp',
    backT: clamp(Math.round(Number(g.backT) || 4), 1, 18),
    roof: g.roof !== false,
    reinforce: (['auto', 'on', 'off'] as const).includes(g.reinforce)
      ? g.reinforce : 'auto',
    frame: g.frame === 'overlay' ? 'overlay' : 'inset',
    hardware: (['blum', 'hettich', 'gtv'] as const).includes(g.hardware)
      ? g.hardware : 'blum',
    runners: String(g.runners || 'tandem-21'),
    plinthH: clamp(Math.round(Number(g.plinthH ?? 100)), 0, 300),
    worktopT: clamp(Math.round(Number(g.worktopT ?? 38)), 0, 80),
    gapSide: clamp(Number(g.gapSide ?? 2), 0, 10),
    gapBetween: clamp(Number(g.gapBetween ?? 3), 1, 8),
    gapTop: clamp(Number(g.gapTop ?? 2), 0, 10),
    gapBottom: clamp(Number(g.gapBottom ?? 2), 0, 10),
    autoApply: g.autoApply !== false,
  }
}

function normalizeProject(raw: unknown): Project {
  const d = (raw ?? {}) as Partial<Project>
  const base = defaultProject()
  const globals = normalizeGlobals(d.globals)
  const instances = (d.instances?.length ? d.instances : base.instances).map(
    (i, idx) => ({
      id: i.id || `i${Math.random().toString(36).slice(2, 7)}`,
      product: i.product || 'base-cabinet',
      name: i.name || `Модуль ${idx + 1}`,
      x: Math.round(Number(i.x) || 0),
      y: Math.round(Number(i.y) || 0),
      z: Math.round(Number(i.z) || 0),
      rot: Number(i.rot) || 0,
      zLocked: i.zLocked !== false,
      params: sanitizeParams({
        ...defaultParams(),
        ...globalsToParams(globals),
        ...(i.params || {}),
      }),
      overrides: (() => {
        if (Array.isArray(i.overrides)) {
          return i.overrides.filter((k): k is ManagedParam =>
            MANAGED_PARAMS.includes(k as ManagedParam))
        }
        // старые проекты: сохраняем отличие от глобальных как переопределение
        const raw = (i.params ?? {}) as unknown as Record<string, unknown>
        const base = globalsToParams(globals) as unknown as Record<string, unknown>
        const diff = MANAGED_PARAMS.filter(
          (k) => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== base[k],
        )
        return diff.length ? diff : undefined
      })(),
      materials: normalizeMaterialOverrides(i.materials),
      zone: String(i.zone || '').trim() || undefined,
      partMaterials: (() => {
        const raw = i.partMaterials
        if (!raw || typeof raw !== 'object') return undefined
        const out: Record<string, Material> = {}
        for (const [k, v] of Object.entries(raw)) {
          const mat = sanitizeMaterial(v)
          if (mat) out[k] = mat
        }
        return Object.keys(out).length ? out : undefined
      })(),
      partMaterialGroups: (() => {
        const raw = i.partMaterialGroups
        if (!raw || typeof raw !== 'object') return undefined
        const out: Record<string, Material> = {}
        for (const [k, v] of Object.entries(raw)) {
          const mat = sanitizeMaterial(v)
          if (mat) out[k] = mat
        }
        return Object.keys(out).length ? out : undefined
      })(),
      partOverrides: (() => {
        const raw = i.partOverrides
        if (!raw || typeof raw !== 'object') return undefined
        const out: Record<string, Material> = {}
        for (const [k, v] of Object.entries(raw)) {
          const mat = sanitizeMaterial(v)
          if (mat) out[k] = mat
        }
        return Object.keys(out).length ? out : undefined
      })(),
      assemblyDone: Array.isArray(i.assemblyDone)
        ? [...new Set(i.assemblyDone
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 0))].slice(0, 200)
        : undefined,
      anim: (i.anim as Record<string, ChannelSet> | undefined) ?? {},
      ...((i as Instance & { doorsOpen?: boolean }).doorsOpen
        ? { legacyDoorsOpen: true }
        : {}),
      ...((i as Instance & { drawersOpen?: boolean }).drawersOpen
        ? { legacyDrawersOpen: true }
        : {}),
    }),
  )
  const roomBase: RoomDims = {
    w: clamp(Math.round(d.room?.w ?? base.room.w), 1200, 12000),
    d: clamp(Math.round(d.room?.d ?? base.room.d), 1200, 12000),
    h: clamp(Math.round(d.room?.h ?? base.room.h), 2000, 4500),
    wallT: 100,
    floor: { enabled: true, material: 'floor', t: 0 },
    ceiling: { enabled: false, material: 'ceiling', t: 0 },
    wallItems: [],
    openings: [],
  }
  return {
    schema: PROJECT_SCHEMA,
    name: d.name || 'Мой проект',
    shop: d.shop && d.shop !== 'shop-default' ? d.shop : base.shop,
    market: d.market || base.market,
    supplier: d.supplier || base.supplier,
    room: (() => {
      const rawOutline = Array.isArray(d.room?.outline)
        ? (d.room!.outline as [number, number][])
            .filter((p) => Array.isArray(p) && p.length >= 2)
            .map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])
        : []
      const outline = rawOutline.length >= 3 ? rawOutline : undefined
      const partitions = Array.isArray(d.room?.partitions)
        ? (d.room!.partitions as RoomDims['partitions'])!
            .filter((p) => p && Array.isArray(p.a) && Array.isArray(p.b))
            .map((p) => ({
              a: [Number(p.a[0]) || 0, Number(p.a[1]) || 0] as [number, number],
              b: [Number(p.b[0]) || 0, Number(p.b[1]) || 0] as [number, number],
              wallT: Number(p.wallT) || undefined,
            }))
        : undefined
      const wallItems: WallItem[] = Array.isArray(d.room?.wallItems)
        ? (d.room!.wallItems as WallItem[])
            .filter((w) => w && w.id && w.kind)
            .map((w) => ({
              id: String(w.id),
              kind: w.kind,
              wall: Math.max(0, Math.round(Number(w.wall) || 0)),
              x: Math.max(0, Number(w.x) || 0),
              z: Math.max(0, Number(w.z) || 0),
              w: Math.max(20, Number(w.w) || 600),
              h: Math.max(20, Number(w.h) || 300),
              depth: Math.max(5, Number(w.depth) || 20),
            }))
        : []
      const floor: RoomSurface = {
        enabled: d.room?.floor?.enabled !== false,
        material: String(d.room?.floor?.material || 'floor'),
        t: Number(d.room?.floor?.t) || 0,
      }
      const ceiling: RoomSurface = {
        enabled: !!d.room?.ceiling?.enabled,
        material: String(d.room?.ceiling?.material || 'ceiling'),
        t: Number(d.room?.ceiling?.t) || 0,
      }
      const tmp: RoomDims = {
        ...roomBase,
        wallT: clamp(Math.round(d.room?.wallT ?? 100), 40, 300),
        outline,
        partitions,
        floor,
        ceiling,
        wallItems,
        openings: [],
      }
      if (outline) {
        const b = roomBounds(tmp as Room)
        tmp.w = Math.max(200, Math.round(b.maxX - b.minX))
        tmp.d = Math.max(200, Math.round(b.maxY - b.minY))
      }
      tmp.openings = normalizeOpenings(
        d.room?.openings ?? base.room.openings,
        tmp,
      )
      return tmp
    })(),
    instances,
    folders: Array.isArray(d.folders)
      ? d.folders
          .filter((f) => f && f.id)
          .map((f) => ({
            id: String(f.id),
            name: String(f.name || 'Папка'),
            ids: (f.ids ?? []).filter((id) =>
              instances.some((i) => i.id === id),
            ),
          }))
      : [],
    globals,
    materials: normalizeMaterials(d.materials),
    materialVars: normalizeMaterialVars(d.materialVars),
    finishes: Array.isArray(d.finishes)
      ? d.finishes
          .filter((f) => f && f.id)
          .slice(0, 80)
          .map((f) => ({
            id: String(f.id),
            name: String(f.name || 'Отделка'),
            kind: f.kind === 'wall' || f.kind === 'ceiling' ? f.kind : 'floor',
            x: Math.max(0, Number(f.x) || 0),
            y: Math.max(0, Number(f.y) || 0),
            w: Math.max(100, Number(f.w) || 1000),
            d: Math.max(100, Number(f.d) || 1000),
            material: String(f.material || 'Плитка'),
            color: String(f.color || '#a9b4bd'),
            tileW: Math.max(10, Number(f.tileW) || 300),
            tileH: Math.max(10, Number(f.tileH) || 300),
            grout: Math.max(0, Number(f.grout) || 2),
            waste: Math.max(0, Number(f.waste) || 10),
            price_m2: Math.max(0, Number(f.price_m2) || 0),
          }))
      : [],
    zones: (() => {
      const names = new Set<string>()
      for (const z of d.zones ?? []) {
        const s = String(z || '').trim()
        if (s) names.add(s)
      }
      for (const i of d.instances ?? []) {
        const z = String((i as Instance).zone || '').trim()
        if (z) names.add(z)
      }
      return [...names]
    })(),
    log: Array.isArray(d.log)
      ? d.log
          .filter((x) => x && typeof x.label === 'string')
          .slice(-200)
          .map((x) => ({ time: String(x.time || ''), label: String(x.label) }))
      : [],
    views: Array.isArray(d.views)
      ? d.views
          .filter((v) => v && v.camera)
          .map((v, i) => ({
            id: v.id || `v${i}`,
            name: v.name || `Вид ${i + 1}`,
            camera: {
              yaw: Number(v.camera.yaw) || 0,
              pitch: Number(v.camera.pitch) || 0,
              zoom: Number(v.camera.zoom) || 0.2,
              target: [
                Number(v.camera.target?.[0]) || 0,
                Number(v.camera.target?.[1]) || 0,
                Number(v.camera.target?.[2]) || 0,
              ] as [number, number, number],
              projection:
                v.camera.projection === 'persp' ? 'persp' : 'ortho',
              distance: Number(v.camera.distance) || 6000,
              fov: Number(v.camera.fov) || 35,
            },
            wallMode: v.wallMode === 'low' ? 'low' : 'cutaway',
            viewMode: v.viewMode === 'schematic' ? 'schematic' : 'realistic',
          }))
      : [],
  }
}

export const state = reactive({
  project: defaultProject(),
  /** id файлового проекта */
  projectId: 'demo',
  selection: 'i1' as string | null,
  /** выделение группы (id модулей); selection — «главный» из них */
  selected: [] as string[],
  /** выбранный проём (окно/дверь) в дереве объектов */
  openingId: null as string | null,
  /** выбранная папка в дереве объектов */
  folderId: null as string | null,
  /** выбрана комната (свойства комнаты) */
  roomSelected: false,
  /** выбранный узел комнаты: сама комната / пол / потолок */
  roomNode: 'room' as 'room' | 'floor' | 'ceiling' | 'wall',
  /** выбранная стена (индекс в roomWalls) */
  wallIndex: null as number | null,
  /** выбранный предмет на стене */
  wallItemId: null as string | null,
  camera25: {
    yaw: 34,
    pitch: 25,
    zoom: 0.2,
    target: [1800, 1400, 500],
    projection: 'persp',
    distance: 6000,
    fov: 35,
  } as Camera,
  cameraPlan: {
    yaw: 0,
    pitch: 90,
    zoom: 0.16,
    target: [1800, 1400, 0],
  } as Camera,
  viewMode: 'realistic' as ViewStyle,
  presentation: false,
  wallMode: 'cutaway' as 'cutaway' | 'low',
  guides: { x: null as number | null, y: null as number | null },
  rev: 0,
  fitToken: 0,
  followToken: 0,
  /** запрос показать/перепривязать плавающее окно свойств */
  propsToken: 0,
  /** запрос камеры: показать объект целиком с выбранного направления */
  focusToken: 0,
  focusInstanceId: null as string | null,
  focusView: 'front' as 'front' | 'iso' | 'side' | 'top',
  focusLeft: 1,
  /** доля ширины 3D-канваса, видимая слева в объектном режиме */
  objectLeft: 0.38,
  busy: false,
  savedAt: '',
  saveState: 'idle' as 'idle' | 'dirty' | 'saving' | 'saved' | 'error',
  saveError: '',
  dirty: false,
  error: '',
})

/** Состояние UI, не сохраняется в project.json. */
export const ui = reactive({
  /** открыта модалка «Добавить объект» */
  addOpen: false,
  /** показывать фасады в 3D (можно скрыть для просмотра деталей) */
  facades: true,
  /** показывать ручки/петли/фурнитуру поверх схемы */
  hardware: true,
  /** перемещение модулей мышью по 3D-канвасу (по умолчанию выключено) */
  dragMove: false,
  /** размеры поверх 3D-канваса */
  dims3d: true,
  /** единая модалка объекта: быстрые действия или детальный режим */
  object: {
    open: false,
    mode: 'quick' as 'quick' | 'full',
  },
  /** мобильная панель «Объекты» открыта */
  panelOpen: false,
  /** меню «Ещё» (файлы, версии, КП, экспорт) */
  moreOpen: false,
  /** модалка проектов на диске */
  projectsOpen: false,
  /** журнал изменений */
  historyOpen: false,
  /** короткое уведомление с действием «Отменить» */
  toast: null as null | {
    id: number
    text: string
    action: 'undo' | null
    kind: 'info' | 'success' | 'error'
  },
  /** модалка настроек проекта */
  settingsOpen: false,
  /** вкладка настроек проекта */
  settingsTab: 'globals' as 'globals' | 'materials' | 'vars' | 'pricing',
  /** модалка КП */
  quoteOpen: false,
  /** модалка версий проекта */
  versionsOpen: false,
  /** модалка отделки (плитка/ламинат/паркет) */
  finishOpen: false,
  finishId: null as string | null,
})

/** Последняя позиция курсора (clientX/clientY) — для привязки плавающих окон. */
export const pointer = { x: 0, y: 0 }

export function openAddModal(): void {
  ui.addOpen = true
}
export function closeAddModal(): void {
  ui.addOpen = false
}

export function openObjectModal(mode: 'quick' | 'full' = 'quick'): void {
  ui.object.open = true
  ui.object.mode = mode
}

export function closeObjectModal(): void {
  ui.object.open = false
  ui.object.mode = 'quick'
}

export function setObjectModalMode(mode: 'quick' | 'full'): void {
  ui.object.mode = mode
}

/** Попросить камеру показать объект целиком с направления. */
export function focusObject(
  id: string,
  view: 'front' | 'iso' | 'side' | 'top' = 'front',
  leftFraction = 1,
): void {
  state.focusInstanceId = id
  state.focusView = view
  state.focusLeft = Math.min(1, Math.max(0.2, leftFraction))
  state.focusToken++
}

export const derived = reactive<Record<string, SolveResponse>>({})

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__furniture = {
    state,
    derived,
    get partSelection() {
      return partSelection
    },
    get animState() {
      return animState
    },
  }
}

/** Выделенная деталь внутри модуля (для просмотра размеров). */
export const partSelection = reactive<{
  instanceId: string | null
  part: number | null
}>({ instanceId: null, part: null })

export function selectPart(
  instanceId: string,
  part: number | null,
  openModal = true,
): void {
  partSelection.instanceId = part == null ? null : instanceId
  partSelection.part = part
  // выбор детали не открывает сразу редактор: сначала простая модалка,
  // а детальный режим — по кнопке «Детали и конструктор».
  // Из 3D деталь выбирается без окна — рядом появляется иконка открытия.
  if (part != null && openModal && !ui.object.open) openObjectModal('quick')
  touch()
}

/** Субъекты (детали) инстанса из последнего расчёта. */
export function objectsOf(inst: Instance) {
  return derived[inst.id]?.objects ?? []
}

/** Создать недостающие наборы каналов для подвижных деталей. */
export function ensureAnim(inst: Instance): Record<string, ChannelSet> {
  if (!inst.anim) inst.anim = {}
  objectsOf(inst).forEach((o, part) => {
    if (!isMovable(o)) return
    const key = partKey(o, part)
    if (!inst.anim![key]) inst.anim![key] = channelsFor(o)
  })
  return inst.anim!
}

export function channelsOf(inst: Instance, part: number): ChannelSet | null {
  const o = objectsOf(inst)[part]
  if (!o || !isMovable(o)) return null
  return ensureAnim(inst)[partKey(o, part)] ?? null
}

export function partIsOpen(inst: Instance, part: number): boolean {
  const set = channelsOf(inst, part)
  if (!set) return false
  return Object.values(set).some((ch) => ch.value > ch.min + 0.001)
}

export function kindIsOpen(inst: Instance, kind: 'door' | 'drawer'): boolean {
  return objectsOf(inst).some(
    (o, part) =>
      (kind === 'door'
        ? o.kind === 'door'
        : o.kind === 'drawerfront' || o.kind === 'drawerbox') &&
      partIsOpen(inst, part),
  )
}

/** Значения каналов детали для рендера (с учётом проигрывания). */
export function partAnimValues(
  inst: Instance,
  part: number,
): Record<string, number> | undefined {
  const o = objectsOf(inst)[part]
  if (!o || !isMovable(o)) return undefined
  const key = partKey(o, part)
  const set = ensureAnim(inst)[key]
  if (!set) return undefined
  const animated =
    animState.playing &&
    animState.instanceId === inst.id &&
    animState.key === key
  return evaluateSet(set, animState.time, animated)
}

/** Каталог направляющих (загружается один раз из /api/hardware). */
export const runners = reactive<RunnerInfo[]>([])
export const handles = reactive<HandleInfo[]>([])

export async function loadHardware(): Promise<void> {
  try {
    const list = await apiHardware()
    runners.splice(0, runners.length, ...list)
    try {
      const h = await apiHandles()
      handles.splice(0, handles.length, ...h)
    } catch {
      /* ручки не критичны */
    }
    touch()
  } catch {
    /* каталог не критичен для рендера */
  }
}

/** Плавная анимация значений каналов (открытие/закрытие — равноправные действия). */
let toggleRaf = 0

function runTween(
  pairs: { ch: { value: number }; from: number; to: number }[],
  dur = 0.45,
): void {
  cancelAnimationFrame(toggleRaf)
  const t0 = performance.now()
  const step = (): void => {
    const k = Math.min(1, (performance.now() - t0) / (dur * 1000))
    const e = k * k * (3 - 2 * k)
    for (const p of pairs) p.ch.value = p.from + (p.to - p.from) * e
    touch()
    if (k < 1) toggleRaf = requestAnimationFrame(step)
    else scheduleSave()
  }
  toggleRaf = requestAnimationFrame(step)
}

export const animState = reactive({
  playing: false,
  time: 0,
  duration: 0,
  key: '',
  instanceId: '',
})

let animRaf = 0

/** Проиграть анимацию конкретного субобъекта. */
export function playPart(id: string, part: number): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const o = objectsOf(inst)[part]
  const set = channelsOf(inst, part)
  if (!o || !set) return
  for (const ch of Object.values(set)) {
    if (!ch.keys.length) ch.keys = defaultKeys(ch, o.kind)
  }
  const key = partKey(o, part)
  const duration = Math.max(0.4, setDuration(set))
  cancelAnimationFrame(animRaf)
  animState.playing = true
  animState.time = 0
  animState.duration = duration
  animState.key = key
  animState.instanceId = id
  const t0 = performance.now()
  const step = (): void => {
    const t = (performance.now() - t0) / 1000
    animState.time = Math.min(duration, t)
    touch()
    if (t < duration) {
      animRaf = requestAnimationFrame(step)
    } else {
      animState.playing = false
      for (const ch of Object.values(set)) {
        if (ch.keys.length) ch.value = evaluateChannel(ch, duration)
      }
      touch()
      scheduleSave()
    }
  }
  animRaf = requestAnimationFrame(step)
}

/** Задать значение канала субобъекта (слайдер/числовое поле). */
export function setPartChannel(
  id: string,
  part: number,
  channelId: string,
  value: number,
): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const set = channelsOf(inst, part)
  const ch = set?.[channelId]
  if (!ch) return
  ch.value = Math.min(ch.max, Math.max(ch.min, value))
  touch()
  scheduleSave()
}

/** Добавить ключ в канал (в конец таймлайна, с текущим значением). */
export function addKey(id: string, part: number, channelId: string): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const ch = channelsOf(inst, part)?.[channelId]
  if (!ch) return
  pushHistory()
  const last = ch.keys.reduce((m, k) => Math.max(m, k.t), 0)
  const t = ch.keys.length ? Math.round((last + 0.25) * 100) / 100 : 0
  const key: Keyframe = { t, v: ch.value, ease: 'easeInOut' }
  ch.keys = [...ch.keys, key].sort((a, b) => a.t - b.t)
  touch()
  scheduleSave()
}

export function removeKey(
  id: string,
  part: number,
  channelId: string,
  index: number,
): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const ch = channelsOf(inst, part)?.[channelId]
  if (!ch) return
  pushHistory()
  ch.keys = ch.keys.filter((_, i) => i !== index)
  touch()
  scheduleSave()
}

/** Пересобрать ключи по умолчанию для всех каналов субобъекта. */
export function resetKeys(id: string, part: number): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const o = objectsOf(inst)[part]
  const set = channelsOf(inst, part)
  if (!o || !set) return
  pushHistory()
  for (const ch of Object.values(set)) ch.keys = defaultKeys(ch, o.kind)
  touch()
  scheduleSave()
}

/** Открыть/закрыть конкретный субобъект (с автогенерацией ключей). */
export function togglePart(id: string, part: number): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const o = objectsOf(inst)[part]
  const set = channelsOf(inst, part)
  if (!o || !set) return
  pushHistory()
  const opening = !partIsOpen(inst, part)
  const pairs: { ch: Channel; from: number; to: number }[] = []
  for (const ch of Object.values(set)) {
    if (!ch.keys.length) ch.keys = defaultKeys(ch, o.kind)
    pairs.push({ ch, from: ch.value, to: opening ? ch.max : ch.min })
  }
  runTween(pairs)
}

/** Открыть/закрыть все дверные полотна или ящики модуля. */
export function toggleKind(id: string, kind: 'door' | 'drawer'): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const objs = objectsOf(inst)
  const parts = objs
    .map((o, part) => ({ o, part }))
    .filter(({ o }) =>
      kind === 'door'
        ? o.kind === 'door'
        : o.kind === 'drawerfront' || o.kind === 'drawerbox',
    )
  if (!parts.length) return
  pushHistory()
  const opening = !kindIsOpen(inst, kind)
  const pairs: { ch: Channel; from: number; to: number }[] = []
  for (const { o, part } of parts) {
    const set = channelsOf(inst, part)
    if (!set) continue
    for (const ch of Object.values(set)) {
      if (!ch.keys.length) ch.keys = defaultKeys(ch, o.kind)
      pairs.push({ ch, from: ch.value, to: opening ? ch.max : ch.min })
    }
  }
  runTween(pairs)
}

/** Открытая модалка «детали и размеры» (одна на всё приложение). */
export const detail = reactive<{
  instanceId: string | null
}>({ instanceId: null })

export function openDetail(id: string, part?: number | null): void {
  detail.instanceId = id
  if (part != null) selectPart(id, part)
  touch()
}

export function closeDetail(): void {
  detail.instanceId = null
  touch()
}

export const selectedInstance = computed(
  () =>
    state.project.instances.find((i) => i.id === state.selection) ?? null,
)

export const selectedDerived = computed(() =>
  state.selection ? (derived[state.selection] ?? null) : null,
)

const history = reactive({ undo: [] as string[], redo: [] as string[] })
export const canUndo = computed(() => history.undo.length > 0)
export const canRedo = computed(() => history.redo.length > 0)

function touch(): void {
  state.rev++
}

function pushHistory(label = 'Изменение'): void {
  history.undo.push(JSON.stringify(state.project))
  if (history.undo.length > 60) history.undo.shift()
  history.redo.length = 0
  state.project.log = [
    ...(state.project.log ?? []),
    { time: new Date().toISOString(), label },
  ].slice(-200)
}

export function beginDrag(): void {
  pushHistory('Перемещение / изменение')
}

export function revealProps(): void {
  state.propsToken++
}

/** Выбрать модуль, не открывая и не закрывая окно настроек. */
export function selectQuiet(id: string): void {
  if (state.selection !== id) {
    partSelection.instanceId = null
    partSelection.part = null
  }
  state.selection = id
  state.selected = [id]
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  touch()
}

export function select(id: string | null): void {
  if (state.selection !== id) selectPart(id ?? '', null)
  state.selection = id
  state.selected = id ? [id] : []
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  if (id) openObjectModal('quick')
  else closeObjectModal()
  touch()
}

/** Shift/Ctrl+клик: добавить или убрать модуль из выделения. */
export function toggleSelection(id: string): void {
  const inSet = state.selected.includes(id)
  if (inSet) {
    state.selected = state.selected.filter((x) => x !== id)
    if (state.selection === id) {
      state.selection = state.selected[state.selected.length - 1] ?? null
    }
  } else {
    state.selected = [...state.selected, id]
    state.selection = id
  }
  selectPart(state.selection ?? '', null)
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  openObjectModal('quick')
  touch()
}

export function selectAll(): void {
  state.selected = state.project.instances.map((i) => i.id)
  state.selection = state.selected[state.selected.length - 1] ?? null
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  openObjectModal('quick')
  touch()
}

export function selectRoom(
  node: 'room' | 'floor' | 'ceiling' = 'room',
): void {
  state.selection = null
  state.selected = []
  state.openingId = null
  state.folderId = null
  state.roomSelected = true
  state.roomNode = node
  state.wallIndex = null
  state.wallItemId = null
  openObjectModal('quick')
  touch()
}

export function selectWallItem(wall: number, item: string): void {
  selectWall(wall)
  state.wallItemId = item
  openObjectModal('quick')
  touch()
}

export function selectWall(index: number, openModal = true): void {
  state.selection = null
  state.selected = []
  state.openingId = null
  state.folderId = null
  state.roomSelected = true
  state.roomNode = 'wall'
  state.wallIndex = Math.max(0, Math.round(index))
  state.wallItemId = null
  if (openModal) openObjectModal('quick')
  touch()
}

export function selectOpening(id: string | null, openModal = true): void {
  state.openingId = id
  state.selection = null
  state.selected = []
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  if (id && openModal) openObjectModal('quick')
  else if (!id) closeObjectModal()
  touch()
}

export function selectFolder(id: string | null): void {
  state.folderId = id
  state.selection = null
  state.selected = []
  state.openingId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  if (id) openObjectModal('quick')
  else closeObjectModal()
  touch()
}

export function clearSelection(): void {
  state.selected = []
  state.selection = null
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  closeObjectModal()
  touch()
}

/** Сдвиг всей группы: дельта одинаковая, привязка — по «главному» модулю. */
export function moveSelection(
  dx: number,
  dy: number,
  starts: Record<string, { x: number; y: number }>,
): void {
  const ids = state.selected.length
    ? state.selected
    : state.selection
      ? [state.selection]
      : []
  if (!ids.length) return
  const anchorId = state.selection ?? ids[0]
  const anchor = state.project.instances.find((i) => i.id === anchorId)
  if (!anchor || !starts[anchorId]) return

  const snap = snapPlacement(
    anchor,
    starts[anchorId].x + dx,
    starts[anchorId].y + dy,
    true,
  )
  const sdx = snap.x - starts[anchorId].x
  const sdy = snap.y - starts[anchorId].y

  const moved = new Set(ids)
  const next = new Map<string, { x: number; y: number }>()
  for (const id of ids) {
    const st = starts[id]
    if (!st) continue
    next.set(id, { x: st.x + sdx, y: st.y + sdy })
  }
  // проверка: группа не должна пересечь невыделенные модули
  for (const [id, p] of next) {
    const inst = state.project.instances.find((i) => i.id === id)
    if (!inst) continue
    const flat = footprintOf(p.x, p.y, inst.params.W, inst.params.D, inst.rot)
    const [z0, z1] = zSpan(inst)
    const bb: Box3 = { ...flat, z0, z1 }
    if (bb.x < -0.01 || bb.y < -0.01) return
    if (bb.x + bb.w > state.project.room.w + 0.01) return
    if (bb.y + bb.d > state.project.room.d + 0.01) return
    for (const other of state.project.instances) {
      if (moved.has(other.id)) continue
      if (overlaps(bb, footprint(other))) return
    }
  }
  for (const [id, p] of next) {
    const inst = state.project.instances.find((i) => i.id === id)
    if (!inst) continue
    inst.x = p.x
    inst.y = p.y
  }
  touch()
  scheduleSave()
}

/**
 * Повернуть выделение. Группа поворачивается как целое вокруг общего центра:
 * взаимное расположение модулей сохраняется. Один модуль — вокруг себя.
 */
/** Координаты объекта в комнате (X, Y, Z). Z залочен у напольной мебели. */
export function setInstancePosition(
  id: string,
  patch: { x?: number; y?: number; z?: number },
): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  pushHistory('Позиция модуля')
  if (patch.x != null) {
    inst.x = Math.max(0, Math.round(patch.x))
  }
  if (patch.y != null) {
    inst.y = Math.max(0, Math.round(patch.y))
  }
  if (patch.z != null && !inst.zLocked) {
    inst.z = Math.max(0, Math.round(patch.z))
  }
  clearGuides()
  touch()
  scheduleSave()
}

export function toggleZLock(id: string): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  pushHistory('Блокировка Z')
  inst.zLocked = !inst.zLocked
  if (inst.zLocked) inst.z = 0
  touch()
  scheduleSave()
}

/** Папки (группы объектов). */
export function createFolder(name?: string): void {
  const ids = state.selected.length ? [...state.selected] : []
  pushHistory('Создана папка')
  const n = state.project.folders.length + 1
  const id = `f${Date.now().toString(36)}`
  state.project.folders.push({
    id,
    name: name || `Папка ${n}`,
    ids,
  })
  touch()
  scheduleSave()
}

export function addToFolder(folderId: string, ids: string[]): void {
  const f = state.project.folders.find((x) => x.id === folderId)
  if (!f) return
  pushHistory()
  for (const id of ids) {
    if (!f.ids.includes(id)) f.ids.push(id)
  }
  touch()
  scheduleSave()
}

export function removeFromFolder(folderId: string, id: string): void {
  const f = state.project.folders.find((x) => x.id === folderId)
  if (!f) return
  pushHistory()
  f.ids = f.ids.filter((x) => x !== id)
  touch()
  scheduleSave()
}

export function renameFolder(folderId: string, name: string): void {
  const f = state.project.folders.find((x) => x.id === folderId)
  if (!f || !name.trim()) return
  pushHistory()
  f.name = name.trim()
  touch()
  scheduleSave()
}

export function deleteFolder(folderId: string): void {
  pushHistory()
  state.project.folders = state.project.folders.filter(
    (f) => f.id !== folderId,
  )
  touch()
  scheduleSave()
  notify('Папка удалена', 'undo')
}

export function folderOf(id: string): Folder | null {
  return state.project.folders.find((f) => f.ids.includes(id)) ?? null
}

/**
 * Придвинуть выделение к стене (или до упора в соседний модуль).
 * Группа едет целиком, пока первый из модулей не упрётся.
 */
export function pushSelection(
  side: 'left' | 'right' | 'back' | 'front',
): void {
  const ids = state.selected.length
    ? [...state.selected]
    : state.selection
      ? [state.selection]
      : []
  if (!ids.length) return
  const insts = ids
    .map((id) => state.project.instances.find((i) => i.id === id))
    .filter((i): i is Instance => !!i)
  if (!insts.length) return

  const dir: [number, number] =
    side === 'left'
      ? [-1, 0]
      : side === 'right'
        ? [1, 0]
        : side === 'front'
          ? [0, -1]
          : [0, 1]
  const room = state.project.room
  const moved = new Set(ids)
  let dist = Infinity

  for (const inst of insts) {
    const bb = footprintOf(
      inst.x,
      inst.y,
      inst.params.W,
      inst.params.D,
      inst.rot,
    )
    if (dir[0] < 0) dist = Math.min(dist, bb.x)
    if (dir[0] > 0) dist = Math.min(dist, room.w - (bb.x + bb.w))
    if (dir[1] < 0) dist = Math.min(dist, bb.y)
    if (dir[1] > 0) dist = Math.min(dist, room.d - (bb.y + bb.d))

    for (const other of state.project.instances) {
      if (moved.has(other.id)) continue
      const [az0, az1] = zSpan(inst)
      const [bz0, bz1] = zSpan(other)
      if (az1 <= bz0 + 0.5 || bz1 <= az0 + 0.5) continue
      const ob = footprint(other)
      if (dir[0] !== 0) {
        if (ob.y >= bb.y + bb.d - 0.5 || ob.y + ob.d <= bb.y + 0.5) continue
        if (dir[0] > 0 && ob.x >= bb.x + bb.w - 0.5) {
          dist = Math.min(dist, ob.x - (bb.x + bb.w))
        }
        if (dir[0] < 0 && ob.x + ob.w <= bb.x + 0.5) {
          dist = Math.min(dist, bb.x - (ob.x + ob.w))
        }
      } else {
        if (ob.x >= bb.x + bb.w - 0.5 || ob.x + ob.w <= bb.x + 0.5) continue
        if (dir[1] > 0 && ob.y >= bb.y + bb.d - 0.5) {
          dist = Math.min(dist, ob.y - (bb.y + bb.d))
        }
        if (dir[1] < 0 && ob.y + ob.d <= bb.y + 0.5) {
          dist = Math.min(dist, bb.y - (ob.y + ob.d))
        }
      }
    }
  }

  if (!Number.isFinite(dist) || dist < 0.5) return
  pushHistory()
  for (const inst of insts) {
    inst.x += dir[0] * dist
    inst.y += dir[1] * dist
  }
  clearGuides()
  touch()
  scheduleSave()
}

export function rotateSelection(delta = 90): void {
  const ids = state.selected.length
    ? [...state.selected]
    : state.selection
      ? [state.selection]
      : []
  if (!ids.length) return
  if (ids.length === 1) {
    rotateInstance(ids[0], delta)
    return
  }
  const list = ids
    .map((id) => state.project.instances.find((i) => i.id === id))
    .filter((i): i is Instance => !!i)
  if (list.length < 2) return

  // общий центр габаритов группы
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const inst of list) {
    const bb = footprintOf(
      inst.x,
      inst.y,
      inst.params.W,
      inst.params.D,
      inst.rot,
    )
    minX = Math.min(minX, bb.x)
    minY = Math.min(minY, bb.y)
    maxX = Math.max(maxX, bb.x + bb.w)
    maxY = Math.max(maxY, bb.y + bb.d)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const a = (delta * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)

  const plan = list.map((inst) => {
    const bb = footprintOf(
      inst.x,
      inst.y,
      inst.params.W,
      inst.params.D,
      inst.rot,
    )
    const mx = bb.x + bb.w / 2
    const my = bb.y + bb.d / 2
    const nx = cx + (mx - cx) * cs - (my - cy) * sn
    const ny = cy + (mx - cx) * sn + (my - cy) * cs
    const rot = normalizeRot(inst.rot + delta)
    const off = footprintOf(0, 0, inst.params.W, inst.params.D, rot)
    return {
      inst,
      rot,
      x: nx - off.x - off.w / 2,
      y: ny - off.y - off.d / 2,
    }
  })

  // держим группу в комнате: сдвигаем целиком
  let nMinX = Infinity
  let nMinY = Infinity
  let nMaxX = -Infinity
  let nMaxY = -Infinity
  for (const p of plan) {
    const bb = footprintOf(
      p.x,
      p.y,
      p.inst.params.W,
      p.inst.params.D,
      p.rot,
    )
    nMinX = Math.min(nMinX, bb.x)
    nMinY = Math.min(nMinY, bb.y)
    nMaxX = Math.max(nMaxX, bb.x + bb.w)
    nMaxY = Math.max(nMaxY, bb.y + bb.d)
  }
  const room = state.project.room
  let shiftX = 0
  let shiftY = 0
  if (nMinX < 0) shiftX = -nMinX
  if (nMaxX + shiftX > room.w) shiftX += room.w - (nMaxX + shiftX)
  if (nMinY < 0) shiftY = -nMinY
  if (nMaxY + shiftY > room.d) shiftY += room.d - (nMaxY + shiftY)

  const moved = new Set(ids)
  for (const p of plan) {
    const flat = footprintOf(
      p.x + shiftX,
      p.y + shiftY,
      p.inst.params.W,
      p.inst.params.D,
      p.rot,
    )
    const [z0, z1] = zSpan(p.inst)
    const bb: Box3 = { ...flat, z0, z1 }
    if (bb.x < -0.01 || bb.y < -0.01) return
    if (bb.x + bb.w > room.w + 0.01) return
    if (bb.y + bb.d > room.d + 0.01) return
    for (const other of state.project.instances) {
      if (moved.has(other.id)) continue
      if (overlaps(bb, footprint(other))) return
    }
  }

  pushHistory()
  for (const p of plan) {
    p.inst.rot = p.rot
    p.inst.x = p.x + shiftX
    p.inst.y = p.y + shiftY
  }
  clearGuides()
  touch()
  scheduleSave()
}

export function deleteSelection(): void {
  const ids = state.selected.length
    ? [...state.selected]
    : state.selection
      ? [state.selection]
      : []
  if (!ids.length) return
  pushHistory(`Удалено модулей: ${ids.length}`)
  for (const id of ids) deleteInstance(id, false)
  state.selected = []
  notify(`Удалено модулей: ${ids.length}`, 'undo')
}

export function duplicateSelection(): void {
  const ids = state.selected.length
    ? [...state.selected]
    : state.selection
      ? [state.selection]
      : []
  for (const id of ids) duplicateInstance(id)
}

let busy = 0

async function solveOne(inst: Instance): Promise<void> {
  busy++
  state.busy = true
  try {
    const res = await apiSolve(
      {
        product: inst.product,
        params: { ...inst.params },
      },
      {
        market: state.project.market,
        shop: state.project.shop,
        supplier: state.project.supplier,
      },
    )
    derived[inst.id] = res
    ensureAnim(inst)
    state.error = ''
    touch()
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
  } finally {
    busy--
    state.busy = busy > 0
  }
}

export async function solveAll(): Promise<void> {
  await Promise.all(state.project.instances.map((i) => solveOne(i)))
}

const timers = new Map<string, number>()

function scheduleSolve(inst: Instance): void {
  const old = timers.get(inst.id)
  if (old) clearTimeout(old)
  timers.set(
    inst.id,
    window.setTimeout(() => {
      timers.delete(inst.id)
      void solveOne(inst)
    }, 200),
  )
}

let saveTimer = 0
let saveChain: Promise<boolean> = Promise.resolve(true)

function scheduleSave(): void {
  state.dirty = true
  state.saveState = 'dirty'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = 0
    void saveProject()
  }, 900)
}

let toastSeq = 0
let toastTimer = 0

export function notify(
  text: string,
  action: 'undo' | null = null,
  kind: 'info' | 'success' | 'error' = 'info',
): void {
  if (toastTimer) clearTimeout(toastTimer)
  ui.toast = { id: ++toastSeq, text, action, kind }
  toastTimer = window.setTimeout(() => {
    toastTimer = 0
    if (ui.toast?.id === toastSeq) ui.toast = null
  }, 6500)
}

export function dismissToast(): void {
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = 0
  ui.toast = null
}

/**
 * Сохраняет проект в очередь: два одновременных PUT не могут обогнать друг
 * друга, а новый снимок всегда уходит после предыдущего.
 */
export async function saveProject(): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  const id = state.projectId
  const serialized = JSON.stringify(state.project)
  state.dirty = false
  state.saveState = 'saving'
  const run = async (): Promise<boolean> => {
    try {
      await apiPutProject(id, JSON.parse(serialized))
      if (state.projectId === id) {
        state.savedAt = new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })
        state.saveError = ''
        if (!state.dirty) state.saveState = 'saved'
      }
      return true
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? 'Нет связи с сервером — изменения не сохранены'
        : raw
      if (state.projectId === id) {
        state.dirty = true
        state.saveError = msg
        state.saveState = 'error'
        state.error = msg
      }
      return false
    }
  }
  const next = saveChain.then(run, run)
  saveChain = next
  return next
}

/** Дождаться сохранения перед сменой проекта/версии. */
export async function flushSave(): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (!state.dirty && state.saveState !== 'saving') return true
  return saveProject()
}

/** Последний шанс сохранить при закрытии вкладки. */
export function saveOnExit(): void {
  if (!state.dirty) return
  const doc = JSON.parse(JSON.stringify(state.project))
  void apiPutProject(state.projectId, doc, true).catch(() => {})
}

export function setMount(id: string, mount: 'floor' | 'wall'): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  pushHistory()
  inst.params = sanitizeParams({ ...inst.params, mount })
  if (mount === 'wall') {
    inst.zLocked = false
    if (!inst.z) inst.z = 1450
  } else {
    inst.zLocked = true
    inst.z = 0
  }
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

export function updateParams(patch: Partial<Params>): void {
  const inst = selectedInstance.value
  if (!inst) return
  pushHistory('Параметры модуля')
  const managed = MANAGED_PARAMS.filter((k) => k in patch)
  if (managed.length) {
    const set = new Set<ManagedParam>(inst.overrides ?? [])
    for (const k of managed) set.add(k)
    inst.overrides = [...set]
  }
  const next = { ...inst.params, ...patch }
  // При смене ширины не оставляем «две двери на 400 мм»: число створок
  // подстраивается под стандарт, если компоновка не задана вручную.
  if (patch.W != null && patch.doors == null && !next.fronts?.length) {
    next.doors = Math.min(next.doors, suggestDoors(Number(patch.W)))
  }
  inst.params = sanitizeParams(next)
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

/** Эффективные материалы модуля: проект + переопределения модуля. */
export function effectiveMaterials(inst?: Instance | null): Materials {
  return inst?.materials
    ? { ...state.project.materials, ...inst.materials }
    : state.project.materials
}

export function isParamOverridden(inst: Instance, key: ManagedParam): boolean {
  return !!inst.overrides?.includes(key)
}

/** Изменить глобальные переменные проекта и (по флагу) применить к модулям. */
export function setGlobals(patch: Partial<ProjectGlobals>): void {
  pushHistory('Глобальные переменные')
  const g = state.project.globals
  Object.assign(g, normalizeGlobals({ ...g, ...patch }))
  if (g.autoApply) {
    for (const inst of state.project.instances) {
      const params = globalsToParams(g)
      for (const key of MANAGED_PARAMS) {
        if (inst.overrides?.includes(key)) continue
        ;(inst.params as unknown as Record<string, unknown>)[key] =
          (params as unknown as Record<string, unknown>)[key]
      }
    }
    void solveAll()
  }
  touch()
  scheduleSave()
}

/** Рынок / цех / поставщик проекта: пересчитать все сметы. */
export function setProjectPricing(
  patch: Partial<Pick<Project, 'market' | 'shop' | 'supplier'>>,
): void {
  pushHistory('Цены проекта')
  Object.assign(state.project, patch)
  touch()
  void solveAll()
  scheduleSave()
}

/** Принудительно применить глобальные значения ко всем модулям. */
export function applyGlobalsToAll(): void {
  pushHistory('Глобальные значения для всех модулей')
  const params = globalsToParams(state.project.globals)
  for (const inst of state.project.instances) {
    inst.overrides = undefined
    inst.params = sanitizeParams({ ...inst.params, ...params })
  }
  touch()
  void solveAll()
  scheduleSave()
}

/** Сбросить переопределения параметров модуля к глобальным значениям. */
export function resetParamOverrides(id: string, keys?: ManagedParam[]): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  pushHistory('Сброс к глобальным значениям')
  const reset = new Set<ManagedParam>(keys ?? MANAGED_PARAMS)
  inst.overrides = (inst.overrides ?? []).filter((k) => !reset.has(k))
  const params = globalsToParams(state.project.globals)
  for (const key of reset) {
    ;(inst.params as unknown as Record<string, unknown>)[key] =
      (params as unknown as Record<string, unknown>)[key]
  }
  inst.params = sanitizeParams(inst.params)
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

export function setRoom(patch: Partial<RoomDims>, record = true): void {
  if (record) pushHistory('Параметры комнаты')
  const r = state.project.room
  if (patch.w != null && !r.outline) r.w = clamp(Math.round(patch.w), 1200, 12000)
  if (patch.d != null && !r.outline) r.d = clamp(Math.round(patch.d), 1200, 12000)
  if (patch.h != null) r.h = clamp(Math.round(patch.h), 2000, 4500)
  if (patch.wallT != null)
    r.wallT = clamp(Math.round(patch.wallT), 40, 300)
  if (patch.outline !== undefined) {
    const pts = (patch.outline ?? [])
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])
    r.outline = pts.length >= 3 ? pts : undefined
    if (r.outline) {
      const b = roomBounds(r as Room)
      r.w = Math.max(200, Math.round(b.maxX - b.minX))
      r.d = Math.max(200, Math.round(b.maxY - b.minY))
    }
  }
  if (patch.partitions !== undefined) {
    r.partitions = (patch.partitions ?? [])
      .filter((p) => p && Array.isArray(p.a) && Array.isArray(p.b))
      .map((p) => ({
        a: [Number(p.a[0]) || 0, Number(p.a[1]) || 0] as [number, number],
        b: [Number(p.b[0]) || 0, Number(p.b[1]) || 0] as [number, number],
        wallT: Number(p.wallT) || undefined,
      }))
  }
  r.openings = r.openings.map((o) => clampOpening(o, r))
  state.fitToken++
  touch()
  scheduleSave()
}

interface Box2 {
  x: number
  y: number
  w: number
  d: number
}

interface Box3 extends Box2 {
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
function footprintOf(
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

function footprint(inst: Instance): Box3 {
  const d = derived[inst.id]
  const bb = footprintOf(
    inst.x,
    inst.y,
    d?.corpus.W ?? inst.params.W,
    d?.corpus.D ?? inst.params.D,
    inst.rot,
  )
  const [z0, z1] = zSpan(inst)
  return { ...bb, z0, z1 }
}

/** Пересечение объёмов: по плану И по высоте. Навесной над напольным — ок. */
function overlaps(a: Box3, b: Box3): boolean {
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

function roomContains(x: number, y: number, W: number, D: number, rot: number): boolean {
  const room = state.project.room
  if (!room.outline?.length) return true
  const pts = outlinePoints(room)
  const a = (rot * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  for (const [lx, ly] of [[0, 0], [W, 0], [W, D], [0, D]]) {
    const wx = x + lx * cs - ly * sn
    const wy = y + lx * sn + ly * cs
    if (!pointInPoly(wx, wy, pts)) return false
  }
  return true
}

function partitionHits(r: Box2): boolean {
  const room = state.project.room
  const parts = room.partitions ?? []
  for (const p of parts) {
    const [ax, ay] = p.a
    const [bx, by] = p.b
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1) continue
    const n = Math.max(2, Math.ceil(len / 25))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const px = ax + (bx - ax) * t
      const py = ay + (by - ay) * t
      if (px > r.x - 20 && px < r.x + r.w + 20 &&
          py > r.y - 20 && py < r.y + r.d + 20) {
        return true
      }
    }
  }
  return false
}

function collides(
  inst: Instance,
  x: number,
  y: number,
  W: number,
  D: number,
  rot = 0,
): boolean {
  if (!roomContains(x, y, W, D, rot)) return true
  const flat = footprintOf(x, y, W, D, rot)
  if (partitionHits(flat)) return true
  const [z0, z1] = zSpan(inst)
  const r: Box3 = { ...flat, z0, z1 }
  return state.project.instances.some(
    (i) => i.id !== inst.id && overlaps(r, footprint(i)),
  )
}

function findFreeNear(
  inst: Instance,
  x: number,
  y: number,
  W: number,
  D: number,
): { x: number; y: number } {
  const room = state.project.room
  const step = 50
  const cands: { x: number; y: number }[] = []
  for (let r = 1; r <= 10; r++) {
    for (const dx of [-r * step, r * step]) {
      for (const dy of [-r * step, 0, r * step]) cands.push({ x: x + dx, y: y + dy })
    }
    for (const dy of [-r * step, r * step]) {
      for (const dx of [-r * step, 0, r * step]) cands.push({ x: x + dx, y: y + dy })
    }
  }
  for (const c of cands) {
    const nx = clamp(Math.round(c.x / 10) * 10, 0, Math.max(0, room.w - W))
    const ny = clamp(Math.round(c.y / 10) * 10, 0, Math.max(0, room.d - D))
    if (!collides(inst, nx, ny, W, D)) return { x: nx, y: ny }
  }
  return findFreeSpot(W, D, zSpan(inst))
}

function snapPlacement(
  inst: Instance,
  x: number,
  y: number,
  withGuides: boolean,
): { x: number; y: number } {
  const room = state.project.room
  const box = footprintOf(x, y, inst.params.W, inst.params.D, inst.rot)
  const ox = box.x - x
  const oy = box.y - y
  const W = box.w
  const D = box.d
  const SNAP = 30
  const others = state.project.instances
    .filter((i) => i.id !== inst.id)
    .map(footprint)

  const xCands: { value: number; guide: number }[] = [
    { value: 0, guide: 0 },
    { value: room.w - W, guide: room.w },
  ]
  const yCands: { value: number; guide: number }[] = [
    { value: 0, guide: 0 },
    { value: room.d - D, guide: room.d },
  ]
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
  const maxX = Math.max(0, room.w - W)
  const maxY = Math.max(0, room.d - D)
  const nx = clamp(Math.round((sx ? sx.value : box.x) / 10) * 10, 0, maxX)
  const ny = clamp(Math.round((sy ? sy.value : box.y) / 10) * 10, 0, maxY)

  if (withGuides) {
    state.guides.x = sx ? sx.guide : null
    state.guides.y = sy ? sy.guide : null
  }
  return { x: nx - ox, y: ny - oy }
}

export function clearGuides(): void {
  state.guides.x = null
  state.guides.y = null
}

export function resizeInstance(
  id: string,
  patch: Partial<Pick<Params, 'W' | 'D'>>,
): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const next = sanitizeParams({ ...inst.params, ...patch })
  const room = state.project.room
  const bb = footprintOf(inst.x, inst.y, next.W, next.D, inst.rot)
  if (bb.x < -0.01 || bb.y < -0.01) return
  if (bb.x + bb.w > room.w + 0.01 || bb.y + bb.d > room.d + 0.01) return
  if (collides(inst, inst.x, inst.y, next.W, next.D, inst.rot)) return
  inst.params = next
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

export function setPlacement(id: string, x: number, y: number): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const pos = snapPlacement(inst, x, y, true)
  const bb = footprintOf(pos.x, pos.y, inst.params.W, inst.params.D, inst.rot)
  const W = bb.w
  const D = bb.d
  const prevX = inst.x
  const prevY = inst.y
  const wasColliding = collides(
    inst,
    prevX,
    prevY,
    inst.params.W,
    inst.params.D,
    inst.rot,
  )

  let nx = pos.x
  let ny = pos.y
  if (!wasColliding) {
    // не даём войти в другой модуль: гасим ту ось, которая приводит к пересечению
    if (collides(inst, nx, prevY, inst.params.W, inst.params.D, inst.rot)) {
      nx = prevX
    }
    if (collides(inst, nx, ny, inst.params.W, inst.params.D, inst.rot)) {
      ny = prevY
    }
    if (collides(inst, nx, ny, inst.params.W, inst.params.D, inst.rot)) {
      nx = prevX
      ny = prevY
    }
  }
  const bbNow = footprintOf(nx, ny, inst.params.W, inst.params.D, inst.rot)
  if (bbNow.w !== W || bbNow.d !== D) {
    // при смене габарита (поворот) держим в комнате
    if (bbNow.x < -0.01) nx -= bbNow.x
    if (bbNow.y < -0.01) ny -= bbNow.y
    if (bbNow.x + bbNow.w > state.project.room.w + 0.01) {
      nx -= bbNow.x + bbNow.w - state.project.room.w
    }
    if (bbNow.y + bbNow.d > state.project.room.d + 0.01) {
      ny -= bbNow.y + bbNow.d - state.project.room.d
    }
  }
  inst.x = nx
  inst.y = ny
  touch()
  scheduleSave()
}

/** Высота конкретного ящика (по номеру): остальные сохраняются. */
export function setDrawerHeight(
  id: string,
  drawerId: number,
  h: number,
): void {
  const d = derived[id]
  const inst = state.project.instances.find((x) => x.id === id)
  if (!d?.drawers?.length || !inst) return
  const heights = d.drawers.map((x) => Math.round(x.front_h))
  // широкий ряд может делиться на несколько фасадов: высота задаётся ряду
  const rows = Math.max(1, inst.params.drawers || heights.length)
  const perRow = Math.max(1, Math.round(heights.length / rows))
  const i = Math.floor((drawerId - 1) / perRow)
  if (i < 0 || i >= heights.length) return
  heights[i] = Math.round(h)
  updateParams({ drawerHeights: heights })
}

/** Поворот модуля вокруг центра его габарита. */
export function rotateInstance(id: string, delta = 90): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  const room = state.project.room
  const W = inst.params.W
  const D = inst.params.D
  const before = footprintOf(inst.x, inst.y, W, D, inst.rot)
  const cx = before.x + before.w / 2
  const cy = before.y + before.d / 2
  const rot = normalizeRot(inst.rot + delta)
  const after = footprintOf(0, 0, W, D, rot)

  pushHistory()
  inst.rot = rot
  let x = cx - after.x - after.w / 2
  let y = cy - after.y - after.d / 2

  // держим в комнате
  if (x + after.x < 0) x = -after.x
  if (y + after.y < 0) y = -after.y
  if (x + after.x + after.w > room.w) {
    x = room.w - after.x - after.w
  }
  if (y + after.y + after.d > room.d) {
    y = room.d - after.y - after.d
  }
  // и не в другом модуле
  if (collides(inst, x, y, W, D, rot)) {
    const free = findFreeNear(
      inst,
      x + after.x,
      y + after.y,
      after.w,
      after.d,
    )
    x = free.x - after.x
    y = free.y - after.y
  }
  inst.x = x
  inst.y = y
  clearGuides()
  touch()
  scheduleSave()
}

function findFreeSpot(
  W: number,
  D: number,
  span: [number, number] = [0, 720],
): { x: number; y: number } {
  const room = state.project.room
  const others = state.project.instances.map(footprint)
  const b = roomBounds(room)
  for (let y = b.maxY - D; y >= b.minY; y -= 50) {
    for (let x = b.minX + 50; x <= b.maxX - W - 50; x += 50) {
      if (!roomContains(x, y, W, D, 0)) continue
      const box: Box3 = { x, y, w: W, d: D, z0: span[0], z1: span[1] }
      if (partitionHits(box)) continue
      if (!others.some((o) => overlaps(box, o))) return { x, y }
    }
  }
  return { x: b.minX + 50, y: Math.max(b.minY + 50, b.maxY - D - 100) }
}

export function addInstance(
  presetKey?: string,
  x?: number,
  y?: number,
  override?: Partial<Params>,
): void {
  const preset =
    MODULE_PRESETS.find((p) => p.key === presetKey) ?? MODULE_PRESETS[0]
  const merged = {
    ...defaultParams(),
    ...globalsToParams(state.project.globals),
    ...preset.params,
    ...(override ?? {}),
  }
  const explicit = { ...preset.params, ...(override ?? {}) }
  const overrides = MANAGED_PARAMS.filter((k) => k in explicit)
  // Узкому корпусу — одна створка, если компоновка не задана явно.
  if (!merged.fronts?.length) {
    merged.doors = Math.min(
      Number(merged.doors) || 0,
      suggestDoors(Number(merged.W) || 600),
    )
  }
  const params = sanitizeParams(merged)
  const z0 = params.mount === 'wall' ? 1450 : 0
  const z1 = z0 + (params.mount === 'wall'
    ? params.H
    : params.plinthH + params.H + params.worktopT)
  const pos =
    x != null && y != null
      ? { x, y }
      : findFreeSpot(params.W, params.D, [z0, z1])
  const id = `i${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const inst: Instance = {
    id,
    product: 'base-cabinet',
    name: `Модуль ${state.project.instances.length + 1}`,
    x: 0,
    y: 0,
    z: params.mount === 'wall' ? 1450 : 0,
    rot: 0,
    zLocked: params.mount === 'wall' ? false : true,
    params,
    overrides: overrides.length ? overrides : undefined,
  }
  const snapped = snapPlacement(inst, pos.x, pos.y, false)
  let fx = snapped.x
  let fy = snapped.y
  if (collides(inst, fx, fy, params.W, params.D)) {
    const free = findFreeNear(inst, fx, fy, params.W, params.D)
    fx = free.x
    fy = free.y
  }
  inst.x = fx
  inst.y = fy
  pushHistory('Добавлен модуль')
  state.project.instances.push(inst)
  state.selection = id
  state.selected = [id]
  openObjectModal('quick')
  clearGuides()
  touch()
  void solveOne(inst)
  scheduleSave()
}

export function duplicateInstance(id: string): void {
  const src = state.project.instances.find((i) => i.id === id)
  if (!src) return
  const W = src.params.W
  const newId = `i${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const inst: Instance = {
    ...JSON.parse(JSON.stringify(src)),
    id: newId,
    name: `${src.name || 'Модуль'} копия`,
  }
  const snapped = snapPlacement(inst, src.x + W + 50, src.y, false)
  let fx = snapped.x
  let fy = snapped.y
  if (collides(inst, fx, fy, inst.params.W, inst.params.D)) {
    const free = findFreeNear(inst, fx, fy, inst.params.W, inst.params.D)
    fx = free.x
    fy = free.y
  }
  inst.x = fx
  inst.y = fy
  pushHistory('Добавлен модуль')
  state.project.instances.push(inst)
  state.selection = newId
  state.selected = [newId]
  openObjectModal('quick')
  clearGuides()
  touch()
  void solveOne(inst)
  scheduleSave()
}

export function deleteInstance(id: string, record = true): void {
  const i = state.project.instances.findIndex((x) => x.id === id)
  if (i < 0) return
  if (partSelection.instanceId === id) selectPart(id, null)
  if (record) pushHistory('Удалён модуль')
  state.project.instances.splice(i, 1)
  delete derived[id]
  state.selected = state.selected.filter((x) => x !== id)
  if (state.selection === id) {
    state.selection = state.project.instances[i]?.id
      ?? state.project.instances[i - 1]?.id
      ?? null
    state.selected = state.selection ? [state.selection] : []
    if (state.selection) openObjectModal('quick')
    else closeObjectModal()
  }
  clearGuides()
  touch()
  scheduleSave()
  if (record) notify('Модуль удалён', 'undo')
}

export function renameInstance(id: string, name: string): void {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return
  pushHistory()
  inst.name = name.trim()
  touch()
  scheduleSave()
}

export function setMaterial(
  role: string,
  patch: Partial<Material>,
  instanceId?: string,
): void {
  pushHistory(instanceId ? 'Материал модуля' : 'Материал проекта')
  if (instanceId) {
    const inst = state.project.instances.find((i) => i.id === instanceId)
    if (!inst) return
    const cur = effectiveMaterials(inst)[role] ?? DEFAULT_MATERIALS[role]
    inst.materials = { ...(inst.materials ?? {}), [role]: { ...cur, ...patch } }
  } else {
    const cur = state.project.materials[role] ?? DEFAULT_MATERIALS[role]
    state.project.materials[role] = { ...cur, ...patch }
  }
  touch()
  scheduleSave()
}

/** Материал конкретной детали (перекрывает переменные и материал модуля). */
export function setPartMaterial(
  instanceId: string,
  partIndex: number,
  patch: Partial<Material>,
): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  const obj = derived[instanceId]?.objects[partIndex]
  if (!inst || !obj) return
  pushHistory('Материал детали')
  const cur = resolveMaterial(
    state.project.materials,
    state.project.materialVars,
    inst,
    obj,
    partIndex,
  ).material
  inst.partOverrides = {
    ...(inst.partOverrides ?? {}),
    [partUid(obj)]: { ...cur, ...patch },
  }
  touch()
  scheduleSave()
}

export function setPartMaterialFull(
  instanceId: string,
  partIndex: number,
  material: Material,
): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  const obj = derived[instanceId]?.objects[partIndex]
  if (!inst || !obj) return
  pushHistory('Материал детали')
  inst.partOverrides = {
    ...(inst.partOverrides ?? {}),
    [partUid(obj)]: JSON.parse(JSON.stringify(material)) as Material,
  }
  touch()
  scheduleSave()
}

/** Материал всем одинаковым деталям (та же группа: имя+секция+ящик). */
export function setPartMaterialGroup(
  instanceId: string,
  partIndex: number,
  patch: Partial<Material>,
  full?: Material,
): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  const obj = derived[instanceId]?.objects[partIndex]
  if (!inst || !obj) return
  pushHistory('Материал группы деталей')
  const cur = full ?? resolveMaterial(
    state.project.materials,
    state.project.materialVars,
    inst,
    obj,
    partIndex,
  ).material
  inst.partMaterialGroups = {
    ...(inst.partMaterialGroups ?? {}),
    [partGroupKey(obj)]: { ...cur, ...patch },
  }
  touch()
  scheduleSave()
}

export function resetPartMaterial(instanceId: string, partIndex: number): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  const obj = derived[instanceId]?.objects[partIndex]
  if (!inst) return
  pushHistory('Сброс материала детали')
  if (obj) {
    const uid = partUid(obj)
    const group = partGroupKey(obj)
    if (inst.partOverrides?.[uid] || inst.partMaterialGroups?.[group]) {
      const next = { ...(inst.partOverrides ?? {}) }
      delete next[uid]
      inst.partOverrides = Object.keys(next).length ? next : undefined
      const gnext = { ...(inst.partMaterialGroups ?? {}) }
      delete gnext[group]
      inst.partMaterialGroups = Object.keys(gnext).length ? gnext : undefined
    }
  }
  if (inst.partMaterials?.[String(partIndex)]) {
    const next = { ...inst.partMaterials }
    delete next[String(partIndex)]
    inst.partMaterials = Object.keys(next).length ? next : undefined
  }
  touch()
  scheduleSave()
}

export function resetPartMaterialGroup(
  instanceId: string,
  partIndex: number,
): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  const obj = derived[instanceId]?.objects[partIndex]
  if (!inst || !obj) return
  pushHistory('Сброс материала группы')
  const next = { ...(inst.partMaterialGroups ?? {}) }
  delete next[partGroupKey(obj)]
  inst.partMaterialGroups = Object.keys(next).length ? next : undefined
  touch()
  scheduleSave()
}

export function partMaterialOverridden(
  inst: Instance | null | undefined,
  partIndex: number,
): boolean {
  if (!inst) return false
  if (inst.partMaterials?.[String(partIndex)]) return true
  const obj = inst ? derived[inst.id]?.objects[partIndex] : null
  if (!obj) return false
  return !!(inst.partOverrides?.[partUid(obj)] ||
    inst.partMaterialGroups?.[partGroupKey(obj)])
}

export function partMaterialSource(
  instanceId: string,
  partIndex: number,
): { source: string; label: string } | null {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  const obj = derived[instanceId]?.objects[partIndex]
  if (!inst || !obj) return null
  const r = resolveMaterial(
    state.project.materials,
    state.project.materialVars,
    inst,
    obj,
    partIndex,
  )
  return { source: r.source, label: r.label }
}

/** Политика кромки модуля. */
export function setEdgePolicy(instanceId: string, patch: Partial<EdgePolicy>): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst) return
  pushHistory('Кромка модуля')
  inst.params.edges = { ...(inst.params.edges ?? {}), ...patch }
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

/** Переопределение кромки детали по стороне (auto — вернуть правило). */
export function setEdgeOverride(
  instanceId: string,
  partName: string,
  side: string,
  value: string,
): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst || !partName) return
  pushHistory('Кромка детали')
  const policy = { ...(inst.params.edges ?? {}) }
  const byPart = { ...(policy.byPart ?? {}) }
  const row = { ...(byPart[partName] ?? {}) }
  if (!value || value === 'auto') delete row[side]
  else row[side] = value
  if (Object.keys(row).length) byPart[partName] = row
  else delete byPart[partName]
  inst.params.edges = {
    ...policy,
    byPart: Object.keys(byPart).length ? byPart : undefined,
  }
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

export function setHiddenFasteners(instanceId: string, hidden: boolean): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst) return
  pushHistory('Скрытый крепёж')
  inst.params.hiddenFasteners = hidden
  if (hidden && (!inst.params.fastener || inst.params.fastener === 'auto')) {
    inst.params.fastener = 'auto'
  }
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

export function setConnectionOverride(
  instanceId: string,
  cls: string,
  value: string,
): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst) return
  pushHistory('Крепёж соединения')
  const next = { ...(inst.params.connectionOverrides ?? {}) }
  if (!value || value === 'auto') delete next[cls]
  else next[cls] = value
  inst.params.connectionOverrides = Object.keys(next).length ? next : undefined
  touch()
  scheduleSolve(inst)
  scheduleSave()
}

export function toggleAssemblyStep(instanceId: string, index: number): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst) return
  const set = new Set(inst.assemblyDone ?? [])
  if (set.has(index)) set.delete(index)
  else set.add(index)
  inst.assemblyDone = [...set].sort((a, b) => a - b)
  touch()
  scheduleSave()
}

/** Зона/этаж модуля: к нему применяются переменные с той же зоной. */
export function setInstanceZone(instanceId: string, zone: string): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst) return
  pushHistory('Зона модуля')
  inst.zone = zone.trim() || undefined
  touch()
  scheduleSave()
}

export function addZone(name: string): string {
  const zone = name.trim()
  if (!zone) return ''
  state.project.zones = [...new Set([...(state.project.zones ?? []), zone])]
  touch()
  scheduleSave()
  return zone
}

export function renameZone(from: string, to: string): void {
  const a = from.trim()
  const b = to.trim()
  if (!a || !b || a === b) return
  pushHistory('Переименование зоны')
  state.project.zones = [...new Set(
    (state.project.zones ?? []).map((z) => (z === a ? b : z)),
  )]
  for (const inst of state.project.instances) {
    if ((inst.zone || '') === a) inst.zone = b
  }
  for (const v of state.project.materialVars) {
    if ((v.zone || '') === a) v.zone = b
  }
  touch()
  scheduleSave()
}

export function removeZone(name: string): void {
  const zone = name.trim()
  if (!zone) return
  pushHistory('Удаление зоны')
  state.project.zones = (state.project.zones ?? []).filter((z) => z !== zone)
  for (const inst of state.project.instances) {
    if (inst.zone === zone) inst.zone = undefined
  }
  for (const v of state.project.materialVars) {
    if (v.zone === zone) v.zone = undefined
  }
  touch()
  scheduleSave()
}

export function zonesList(): string[] {
  return [...new Set([
    ...(state.project.zones ?? []),
    ...state.project.instances.map((i) => i.zone || '').filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, 'ru'))
}

/** Копия переменной материала (для другого этажа/зоны или части). */
export function duplicateMaterialVar(id: string): string {
  const src = state.project.materialVars.find((v) => v.id === id)
  if (!src) return ''
  pushHistory('Копия переменной материала')
  const copy: MaterialVariable = JSON.parse(JSON.stringify(src))
  copy.id = `mv${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  copy.name = `${src.name} (копия)`
  state.project.materialVars.push(copy)
  touch()
  scheduleSave()
  return copy.id
}

/** Сбросить материал модуля к материалу проекта (role не задан — все). */
export function resetInstanceMaterial(instanceId: string, role?: string): void {
  const inst = state.project.instances.find((i) => i.id === instanceId)
  if (!inst?.materials) return
  pushHistory('Сброс материала модуля')
  if (role) {
    const next = { ...inst.materials }
    delete next[role]
    inst.materials = Object.keys(next).length ? next : undefined
  } else {
    inst.materials = undefined
  }
  touch()
  scheduleSave()
}

export function instanceMaterialOverridden(
  inst: Instance | null | undefined,
  role: string,
): boolean {
  return !!inst?.materials?.[role]
}

export function addMaterialVar(
  patch: Partial<Omit<MaterialVariable, 'material'>> & {
    material?: Partial<Material>
  } = {},
): string {
  pushHistory('Переменная материала')
  const id = `mv${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const material = {
    ...JSON.parse(JSON.stringify(DEFAULT_MATERIALS.corpus)) as Material,
    ...(patch.material ?? {}),
  }
  state.project.materialVars.push({
    id,
    name: patch.name || `Переменная ${state.project.materialVars.length + 1}`,
    enabled: patch.enabled !== false,
    scope: patch.scope ?? 'all',
    parts: patch.parts?.length ? [...patch.parts] : ['carcass'],
    material,
  })
  touch()
  scheduleSave()
  return id
}

export function updateMaterialVar(
  id: string,
  patch: Partial<Omit<MaterialVariable, 'material'>> & {
    material?: Partial<Material>
  },
): void {
  const v = state.project.materialVars.find((x) => x.id === id)
  if (!v) return
  pushHistory('Переменная материала')
  if (patch.name != null) v.name = patch.name
  if (patch.enabled != null) v.enabled = patch.enabled
  if (patch.scope) v.scope = patch.scope
  if (patch.parts) v.parts = [...new Set(patch.parts)]
  if (patch.material) v.material = { ...v.material, ...patch.material }
  touch()
  scheduleSave()
}

export function removeMaterialVar(id: string): void {
  if (!state.project.materialVars.some((v) => v.id === id)) return
  pushHistory('Удаление переменной')
  state.project.materialVars = state.project.materialVars.filter((v) => v.id !== id)
  touch()
  scheduleSave()
}

export function moveMaterialVar(id: string, delta: number): void {
  const list = state.project.materialVars
  const i = list.findIndex((v) => v.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return
  pushHistory('Порядок переменных')
  const [v] = list.splice(i, 1)
  list.splice(j, 0, v)
  touch()
  scheduleSave()
}

/** Базовый набор: корпуса напольный/навесной, фасады, ящики, полки, и т.д. */
export function createDefaultMaterialVars(replace = false): void {
  if (state.project.materialVars.length && !replace) return
  pushHistory('Базовые переменные материалов')
  const m = state.project.materials
  const clone = (x: Material | undefined): Material =>
    JSON.parse(JSON.stringify(x ?? DEFAULT_MATERIALS.corpus)) as Material
  const stamp = Date.now().toString(36)
  let seq = 0
  const mk = (
    name: string,
    scope: MaterialScope,
    parts: MaterialPart[],
    material: Material,
  ): MaterialVariable => ({
    id: `mv${stamp}${++seq}`,
    name,
    enabled: true,
    scope,
    parts,
    material: clone(material),
  })
  state.project.materialVars = [
    mk('Напольный корпус', 'floor', ['carcass', 'sides', 'divider'], m.corpus),
    mk('Навесной корпус', 'wall', ['carcass', 'sides', 'divider'], m.corpus),
    mk('Фасады', 'all', ['door', 'drawerFront'], m.facade),
    mk('Ящики', 'all', ['drawerBox'], m.drawer),
    mk('Полки', 'all', ['shelf'], m.corpus),
    mk('Задняя стенка', 'all', ['back'], m.back),
    mk('Столешница', 'all', ['worktop'], m.worktop),
    mk('Цоколь', 'all', ['plinth'], m.plinth),
    mk('Опоры', 'all', ['leg'], m.leg),
  ]
  touch()
  scheduleSave()
}

export function rename(name: string): void {
  if (!name.trim() || name === state.project.name) return
  pushHistory()
  state.project.name = name.trim()
  touch()
  scheduleSave()
}

export function setViewMode(mode: ViewStyle): void {
  state.viewMode = mode
}

export function setWallMode(mode: 'cutaway' | 'low'): void {
  state.wallMode = mode
}

export function setPresentation(on: boolean): void {
  state.presentation = on
  touch()
}

export function saveView(): void {
  pushHistory()
  const cam = state.camera25
  const n = state.project.views.length + 1
  state.project.views.push({
    id: `v${Date.now().toString(36)}`,
    name: `Вид ${n}`,
    camera: {
      yaw: cam.yaw,
      pitch: cam.pitch,
      zoom: cam.zoom,
      target: [...cam.target] as [number, number, number],
      projection: cam.projection,
      distance: cam.distance,
      fov: cam.fov,
    },
    wallMode: state.wallMode,
    viewMode: state.viewMode,
  })
  touch()
  scheduleSave()
}

export function applyView(id: string): void {
  const v = state.project.views.find((x) => x.id === id)
  if (!v) return
  state.camera25 = {
    yaw: v.camera.yaw,
    pitch: v.camera.pitch,
    zoom: v.camera.zoom,
    target: [...v.camera.target] as [number, number, number],
    projection: v.camera.projection,
    distance: v.camera.distance,
    fov: v.camera.fov,
  }
  state.wallMode = v.wallMode
  state.viewMode = v.viewMode
  touch()
}

export function deleteView(id: string): void {
  if (!state.project.views.some((v) => v.id === id)) return
  pushHistory()
  state.project.views = state.project.views.filter((v) => v.id !== id)
  touch()
  scheduleSave()
}

export function setTexture(
  role: string,
  texture: string | null,
  instanceId?: string,
): void {
  pushHistory(instanceId ? 'Текстура модуля' : 'Текстура проекта')
  if (instanceId) {
    const inst = state.project.instances.find((i) => i.id === instanceId)
    if (!inst) return
    const cur = effectiveMaterials(inst)[role] ?? DEFAULT_MATERIALS[role]
    inst.materials = {
      ...(inst.materials ?? {}),
      [role]: {
        ...cur,
        texture: texture || undefined,
        pattern: texture ? 'solid' : cur.pattern,
      },
    }
  } else {
    const cur = state.project.materials[role] ?? DEFAULT_MATERIALS[role]
    state.project.materials[role] = {
      ...cur,
      texture: texture || undefined,
      pattern: texture ? 'solid' : cur.pattern,
    }
  }
  touch()
  scheduleSave()
}

let openingSeq = 1
let wallItemSeq = 1

function shiftWallIndices(from: number, delta: number, remove = false): void {
  const room = state.project.room
  const fix = (wall: number): number | null => {
    if (remove && wall === from) return null
    if (remove && wall === from + 1) return null
    if (wall > from) return wall + delta
    return wall
  }
  room.openings = room.openings
    .map((o) => {
      const n = fix(o.wall)
      return n == null ? null : { ...o, wall: n }
    })
    .filter((o): o is Opening => !!o)
  room.wallItems = room.wallItems
    .map((w) => {
      const n = fix(w.wall)
      return n == null ? null : { ...w, wall: n }
    })
    .filter((w): w is WallItem => !!w)
}

/** Разделить наружную стену посередине — появляется новая точка/стена. */
export function splitWall(index: number): void {
  const room = state.project.room
  const seg = roomWalls(room as Room).find((w) => w.index === index)
  if (!seg || !seg.outer) return
  const outline = outlinePoints(room).map((p) => [p.x, p.y] as [number, number])
  const i = seg.index
  const a = outline[i]
  const b = outline[(i + 1) % outline.length]
  const mid: [number, number] = [
    Math.round((a[0] + b[0]) / 2),
    Math.round((a[1] + b[1]) / 2),
  ]
  pushHistory()
  outline.splice(i + 1, 0, mid)
  shiftWallIndices(i, 1)
  room.outline = outline
  const b2 = roomBounds(room as Room)
  room.w = Math.max(200, Math.round(b2.maxX - b2.minX))
  room.d = Math.max(200, Math.round(b2.maxY - b2.minY))
  room.openings = room.openings.map((o) => clampOpening(o, room))
  state.wallIndex = i + 1
  state.roomNode = 'wall'
  touch()
  scheduleSave()
}

/** Удалить стену: у наружной — удаляет точку, у перегородки — сегмент. */
export function removeWall(index: number): void {
  const room = state.project.room
  const walls = roomWalls(room as Room)
  const seg = walls.find((w) => w.index === index)
  if (!seg) return
  pushHistory()
  if (!seg.outer) {
    const outer = walls.filter((w) => w.outer).length
    const pi = index - outer
    if (pi >= 0) room.partitions = (room.partitions ?? []).filter((_, k) => k !== pi)
    shiftWallIndices(outer + pi, -1)
  } else {
    const outline = outlinePoints(room).map((p) => [p.x, p.y] as [number, number])
    if (outline.length <= 3) return
    const j = (index + 1) % outline.length
    outline.splice(j, 1)
    // удаляем проёмы/предметы на двух исчезнувших стенах
    const killed = new Set([index, (index + 1) % walls.filter((w) => w.outer).length])
    room.openings = room.openings.filter((o) => !killed.has(o.wall))
    room.wallItems = room.wallItems.filter((w) => !killed.has(w.wall))
    // сдвигаем индексы после удалённой точки
    const map = (wall: number): number => {
      if (wall > j) return wall - 1
      return wall
    }
    room.openings = room.openings.map((o) => ({ ...o, wall: map(o.wall) }))
    room.wallItems = room.wallItems.map((w) => ({ ...w, wall: map(w.wall) }))
    room.outline = outline
    const b = roomBounds(room as Room)
    room.w = Math.max(200, Math.round(b.maxX - b.minX))
    room.d = Math.max(200, Math.round(b.maxY - b.minY))
  }
  state.wallIndex = null
  state.wallItemId = null
  state.roomNode = 'room'
  room.openings = room.openings.map((o) => clampOpening(o, room))
  touch()
  scheduleSave()
  notify('Стена удалена', 'undo')
}

export function addPartition(): void {
  const room = state.project.room
  pushHistory('Добавлена перегородка')
  room.partitions = [
    ...(room.partitions ?? []),
    { a: [Math.round(room.w / 2), 0], b: [Math.round(room.w / 2), Math.round(room.d)] },
  ]
  state.wallIndex = roomWalls(room as Room).length - 1
  state.roomSelected = true
  state.roomNode = 'wall'
  touch()
  scheduleSave()
}

const WALL_ITEM_DEFAULTS: Record<WallItemKind, Omit<WallItem, 'id' | 'wall'>> = {
  shelf: { kind: 'shelf', x: 0, z: 1200, w: 600, h: 30, depth: 220 },
  mirror: { kind: 'mirror', x: 0, z: 1100, w: 600, h: 800, depth: 20 },
  socket: { kind: 'socket', x: 0, z: 300, w: 80, h: 80, depth: 12 },
  switch: { kind: 'switch', x: 0, z: 1000, w: 80, h: 80, depth: 12 },
}

export function addWallItem(kind: WallItemKind, wall: number): void {
  const room = state.project.room
  const walls = roomWalls(room as Room)
  const seg = walls.find((w) => w.index === wall)
  if (!seg) return
  const t = WALL_ITEM_DEFAULTS[kind]
  const x = Math.max(0, Math.round((seg.len - t.w) / 2))
  pushHistory('Добавлен предмет на стену')
  room.wallItems.push({
    ...t,
    id: `w${Date.now().toString(36)}${wallItemSeq++}`,
    wall,
    x,
  })
  state.wallIndex = wall
  state.roomSelected = true
  state.roomNode = 'wall'
  touch()
  scheduleSave()
}

export function updateWallItem(
  id: string,
  patch: Partial<WallItem>,
  record = true,
): void {
  const room = state.project.room
  const i = room.wallItems.findIndex((w) => w.id === id)
  if (i < 0) return
  if (record) pushHistory('Изменён предмет на стене')
  room.wallItems[i] = { ...room.wallItems[i], ...patch }
  touch()
  scheduleSave()
}

export function removeWallItem(id: string): void {
  const room = state.project.room
  if (!room.wallItems.some((w) => w.id === id)) return
  pushHistory('Удалён предмет со стены')
  room.wallItems = room.wallItems.filter((w) => w.id !== id)
  touch()
  scheduleSave()
  notify('Предмет со стены удалён', 'undo')
}

export function addFinish(patch: Partial<Finish> = {}): string {
  pushHistory('Добавлена отделка')
  const id = `fin${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const room = state.project.room
  const f: Finish = {
    id,
    name: patch.name || `Отделка ${(state.project.finishes?.length ?? 0) + 1}`,
    kind: patch.kind === 'ceiling' || patch.kind === 'wall' ? patch.kind : 'floor',
    x: Math.max(0, Number(patch.x) || 0),
    y: Math.max(0, Number(patch.y) || 0),
    w: Math.max(100, Number(patch.w) || Math.round(room.w / 2)),
    d: Math.max(100, Number(patch.d) || Math.round(room.d / 2)),
    material: patch.material || 'Плитка',
    color: patch.color || '#a9b4bd',
    tileW: Math.max(10, Number(patch.tileW) || 300),
    tileH: Math.max(10, Number(patch.tileH) || 300),
    grout: Math.max(0, Number(patch.grout) || 2),
    waste: Math.max(0, Number(patch.waste) || 10),
    price_m2: Math.max(0, Number(patch.price_m2) || 0),
  }
  state.project.finishes = [...(state.project.finishes ?? []), f]
  touch()
  scheduleSave()
  return id
}

export function updateFinish(id: string, patch: Partial<Finish>): void {
  const list = state.project.finishes ?? []
  const i = list.findIndex((f) => f.id === id)
  if (i < 0) return
  pushHistory('Изменена отделка')
  const next = { ...list[i], ...patch }
  next.w = Math.max(100, Math.round(next.w))
  next.d = Math.max(100, Math.round(next.d))
  next.tileW = Math.max(10, Math.round(next.tileW))
  next.tileH = Math.max(10, Math.round(next.tileH))
  next.waste = Math.max(0, next.waste)
  next.price_m2 = Math.max(0, next.price_m2)
  state.project.finishes = list.map((f) => (f.id === id ? next : f))
  touch()
  scheduleSave()
}

export function removeFinish(id: string): void {
  if (!(state.project.finishes ?? []).some((f) => f.id === id)) return
  pushHistory('Удалена отделка')
  state.project.finishes = (state.project.finishes ?? []).filter((f) => f.id !== id)
  touch()
  scheduleSave()
}

export function finishCalc(f: Finish): {
  area: number
  tiles: number
  boxes: number
  cost: number
  groutKg: number
} {
  const area = (f.w * f.d) / 1e6
  const tileArea = (f.tileW * f.tileH) / 1e6
  const tiles = Math.ceil((area / Math.max(0.0001, tileArea)) * (1 + f.waste / 100))
  const perBox = f.material.includes('Плитка') ? Math.max(1, Math.round(1.44 / tileArea)) : 1
  const boxes = Math.ceil(tiles / perBox)
  return {
    area: Math.round(area * 100) / 100,
    tiles,
    boxes,
    cost: Math.round(area * f.price_m2 * (1 + f.waste / 100) * 100) / 100,
    groutKg: Math.round(Math.sqrt(tileArea) * f.grout * area * 1.6 * 10) / 10,
  }
}

export function setSurface(
  kind: 'floor' | 'ceiling',
  patch: Partial<RoomSurface>,
): void {
  pushHistory('Материал поверхности')
  state.project.room[kind] = { ...state.project.room[kind], ...patch }
  state.fitToken++
  touch()
  scheduleSave()
}

export function addOpening(
  kind: OpeningKind,
  opts: Partial<Opening> = {},
): string {
  const room = state.project.room
  const walls = roomWalls(room as Room)
  const defaultWall = kind === 'door' || kind === 'arch'
    ? Math.max(0, walls.length - 1)
    : 0
  pushHistory('Добавлен проём')
  const wall: WallIndex = opts.wall ?? defaultWall
  const L = wallLength(wall, room)
  const w = opts.w ?? (kind === 'window' ? 1200 : 900)
  const o: Opening = {
    id: `o${Date.now().toString(36)}${openingSeq++}`,
    kind,
    wall,
    x: opts.x ?? Math.max(0, Math.round((L - w) / 2)),
    w,
    z0: opts.z0 ?? (kind === 'window' ? 900 : 0),
    z1: opts.z1 ?? (kind === 'window' ? 2200 : 2100),
    ...(opts.open != null ? { open: opts.open } : {}),
    hinge: opts.hinge === 'right' ? 'right' : 'left',
    angle: clamp(Number(opts.angle) || 80, 0, 120),
    wallT: opts.wallT ?? room.wallT,
    frameT: opts.frameT ?? 70,
    sillDepth: opts.sillDepth ?? 250,
    casing: opts.casing ?? 70,
    material: opts.material ?? 'ПВХ',
    price: opts.price ?? 0,
  }
  room.openings.push(clampOpening(o, room))
  state.openingId = o.id
  state.selection = null
  state.selected = []
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  openObjectModal('quick')
  touch()
  scheduleSave()
  return o.id
}

export function updateOpening(
  id: string,
  patch: Partial<Opening>,
  record = true,
): void {
  const room = state.project.room
  const i = room.openings.findIndex((o) => o.id === id)
  if (i < 0) return
  if (record) pushHistory('Изменён проём')
  room.openings[i] = clampOpening({ ...room.openings[i], ...patch }, room)
  touch()
  scheduleSave()
}

export function removeOpening(id: string): void {
  const room = state.project.room
  if (!room.openings.some((o) => o.id === id)) return
  pushHistory('Удалён проём')
  room.openings = room.openings.filter((o) => o.id !== id)
  touch()
  scheduleSave()
  notify('Проём удалён', 'undo')
}

export function toggleDoors(id: string): void {
  toggleKind(id, 'door')
}

export function toggleDrawers(id: string): void {
  toggleKind(id, 'drawer')
}

export function toggleRoomDoor(id: string): void {
  const o = state.project.room.openings.find((x) => x.id === id)
  if (!o || o.kind !== 'door') return
  o.open = !o.open
  touch()
  scheduleSave()
}

export function undo(): void {
  if (!history.undo.length) return
  selectPart('', null)
  history.redo.push(JSON.stringify(state.project))
  state.project = JSON.parse(history.undo.pop() as string)
  state.project.log = [
    ...(state.project.log ?? []),
    { time: new Date().toISOString(), label: 'Отмена действия' },
  ].slice(-200)
  state.selection = state.project.instances[0]?.id ?? null
  state.fitToken++
  touch()
  void solveAll()
  scheduleSave()
}

export function redo(): void {
  if (!history.redo.length) return
  selectPart('', null)
  history.undo.push(JSON.stringify(state.project))
  state.project = JSON.parse(history.redo.pop() as string)
  state.project.log = [
    ...(state.project.log ?? []),
    { time: new Date().toISOString(), label: 'Повтор действия' },
  ].slice(-200)
  state.selection = state.project.instances[0]?.id ?? null
  state.fitToken++
  touch()
  void solveAll()
  scheduleSave()
}

export async function init(): Promise<void> {
  void loadHardware()
  const saved = (() => {
    try {
      return localStorage.getItem('furniture.project')
    } catch {
      return null
    }
  })()
  state.projectId = saved || 'demo'
  try {
    const raw = await apiGetProject(state.projectId)
    state.project = normalizeProject(raw)
  } catch {
    if (state.projectId !== 'demo') {
      try {
        const raw = await apiGetProject('demo')
        state.projectId = 'demo'
        state.project = normalizeProject(raw)
      } catch {
        state.project = defaultProject()
        await saveProject()
      }
    } else {
      state.project = defaultProject()
      await saveProject()
    }
  }
  state.selection = state.project.instances[0]?.id ?? null
  state.fitToken++
  await solveAll()
  applyLegacyOpenFlags()
}

export async function listProjects() {
  return apiListProjects()
}

export async function restoreProjectVersion(vid: string): Promise<void> {
  if (!(await flushSave())) {
    throw new Error('Не удалось сохранить текущий проект перед восстановлением')
  }
  const { project } = await apiRestoreVersion(state.projectId, vid)
  state.project = normalizeProject(project)
  state.selection = state.project.instances[0]?.id ?? null
  state.selected = state.selection ? [state.selection] : []
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.fitToken++
  state.dirty = false
  state.saveState = 'saved'
  await solveAll()
  applyLegacyOpenFlags()
  touch()
}

export async function openProject(id: string): Promise<void> {
  if (!(await flushSave())) {
    throw new Error('Не удалось сохранить текущий проект перед открытием другого')
  }
  const raw = await apiGetProject(id)
  state.project = normalizeProject(raw)
  state.projectId = id
  state.selection = state.project.instances[0]?.id ?? null
  state.selected = state.selection ? [state.selection] : []
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.fitToken++
  try {
    localStorage.setItem('furniture.project', id)
  } catch {
    /* ignore */
  }
  state.dirty = false
  state.saveState = 'saved'
  await solveAll()
  applyLegacyOpenFlags()
  touch()
}

export async function createProject(name: string): Promise<void> {
  if (!(await flushSave())) {
    throw new Error('Не удалось сохранить текущий проект перед созданием нового')
  }
  const base = defaultProject()
  base.name = name.trim() || 'Новый проект'
  base.instances = []
  base.folders = []
  base.room.openings = []
  const id = `p${Date.now().toString(36)}`
  state.project = base
  state.projectId = id
  state.selection = null
  state.selected = []
  state.openingId = null
  state.folderId = null
  state.roomSelected = true
  try {
    localStorage.setItem('furniture.project', id)
  } catch {
    /* ignore */
  }
  await saveProject()
  state.dirty = false
  state.saveState = 'saved'
  state.fitToken++
  touch()
}

/** Старые проекты хранили doorsOpen/drawersOpen — переносим в каналы. */
function applyLegacyOpenFlags(): void {
  for (const inst of state.project.instances) {
    if (!inst.legacyDoorsOpen && !inst.legacyDrawersOpen) continue
    objectsOf(inst).forEach((o, part) => {
      const on =
        (inst.legacyDoorsOpen && o.kind === 'door') ||
        (inst.legacyDrawersOpen &&
          (o.kind === 'drawerfront' || o.kind === 'drawerbox'))
      if (!on) return
      const set = channelsOf(inst, part)
      if (!set) return
      for (const ch of Object.values(set)) {
        if (!ch.keys.length) ch.keys = defaultKeys(ch, o.kind)
        ch.value = ch.max
      }
    })
    delete inst.legacyDoorsOpen
    delete inst.legacyDrawersOpen
  }
}
