<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  beginDrag,
  clearSelection,
  createFolder,
  derived,
  moveProp,
  moveSelection,
  notify,
  openObjectModal,
  partIsOpen,
  partSelection,
  select,
  selectQuiet,
  selectOpening,
  selectFolder,
  selectPart,
  selectProp,
  selectWall,
  selectWallItem,
  setViewMode,
  solveAll,
  solveVisible,
  state,
  togglePart,
  toggleSelection,
  ui,
} from '../state/project'
import PlanView from './PlanView.vue'
import CameraPad from './CameraPad.vue'
import { moduleInfo, relationsFor } from '../module/info'
import { outlinePoints, roomWalls } from '../render25d/room'
import { footprintOf } from '../state/geometry'
import DimOverlay from './DimOverlay.vue'
import {
  DIM_D, DIM_H, DIM_OUT_OBJ, DIM_OUT_WALL, DIM_POS, DIM_REL, DIM_W,
} from '../dims/colors'
import type { DimLine, EdgeSpec } from '../dims/types'
import { outerDims } from '../dims/outer'

const canvasEl = ref<HTMLCanvasElement | null>(null)
let renderer: import('../render3d/babylonScene').BabylonRenderer | null = null
let ro: ResizeObserver | null = null

const viewName = ref('iso')
// Прогулка оставлена в коде как задел (см. docs/39-walk-disabled.md),
// но в интерфейсе выключена. Свободный полёт удалён.
const walkEnabled = false
const camMode = ref<'orbit' | 'first' | 'fly'>('orbit')
const fitTarget = ref<'module' | 'room'>('room')
const planOpen = ref(false)
const pointerLocked = ref(false)
const camToast = ref('')
let camToastTimer = 0
const camModeIcon: Record<'orbit' | 'first' | 'fly', string> = {
  orbit: '◉', first: '⌖', fly: '✈',
}
const walker = ref<{ x: number; y: number; yaw: number; eye: number } | null>(null)
const rendererRoom = ref('')
type WalkTarget = {
  kind: 'seat' | 'bed' | 'lamp' | 'sink' | 'switch' | 'stove'
  id: string
  label: string
  x: number
  y: number
  z: number
  yaw: number
  eye: number
}
const walkTarget = ref<WalkTarget | null>(null)
const seated = ref(false)
const roomLightOn = ref(true)
const orbitPivot = ref<'room' | 'object'>('room')
const blueprintView = ref<'iso' | 'front' | 'side' | 'top'>('iso')
const blueprintPivot = ref<'room' | 'object'>('room')
const isBlueprint = computed(() => state.viewMode === 'blueprint')
const viewMore = computed({
  get: () => ui.viewSheetOpen,
  set: (v: boolean) => { ui.viewSheetOpen = v },
})
let cameraApplied = false

const touchQuery = window.matchMedia('(pointer: coarse)')
const building = ref(true)
const isTouch = ref(touchQuery.matches)
function onTouchChange(e: MediaQueryListEvent): void {
  isTouch.value = e.matches
}

const padMove = ref({ x: 0, y: 0 })
const padZ = ref(0)
const moveKeys = new Set<string>()
const moveSpeedBoost = ref(false)
const keyVec = ref({ x: 0, y: 0, z: 0 })

function syncKeyVec(): void {
  keyVec.value = {
    x: (moveKeys.has('d') ? 1 : 0) - (moveKeys.has('a') ? 1 : 0),
    y: (moveKeys.has('w') ? 1 : 0) - (moveKeys.has('s') ? 1 : 0),
    z: (moveKeys.has('e') ? 1 : 0) - (moveKeys.has('q') ? 1 : 0),
  }
}
let moveLast = 0

const camModeLabel = computed(() => {
  if (camMode.value === 'orbit') return 'Обзор'
  return camMode.value === 'first' ? 'Прогулка' : 'Полёт'
})

const camModeHint = computed(() => {
  if (camMode.value === 'orbit') {
    return 'Обзор: вращайте сцену, джойстик/WASD сдвигают вид, Q/E меняют высоту'
  }
  if (camMode.value === 'first') {
    return 'Прогулка: WASD — идти, мышь — обзор (клик по сцене), Space — прыжок, E — сесть/свет/вода'
  }
  return 'Полёт: WASD — лететь, Q/E — вниз/вверх, мышь — обзор (клик по сцене)'
})

const showPad = computed(
  () => isTouch.value || camMode.value !== 'orbit',
)

const currentRoomIds = computed<Set<string> | null>(() => {
  if (!ui.onlyRoom) return null
  const f = state.project.folders.find((x) => x.id === state.folderId)
  return f && f.ids.length ? new Set(f.ids) : null
})

type Area = { x: number; y: number; w: number; d: number }

/** Куда смотреть при входе: направление с самым длинным свободным лучом. */
function bestYaw(x: number, y: number, a: Area): number {
  const objs = walkObstacles()
  const blocked = (px: number, py: number) =>
    px < a.x + 200 || px > a.x + a.w - 200 ||
    py < a.y + 200 || py > a.y + a.d - 200 ||
    objs.some((o) =>
      px > o.x - 200 && px < o.x + o.w + 200 &&
      py > o.y - 200 && py < o.y + o.d + 200)
  let best = 0
  let bestFree = -1
  for (let deg = 0; deg < 360; deg += 45) {
    const rad = (deg * Math.PI) / 180
    let dist = 0
    for (let step = 200; step <= 3600; step += 200) {
      if (blocked(x + Math.sin(rad) * step, y + Math.cos(rad) * step)) break
      dist = step
    }
    if (dist > bestFree) {
      bestFree = dist
      best = deg
    }
  }
  return best
}

function inArea(x: number, y: number, a: Area): boolean {
  return x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.d
}

function folderAt(x: number, y: number) {
  return state.project.folders.find((f) => f.area && inArea(x, y, f.area))
}

/** Габарит повёрнутого модуля/декора в плане (AABB), мм. */
function aabbOf(
  x: number, y: number, W: number, D: number, rot: number,
): Area {
  const a = ((rot || 0) * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lx, ly] of [[0, 0], [W, 0], [W, D], [0, D]]) {
    const wx = x + lx * cs - ly * sn
    const wy = y + lx * sn + ly * cs
    minX = Math.min(minX, wx)
    maxX = Math.max(maxX, wx)
    minY = Math.min(minY, wy)
    maxY = Math.max(maxY, wy)
  }
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY }
}

/** Габарит повёрнутого прямоугольника, заданного центром (декор). */
function aabbCentered(
  cx: number, cy: number, W: number, D: number, rot: number,
): Area {
  const a = ((rot || 0) * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lx, ly] of [
    [-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2],
  ]) {
    const wx = cx + lx * cs - ly * sn
    const wy = cy + lx * sn + ly * cs
    minX = Math.min(minX, wx)
    maxX = Math.max(maxX, wx)
    minY = Math.min(minY, wy)
    maxY = Math.max(maxY, wy)
  }
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY }
}

/** Минимальный зазор до мебели/стен в точке (мм). */
function clearanceAt(x: number, y: number, a: Area): number {
  const objs = walkObstacles()
  let d = Math.min(
    x - (a.x + 200), (a.x + a.w - 200) - x,
    y - (a.y + 200), (a.y + a.d - 200) - y,
  )
  for (const o of objs) d = Math.min(d, rectClear(x, y, o))
  return d
}

/** Общий контур квартиры по комнатам-папкам (мм). */
function walkBounds(): Area | null {
  const areas = state.project.folders
    .map((f) => f.area)
    .filter((a): a is Area => !!a)
  if (!areas.length) {
    return {
      x: 0, y: 0,
      w: state.project.room.w, d: state.project.room.d,
    }
  }
  const minX = Math.min(...areas.map((a) => a.x))
  const minY = Math.min(...areas.map((a) => a.y))
  const maxX = Math.max(...areas.map((a) => a.x + a.w))
  const maxY = Math.max(...areas.map((a) => a.y + a.d))
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY }
}

function walkObstacles(): Area[] {
  const out: Area[] = []
  for (const i of state.project.instances) {
    // Навесные шкафы тоже мешают на высоте глаз (низ 1450 мм),
    // поэтому в прогулке они — полноценное препятствие.
    const d = derived[i.id]
    const W = d?.corpus.W ?? i.params.W
    const D = d?.corpus.D ?? i.params.D
    out.push(aabbOf(i.x, i.y, W, D, i.rot))
  }
  for (const pr of state.project.props ?? []) {
    // Ковёр/дорожка — покрытие пола, по ним ходят.
    if ((pr.h ?? 0) < 200) continue
    out.push(aabbCentered(pr.x, pr.y, pr.w, pr.d, pr.rot || 0))
  }
  return out
}

let walkSig = ''

/** Зазор от точки до прямоугольника (0 внутри), мм. */
function rectClear(x: number, y: number, o: Area): number {
  const dx = Math.max(o.x - x, 0, x - (o.x + o.w))
  const dy = Math.max(o.y - y, 0, y - (o.y + o.d))
  return Math.hypot(dx, dy)
}

/**
 * Свободная точка в комнате: не в мебели и с запасом от неё,
 * ближе к центру. Иначе камера упирается в первый попавшийся шкаф.
 */
function freeSpotIn(a: Area): { x: number; y: number } | null {
  const objs = walkObstacles()
  const margin = 300
  const comfort = 450
  let best: { x: number; y: number } | null = null
  let bestScore = -Infinity
  let fallback: { x: number; y: number; clearance: number } | null = null
  const cx = a.x + a.w / 2
  const cy = a.y + a.d / 2
  for (let y = a.y + margin; y <= a.y + a.d - margin; y += 150) {
    for (let x = a.x + margin; x <= a.x + a.w - margin; x += 150) {
      const clearance = objs.length
        ? Math.min(...objs.map((o) => rectClear(x, y, o)))
        : Infinity
      if (clearance < comfort) {
        if (!fallback || clearance > fallback.clearance) {
          fallback = { x, y, clearance }
        }
        continue
      }
      // Максимум свободного места, слегка тянемся к центру комнаты.
      const score = Math.min(clearance, 1400)
        - 0.06 * Math.hypot(x - cx, y - cy)
      if (score > bestScore) {
        bestScore = score
        best = { x, y }
      }
    }
  }
  if (best) return best
  if (fallback && fallback.clearance >= 220) {
    return { x: fallback.x, y: fallback.y }
  }
  return null
}

