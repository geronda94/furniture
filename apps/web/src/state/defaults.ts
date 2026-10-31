/**
 * Типы проекта, пресеты модулей, значения по умолчанию и нормализация
 * сохранённого JSON. Вынесено из `state/project.ts` (P2-5, docs/26):
 * здесь нет реактивного состояния, только чистые данные и функции.
 */
import type { ChannelSet } from '../anim/channels'
import type {
  Camera,
  Material,
  MaterialPart,
  MaterialScope,
  MaterialVariable,
  Materials,
  Opening,
  OpeningKind,
  Prop,
  PropType,
  Room,
  RoomSurface,
  ViewStyle,
  WallIndex,
  WallItem,
  WallItemKind,
} from '../render25d/types'
import { roomBounds, roomWallLength } from '../render25d/room'

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
    key: 'corner900',
    label: 'Угловой 900×900',
    hint: 'угловой корпус, 2 двери',
    group: 'Угловые',
    params: { W: 900, H: 720, D: 900, doors: 2, shelves: 2 },
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
  /** комната на плане, мм: x/y — левый-верхний угол, w/d — размеры */
  area?: { x: number; y: number; w: number; d: number }
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
  /** декоративная мебель/сантехника демо-сцены (вне BOM) */
  props?: Prop[]
  /** как показывать стены при открытии проекта */
  wallMode?: 'cutaway' | 'low'
  /** стартовый ракурс 3D для демо-проекта, градусы */
  camera3d?: { alpha: number; beta: number }
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
    props: [],
    wallMode: 'cutaway',
    views: [],
    log: [],
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
}

export function sanitizeParams(p: Params): Params {
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

export function clampOpening(o: Opening, room: RoomDims): Opening {
  const L = wallLength(o.wall, room)
  const w = clamp(Math.round(o.w), 200, Math.min(L, 6000))
  const x = clamp(Math.round(o.x), 0, Math.max(0, L - w))
  const z0 = clamp(Math.round(o.z0), 0, room.h - 200)
  const z1 = clamp(Math.round(o.z1), z0 + 100, room.h)
  return { ...o, x, w, z0, z1 }
}

export function normalizeOpenings(
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

export function normalizeMaterials(raw: unknown): Materials {
  const out: Materials = { ...DEFAULT_MATERIALS }
  if (!raw || typeof raw !== 'object') return out
  for (const [role, value] of Object.entries(raw as Record<string, unknown>)) {
    const m = sanitizeMaterial(value)
    if (m) out[role] = m
  }
  return out
}

/** Переопределения материалов модуля: только заданные роли, без дефолтов. */
export function normalizeMaterialOverrides(raw: unknown): Materials | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Materials = {}
  for (const [role, value] of Object.entries(raw as Record<string, unknown>)) {
    const m = sanitizeMaterial(value)
    if (m) out[role] = m
  }
  return Object.keys(out).length ? out : undefined
}

export function normalizeGlobals(raw: unknown): ProjectGlobals {
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

export function normalizeProject(raw: unknown): Project {
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
          .map((f) => {
            const a = f.area as
              | { x?: number; y?: number; w?: number; d?: number }
              | undefined
            const area = a && Number(a.w) > 100 && Number(a.d) > 100
              ? {
                  x: Math.max(0, Number(a.x) || 0),
                  y: Math.max(0, Number(a.y) || 0),
                  w: Math.max(100, Number(a.w) || 100),
                  d: Math.max(100, Number(a.d) || 100),
                }
              : undefined
            return {
              id: String(f.id),
              name: String(f.name || 'Папка'),
              ids: (f.ids ?? []).filter((id) =>
                instances.some((i) => i.id === id),
              ),
              ...(area ? { area } : {}),
            }
          })
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
    wallMode: d.wallMode === 'low' ? 'low' : 'cutaway',
    camera3d: (() => {
      const c = d.camera3d
      if (!c || typeof c !== 'object') return undefined
      return {
        alpha: Number(c.alpha) || -60,
        beta: Number(c.beta) || 38,
      }
    })(),
    props: (() => {
      const allowed = new Set<PropType>([
        'bed', 'sofa', 'armchair', 'chair', 'coffee-table', 'tv',
        'rug', 'bathtub', 'toilet', 'vanity', 'shower', 'plant',
        'dresser', 'lamp', 'fridge', 'stove', 'sink', 'hood',
      ])
      return Array.isArray(d.props)
        ? d.props
            .filter((p) => p && allowed.has(p.type as PropType))
            .slice(0, 120)
            .map((p, i) => ({
              id: String(p.id || `prop${i + 1}`),
              type: p.type as PropType,
              name: String(p.name || 'Декор'),
              x: Math.round(Number(p.x) || 0),
              y: Math.round(Number(p.y) || 0),
              z: Math.round(Number(p.z) || 0),
              rot: Number(p.rot) || 0,
              w: Math.max(100, Number(p.w) || 1000),
              d: Math.max(100, Number(p.d) || 1000),
              h: Math.max(50, Number(p.h) || 500),
              color: String(p.color || '#8b8f95'),
              accent: p.accent ? String(p.accent) : undefined,
              zone: p.zone ? String(p.zone) : undefined,
            }))
        : []
    })(),
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
            viewMode: v.viewMode === 'schematic' || v.viewMode === 'blueprint'
              ? v.viewMode
              : 'realistic',
          }))
      : [],
  }
}
