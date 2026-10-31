import { computed, reactive } from 'vue'
import {
  apiGetProject,
  apiHandles,
  apiHardware,
  apiListProjects,
  apiProjectLayout,
  apiPutProject,
  apiValidateProject,
  apiRestoreVersion,
  apiSolve,
  apiSolveBatch,
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
  Prop,
  PropType,
  Room,
  RoomSurface,
  ViewStyle,
  WallIndex,
  WallItem,
  WallItemKind,
} from '../render25d/types'
import { outlinePoints, pointInPoly, roomBounds, roomWallLength, roomWalls } from '../render25d/room'
import {
  cornersOf,
  distanceToSeg,
  footprintOf,
  insideOrEdge,
  overlaps,
  wallFaces,
  zSpan,
  normalizeRot,
} from './geometry'
import type { Box2, Box3, WallFace } from './geometry'

// Совместимость: эти помощники исторически импортировали из state/project.
export { wallFaces, zSpan, normalizeRot } from './geometry'
export type { WallFace } from './geometry'
import {
  partGroupKey,
  partUid,
  resolveMaterial,
  resolveObjectMaterial,
} from '../material/vars'

import {
  DEFAULT_MATERIALS,
  MANAGED_PARAMS,
  MATERIAL_ROLES,
  MODULE_PRESETS,
  PROJECT_SCHEMA,
  clamp,
  clampOpening,
  defaultGlobals,
  defaultParams,
  defaultProject,
  globalsToParams,
  normalizeGlobals,
  normalizeMaterialOverrides,
  normalizeMaterials,
  normalizeOpenings,
  normalizeProject,
  sanitizeParams,
  suggestDoors,
  wallLength,
} from './defaults'
import type {
  BackKind,
  EdgePolicy,
  Finish,
  Folder,
  Frame,
  FrontBlock,
  Hardware,
  Instance,
  LogEntry,
  ManagedParam,
  ModulePreset,
  Params,
  Project,
  ProjectGlobals,
  Reinforce,
  RoomDims,
  SavedView,
} from './defaults'
export * from './defaults'

export const state = reactive({
  project: defaultProject(),
  /** id файлового проекта */
  projectId: 'demo',
  selection: 'i1' as string | null,
  /** выделение группы (id модулей); selection — «главный» из них */
  selected: [] as string[],
  /** выбранный проём (окно/дверь) в дереве объектов */
  openingId: null as string | null,
  /** выбранный декоративный объект (не входит в смету) */
  propId: null as string | null,
  /** открыта панель свойств декора */
  propPanelOpen: false,
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
  focusPropId: null as string | null,
  focusView: 'front' as 'front' | 'iso' | 'side' | 'top',
  focusLeft: 1,
  /** доля экрана по высоте, доступная объекту (1 — вся высота) */
  focusBottom: 1,
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
  /** активная вкладка библиотеки при открытии */
  addTab: 'furniture' as 'furniture' | 'tech' | 'decor' | 'opening',
  /** основной вид: 3D или 2D-развёртки стен без WebGL */
  renderMode: '3d' as '3d' | 'draft',
  /** в 2D: развёртки стен или план */
  draftTab: 'walls' as 'walls' | 'plan',
  /** показывать только модули выбранной комнаты (папки) */
  onlyRoom: false,
  /** показывать фасады в 3D (можно скрыть для просмотра деталей) */
  facades: true,
  /** показывать ручки/петли/фурнитуру поверх схемы */
  hardware: true,
  /** угол обзора в прогулке, градусы по вертикали */
  walkFov: 60,
  /** режим «Мастер»: только главные действия, без продвинутых панелей */
  master: (() => {
    try {
      return localStorage.getItem('furniture.master') === '1'
    } catch {
      return false
    }
  })(),
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
  /** шторка «Вид и сцена» (ракурс, камера, настройки сцены) */
  viewSheetOpen: false,
  /** меню «Ещё» (файлы, версии, КП, экспорт) */
  moreOpen: false,
  /** мастер «Быстрый старт» */
  quickOpen: false,
  /** сводка «Готовый проект» */
  resultOpen: false,
  /** модалка проектов на диске */
  projectsOpen: false,
  /** журнал изменений */
  historyOpen: false,
  /** демо-тур по интерфейсу */
  tourOpen: false,
  tourStep: 0,
  /** короткое уведомление с действием «Отменить» */
  toast: null as null | {
    id: number
    text: string
    action: 'undo' | 'layout' | null
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
  /** проверка расстановки мебели */
  layoutOpen: false,
  /** модалка отделки (плитка/ламинат/паркет) */
  finishOpen: false,
  finishId: null as string | null,
})

/** Последняя позиция курсора (clientX/clientY) — для привязки плавающих окон. */
export const pointer = { x: 0, y: 0 }

/** Кэш расчётов действителен только для текущей версии движка. */
function cacheIsFresh(cache: Record<string, SolveResponse>): boolean {
  const rows = Object.values(cache)
  if (!rows.length) return false
  return rows.every((r) =>
    (r.objects ?? []).every((o) => !!o.op_part),
  )
}

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
  bottomFraction = 1,
): void {
  state.focusInstanceId = id
  state.focusPropId = null
  state.focusView = view
  state.focusLeft = Math.min(1, Math.max(0.2, leftFraction))
  state.focusBottom = Math.min(1, Math.max(0.3, bottomFraction))
  state.focusToken++
}