/** Комната под камерой (или выбранная) + препятствия для прогулки. */
function refreshWalkArea(force = false): void {
  if (!renderer) return
  const wp = renderer.walkerPosition()
  const walking = camMode.value !== 'orbit' && wp
  const x = walking ? wp!.x : state.project.room.w / 2
  const y = walking ? wp!.y : state.project.room.d / 2
  const f = (walking ? folderAt(x, y) : null)
    ?? state.project.folders.find((q) => q.id === state.folderId && q.area)
    ?? null
  // Граница прогулки — вся квартира, а не текущая комната: иначе камера
  // упирается в прямоугольник комнаты и не проходит в открытую дверь.
  const rect = walkBounds()
  const name = f?.name ?? ''
  const objs = walkObstacles()
  const sig = `${rect ? rect.x + ',' + rect.y + ',' + rect.w + ',' + rect.d : '-'}|${name}|` +
    objs.map((o) => `${o.x},${o.y},${o.w},${o.d}`).join(';')
  if (!force && sig === walkSig) return
  walkSig = sig
  renderer.setWalkArea(rect, objs, name)
}

const SEAT_TYPES = new Set(['chair', 'armchair', 'sofa', 'bed'])

/** Ближайшее сиденье/интерактивный предмет для подсказки и клавиши E. */
function findWalkTarget(wp: { x: number; y: number } | null): WalkTarget | null {
  if (!wp) return null
  let best: WalkTarget | null = null
  let bestD = Infinity
  const consider = (t: WalkTarget, radius: number) => {
    const d = Math.hypot(t.x - wp.x, t.y - wp.y)
    if (d > radius || d >= bestD) return
    bestD = d
    best = t
  }
  const a = folderAt(wp.x, wp.y)?.area
  const faceYaw = (x: number, y: number): number => {
    if (!a) return 0
    return (Math.atan2(a.x + a.w / 2 - x, a.y + a.d / 2 - y) * 180) / Math.PI
  }
  for (const pr of state.project.props ?? []) {
    if (SEAT_TYPES.has(pr.type)) {
      const bed = pr.type === 'bed'
      consider({
        kind: bed ? 'bed' : 'seat',
        id: pr.id,
        label: bed ? 'Лечь' : 'Сесть',
        x: pr.x,
        y: pr.y,
        z: pr.h,
        yaw: bed ? (pr.rot || 0) : faceYaw(pr.x, pr.y),
        eye: bed ? Math.max(0.55, (pr.h / 1000) * 0.72) : 1.14,
      }, 1500)
    } else if (pr.type === 'lamp') {
      consider({
        kind: 'lamp', id: pr.id,
        label: renderer?.isLampOn(pr.id) ? 'Выключить светильник' : 'Включить светильник',
        x: pr.x, y: pr.y, z: pr.h * 0.88, yaw: 0, eye: 1.6,
      }, 2000)
    } else if (pr.type === 'sink') {
      consider({
        kind: 'sink', id: pr.id,
        label: renderer?.isSinkOn(pr.id) ? 'Закрыть воду' : 'Открыть воду',
        x: pr.x, y: pr.y, z: pr.h * 0.9, yaw: 0, eye: 1.6,
      }, 2000)
    } else if (pr.type === 'stove') {
      consider({
        kind: 'stove', id: pr.id,
        label: 'Плита: включить/выключить',
        x: pr.x, y: pr.y, z: pr.h, yaw: 0, eye: 1.6,
      }, 2000)
    }
  }
  // Мойка в составе кухни — тоже интерактивная (кран).
  for (const inst of state.project.instances) {
    if (!/мойк|sink/i.test(inst.name)) continue
    const d = derived[inst.id]
    if (!d) continue
    const w = d.corpus.W
    const dep = d.corpus.D
    const c = toWorld(inst, w / 2, dep / 2, 0)
    consider({
      kind: 'sink', id: `inst:${inst.id}`,
      label: renderer?.isSinkOn(`inst:${inst.id}`) ? 'Закрыть воду' : 'Открыть воду',
      x: c.x, y: c.y, z: d.corpus.H + 120, yaw: 0, eye: 1.6,
    }, 2200)
  }
  // Выключатели на стенах.
  const walls = roomWalls(state.project.room)
  for (const item of state.project.room.wallItems ?? []) {
    if (item.kind !== 'switch') continue
    const seg = walls.find((w) => w.index === item.wall)
    if (!seg) continue
    const s = item.x + item.w / 2
    const x = seg.a.x + seg.dx * s + seg.nx * (item.depth / 2)
    const y = seg.a.y + seg.dy * s + seg.ny * (item.depth / 2)
    consider({
      kind: 'switch', id: item.id,
      label: roomLightOn.value ? 'Выключить свет' : 'Включить свет',
      x, y, z: item.z + item.h / 2, yaw: 0, eye: 1.6,
    }, 2200)
  }
  return best
}

function updateWalkHud(): void {
  if (!renderer) return
  const wp = renderer.walkerPosition()
  walker.value = wp
  rendererRoom.value = renderer.currentRoomName()
  seated.value = renderer.isSeated()
  roomLightOn.value = renderer.roomLightIsOn()
  walkTarget.value = camMode.value === 'first' && !seated.value
    ? findWalkTarget(wp)
    : null
}

function interactWalk(): void {
  if (!renderer) return
  if (renderer.isSeated()) {
    renderer.standUp()
    seated.value = false
    return
  }
  const t = walkTarget.value
  if (!t) return
  if (t.kind === 'seat' || t.kind === 'bed') {
    renderer.sitAt(t.x, t.y, t.yaw, t.eye, t.id, t.kind)
    seated.value = true
    walkTarget.value = null
    notify(t.kind === 'bed' ? 'Лежим. E или Space — встать' : 'Сидим. E или Space — встать')
    return
  }
  if (t.kind === 'lamp') {
    const on = renderer.toggleLamp(t.id, t.x, t.y, t.z)
    notify(on ? 'Светильник включён' : 'Светильник выключен')
  } else if (t.kind === 'sink') {
    const on = renderer.toggleSink(t.id, t.x, t.y, t.z)
    notify(on ? 'Вода открыта' : 'Вода закрыта')
  } else if (t.kind === 'switch') {
    const on = renderer.toggleRoomLight()
    roomLightOn.value = on
    notify(on ? 'Свет включён' : 'Свет выключен')
  } else if (t.kind === 'stove') {
    const on = renderer.toggleRoomLight()
    notify(on ? 'Плита включена' : 'Плита выключена')
  }
  walkTarget.value = findWalkTarget(walker.value)
}

function applyProjectCamera(): void {
  const cam = state.project.camera3d
  if (!renderer || !cam || cameraApplied) return
  renderer.setOrbit(cam.alpha, cam.beta)
  cameraApplied = true
}
const viewNameLabel = computed(() => {
  const labels: Record<string, string> = {
    iso: 'Изо', front: 'Фасад', side: 'Бок', top: 'Сверху',
  }
  return labels[viewName.value] ?? 'Вид'
})
const selHull = ref<{ x: number; y: number }[]>([])
const dimLines = ref<DimLine[]>([])
const partPill = ref<{ id: string; part: number } | null>(null)
const pillPos = ref({ x: 0, y: 0 })
let dimRaf = 0
let dimLast = 0
let walkLast = 0
let selSig = ''
let partSig = ''

// --- производительность (FPS/память) -------------------------------------
const perfOn = (() => {
  try {
    return new URLSearchParams(window.location.search).get('perf') === '1'
  } catch {
    return false
  }
})()
const perf = ref({ fps: 0, heap: 0, meshes: 0 })
let perfFrames = 0
let perfLast = 0

// Авто-качество: если GPU не тянет, один раз включаем каркас и уменьшаем
// разрешение, а при совсем низком FPS предлагаем 2D-развёртки.
const lowGpu = ref(false)
const suggestDraft = ref(false)
let autoQualityDone = false
let autoSlowWindows = 0
let autoLast = 0
let autoFrames = 0
let autoStart = 0