export const derived = reactive<Record<string, SolveResponse>>({})

/** Результат серверной проверки расстановки (план + объёмы + декор). */
export const layoutState = reactive({
  errors: 0,
  warnings: 0,
  issues: [] as { code: string; level: string; message: string }[],
  busy: false,
  checkedAt: 0,
})

let layoutTimer = 0
let layoutSeq = 0

export function scheduleLayoutCheck(delay = 800): void {
  if (layoutTimer) clearTimeout(layoutTimer)
  layoutTimer = window.setTimeout(() => {
    layoutTimer = 0
    void checkLayout()
  }, delay)
}

export async function checkLayout(): Promise<void> {
  if (!state.projectId || state.saveState === 'saving') return
  const seq = ++layoutSeq
  layoutState.busy = true
  try {
    const r = await apiProjectLayout(state.projectId)
    if (seq !== layoutSeq) return
    layoutState.errors = r.errors
    layoutState.warnings = r.warnings
    layoutState.issues = r.issues
    layoutState.checkedAt = Date.now()
  } catch {
    /* сеть/сессия — не затираем последний результат */
  } finally {
    if (seq === layoutSeq) layoutState.busy = false
  }
}

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__furniture = {
    state,
    ui,
    derived,
    layoutState,
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

/** Показать декоративный объект в 3D (ошибки расстановки по декору). */
export function focusProp(propId: string): void {
  state.focusInstanceId = null
  state.focusPropId = propId
  state.focusView = 'iso'
  state.focusLeft = 1
  state.focusToken++
}

export function selectPart(
  instanceId: string,
  part: number | null,
  openModal = true,
): void {
  // Выбор детали — всегда одиночный: активным становится один модуль
  // и одна деталь внутри него.
  if (part != null && instanceId) {
    state.selection = instanceId
    state.selected = [instanceId]
  }
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

export function pushHistory(label = 'Изменение'): void {
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

/** Заготовки декора: размеры по умолчанию для библиотеки. */
export type PropCategory =
  | 'soft' | 'beds' | 'tables' | 'storage' | 'decor' | 'tech' | 'bath'

export const PROP_GROUPS: { id: PropCategory; label: string }[] = [
  { id: 'soft', label: 'Мягкая мебель' },
  { id: 'beds', label: 'Кровати' },
  { id: 'tables', label: 'Столы и стулья' },
  { id: 'storage', label: 'Корпусная мебель' },
  { id: 'tech', label: 'Техника' },
  { id: 'bath', label: 'Сантехника' },
  { id: 'decor', label: 'Декор' },
]

export interface PropPreset {
  key: string
  type: PropType
  name: string
  category: PropCategory
  group: string
  w: number
  d: number
  h: number
  color: string
  accent?: string
  icon: string
}

const G = (id: PropCategory): string =>
  PROP_GROUPS.find((g) => g.id === id)?.label ?? 'Декор'

const prop = (
  key: string, type: PropType, name: string, category: PropCategory,
  w: number, d: number, h: number, color: string, icon: string,
  accent?: string,
): PropPreset => ({
  key, type, name, category, group: G(category),
  w, d, h, color, accent, icon,
})

/** Библиотека объектов: категория «Мебель» с субкатегориями + техника/декор. */
export const PROP_PRESETS: PropPreset[] = [
  // --- мягкая мебель ---
  prop('sofa-small', 'sofa', 'Диван 2-местный', 'soft',
    1600, 900, 850, '#5f6a72', '🛋', '#9aa5ad'),
  prop('sofa', 'sofa', 'Диван 3-местный', 'soft',
    2200, 950, 850, '#5f6a72', '🛋', '#9aa5ad'),
  prop('sofa-compact', 'sofa', 'Диван компакт', 'soft',
    1200, 850, 820, '#6d7379', '🛋', '#9aa5ad'),
  prop('armchair', 'armchair', 'Кресло', 'soft',
    850, 850, 800, '#6b6f64', '🪑', '#a3a795'),
  prop('armchair-xl', 'armchair', 'Кресло широкое', 'soft',
    950, 900, 820, '#6b6f64', '🪑', '#a3a795'),

  // --- кровати (ГОСТ 13025.2: 700/800/900, 1100…1800 × 1860–2050) ---
  prop('bed-90', 'bed', 'Кровать 900', 'beds',
    900, 2000, 900, '#8d7a66', '🛏', '#c8b6a2'),
  prop('bed-120', 'bed', 'Кровать 1200', 'beds',
    1200, 2000, 900, '#8d7a66', '🛏', '#c8b6a2'),
  prop('bed', 'bed', 'Кровать 1600', 'beds',
    1600, 2000, 900, '#8d7a66', '🛏', '#c8b6a2'),
  prop('bed-180', 'bed', 'Кровать 1800', 'beds',
    1800, 2000, 900, '#8d7a66', '🛏', '#c8b6a2'),

  // --- столы и стулья ---
  prop('dining-table', 'coffee-table', 'Обеденный стол 1600', 'tables',
    1600, 900, 750, '#7b6652', '🪵', '#a68b6c'),
  prop('dining-table-1200', 'coffee-table', 'Обеденный стол 1200', 'tables',
    1200, 800, 750, '#7b6652', '🪵', '#a68b6c'),
  prop('coffee-table', 'coffee-table', 'Журнальный стол', 'tables',
    1100, 650, 420, '#7b6652', '🪵', '#a68b6c'),
  prop('chair', 'chair', 'Стул', 'tables',
    450, 480, 850, '#8a6b4f', '🪑', '#b08a63'),
  prop('bar-chair', 'chair', 'Барный стул', 'tables',
    450, 500, 1050, '#8a6b4f', '🪑', '#b08a63'),

  // --- корпусная мебель (декор, вне BOM) ---
  prop('dresser', 'dresser', 'Комод', 'storage',
    1000, 450, 900, '#7b6652', '🗄', '#a68b6c'),
  prop('tv-stand', 'dresser', 'ТВ-тумба', 'storage',
    1800, 450, 500, '#7b6652', '🗄', '#a68b6c'),

  // --- техника ---
  prop('fridge', 'fridge', 'Холодильник', 'tech',
    700, 650, 1850, '#c8ccd0', '🧊', '#9aa0a5'),
  prop('stove', 'stove', 'Плита', 'tech',
    600, 560, 850, '#2b2f33', '🔥', '#6b7378'),
  prop('sink', 'sink', 'Мойка', 'tech',
    800, 560, 850, '#c8ccd0', '🚰', '#9aa0a5'),
  prop('tv', 'tv', 'Телевизор', 'tech',
    1500, 90, 850, '#121417', '📺'),
  prop('hood', 'hood', 'Вытяжка', 'tech',
    600, 500, 600, '#b9c0c5', '💨', '#7c858c'),

  // --- сантехника ---
  prop('toilet', 'toilet', 'Унитаз', 'bath',
    450, 650, 780, '#f0f1ec', '🚽', '#d5d7d0'),
  prop('bathtub', 'bathtub', 'Ванна', 'bath',
    1700, 800, 560, '#f0f1ec', '🛁', '#d5d7d0'),
  prop('vanity', 'vanity', 'Тумба с раковиной', 'bath',
    1200, 550, 850, '#f0f1ec', '🚿', '#d5d7d0'),
  prop('shower', 'shower', 'Душевая', 'bath',
    1000, 900, 2100, '#cfd4d8', '🚿', '#9aa0a5'),

  // --- декор ---
  prop('lamp', 'lamp', 'Торшер', 'decor',
    350, 350, 1650, '#e8dcc4', '💡', '#c9b489'),
  prop('plant', 'plant', 'Растение', 'decor',
    450, 450, 1200, '#4e7a45', '🪴', '#3d6236'),
  prop('rug', 'rug', 'Ковёр', 'decor',
    2000, 1500, 12, '#8d7f70', '🟫'),
]

export const selectedProp = computed<Prop | null>(() => {
  if (!state.propId) return null
  return (state.project.props ?? []).find((p) => p.id === state.propId) ?? null
})

let propSeq = 0

/** Свободное место под декор: спираль от центра комнаты. */
function findPropSpot(w: number, d: number): { x: number; y: number } {
  const room = state.project.room
  const pad = 120
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (const inst of state.project.instances) {
    const b = footprintOf(inst.x, inst.y, inst.params.W, inst.params.D, inst.rot)
    boxes.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.d })
  }
  for (const pr of state.project.props ?? []) {
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

/** Выбрать декор (с открытием панели или без). */
export function selectProp(id: string | null, openPanel = true): void {
  state.propId = id
  state.selection = null
  state.selected = []
  state.openingId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  state.propPanelOpen = Boolean(id && openPanel)
  touch()
}

export function addProp(
  keyOrType: string,
  at?: { x: number; y: number; rot?: number },
): string | null {
  const preset = PROP_PRESETS.find((p) => p.key === keyOrType)
    ?? PROP_PRESETS.find((p) => p.type === keyOrType)
  if (!preset) return null
  const type = preset.type
  pushHistory(`Добавлен декор: ${preset.name}`)
  const room = state.project.room
  const props = state.project.props ?? []
  propSeq++
  let id = `p${Date.now().toString(36)}${propSeq}`
  while (props.some((p) => p.id === id)) id += 'x'
  const spot = at ?? findPropSpot(preset.w, preset.d)
  const x = Math.round(spot.x)
  const y = Math.round(spot.y)
  props.push({
    id,
    type,
    name: preset.name,
    x,
    y,
    z: 0,
    rot: at?.rot ?? 0,
    w: preset.w,
    d: preset.d,
    h: preset.h,
    color: preset.color,
    accent: preset.accent,
  })
  state.project.props = props
  state.propId = id
  state.propPanelOpen = true
  touch()
  scheduleSave()
  scheduleLayoutCheck(1200)
  return id
}

export function updateProp(id: string, patch: Partial<Prop>, quiet = false): void {
  const prop = (state.project.props ?? []).find((p) => p.id === id)
  if (!prop) return
  // Размер/поворот: не даём декору войти в стену, мебель или другой декор.
  const geometry = ['w', 'd', 'h', 'rot', 'z'].some(
    (k) => Object.prototype.hasOwnProperty.call(patch, k),
  )
  if (geometry && prop.type !== 'rug') {
    const next = { ...prop, ...patch }
    if (propCollides(next, next.x, next.y)) {
      notify('Декор не помещается: пересечёт стену, мебель или другой декор', null, 'error')
      return
    }
  }
  if (!quiet) pushHistory('Изменение декора')
  Object.assign(prop, patch)
  touch()
  scheduleSave()
}

/** Габарит декора (центр + поворот) в мировых осях. */
function propBox(
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

/** Декор не входит в стены, мебель и другой декор (ковёр — покрытие пола). */
function propCollides(prop: Prop, x: number, y: number): boolean {
  const flat = propBox(x, y, prop.w, prop.d, prop.rot ?? 0)
  if (!roomContains(flat.x, flat.y, flat.w, flat.d, 0)) return true
  const z0 = Number(prop.z) || 0
  const z1 = z0 + (Number(prop.h) || 0)
  if (wallBodyHit(flat.x, flat.y, flat.w, flat.d, 0, z0, z1)) return true
  const box: Box3 = { ...flat, z0, z1 }
  const props = state.project.props ?? []
  return state.project.instances.some((i) => overlaps(box, footprint(i)))
    || props.some((p) => {
      if (p.id === prop.id) return false
      if (p.type === 'rug' || prop.type === 'rug') return false
      const pb = propBox(p.x, p.y, p.w, p.d, p.rot ?? 0)
      const pz0 = Number(p.z) || 0
      return overlaps(box, { ...pb, z0: pz0, z1: pz0 + (Number(p.h) || 0) })
    })
}

/** Перемещение декора мышью: история пишется один раз на drag. */
export function moveProp(id: string, x: number, y: number): void {
  const prop = (state.project.props ?? []).find((p) => p.id === id)
  if (!prop) return
  // Ковёр — покрытие пола: его можно класть под мебель.
  if (prop.type === 'rug') {
    prop.x = Math.round(x)
    prop.y = Math.round(y)
    touch()
    return
  }
  const px = prop.x
  const py = prop.y
  for (const [nx, ny] of [[x, y], [x, py], [px, y]]) {
    if (!propCollides(prop, nx, ny)) {
      prop.x = Math.round(nx)
      prop.y = Math.round(ny)
      touch()
      return
    }
  }
}

export function rotateProp(id: string, delta: number): void {
  const prop = (state.project.props ?? []).find((p) => p.id === id)
  if (!prop) return
  pushHistory('Поворот декора')
  prop.rot = ((((prop.rot ?? 0) + delta) % 360) + 360) % 360
  touch()
  scheduleSave()
}

export function duplicateProp(id: string): void {
  const prop = (state.project.props ?? []).find((p) => p.id === id)
  if (!prop) return
  pushHistory('Копия декора')
  const copy: Prop = {
    ...prop,
    id: `${prop.id}-${Date.now().toString(36)}`,
    x: prop.x + 150,
    y: prop.y + 150,
  }
  state.project.props = [...(state.project.props ?? []), copy]
  state.propId = copy.id
  touch()
  scheduleSave()
  scheduleLayoutCheck(1200)
}

export function deleteProp(id: string): void {
  const props = state.project.props ?? []
  if (!props.some((p) => p.id === id)) return
  pushHistory('Удалён декор')
  state.project.props = props.filter((p) => p.id !== id)
  if (state.propId === id) {
    state.propId = null
    state.propPanelOpen = false
    state.focusPropId = null
  }
  touch()
  scheduleSave()
  scheduleLayoutCheck(1000)
}

/** Показать/скрыть панель декора. */
export function setPropPanel(open: boolean): void {
  state.propPanelOpen = open
}

/** Выбрать модуль, не открывая и не закрывая окно настроек. */
export function selectQuiet(id: string): void {
  ensureSolved(id)
  if (state.selection !== id) {
    partSelection.instanceId = null
    partSelection.part = null
  }
  state.selection = id
  state.selected = [id]
  state.openingId = null
  state.propId = null
  state.folderId = null
  state.roomSelected = false
  state.wallIndex = null
  state.wallItemId = null
  touch()
}

export function select(id: string | null): void {
  if (id) ensureSolved(id)
  if (state.selection !== id) selectPart(id ?? '', null)
  state.selection = id
  state.selected = id ? [id] : []
  state.openingId = null
  state.propId = null
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
  ensureSolved(id)
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
  state.propId = null
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
  state.propId = null
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
  state.propId = null
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
  if (id && ui.onlyRoom) {
    // Освобождаем расчёт скрытых комнат, чтобы не держать весь проект в памяти.
    const f = state.project.folders.find((x) => x.id === id)
    if (f) {
      const keep = new Set(f.ids)
      for (const inst of state.project.instances) {
        if (!keep.has(inst.id)) delete derived[inst.id]
      }
    }
    void solveVisible()
  }
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
  state.propId = null
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
    if (!roomContains(p.x, p.y, inst.params.W, inst.params.D, inst.rot)) return
    if (wallBodyHit(p.x, p.y, inst.params.W, inst.params.D, inst.rot, z0, z1)) return
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
  // Останавливаемся не только о модуль, но и о внутреннюю грань стены/проём.
  const step = 10
  let safe = 0
  for (let d = step; d <= dist + 0.01; d += step) {
    let ok = true
    for (const inst of insts) {
      const nx = inst.x + dir[0] * d
      const ny = inst.y + dir[1] * d
      const [z0, z1] = zSpan(inst)
      if (!roomContains(nx, ny, inst.params.W, inst.params.D, inst.rot) ||
          wallBodyHit(nx, ny, inst.params.W, inst.params.D, inst.rot, z0, z1)) {
        ok = false
        break
      }
    }
    if (!ok) break
    safe = d
  }
  if (safe < 0.5) return
  pushHistory()
  for (const inst of insts) {
    inst.x += dir[0] * safe
    inst.y += dir[1] * safe
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
const solving = new Set<string>()
/** Один тост про ошибки расстановки до следующего успешного сохранения. */
let layoutToastShown = false

/** Русское склонение: 1 ошибка, 2 ошибки, 5 ошибок. */
function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

async function solveOne(inst: Instance): Promise<void> {
  if (solving.has(inst.id)) return
  solving.add(inst.id)
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
    solving.delete(inst.id)
    busy--
    state.busy = busy > 0
  }
}

/** Досчитать один модуль по требованию (выбор, скрытая комната). */
export function ensureSolved(id: string): void {
  if (derived[id] || solving.has(id)) return
  const inst = state.project.instances.find((i) => i.id === id)
  if (inst) void solveOne(inst)
}

/**
 * Ленивая загрузка: считать только модули выбранной комнаты (папки).
 * Без выбранной папки — обычный solveAll.
 */
export async function solveVisible(): Promise<void> {
  let folder = state.project.folders.find((f) => f.id === state.folderId)
  if (!folder && ui.onlyRoom) {
    // если комната ещё не выбрана — берём комнату выбранного/первого модуля
    const first = state.project.instances.find((i) => i.id === state.selection)
      ?? state.project.instances[0]
    folder = first
      ? state.project.folders.find((f) => f.ids.includes(first.id))
      : undefined
    if (folder) state.folderId = folder.id
  }
  if (!folder) return
  const ids = new Set(folder.ids)
  const queue = state.project.instances.filter(
    (i) => ids.has(i.id) && !derived[i.id] && !solving.has(i.id),
  )
  if (!queue.length) return
  const workers = Math.min(3, queue.length)
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length) {
      const inst = queue.shift()
      if (inst) await solveOne(inst)
    }
  }))
}

/**
 * Пакетный расчёт: один HTTP-запрос на комнату вместо десятков PUT-ов.
 * Падение одного модуля не мешает остальным.
 */
async function solveBatch(instances: Instance[]): Promise<void> {
  const queue = instances.filter(
    (i) => !derived[i.id] && !solving.has(i.id),
  )
  if (!queue.length) return
  for (const inst of queue) solving.add(inst.id)
  busy++
  state.busy = true
  const chunkSize = 12
  try {
    for (let i = 0; i < queue.length; i += chunkSize) {
      const chunk = queue.slice(i, i + chunkSize)
      try {
        const rows = await apiSolveBatch(
          chunk.map((inst) => ({
            id: inst.id,
            product: inst.product,
            params: { ...inst.params },
          })),
          {
            market: state.project.market,
            shop: state.project.shop,
            supplier: state.project.supplier,
          },
        )
        for (const row of rows) {
          const inst = chunk[row.index]
          if (!inst) continue
          if (row.result) {
            derived[inst.id] = row.result
            ensureAnim(inst)
          } else if (row.error) {
            state.error = row.error
          }
        }
        touch()
      } catch (e) {
        // Если batch недоступен (старый API) — падаем на одиночный расчёт.
        for (const inst of chunk) {
          solving.delete(inst.id)
        }
        await Promise.all(chunk.map((inst) => solveOne(inst)))
      }
    }
    state.error = ''
    touch()
  } finally {
    for (const inst of queue) solving.delete(inst.id)
    busy--
    state.busy = busy > 0
  }
}

async function solveMany(
  instances: Instance[], workers = 3,
): Promise<void> {
  if (instances.length > 1) {
    await solveBatch(instances)
    return
  }
  const queue = instances.filter(
    (i) => !derived[i.id] && !solving.has(i.id),
  )
  const n = Math.min(workers, queue.length)
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) {
      const inst = queue.shift()
      if (inst) await solveOne(inst)
    }
  }))
}