function sync(): void {
  if (!renderer) return
  renderer.syncRoom(state.project.room, state.project.materials)
  renderer.syncProps(state.project.props ?? [])
  // Режим «только комната» — не строить меши чужих комнат (экономия GPU/RAM).
  const roomIds = currentRoomIds.value
  const instances = roomIds
    ? state.project.instances.filter((i) => roomIds.has(i.id))
    : state.project.instances
  renderer.syncInstances(
    instances,
    derived,
    state.project.materials,
    state.project.materialVars,
    state.rev,
  )
  renderer.setVisibleInstances(currentRoomIds.value)
  renderer.setSelected(state.selected.length ? [...state.selected]
    : state.selection ? [state.selection] : [])
  renderer.setSelectedPart(partSelection.instanceId, partSelection.part)
  renderer.setSelectedProp(state.propId)
  refreshWalkArea(true)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function toWorld(
  inst: { x: number; y: number; z: number; rot: number },
  lx: number,
  ly: number,
  lz: number,
): { x: number; y: number; z: number } {
  const a = (inst.rot * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  return {
    x: inst.x + lx * cs - ly * sn,
    y: inst.y + lx * sn + ly * cs,
    z: (inst.z || 0) + lz,
  }
}

function updateDims(): void {
  if (!renderer || (!ui.dims3d && !ui.dimsOuter && !ui.dimsAll) || !state.selection || state.selected.length > 1) {
    if (dimLines.value.length) dimLines.value = []
    return
  }
  const inst = state.project.instances.find((i) => i.id === state.selection)
  const d = inst ? derived[inst.id] : null
  if (!inst || !d) {
    if (dimLines.value.length) dimLines.value = []
    return
  }
  const info = moduleInfo(inst, d.objects)
  const part =
    partSelection.instanceId === inst.id ? partSelection.part : null
  const el = part != null ? info?.elements[part] : null
  let x0 = 0
  let y0 = 0
  let z0 = 0
  let x1 = d.corpus.W
  let y1 = d.corpus.D
  let z1 = d.corpus.H
  if (el) {
    x0 = el.x
    y0 = el.y
    z0 = el.z
    x1 = el.x + el.w
    y1 = el.y + el.d
    z1 = el.z + el.h
  } else {
    x0 = Infinity
    y0 = Infinity
    z0 = Infinity
    x1 = -Infinity
    y1 = -Infinity
    z1 = -Infinity
    for (const o of d.objects) {
      x0 = Math.min(x0, o.x)
      y0 = Math.min(y0, o.y)
      z0 = Math.min(z0, o.z)
      x1 = Math.max(x1, o.x + o.sx)
      y1 = Math.max(y1, o.y + o.sy)
      z1 = Math.max(z1, o.z + o.sz)
    }
  }
  if (!Number.isFinite(x0)) {
    dimLines.value = []
    return
  }
  const W = x1 - x0
  const D = y1 - y0
  const H = z1 - z0
  const pad = Math.max(45, Math.max(W, D, H) * 0.06)
  const out: typeof dimLines.value = []
  const lerpLocal = (
    a: [number, number, number],
    b: [number, number, number],
    f: number,
  ): [number, number, number] => [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ]
  const add = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    label: string,
    color: string,
    t = 0.5,
    edges: EdgeSpec[] = [],
    hint = '',
  ) => {
    const marker = color === DIM_H ? 'dim-arrow-h'
      : color === DIM_D ? 'dim-arrow-d'
        : color === DIM_POS ? 'dim-arrow-p'
          : color === DIM_REL ? 'dim-arrow-r'
            : color === DIM_OUT_WALL ? 'dim-arrow-wall'
              : color === DIM_OUT_OBJ ? 'dim-arrow-out'
                : 'dim-arrow-w'
    const p1 = renderer!.project(a.x, a.y, a.z)
    const p2 = renderer!.project(b.x, b.y, b.z)
    // Реальные грани деталей: цветные отрезки прямо по рёбрам, а не
    // поперечные засечки. У размера между двумя объектами — две грани.
    const edgePts: [number, number, number, number][] = []
    for (const edge of edges) {
      const f0 = edge.from ?? 0
      const f1 = edge.to ?? Math.min(1, f0 + 1 / 3)
      const ea = lerpLocal(edge.a, edge.b, f0)
      const eb = lerpLocal(edge.a, edge.b, f1)
      const wa = Wp(ea[0], ea[1], ea[2])
      const wb = Wp(eb[0], eb[1], eb[2])
      const pa = renderer!.project(wa.x, wa.y, wa.z)
      const pb = renderer!.project(wb.x, wb.y, wb.z)
      if (Math.hypot(pb.x - pa.x, pb.y - pa.y) >= 5) {
        edgePts.push([pa.x, pa.y, pb.x, pb.y])
      }
    }
    out.push({
      edges: edgePts,
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      tx: p1.x + (p2.x - p1.x) * t,
      ty: p1.y + (p2.y - p1.y) * t - 4,
      label,
      color,
      marker,
      hint,
      labelW: Math.max(36, label.length * 7.8 + 14),
    })
  }
  const Wp = (lx: number, ly: number, lz: number) => toWorld(inst, lx, ly, lz)
  // Кромка объекта на нужной высоте: для размера между полками подсвечиваем
  // обе грани — и выбранную, и соседнюю, к которой размер относится.
  const atZ = (z: number, yRef: number): { x0: number; x1: number } | null => {
    if (!info) return null
    let best: (typeof info.elements)[number] | null = null
    for (const e of info.elements) {
      const dz = Math.min(Math.abs(e.z - z), Math.abs(e.z + e.h - z))
      // Только детали на той же передней плоскости: иначе вторая грань
      // уезжает на заднюю стенку/в глубину модуля.
      if (dz > 1.5 || Math.abs(e.y - yRef) > 40) continue
      if (!best || e.w > best.w) best = e
    }
    return best ? { x0: best.x, x1: best.x + best.w } : null
  }
  const edgeAtZ = (
    z: number,
    fx0: number,
    fx1: number,
    fy: number,
    from = 0.36,
    to = 0.63,
  ): EdgeSpec => {
    const at = atZ(z, fy)
    return {
      a: [at ? at.x0 : fx0, fy, z],
      b: [at ? at.x1 : fx1, fy, z],
      from,
      to,
    }
  }
  if (ui.dims3d) {
  const depthMark = D < 60 ? 'Т' : 'Г'
  // Грань берём на той же плоскости, что и сам размер (передняя грань y0,
  // правое ребро x1), иначе подсветка уезжает на противоположную сторону.
  // Ширина и так очевидна по линии размера — отдельную подсветку грани
  // не рисуем, чтобы не плодить лишние жёлтые полосы на детали.
  add(Wp(x0, y0 - pad, z0), Wp(x1, y0 - pad, z0), `Ш ${Math.round(W)}`, DIM_W, 0.26)
  add(Wp(x1 + pad, y0 - pad, z0), Wp(x1 + pad, y0 - pad, z1), `В ${Math.round(H)}`, DIM_H, 0.5,
    [{ a: [x1, y0, z0], b: [x1, y0, z1], from: 0.36, to: 0.63 }])
  add(Wp(x1 + pad, y0, z0), Wp(x1 + pad, y1, z0), `${depthMark} ${Math.round(D)}`, DIM_D, 0.84,
    [{ a: [x1, y0, z0], b: [x1, y1, z0], from: 0.02, to: 0.33 }])
  // Относительные размеры: высоты полок в выбранном модуле и просветы
  // до соседних полок у выбранной детали — то, что нужно при проектировании.
  if (!ui.dimsAll && info) {
    if (!el) {
      for (const g of info.shelves) {
        if (g.size <= 2) continue
        add(Wp(x0 + 22, y0, g.from), Wp(x0 + 22, y0, g.to),
          `↕ ${Math.round(g.size)}`, DIM_REL, 0.5,
          [
            edgeAtZ(g.from, x0, x1, y0, 0.67, 0.97),
            edgeAtZ(g.to, x0, x1, y0, 0.67, 0.97),
          ])
      }
    } else {
      const rel = relationsFor(info, part)
      if (rel?.above && rel.above.distance > 2 &&
          rel.above.distance < info.totalH - 2) {
        add(Wp(x1 - 18, y0, z1), Wp(x1 - 18, y0, rel.above.to),
          `↕ ${Math.round(rel.above.distance)}`, DIM_REL, 0.5,
          [
            { a: [x0, y0, z1], b: [x1, y0, z1], from: 0.67, to: 0.97 },
            edgeAtZ(rel.above.to, x0, x1, y0, 0.67, 0.97),
          ])
      }
      if (rel?.below && rel.below.distance > 2 &&
          rel.below.distance < info.totalH - 2) {
        add(Wp(x1 - 18, y0, rel.below.from), Wp(x1 - 18, y0, z0),
          `↕ ${Math.round(rel.below.distance)}`, DIM_REL, 0.5,
          [
            { a: [x0, y0, z0], b: [x1, y0, z0], from: 0.67, to: 0.97 },
            edgeAtZ(rel.below.from, x0, x1, y0, 0.67, 0.97),
          ])
      }
    }
  }
  // Абсолютные размеры от краёв плиты (только для выбранной детали):
  // сколько до левого/правого края корпуса и до низа/верха.
  if (el && info) {
    const abs = relationsFor(info, part)
    if (abs) {
      const gap = Math.max(28, Math.min(60, W * 0.12))
      // Абсолютные ↓/↑ ведут к левому углу корпуса: подсветка начинается
      // ровно под линией стрелки и идёт вправо по грани дна/крыши.
      const absX = el.x - gap * 0.45
      const absLen = Math.min(140, Math.max(60, info.W * 0.3))
      if (abs.toLeft > 30) {
        add(Wp(0, y0 - gap * 0.45, z0 - gap * 0.3),
          Wp(el.x, y0 - gap * 0.45, z0 - gap * 0.3), `← ${Math.round(abs.toLeft)}`, DIM_POS, 0.5,
          [{ a: [el.x, y0, z0], b: [el.x, y0, z1], from: 0.36, to: 0.63 }])
      }
      if (abs.toRight > 30) {
        add(Wp(el.x + el.w, y0 - gap * 0.45, z0 - gap * 0.3),
          Wp(info.W, y0 - gap * 0.45, z0 - gap * 0.3), `→ ${Math.round(abs.toRight)}`, DIM_POS, 0.5,
          [{ a: [el.x + el.w, y0, z0], b: [el.x + el.w, y0, z1], from: 0.05, to: 0.32 }])
      }
      if (abs.toBottom > 2) {
        add(Wp(el.x - gap * 0.45, y0 - gap * 0.2, 0),
          Wp(el.x - gap * 0.45, y0 - gap * 0.2, el.z), `↓ ${Math.round(abs.toBottom)}`, DIM_POS, 0.5,
          [{ a: [absX, y0, 0], b: [absX + absLen, y0, 0], from: 0, to: 1 }])
      }
      if (abs.toTop > 2) {
        add(Wp(el.x - gap * 0.45, y0 - gap * 0.2, el.z),
          Wp(el.x - gap * 0.45, y0 - gap * 0.2, info.totalH), `↑ ${Math.round(abs.toTop)}`, DIM_POS, 0.5,
          [{ a: [absX, y0, info.totalH], b: [absX + absLen, y0, info.totalH], from: 0, to: 1 }])
      }
    }
  }
  }
  // Все зазоры модуля: между всеми полками и ящиками, а не только у
  // выбранной детали. Абсолютные размеры при этом остаются только у детали.
  if (ui.dimsAll && info) {
    const Wmod = d.corpus.W
    const yMod = 0
    for (const g of info.shelves) {
      if (g.size <= 2) continue
      add(Wp(Wmod - 18, yMod, g.from), Wp(Wmod - 18, yMod, g.to),
        `↕ ${Math.round(g.size)}`, DIM_REL, 0.5,
        [
          edgeAtZ(g.from, 0, Wmod, yMod, 0.67, 0.97),
          edgeAtZ(g.to, 0, Wmod, yMod, 0.67, 0.97),
        ])
    }
    const fronts = info.elements
      .filter((e) => e.kind === 'drawerfront')
      .sort((a, b) => a.z - b.z)
    for (let i = 0; i < fronts.length - 1; i++) {
      const lower = fronts[i]
      const upper = fronts[i + 1]
      const gap = upper.z - (lower.z + lower.h)
      if (gap <= 2) continue
      add(Wp(Wmod - 18, yMod, lower.z + lower.h),
        Wp(Wmod - 18, yMod, upper.z),
        `↕ ${Math.round(gap)}`, DIM_REL, 0.5,
        [
          edgeAtZ(lower.z + lower.h, 0, Wmod, yMod, 0.67, 0.97),
          edgeAtZ(upper.z, 0, Wmod, yMod, 0.67, 0.97),
        ])
    }
  }
  // Снаружи: расстояния от модуля до стен/перегородок и соседних объектов.
  if (ui.dimsOuter) {
    for (const c of outerDims(
      inst,
      state.project.instances,
      derived,
      state.project.room,
    )) {
      if (!Number.isFinite(c.gap) || c.gap <= 2) continue
      add(c.a, c.b, c.label, c.color, 0.5, [], c.hint)
    }
  }
  // Подписи близких размеров не должны наезжать друг на друга.
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      const half = (out[i].labelW + out[j].labelW) / 2 + 4
      if (Math.abs(out[i].tx - out[j].tx) < half &&
          Math.abs(out[i].ty - out[j].ty) < 26) {
        out[i].tx += out[i].tx >= out[j].tx ? half * 0.6 : -half * 0.6
        out[i].ty += i % 2 ? 26 : -26
      }
    }
  }
  dimLines.value = out
}

function updatePartPill(): void {
  if (!partPill.value || !renderer || !canvasEl.value) return
  const inst = state.project.instances.find((i) => i.id === partPill.value!.id)
  const o = inst ? derived[inst.id]?.objects[partPill.value.part] : null
  if (!inst || !o) {
    partPill.value = null
    return
  }
  const p = renderer.project(
    toWorld(inst, o.x + o.sx / 2, o.y + o.sy / 2, o.z + o.sz / 2).x,
    toWorld(inst, o.x + o.sx / 2, o.y + o.sy / 2, o.z + o.sz / 2).y,
    toWorld(inst, o.x + o.sx / 2, o.y + o.sy / 2, o.z + o.sz / 2).z,
  )
  const rect = canvasEl.value.getBoundingClientRect()
  pillPos.value = {
    x: clamp(p.x, 10, Math.max(10, rect.width - 34)),
    y: clamp(p.y - 30, 10, Math.max(10, rect.height - 34)),
  }
}

/** Контур выбора: проекция самого объекта (выпуклая оболочка), а не
 *  прямоугольник вокруг него — обводка идёт строго по выбранной детали. */
function selectionHull(): { x: number; y: number }[] {
  const pts = renderer?.selectionScreenHull() ?? []
  if (pts.length < 3) return pts
  // Отодвигаем пунктир наружу от детали: иначе он ложится прямо на
  // цветные подсветки рёбер и перекрывает их.
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const pad = 7
  return pts.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad }
  })
}

function controlLoop(t: number): void {
  const dt = moveLast ? Math.min(0.08, (t - moveLast) / 1000) : 0
  moveLast = t
  applyMovement(dt)
  if (t - dimLast > 33) {
    dimLast = t
    updateDims()
    updatePartPill()
    if (renderer) {
      // Страховка: состояние выбора могло обновиться до того, как watcher
      // увидел renderer. Синхронизируем только при изменении.
      const ids = state.selected.length ? [...state.selected]
        : state.selection ? [state.selection] : []
      const sig = `${state.wallIndex}|${state.wallItemId}|${state.openingId}|${ids.join(',')}`
      if (sig !== selSig) {
        selSig = sig
        if (state.wallIndex != null) {
          renderer.setSelectedWall(state.wallIndex, state.wallItemId)
        } else if (state.openingId) {
          renderer.setSelectedOpening(state.openingId)
        } else {
          renderer.setSelected(ids)
        }
      }
      const psig = `${partSelection.instanceId ?? ''}:${partSelection.part ?? ''}`
      if (psig !== partSig) {
        partSig = psig
        renderer.setSelectedPart(partSelection.instanceId, partSelection.part)
      }
      renderer.refreshSelectionGlow()
      selHull.value = selectionHull()
    }
    // Комнаты меняются редко: пересчёт раз в ~0.4 с достаточен.
    if (t - walkLast > 400) {
      walkLast = t
      refreshWalkArea()
      updateWalkHud()
    }
  }
  // --- авто-качество (всегда, не только при ?perf=1) ---
  if (document.hidden) {
    // в фоне rAF стоит: не считаем это «медленным GPU»
    autoFrames = 0
    autoLast = t
  }
  if (!autoStart) autoStart = t
  // Первые 4 с — прогрев (загрузка, solve, текстуры): не считаем их тормозами.
  if (t - autoStart < 4000) {
    autoFrames = 0
    autoLast = t
  } else {
    autoFrames++
  }
  if (!autoLast) autoLast = t
  if (t - autoLast >= 2000 && renderer && !state.presentation &&
      state.viewMode !== 'blueprint' &&
      document.visibilityState === 'visible' && t - autoStart >= 4000) {
    const fps = (autoFrames * 1000) / (t - autoLast)
    autoFrames = 0
    autoLast = t
    if (fps < 24) {
      autoSlowWindows++
      if (!autoQualityDone) {
        autoQualityDone = true
        lowGpu.value = true
        if (state.viewMode !== 'schematic') setViewMode('schematic')
        renderer.setQuality('schematic')
        renderer.setPerformance(true)
      } else if (autoSlowWindows >= 3 && fps < 16) {
        suggestDraft.value = true
      }
    } else if (fps >= 45) {
      autoSlowWindows = 0
    }
  }
  if (perfOn) {
    perfFrames++
    if (!perfLast) perfLast = t
    if (t - perfLast >= 1000) {
      const heap = (performance as Performance & {
        memory?: { usedJSHeapSize: number }
      }).memory?.usedJSHeapSize ?? 0
      const stats = renderer?.perfStats()
      perf.value = {
        fps: Math.round((perfFrames * 1000) / (t - perfLast)),
        heap: Math.round(heap / 1048576),
        meshes: renderer?.meshCount() ?? 0,
        ...stats,
        quality: state.viewMode,
        lowGpu: lowGpu.value,
      }
      ;(window as unknown as Record<string, unknown>).__furniturePerf = perf.value
      perfFrames = 0
      perfLast = t
    }
  }
  dimRaf = requestAnimationFrame(controlLoop)
}

function fit(target: 'module' | 'room' = fitTarget.value): void {
  fitTarget.value = target
  renderer?.fit(target, state.project.room, state.selection)
}

function centerRoom(): void {
  camMode.value = 'orbit'
  renderer?.setMode('orbit')
  renderer?.center(state.project.room)
}

/** Ось обзора: центр выбранной комнаты (папки) или всей квартиры. */
function pivotRoom(): void {
  orbitPivot.value = 'room'
  camMode.value = 'orbit'
  exitLook()
  renderer?.setMode('orbit')
  const f = state.project.folders.find((q) => q.id === state.folderId && q.area)
  if (f?.area) renderer?.setPivotArea(f.area)
  else renderer?.setPivotRoom(state.project.room)
  announceCam('orbit')
}

/** Поставить ось обзора на модуль: по мешам, иначе по его габаритам. */
function pivotToInstance(id: string): boolean {
  if (!renderer) return false
  if (renderer.setPivotObject(id)) return true
  const inst = state.project.instances.find((i) => i.id === id)
  const d = inst ? derived[inst.id] : null
  if (!inst || !d) return false
  const c = toWorld(inst, d.corpus.W / 2, d.corpus.D / 2, d.corpus.H / 2)
  renderer.setOrbitTarget(c.x, c.y, c.z)
  return true
}

/** Ось обзора: центр выбранного объекта мебели. */
function pivotObject(): void {
  const id = state.selection ?? state.selected[0]
  if (!id || !renderer) return
  camMode.value = 'orbit'
  exitLook()
  renderer.setMode('orbit')
  if (pivotToInstance(id)) {
    orbitPivot.value = 'object'
    announceCam('orbit')
  }
}

function cyclePivot(): void {
  if (orbitPivot.value === 'room' && (state.selection || state.selected.length)) {
    pivotObject()
  } else {
    pivotRoom()
  }
}

function setView(name: 'iso' | 'front' | 'side' | 'top'): void {
  if (isBlueprint.value) {
    setBlueprintView(name)
    return
  }
  viewName.value = name
  camMode.value = 'orbit'
  renderer?.setMode('orbit')
  renderer?.setView(name)
}

function setProjection(p: 'persp' | 'ortho'): void {
  renderer?.setProjection(p)
}

function setBlueprintView(v: 'iso' | 'front' | 'side' | 'top'): void {
  blueprintView.value = v
  renderer?.setBlueprintView(v)
}

function setBlueprintPivot(v: 'room' | 'object'): void {
  if (v === 'object') {
    const id = state.selection ?? state.selected[0]
    if (id && renderer?.setPivotObject(id)) {
      blueprintPivot.value = 'object'
      return
    }
  }
  blueprintPivot.value = 'room'
  renderer?.setBlueprintPivot('room')
}

function blueprintZoom(f: number): void {
  renderer?.blueprintZoom(f)
}

function announceCam(mode: 'orbit' | 'first' | 'fly'): void {
  const label = mode === 'orbit' ? 'Обзор' : mode === 'first' ? 'Прогулка' : 'Полёт'
  camToast.value = label
  window.clearTimeout(camToastTimer)
  camToastTimer = window.setTimeout(() => { camToast.value = '' }, 1500)
}

function requestLook(): void {
  if (isTouch.value) return
  const c = canvasEl.value
  if (!c || document.pointerLockElement === c) return
  void c.requestPointerLock?.()
}

function exitLook(): void {
  if (document.pointerLockElement) document.exitPointerLock()
}

function setCamMode(mode: 'orbit' | 'first' | 'fly'): void {
  if (!walkEnabled && mode !== 'orbit') return
  if (mode !== 'orbit' && isBlueprint.value) {
    // В чертеже камера фиксированная: выход в прогулку/полёт возвращает
    // обычный вид, иначе «свободная камера» ломает чертёжные ракурсы.
    setViewMode('schematic')
  }
  camMode.value = mode
  renderer?.setMode(mode)
  announceCam(mode)
  viewMore.value = false
  if (mode === 'orbit') exitLook()
  else if (!isTouch.value) requestLook()
  if (mode !== 'orbit' && renderer) {
    // Входим в комнату, а не в центр всей квартиры: прогулка замкнута
    // на помещении, в котором находится камера.
    const wp = renderer.walkerPosition()
    // Вход из обзора — в выбранную комнату; если она не задана,
    // остаёмся в той, где уже стоит камера.
    const f = state.project.folders.find((q) => q.id === state.folderId && q.area)
      ?? (wp ? folderAt(wp.x, wp.y) : null)
    if (f?.area) {
      const a = f.area
      // Встаём там, откуда смотрели в обзоре: позиция камеры орбиты,
      // прижатая к комнате, и взгляд на её цель. Занято — ищем свободное.
      const cam = renderer.orbit.position
      let sx = clamp(cam.x * 1000, a.x + 300, a.x + a.w - 300)
      let sy = clamp(cam.z * 1000, a.y + 300, a.y + a.d - 300)
      if (!renderer.canStandAt(sx, sy) || clearanceAt(sx, sy, a) < 400) {
        const spot = freeSpotIn(a)
        if (spot) {
          sx = spot.x
          sy = spot.y
        }
      }
      const t = renderer.orbit.target
      const dx = t.x * 1000 - sx
      const dy = t.z * 1000 - sy
      const yaw = Math.hypot(dx, dy) > 300
        ? (Math.atan2(dx, dy) * 180) / Math.PI
        : bestYaw(sx, sy, a)
      renderer.placeWalker(sx, sy, yaw)
    }
  }
  refreshWalkArea(true)
  updateWalkHud()
}