export async function solveAll(): Promise<void> {
  // Не отправляем 20+ одновременных запросов: браузер упирается в лимит
  // соединений, часть ответов теряется. Небольшая очередь стабильнее.
  await solveMany(state.project.instances, 4)
}

let backgroundTimer = 0

/**
 * Первый экран: сначала комната выбранного/первого модуля, остальное — фоном.
 * В режиме «Только комната» фон не запускается вообще.
 */
export async function solveInitial(): Promise<void> {
  const insts = state.project.instances
  if (insts.length <= 12) {
    await solveAll()
    return
  }
  const first = insts.find((i) => i.id === state.selection) ?? insts[0]
  const folder = state.project.folders.find((f) => f.ids.includes(first.id))
  if (folder) {
    // Первый экран — один выбранный модуль, чтобы не ждать всю комнату.
    await solveMany([first], 1)
    clearTimeout(backgroundTimer)
    backgroundTimer = window.setTimeout(() => {
      if (ui.onlyRoom) void solveVisible()
      else void solveAll()
    }, 500)
  } else {
    await solveAll()
  }
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

export function setMaster(on: boolean): void {
  ui.master = on
  try {
    localStorage.setItem('furniture.master', on ? '1' : '0')
  } catch {
    /* приватный режим — просто не запоминаем */
  }
  if (on) {
    ui.renderMode = '3d'
    ui.panelOpen = false
  }
  notify(on ? 'Мастер-режим: только главное' : 'Экспертный режим: все панели', null)
}

export function notify(
  text: string,
  action: 'undo' | 'layout' | null = null,
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
export async function saveProject(force = false): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  const id = state.projectId
  const serialized = JSON.stringify(state.project)
  state.saveState = 'saving'
  const run = async (): Promise<boolean> => {
    try {
      const doc = JSON.parse(serialized)
      if (!force) {
        // Preflight: не отправляем в БД заведомо невалидную сцену.
        const pre = await apiValidateProject(doc)
        layoutState.errors = pre.errors
        layoutState.warnings = pre.warnings
        layoutState.issues = pre.issues
        layoutState.checkedAt = Date.now()
        if (pre.errors > 0) {
          if (state.projectId === id) {
            state.dirty = true
            state.saveError = `Проект не сохранён: ${pre.errors} ошибок расстановки`
            state.saveState = 'error'
            if (!layoutToastShown) {
              layoutToastShown = true
              const n = pre.errors
              notify(
                `Проект не сохранён: ${n} ${plural(n, 'ошибка', 'ошибки', 'ошибок')} расстановки`,
                'layout',
                'error',
              )
            }
          }
          return false
        }
      }
      await apiPutProject(id, doc)
      if (state.projectId === id) {
        layoutToastShown = false
        state.dirty = false
        state.savedAt = new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })
        state.saveError = ''
        state.saveState = 'saved'
        scheduleLayoutCheck(300)
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
export async function flushSave(force = false): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (!state.dirty && state.saveState !== 'saving') return true
  return saveProject(force)
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

function roomContains(x: number, y: number, W: number, D: number, rot: number): boolean {
  const room = state.project.room
  if (!room.outline?.length) return true
  const pts = outlinePoints(room)
  return cornersOf(x, y, W, D, rot).every((p) => insideOrEdge(p.x, p.y, pts, 1.5))
}

/** Тело стены или зона проёма под модулем (с учётом высоты Z). */
function wallBodyHit(
  x: number, y: number, W: number, D: number, rot: number,
  z0: number, z1: number,
): boolean {
  const room = state.project.room
  const pts = cornersOf(x, y, W, D, rot)
  for (const w of roomWalls(room)) {
    let sMin = Infinity
    let sMax = -Infinity
    let oMin = Infinity
    let oMax = -Infinity
    for (const p of pts) {
      const s = (p.x - w.a.x) * w.dx + (p.y - w.a.y) * w.dy
      const o = (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny
      sMin = Math.min(sMin, s)
      sMax = Math.max(sMax, s)
      oMin = Math.min(oMin, o)
      oMax = Math.max(oMax, o)
    }
    if (sMax <= 0.5 || sMin >= w.len - 0.5) continue
    // тело стены: [ -t, 0 ] вдоль нормали
    if (oMin < -0.5 && oMax > -w.t + 0.5) return true
    for (const o of room.openings ?? []) {
      if (o.wall !== w.index) continue
      const oz0 = Math.max(0, o.z0)
      const oz1 = Math.max(oz0, o.z1)
      if (z1 <= oz0 + 20 || z0 >= oz1 - 20) continue
      const ox0 = Math.max(0, o.x)
      const ox1 = ox0 + Math.max(0, o.w)
      if (sMax <= ox0 + 0.5 || sMin >= ox1 - 0.5) continue
      // дверь требует свободной зоны с обеих сторон, окно — только у стены
      const reach = o.kind === 'door' ? 420 : 80
      if (oMax > -w.t - 60 && oMin < reach) return true
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
  const [z0, z1] = zSpan(inst)
  if (wallBodyHit(x, y, W, D, rot, z0, z1)) return true
  const flat = footprintOf(x, y, W, D, rot)
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
  const step = 25
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
  const SNAP = 60
  const others = state.project.instances
    .filter((i) => i.id !== inst.id)
    .map(footprint)

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
  for (let y = b.maxY - D; y >= b.minY; y -= 25) {
    for (let x = b.minX + 25; x <= b.maxX - W - 25; x += 25) {
      if (!roomContains(x, y, W, D, 0)) continue
      if (wallBodyHit(x, y, W, D, 0, span[0], span[1])) continue
      const box: Box3 = { x, y, w: W, d: D, z0: span[0], z1: span[1] }
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
  const snapped = snapPlacement(inst, src.x + W, src.y, false)
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

/** Предмет на стене не входит в проём и не прячется за модулем. */
function wallItemBlocked(
  item: WallItem, x: number, z: number,
): boolean {
  const room = state.project.room
  const walls = roomWalls(room)
  const seg = walls.find((w) => w.index === item.wall)
  if (!seg) return true
  const w = Number(item.w) || 0
  const h = Number(item.h) || 0
  if (x < -0.5 || x + w > seg.len + 0.5 || z < -0.5) return true
  for (const o of room.openings ?? []) {
    if (o.wall !== seg.index) continue
    const ox1 = Number(o.x) + Number(o.w)
    if (x + w > Number(o.x) + 0.5 && x < ox1 - 0.5
      && z + h > Number(o.z0) + 0.5 && z < Number(o.z1) - 0.5) return true
  }
  for (const inst of state.project.instances) {
    const pts = cornersOf(
      inst.x, inst.y, inst.params.W, inst.params.D, inst.rot,
    )
    let s0 = Infinity
    let s1 = -Infinity
    for (const p of pts) {
      const s = (p.x - seg.a.x) * seg.dx + (p.y - seg.a.y) * seg.dy
      s0 = Math.min(s0, s)
      s1 = Math.max(s1, s)
    }
    const [iz0, iz1] = zSpan(inst)
    if (x + w > s0 + 0.5 && x < s1 - 0.5
      && z + h > iz0 + 0.5 && z < iz1 - 0.5) return true
  }
  return false
}

/** Перетаскивание предмета по развёртке: с проверкой проёма и модулей. */
export function moveWallItem(id: string, x: number, z: number): void {
  const room = state.project.room
  const item = (room.wallItems ?? []).find((w) => w.id === id)
  if (!item) return
  const px = Number(item.x) || 0
  const pz = Number(item.z) || 0
  for (const [nx, nz] of [[x, z], [x, pz], [px, z]]) {
    if (wallItemBlocked(item, nx, nz)) continue
    updateWallItem(id, { x: Math.round(nx), z: Math.round(nz) }, false)
    return
  }
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

  let rows: { id: string }[] = []
  try {
    rows = await apiListProjects()
  } catch {
    rows = []
  }

  let cached: Record<string, SolveResponse> | null = null
  let pid = saved && rows.some((r) => r.id === saved) ? saved : rows[0]?.id
  if (!pid) {
    state.project = defaultProject()
    state.projectId = `p${Date.now().toString(36)}`
    state.selection = null
    state.selected = []
    state.openingId = null
    state.folderId = null
    state.roomSelected = true
    state.wallIndex = null
    try {
      localStorage.setItem('furniture.project', state.projectId)
    } catch {
      /* ignore */
    }
    await saveProject()
  } else {
    state.projectId = pid
    try {
      const raw = await apiGetProject(pid) as Record<string, unknown>
      const maybeCache = raw._solutions
      if (maybeCache && typeof maybeCache === 'object') {
        const c = maybeCache as Record<string, SolveResponse>
        if (cacheIsFresh(c)) cached = c
      }
      state.project = normalizeProject(raw)
    } catch {
      state.project = defaultProject()
      state.projectId = `p${Date.now().toString(36)}`
      await saveProject()
    }
    try {
      localStorage.setItem('furniture.project', state.projectId)
    } catch {
      /* ignore */
    }
  }

  state.dirty = false
  state.saveState = 'saved'
  state.selection = state.project.instances[0]?.id ?? null
  state.selected = state.selection ? [state.selection] : []
  if (ui.onlyRoom && state.selection) {
    const f = state.project.folders.find((x) => x.ids.includes(state.selection!))
    if (f) state.folderId = f.id
  }
  state.wallMode = state.project.wallMode ?? 'cutaway'
  state.fitToken++

  for (const key of Object.keys(derived)) delete derived[key]
  if (cached) {
    for (const [id, res] of Object.entries(cached)) {
      if (state.project.instances.some((i) => i.id === id)) {
        derived[id] = res
      }
    }
    applyLegacyOpenFlags()
    touch()
    // Если кэш неполный — досчитаем только недостающие модули.
    for (const inst of state.project.instances) {
      if (!derived[inst.id]) void solveOne(inst)
    }
  } else {
    // Не блокируем вход в проект: 3D и карточки дорисуются по мере solve.
    void solveInitial().then(applyLegacyOpenFlags)
    touch()
  }
  scheduleLayoutCheck(700)
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

export async function openProject(
  id: string,
  skipFlush = false,
  reuseDerived = false,
): Promise<void> {
  if (!skipFlush && !(await flushSave())) {
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
  if (reuseDerived) {
    for (const inst of state.project.instances) {
      if (!derived[inst.id]) void solveOne(inst)
    }
    applyLegacyOpenFlags()
    touch()
  } else {
    for (const key of Object.keys(derived)) delete derived[key]
    await solveInitial()
    applyLegacyOpenFlags()
    touch()
  }
  scheduleLayoutCheck(500)
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