function cycleCamMode(): void {
  if (!walkEnabled) return
  const order: Array<'orbit' | 'first' | 'fly'> = ['orbit', 'first', 'fly']
  const i = order.indexOf(camMode.value)
  setCamMode(order[(i + 1) % order.length])
}

function onPadMove(v: { x: number; y: number }): void {
  padMove.value = v
}

function onPadZ(v: number): void {
  padZ.value = v
}

function keyName(e: KeyboardEvent): string {
  const k = e.key.toLowerCase()
  const map: Record<string, string> = {
    ц: 'w', ф: 'a', ы: 's', в: 'd', й: 'q', у: 'e',
  }
  return map[k] ?? k
}

function applyMovement(dt: number): void {
  if (!renderer || state.presentation) return
  // Джойстик: вверх — вперёд (в Canvas Y растёт вниз), вправо — вправо.
  let forward = -padMove.value.y
  let strafe = padMove.value.x
  let vertical = padZ.value
  if (moveKeys.has('w')) forward += 1
  if (moveKeys.has('s')) forward -= 1
  if (moveKeys.has('d')) strafe += 1
  if (moveKeys.has('a')) strafe -= 1
  if (moveKeys.has('e')) vertical += 1
  if (moveKeys.has('q')) vertical -= 1
  forward = Math.max(-1, Math.min(1, forward))
  strafe = Math.max(-1, Math.min(1, strafe))
  vertical = Math.max(-1, Math.min(1, vertical))
  if (!forward && !strafe && !vertical) return
  renderer.moveCamera(forward, strafe, vertical, dt, moveSpeedBoost.value)
}

function planZoom(k: number): void {
  state.cameraPlan.zoom = Math.min(3, Math.max(0.02, state.cameraPlan.zoom * k))
  state.rev++
}

function planFit(): void {
  state.fitToken++
}

function addRoom(): void {
  const n = state.project.folders.length + 1
  createFolder(`Комната ${n}`)
  const f = state.project.folders[state.project.folders.length - 1]
  if (f) selectFolder(f.id)
}

function setWallMode(mode: 'cutaway' | 'all'): void {
  state.wallMode = mode
  renderer?.setWallMode(mode)
  state.rev++
}

function exportPng(): void {
  if (!renderer) return
  const url = renderer.canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'view-3d.png'
  a.click()
}

/* ---------- pointer ---------- */
const activePointers = new Set<number>()

let down: {
  x: number
  y: number
  moved: number
  instanceId?: string
  part?: number
  type: 'instance' | 'wall' | 'opening' | 'wallitem' | 'prop'
  wallIndex?: number
  openingId?: string
  itemId?: string
  propId?: string
  propStart?: { x: number; y: number }
  propGrab?: { x: number; y: number }
  move: boolean
  mod: boolean
  startFloor: { x: number; y: number } | null
  starts: Record<string, { x: number; y: number }>
  dragged: boolean
} | null = null

function canvasPoint(e: PointerEvent): { x: number; y: number } {
  const rect = canvasEl.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onPointerLockChange(): void {
  pointerLocked.value = document.pointerLockElement === canvasEl.value
}

function onLookMove(e: PointerEvent): void {
  if (!pointerLocked.value || !renderer) return
  renderer.look(e.movementX || 0, e.movementY || 0)
}

function onDown(e: PointerEvent): void {
  if (!renderer || !canvasEl.value) return
  renderer.cancelCameraTween()
  if (!canvasEl.value) return
  // В прогулке/полёте мышь смотрит без зажатой кнопки: клик — захват.
  if ((camMode.value === 'first' || camMode.value === 'fly') &&
      e.pointerType !== 'touch') {
    if (!pointerLocked.value) requestLook()
    return
  }
  activePointers.add(e.pointerId)
  // Второй палец — жест камеры, а не перетаскивание модуля.
  if (e.pointerType === 'touch' && activePointers.size > 1) {
    down = null
    renderer.orbit.attachControl(canvasEl.value, true)
    return
  }
  partPill.value = null
  const p = canvasPoint(e)
  const hit = renderer.pick(p.x, p.y)
  const starts: Record<string, { x: number; y: number }> = {}
  const isInstance = hit?.type === 'instance' && !!hit.instanceId
  const isProp = hit?.type === 'prop' && !!hit.propId
  const canDrag = (isInstance || isProp) && ui.dragMove
  const mod = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey
  // Выбор — на отпускании, если это был клик, а не вращение камеры.
  // Исключение — режим «Двигать»: там объект нужен выбранным сразу.
  if (canDrag) {
    if (isProp) selectProp(hit.propId!, false)
    if (isInstance) {
      if (mod) toggleSelection(hit.instanceId!)
      else if (hit.part != null) {
        selectQuiet(hit.instanceId!)
        selectPart(hit.instanceId!, hit.part, false)
      } else select(hit.instanceId!)
      for (const id of state.selected.length ? state.selected : [hit.instanceId!]) {
        const i = state.project.instances.find((x) => x.id === id)
        if (i) starts[id] = { x: i.x, y: i.y }
      }
    }
  }
  const grab = canDrag ? renderer.floorPoint(p.x, p.y) : null
  const prop = isProp
    ? (state.project.props ?? []).find((x) => x.id === hit!.propId)
    : null
  down = {
    x: e.clientX,
    y: e.clientY,
    moved: 0,
    instanceId: hit?.instanceId,
    part: hit?.part,
    type: (hit?.type ?? 'instance') as
      'instance' | 'wall' | 'opening' | 'wallitem' | 'prop',
    wallIndex: hit?.wallIndex,
    openingId: hit?.openingId,
    itemId: hit?.itemId,
    propId: hit?.propId,
    propStart: prop ? { x: prop.x, y: prop.y } : undefined,
    propGrab: grab ?? undefined,
    move: canDrag,
    mod,
    startFloor: grab,
    starts,
    dragged: false,
  }
  if (canDrag) {
    renderer.orbit.detachControl()
  }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!down || !renderer) return
  down.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0)
  if (!down.move || !down.startFloor || down.moved < 4) return
  const p = canvasPoint(e)
  const floor = renderer.floorPoint(p.x, p.y)
  if (!floor) return
  if (!down.dragged) {
    down.dragged = true
    beginDrag()
  }
  if (down.propId && down.propStart && down.propGrab) {
    moveProp(
      down.propId,
      down.propStart.x + (floor.x - down.propGrab.x),
      down.propStart.y + (floor.y - down.propGrab.y),
    )
    return
  }
  moveSelection(floor.x - down.startFloor.x, floor.y - down.startFloor.y, down.starts)
}

function onCanvasWheel(): void {
  renderer?.cancelCameraTween()
}

function onUp(e: PointerEvent): void {
  activePointers.delete(e.pointerId)
  if (!down || !renderer) return
  const wasMove = down.move
  const moved = down.moved
  const d = down
  down = null
  if (wasMove) renderer.orbit.attachControl(canvasEl.value!, true)
  if (moved >= 4) return
  // В режиме «Двигать» выбор уже сделан на pointerdown — второй раз не
  // трогаем его, иначе Ctrl/Alt-группа схлопнется в одиночный выбор.
  if (wasMove) return
  if (d.type === 'wall' && d.wallIndex != null) {
    selectWall(d.wallIndex)
    return
  }
  if (d.type === 'wallitem' && d.wallIndex != null) {
    selectWallItem(d.wallIndex, d.itemId ?? '')
    return
  }
  if (d.type === 'opening' && d.openingId) {
    selectOpening(d.openingId)
    return
  }
  if (d.type === 'prop' && d.propId) {
    selectProp(d.propId, true)
    return
  }
  if (!d.instanceId) {
    clearSelection()
    return
  }
  const inst = state.project.instances.find((i) => i.id === d.instanceId)
  if (!inst) return
  if (d.mod) {
    toggleSelection(d.instanceId)
    return
  }
  // Одиночный выбор: прошлое выделение снимается.
  if (d.part != null) selectQuiet(d.instanceId)
  else select(d.instanceId)
  // Ось обзора и камера — лицом к выбранному объекту.
  camMode.value = 'orbit'
  renderer.setMode('orbit')
  if (pivotToInstance(d.instanceId)) orbitPivot.value = 'object'
  if (!isBlueprint.value) {
    // Если объект уже хорошо виден и вписан — камеру не трогаем: клики по
    // соседним деталям одного модуля не должны сбивать удобный ракурс.
    if (!renderer.isInstanceWellFramed(d.instanceId)) {
      renderer.focusInstance(d.instanceId, 'front', 1, 1)
    }
  } else {
    setBlueprintPivot('object')
  }
  if (d.part != null) {
    const o = derived[inst.id]?.objects[d.part]
    const movable =
      o && (o.kind === 'door' || o.kind === 'drawerfront' || o.kind === 'drawerbox')
    if (movable) {
      // окно настроек модуля не трогаем: только выбор детали + иконка
      selectPart(inst.id, d.part, false)
      partPill.value = { id: inst.id, part: d.part }
      pillPos.value = {
        x: clamp(e.clientX - canvasEl.value!.getBoundingClientRect().left, 10, 900),
        y: clamp(e.clientY - canvasEl.value!.getBoundingClientRect().top - 30, 10, 600),
      }
      updatePartPill()
    } else {
      selectPart(inst.id, d.part, false)
    }
  }
  if (!ui.object.open) openObjectModal('quick')
}

function togglePill(): void {
  if (!partPill.value) return
  togglePart(partPill.value.id, partPill.value.part)
}

const pillOpen = computed(() =>
  partPill.value
    ? (() => {
        const inst = state.project.instances.find(
          (i) => i.id === partPill.value!.id,
        )
        return inst ? partIsOpen(inst, partPill.value.part) : false
      })()
    : false,
)

function onDoubleClick(e: MouseEvent): void {
  if (!renderer || !canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  const hit = renderer.pick(e.clientX - rect.left, e.clientY - rect.top)
  if (!hit?.instanceId) return
  select(hit.instanceId)
  fit('module')
}

function onDrop(e: DragEvent): void {
  if (!renderer || !canvasEl.value) return
  e.preventDefault()
  const raw = e.dataTransfer?.getData('text/plain') ?? ''
  const key = raw.startsWith('preset:') ? raw.slice(7) : ''
  if (!key) return
  const rect = canvasEl.value.getBoundingClientRect()
  const p = renderer.floorPoint(e.clientX - rect.left, e.clientY - rect.top)
  if (!p) return
  void import('../state/project').then((m) => {
    const preset = m.MODULE_PRESETS.find((x) => x.key === key)
    if (!preset) return
    m.addInstance(key, p.x - (preset.params.W ?? 600) / 2, p.y - (preset.params.D ?? 560) / 2)
  })
}

function isTypingOrModal(): boolean {
  const t = document.activeElement as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
    t.tagName === 'TEXTAREA' || t.isContentEditable)) return true
  return ui.addOpen || ui.object.open || ui.settingsOpen || ui.quoteOpen ||
    ui.versionsOpen || ui.moreOpen || ui.projectsOpen || ui.historyOpen ||
    ui.viewSheetOpen || ui.tourOpen
}

function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
    t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  const k = keyName(e)
  moveSpeedBoost.value = e.shiftKey
  if (k === ' ' || e.code === 'Space') {
    if (isTypingOrModal() || camMode.value !== 'first') return
    e.preventDefault()
    if (renderer?.isSeated()) renderer.standUp()
    else renderer?.jump()
    return
  }
  if (k === 'e' && camMode.value === 'first') {
    if (isTypingOrModal()) return
    e.preventDefault()
    interactWalk()
    return
  }
  if (['w', 'a', 's', 'd', 'q', 'e'].includes(k)) {
    if (isTypingOrModal()) return
    // Движение с места сидя — встать.
    if (camMode.value === 'first' && ['w', 'a', 's', 'd'].includes(k) &&
      renderer?.isSeated()) {
      renderer.standUp()
    }
    moveKeys.add(k)
    syncKeyVec()
    e.preventDefault()
    return
  }
  if ((k === 'c' || k === 'с') && walkEnabled) {
    if (isTypingOrModal()) return
    e.preventDefault()
    cycleCamMode()
    return
  }
  if (k === 'f' || k === 'а') fit(fitTarget.value)
  // Esc сначала закрывает модалку (это делает App). Если ничего не открыто —
  // снимаем выделение, но не вместе с закрытием окна.
  else if (k === 'escape' && !e.defaultPrevented && !isTypingOrModal()) clearSelection()
  else if (k === '1') setView('iso')
  else if (k === '2') setView('front')
  else if (k === '3') setView('side')
  else if (k === '4') setView('top')
  else if (k === '0') {
    setView('iso')
    fit('room')
  }
}

function onKeyUp(e: KeyboardEvent): void {
  const k = keyName(e)
  moveKeys.delete(k)
  syncKeyVec()
  moveSpeedBoost.value = e.shiftKey
}

function clearMoveKeys(): void {
  moveKeys.clear()
  syncKeyVec()
  moveSpeedBoost.value = false
}

watch(() => state.rev, sync)
watch(() => ui.facades, () => renderer?.markAnimDirty())
watch(() => [ui.dims3d, ui.dimsOuter, ui.dimsAll] as const, () => renderer?.refreshSelectionBox())
watch(() => state.project.materials, sync, { deep: true })
watch(() => state.project.props, sync, { deep: true })
watch(
  () => [state.selected, state.selection, state.wallIndex,
    state.wallItemId, state.openingId] as const,
  () => {
    if (!renderer) return
    if (state.wallIndex != null) {
      renderer.setSelectedWall(state.wallIndex, state.wallItemId)
    } else if (state.openingId) {
      renderer.setSelectedOpening(state.openingId)
    } else {
      renderer.setSelected(state.selected.length ? [...state.selected]
        : state.selection ? [state.selection] : [])
    }
    if (isBlueprint.value && blueprintPivot.value === 'object') {
      renderer.setBlueprintPivot('object')
    }
  },
  { deep: true },
)
watch(() => state.fitToken, () => fit(fitTarget.value))
watch(
  () => state.focusToken,
  () => {
    if (state.focusInstanceId) {
      renderer?.focusInstance(
        state.focusInstanceId,
        state.focusView,
        state.focusLeft,
        state.focusBottom,
      )
    } else if (state.focusPropId) {
      renderer?.focusProp(state.focusPropId, state.focusView)
    }
  },
)

// объектный режим: камера вокруг объекта только в конструкторе
let objectModeOn = false
const objectModeUi = ref(false)

/** Под панелью конструктора канвас занимает только свободную часть:
 *  иначе камера крутится вокруг центра всего экрана, а не объекта. */
function setCanvasDock(active: boolean): void {
  const c = canvasEl.value
  if (!c) return
  if (active) {
    const body = c.parentElement
    const width = body?.clientWidth || 0
    // state.objectLeft — доля ширины вьюпорта, которая остаётся свободной
    // (её же считает панель конструктора). Канвас ровно такой ширины:
    // центр канваса = центр свободной части, вращение вокруг объекта.
    const free = Math.max(160, Math.round(width * state.objectLeft))
    c.style.width = `${free}px`
    c.style.right = ''
  } else {
    c.style.width = ''
    c.style.right = ''
  }
  requestAnimationFrame(() => renderer?.resize())
}

/** Панель может доехать/измениться после открытия — подгоняем канвас. */
watch(() => state.objectLeft, () => {
  if (ui.object.open && ui.object.mode === 'full' && state.selection) {
    setCanvasDock(true)
  }
})

watch(
  () => [ui.object.open, ui.object.mode, state.selection, state.objectLeft] as const,
  () => {
    const active =
      ui.object.open && ui.object.mode === 'full' && !!state.selection
    objectModeUi.value = active
    // В конструкторе камера всегда обзор, но вид отрисовки (Полный/Каркас/
    // Чертёж) не меняем: канвас выглядит так же, как до открытия.
    if (active) {
      if (camMode.value !== 'orbit') {
        camMode.value = 'orbit'
        exitLook()
        renderer?.setMode('orbit')
        updateWalkHud()
      }
    }
    setCanvasDock(active)
    if (active && state.selection) {
      objectModeOn = true
      // Ждём, пока канвас получит новую ширину (ResizeObserver → resize),
      // иначе камера считает кадр по старой, широкой области и обрезает объект.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!objectModeOn || !state.selection) return
        renderer?.resize()
        renderer?.enterObjectMode(state.selection, 1)
      }))
    } else if (objectModeOn) {
      objectModeOn = false
      renderer?.exitObjectMode()
    }
  },
)
// выбрали деталь в конструкторе — камера подходит к ней (длинные боковины)
watch(
  () => [partSelection.instanceId, partSelection.part, ui.object.mode] as const,
  () => {
    renderer?.setSelectedPart(partSelection.instanceId, partSelection.part)
    if (!objectModeUi.value) return
    const id = partSelection.instanceId
    const part = partSelection.part
    if (id && part != null) renderer?.focusPart(id, part)
  },
)
function zoomObject(factor: number): void {
  renderer?.zoomBy(factor)
}

function fitObject(): void {
  renderer?.fitObject()
}

watch(() => state.wallMode, (m) => renderer?.setWallMode(m))
watch(() => ui.walkFov, (v) => renderer?.setWalkFov(v))
watch(() => state.viewMode, (m) => renderer?.setQuality(m))
watch(isBlueprint, (on) => {
  if (on) {
    camMode.value = 'orbit'
    suggestDraft.value = false
    lowGpu.value = false
    exitLook()
    renderer?.setMode('orbit')
    renderer?.setBlueprint(true)
    blueprintView.value = 'iso'
    blueprintPivot.value = 'room'
    renderer?.setBlueprintPivot('room')
    renderer?.setBlueprintView('iso')
  } else {
    renderer?.setBlueprint(false)
  }
})
watch(() => ui.hardware, (v) => renderer?.setHardwareVisible(v))
watch(() => ui.onlyRoom, (v) => { if (v) void solveVisible(); else void solveAll(); sync() })
watch(currentRoomIds, () => { void solveVisible(); sync() })
watch(
  () => state.projectId,
  () => {
    cameraApplied = false
    window.setTimeout(applyProjectCamera, 0)
  },
)
watch(() => state.fitToken, () => {
  fit(fitTarget.value)
  window.setTimeout(applyProjectCamera, 0)
})

onMounted(async () => {
  if (canvasEl.value) {
    const { BabylonRenderer } = await import('../render3d/babylonScene')
    if (!canvasEl.value) return
    renderer = new BabylonRenderer(canvasEl.value)
    if (perfOn) {
      ;(window as unknown as Record<string, unknown>).__furnitureRenderer = renderer
      ;(window as unknown as Record<string, unknown>).__furnitureDbg = {
        state, ui, lowGpu, suggestDraft,
      }
    }
    renderer.setWallMode(state.wallMode)
    renderer.setWalkFov(ui.walkFov)
    // На телефоне с небольшим числом ядер сразу схема: полный вид со
    // тенями и текстурами собирается секундами и «подвешивает» канвас.
    try {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      const cores = navigator.hardwareConcurrency || 8
      if (coarse && cores <= 6 && state.viewMode === 'realistic') {
        state.viewMode = 'schematic'
      }
    } catch { /* ignore */ }
    renderer.setQuality(state.viewMode)
    if (state.viewMode === 'blueprint') {
      camMode.value = 'orbit'
      renderer.setBlueprint(true)
      renderer.setBlueprintPivot('room')
      renderer.setBlueprintView('iso')
    }
    // Первый кадр на телефоне собирается секундами: показываем плашку,
    // чтобы это читалось как загрузка, а не как зависание.
    building.value = true
    renderer.scene.onAfterRenderObservable.addOnce(() => { building.value = false })
    sync()
    renderer.setVisibleInstances(currentRoomIds.value)
  renderer.setSelected(state.selected.length ? [...state.selected]
    : state.selection ? [state.selection] : [])
  renderer.setSelectedPart(partSelection.instanceId, partSelection.part)
  renderer.setSelectedProp(state.propId)
    renderer.fit('room', state.project.room, null)
    applyProjectCamera()
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__babylon = renderer
    }
  }
  ro = new ResizeObserver(() => renderer?.resize())
  if (canvasEl.value) ro.observe(canvasEl.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', clearMoveKeys)
  window.addEventListener('pointermove', onLookMove)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  touchQuery.addEventListener('change', onTouchChange)
  dimRaf = requestAnimationFrame(controlLoop)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', clearMoveKeys)
  window.removeEventListener('pointermove', onLookMove)
  document.removeEventListener('pointerlockchange', onPointerLockChange)
  touchQuery.removeEventListener('change', onTouchChange)
  exitLook()
  cancelAnimationFrame(dimRaf)
  window.clearTimeout(camToastTimer)
  ro?.disconnect()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <section class="view">
    <header class="view__head">
      <div class="view__title-wrap">
        <span class="view__title">3D</span>
        <span class="view__mode-label">{{ camModeLabel }}</span>
      </div>
      <div class="view__actions">
        <div class="view__group" role="group" aria-label="Ракурс">
          <span class="view__group-label">Ракурс</span>
          <button class="tab" :class="{ 'tab--active': viewName === 'iso' }" @click="setView('iso')">Изо</button>
          <button class="tab" :class="{ 'tab--active': viewName === 'front' }" @click="setView('front')">Фасад</button>
          <button class="tab" :class="{ 'tab--active': viewName === 'side' }" @click="setView('side')">Бок</button>
          <button class="tab" :class="{ 'tab--active': viewName === 'top' }" @click="setView('top')">Сверху</button>
        </div>

        <div v-if="walkEnabled && !ui.master" class="view__group" role="group" aria-label="Режим камеры">
          <span class="view__group-label">Камера</span>
          <button class="tab" :class="{ 'tab--active': camMode === 'orbit' }" title="Вращение вокруг точки" @click="setCamMode('orbit')">Обзор</button>
          <button class="tab" :class="{ 'tab--active': camMode === 'first' }" title="Камера на высоте глаз" @click="setCamMode('first')">Прогулка</button>
        </div>

        <div v-if="!ui.master" class="view__group" role="group" aria-label="Вписать в кадр">
          <button class="tab" :class="{ 'tab--active': fitTarget === 'module' }" @click="fit('module')">Модуль</button>
          <button class="tab" :class="{ 'tab--active': fitTarget === 'room' }" @click="fit('room')">Комната</button>
          <button class="tab" title="Камера в центр комнаты" @click="centerRoom">Центр</button>
        </div>

        <div class="view__group" role="group" aria-label="Размеры">
          <span class="view__group-label">Размеры</span>
          <button class="tab" :class="{ 'tab--active': ui.dims3d }" title="Размеры деталей внутри объекта" @click="ui.dims3d = !ui.dims3d">Внутри</button>
          <button class="tab" :class="{ 'tab--active': ui.dimsOuter }" title="Расстояния до стен и соседних объектов" @click="ui.dimsOuter = !ui.dimsOuter">Снаружи</button>
          <button class="tab" :class="{ 'tab--active': ui.dimsAll }" title="Все зазоры между полками и ящиками модуля" @click="ui.dimsAll = !ui.dimsAll">Зазоры</button>
        </div>

        <button v-if="ui.master" class="tab" title="Вписать комнату в кадр" @click="fit('room')">Вписать</button>
        <button class="tab" title="2D-развёртки стен без WebGL" @click="ui.renderMode = 'draft'; ui.draftTab = 'walls'; ui.viewSheetOpen = false">2D-стены</button>
        <button v-if="!ui.master" class="tab view__more" title="Все настройки вида и камеры" @click="viewMore = true">Ещё</button>
        <button v-if="!ui.master" class="tab" popovertarget="view-help3d" title="Горячие клавиши">?</button>
        <button v-if="!ui.master" class="tab" title="Снимок вида" @click="exportPng">PNG</button>

        <div id="view-help3d" popover class="popover">
          <h4>Камера и движение</h4>
          <dl>
            <dt>ЛКМ / перетаскивание</dt><dd>осмотреться (обзор)</dd>
            <dt>W A S D</dt><dd>сдвиг вида</dd>
            <dt>Q / E</dt><dd>ниже / выше</dd>
            <dt>Shift</dt><dd>ускорить движение</dd>
            <dt>Двойной клик</dt><dd>фокус на модуле</dd>
            <dt>F</dt><dd>вписать</dd>
            <dt>0</dt><dd>исходный вид</dd>
            <dt>1–4</dt><dd>изо / фасад / бок / сверху</dd>
            <dt>Esc</dt><dd>снять выделение</dd>
          </dl>
        </div>
      </div>
    </header>

    <div class="view__body" data-tour="scene">
      <div v-if="building" class="view__building">Собираем сцену…</div>
      <div
        v-if="objectModeUi"
        class="view__zoom"
        role="group"
        aria-label="Масштаб объекта"
        :style="{ right: `calc(${Math.round((1 - state.objectLeft) * 100)}% + 10px)` }"
      >
        <button class="view__zoom-btn" title="Отдалить" @click="zoomObject(1.25)">−</button>
        <button class="view__zoom-btn" title="Вписать объект" @click="fitObject()">⌂</button>
        <button class="view__zoom-btn" title="Приблизить" @click="zoomObject(0.8)">＋</button>
      </div>
      <canvas
        ref="canvasEl"
        class="view__canvas"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @wheel.passive="onCanvasWheel"
        @pointercancel="onUp"
        @dblclick="onDoubleClick"
        @dragover.prevent
        @drop.prevent="onDrop"
        @contextmenu.prevent
      ></canvas>

      <button
        v-if="walkEnabled && !state.presentation"
        class="cam-switch"
        :class="`cam-switch--${camMode}`"
        :title="`Камера: ${camModeLabel}. Клик — следующий режим`"
        @click="cycleCamMode"
      >
        <span class="cam-switch__icon" aria-hidden="true">{{ camModeIcon[camMode] }}</span>
        <span class="cam-switch__text">{{ camModeLabel }}</span>
        <span class="cam-switch__hint">
          {{ camMode === 'first'
            ? (pointerLocked ? 'C — сменить · Esc — курсор' : 'клик — обзор · C — сменить')
            : 'C — сменить' }}
        </span>
      </button>

      <Transition name="cam-toast">
        <div v-if="camToast" class="cam-toast" role="status">
          <span class="cam-toast__icon">{{ camModeIcon[camMode] }}</span>
          <b>{{ camToast }}</b>
          <small>{{ camModeHint }}</small>
        </div>
      </Transition>

      <div v-if="isBlueprint && !state.presentation" class="bp-bar" role="group" aria-label="Чертёж">
        <div class="bp-bar__group">
          <button class="tab" :class="{ 'tab--active': blueprintView === 'iso' }" @click="setBlueprintView('iso')">Изо</button>
          <button class="tab" :class="{ 'tab--active': blueprintView === 'front' }" @click="setBlueprintView('front')">Фасад</button>
          <button class="tab" :class="{ 'tab--active': blueprintView === 'side' }" @click="setBlueprintView('side')">Бок</button>
          <button class="tab" :class="{ 'tab--active': blueprintView === 'top' }" @click="setBlueprintView('top')">Сверху</button>
        </div>
        <div class="bp-bar__group">
          <span class="bp-bar__label">Ось</span>
          <button class="tab" :class="{ 'tab--active': blueprintPivot === 'room' }" @click="setBlueprintPivot('room')">Комната</button>
          <button class="tab" :class="{ 'tab--active': blueprintPivot === 'object' }" @click="setBlueprintPivot('object')">Объект</button>
        </div>
        <div class="bp-bar__group">
          <button class="tab" title="Отдалить" @click="blueprintZoom(1.25)">−</button>
          <button class="tab" title="Приблизить" @click="blueprintZoom(0.8)">＋</button>
        </div>
        <span class="bp-bar__hint">Чертёж 2.5D · камера фиксированная</span>
      </div>

      <div v-if="camMode === 'first' && !state.presentation" class="walk-hud">
        <span v-if="seated" class="walk-hud__main">E или Space — встать</span>
        <span v-else-if="walkTarget" class="walk-hud__main">
          <b>E</b> — {{ walkTarget.label }}
        </span>
        <span v-else class="walk-hud__main">WASD — идти · Space — прыжок</span>
        <span v-if="!pointerLocked && !isTouch" class="walk-hud__lock">
          клик по сцене — обзор мышью без зажатой кнопки
        </span>
      </div>

      <DimOverlay
        v-if="(ui.dims3d || ui.dimsOuter || ui.dimsAll) && dimLines.length"
        :lines="dimLines"
      />

      <svg
        v-if="selHull.length && !state.presentation"
        class="view__sel"
        aria-hidden="true"
      >
        <polygon :points="selHull.map((p) => `${p.x},${p.y}`).join(' ')" />
      </svg>

      <button
        v-if="partPill && !state.presentation"
        class="part-pill"
        :style="{ left: `${pillPos.x}px`, top: `${pillPos.y}px` }"
        :title="pillOpen ? 'Закрыть' : 'Открыть'"
        @pointerdown.stop
        @click.stop="togglePill"
      >{{ pillOpen ? '⤡' : '⤢' }}</button>

      <div v-if="!state.presentation" class="viewcube-wrap">
        <div class="viewcube">
          <button class="viewcube__face viewcube__face--front" @click="setView('front')">ПЕРЕД</button>
          <button class="viewcube__face viewcube__face--back" @click="setView('top')">ВЕРХ</button>
          <button class="viewcube__face viewcube__face--right" @click="setView('side')">ПРАВ</button>
          <button class="viewcube__face viewcube__face--left" @click="setView('side')">ЛЕВ</button>
          <button class="viewcube__face viewcube__face--top" @click="setView('top')">ВЕРХ</button>
        </div>
        <button class="viewcube__home" title="Исходный вид (0)" @click="setView('iso'); fit('room')">⌂</button>
      </div>

      <div v-if="!state.presentation" class="wallmode">
        <button class="tab" :class="{ 'tab--active': state.wallMode === 'cutaway' }" title="Срез стен: стены перед камерой скрываются — видно объект" @click="setWallMode('cutaway')">◩ Срез</button>
        <button class="tab" :class="{ 'tab--active': state.wallMode === 'all' }" title="Все стены: показывать стены полностью" @click="setWallMode('all')">▦ Все стены</button>
      </div>

      <div
        v-if="!state.presentation && !objectModeUi"
        class="minimap"
        :class="{ 'minimap--open': planOpen, 'minimap--walk': camMode === 'first' }"
      >
        <PlanView :compact="!planOpen" :marker="walker" />
        <div class="minimap__tools">
          <button class="minimap__btn" title="Приблизить план" @click="planZoom(1.25)">＋</button>
          <button class="minimap__btn" title="Отдалить план" @click="planZoom(0.8)">−</button>
          <button class="minimap__btn" title="Вписать комнату" @click="planFit">⌂</button>
          <button class="minimap__btn minimap__btn--wide" title="Добавить комнату" @click="addRoom">＋комната</button>
        </div>
        <div v-if="walker" class="minimap__pos">
          X <b>{{ (walker.x / 1000).toFixed(2) }}</b> ·
          Y <b>{{ (walker.y / 1000).toFixed(2) }}</b> ·
          Z <b>{{ walker.eye.toFixed(2) }}</b> м
          <span v-if="rendererRoom" class="minimap__room">{{ rendererRoom }}</span>
        </div>
        <button class="minimap__toggle" @click="planOpen = !planOpen">{{ planOpen ? '×' : '⤢' }}</button>
      </div>

      <div v-if="!state.presentation && !isBlueprint" class="view__dock" aria-label="Вид и камера">
        <button class="tab" @click="viewMore = true">Вид · {{ viewNameLabel }}</button>
        <button v-if="walkEnabled" class="tab" :class="{ 'tab--active': camMode !== 'orbit' }" @click="cycleCamMode">{{ camModeLabel }}</button>
        <button
          class="tab"
          :class="{ 'tab--active': orbitPivot === 'object' }"
          :disabled="!state.selection && !state.selected.length"
          :title="orbitPivot === 'room' ? 'Вращать вокруг комнаты — нажмите для объекта' : 'Вращать вокруг объекта — нажмите для комнаты'"
          @click="cyclePivot"
        >Ось: {{ orbitPivot === 'room' ? 'комната' : 'объект' }}</button>
        <button
          class="tab"
          :title="state.selection ? 'Вписать выбранный модуль' : 'Вписать комнату'"
          @click="fit(state.selection ? 'module' : 'room')"
        >Вписать</button>
        <button class="tab" :class="{ 'tab--active': ui.dragMove }" @click="ui.dragMove = !ui.dragMove">Двигать</button>
      </div>

      <CameraPad
        v-if="!state.presentation && showPad && !isBlueprint"
        :mode="camMode"
        :touch="isTouch"
        :keys="keyVec"
        @move="onPadMove"
        @z="onPadZ"
      />

      <div v-if="viewMore" class="view__sheet" @click.self="viewMore = false">
        <section class="view__sheet-card" role="dialog" aria-modal="true" aria-label="Вид и камера">
          <span class="view__sheet-grip" aria-hidden="true"></span>
          <header class="view__sheet-head">
            <span>Вид и сцена</span>
            <button class="btn btn--ghost btn--sm" title="Закрыть" @click="viewMore = false">×</button>
          </header>

          <div v-if="walkEnabled" class="view__sheet-section">
            <span class="view__sheet-label">Режим камеры</span>
            <div class="view__sheet-row view__sheet-row--stack">
              <button class="tab" :class="{ 'tab--active': camMode === 'orbit' }" @click="setCamMode('orbit')">
                Обзор <small>вращение вокруг точки</small>
              </button>
              <button class="tab" :class="{ 'tab--active': camMode === 'first' }" @click="setCamMode('first')">
                Прогулка <small>на высоте глаз</small>
              </button>
            </div>
            <p class="view__sheet-note">{{ camModeHint }}</p>
            <label v-if="camMode === 'first'" class="view__fov">
              <span>Угол обзора <b>{{ ui.walkFov }}°</b></span>
              <input v-model.number="ui.walkFov" type="range" min="48" max="82" step="1" />
            </label>
          </div>

          <div class="view__sheet-section">
            <span class="view__sheet-label">Ракурс</span>
            <div class="view__sheet-row">
              <button class="tab" :class="{ 'tab--active': viewName === 'iso' }" @click="setView('iso')">Изо</button>
              <button class="tab" :class="{ 'tab--active': viewName === 'front' }" @click="setView('front')">Фасад</button>
              <button class="tab" :class="{ 'tab--active': viewName === 'side' }" @click="setView('side')">Бок</button>
              <button class="tab" :class="{ 'tab--active': viewName === 'top' }" @click="setView('top')">Сверху</button>
            </div>
            <div v-if="state.viewMode !== 'blueprint'" class="view__sheet-row">
              <button class="tab" @click="setProjection('persp')">Перспектива</button>
              <button class="tab" @click="setProjection('ortho')">Ортокамера</button>
            </div>
            <div class="view__sheet-row">
              <button class="tab" :class="{ 'tab--active': fitTarget === 'module' }" @click="fit('module')">Вписать модуль</button>
              <button class="tab" :class="{ 'tab--active': fitTarget === 'room' }" @click="fit('room')">Вписать комнату</button>
              <button class="tab" @click="centerRoom">Центр</button>
              <button class="tab" @click="pivotRoom">Ось: комната</button>
              <button class="tab" :disabled="!state.selection" @click="pivotObject">Ось: объект</button>
            </div>
          </div>

          <div class="view__sheet-section">
            <span class="view__sheet-label">Отображение</span>
            <div class="view__sheet-row">
              <button class="tab" :class="{ 'tab--active': state.viewMode === 'realistic' }" @click="setViewMode('realistic')">Полный</button>
              <button class="tab" :class="{ 'tab--active': state.viewMode === 'schematic' }" @click="setViewMode('schematic')">Каркас</button>
              <button class="tab" :class="{ 'tab--active': state.viewMode === 'blueprint' }" @click="setViewMode('blueprint')">Чертёж</button>
            </div>
            <div v-if="state.viewMode === 'blueprint'" class="view__sheet-row">
              <button class="tab" :class="{ 'tab--active': blueprintView === 'iso' }" @click="setBlueprintView('iso')">Изо</button>
              <button class="tab" :class="{ 'tab--active': blueprintView === 'front' }" @click="setBlueprintView('front')">Фасад</button>
              <button class="tab" :class="{ 'tab--active': blueprintView === 'side' }" @click="setBlueprintView('side')">Бок</button>
              <button class="tab" :class="{ 'tab--active': blueprintView === 'top' }" @click="setBlueprintView('top')">Сверху</button>
              <button class="tab" :class="{ 'tab--active': blueprintPivot === 'room' }" @click="setBlueprintPivot('room')">Ось: комната</button>
              <button class="tab" :class="{ 'tab--active': blueprintPivot === 'object' }" @click="setBlueprintPivot('object')">Ось: объект</button>
            </div>
            <div class="view__sheet-row">
              <button class="tab" :class="{ 'tab--active': state.wallMode === 'cutaway' }" title="Стены перед камерой скрываются — видно, что внутри" @click="setWallMode('cutaway')">◩ Срез стен</button>
              <button class="tab" :class="{ 'tab--active': state.wallMode === 'all' }" title="Показывать все стены полностью" @click="setWallMode('all')">▦ Все стены</button>
            </div>
            <div class="view__sheet-row">
              <button class="tab" :class="{ 'tab--active': ui.facades }" @click="ui.facades = !ui.facades">Фасады</button>
              <button class="tab" :class="{ 'tab--active': ui.dragMove }" @click="ui.dragMove = !ui.dragMove">Двигать модули</button>
              <button class="tab" :class="{ 'tab--active': ui.onlyRoom }" @click="ui.onlyRoom = !ui.onlyRoom">Только комната</button>
              <button class="tab" :class="{ 'tab--active': planOpen }" @click="planOpen = !planOpen">План</button>
              <button class="tab" @click="ui.renderMode = 'draft'; ui.draftTab = 'walls'; ui.viewSheetOpen = false">2D-стены</button>
            </div>
            <div class="view__sheet-row">
              <button class="btn btn--sm" @click="exportPng">Снимок PNG</button>
            </div>
          </div>

          <div class="view__sheet-section">
            <span class="view__sheet-label">Размеры</span>
            <div class="view__sheet-row view__sheet-row--stack">
              <button class="tab" :class="{ 'tab--active': ui.dims3d }" @click="ui.dims3d = !ui.dims3d">
                Внутри <small>детали модуля</small>
              </button>
              <button class="tab" :class="{ 'tab--active': ui.dimsOuter }" @click="ui.dimsOuter = !ui.dimsOuter">
                Снаружи <small>до стен и соседей</small>
              </button>
              <button class="tab" :class="{ 'tab--active': ui.dimsAll }" @click="ui.dimsAll = !ui.dimsAll">
                Зазоры <small>все полки и ящики</small>
              </button>
            </div>
          </div>

          <div class="view__sheet-section">
            <span class="view__sheet-label">Как управлять</span>
            <p class="view__sheet-note">
              Обзор: <b>ЛКМ</b> — вращение, колесо — зум, <b>ПКМ / Shift</b> —
              панорама. На телефоне: один палец — вращение, два — зум и панорама.
              Режимы прогулки и полёта временно отключены — работаем в обзоре.
            </p>
          </div>
        </section>
      </div>

      <div v-if="lowGpu && !suggestDraft" class="view__gpu-note">
        Слабый GPU — включён упрощённый вид.
        <button class="view__gpu-btn" @click="suggestDraft = true">2D?</button>
        <button class="view__gpu-btn" @click="lowGpu = false">×</button>
      </div>
      <div v-if="suggestDraft" class="view__gpu-note view__gpu-note--strong">
        Тормозит даже упрощённый 3D.
        <button class="view__gpu-btn" @click="ui.renderMode = 'draft'; ui.draftTab = 'walls'">
          Открыть 2D-развёртки
        </button>
        <button class="view__gpu-btn" @click="suggestDraft = false">Остаться</button>
      </div>
      <span v-if="perfOn" class="view__perf">
        {{ perf.fps }} FPS · {{ perf.heap }} MB · {{ perf.meshes }} мешей
      </span>
      <span v-if="!state.presentation && !isBlueprint" class="view__hint view__hint--right">
        {{ camModeHint }}
      </span>
    </div>
  </section>
</template>
