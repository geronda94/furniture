<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildScene } from '../render25d/scene'
import {
  facesToSvg,
  pickObject,
  pickPart,
  renderView,
} from '../render25d/canvas'
import { basis, fitCamera, focalPx, screenToFloor, screenToTargetPlane } from '../render25d/camera'
import { outlinePoints, roomBounds } from '../render25d/room'
import { clamp } from '../render25d/math'
import type { Face, PlacedObject, Vec3 } from '../render25d/types'
import {
  addInstance,
  revealProps,
  beginDrag,
  clearGuides,
  derived,
  MODULE_PRESETS,
  partAnimValues,
  clearSelection,
  pointer,
  moveSelection,
  openDetail,
  objectsOf,
  select,
  selectPart,
  toggleSelection,
  partSelection,
  selectedInstance,
  setPlacement,
  setWallMode,
  state,
} from '../state/project'
import PlanView from './PlanView.vue'
import ObjectPopup from './ObjectPopup.vue'
import PartPopup from './PartPopup.vue'
import GroupPopup from './GroupPopup.vue'
import PropsWindow from './PropsWindow.vue'

const canvasEl = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let w = 0
let h = 0
let dpr = 1
let raf = 0
let anim = 0
let fitted = false
let fitW = 0
let fitH = 0
let touched = false
let faces: Face[] = []
let ro: ResizeObserver | null = null
let dragMode: 'none' | 'orbit' | 'pan' | 'move' = 'none'
let lastX = 0
let lastY = 0
let downHit: string | null = null
let downPart: number | null = null
let moveStarts: Record<string, { x: number; y: number }> = {}
let moved = 0
let moveStarted = false
let moveStartFloor: Vec3 | null = null
let moveStartPos = { x: 0, y: 0 }

const viewName = ref('iso')
const camMode = ref<'orbit' | 'first' | 'fly'>('orbit')
const fitTarget = ref<'module' | 'room'>('room')
const planOpen = ref(false)
const dragOver = ref(false)
const popup = ref<{ id: string; x: number; y: number } | null>(null)
const partPopup = ref<{ id: string; part: number; x: number; y: number } | null>(
  null,
)
const groupPopup = ref<{ x: number; y: number } | null>(null)
const propsWin = ref<{ x: number; y: number } | null>(null)

const popupInstance = computed(() => {
  if (!popup.value) return null
  return state.project.instances.find((i) => i.id === popup.value!.id) ?? null
})

function selectionRect(id: string) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of faces) {
    if (f.objectId !== id) continue
    for (const p of f.pts) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

function partRect(id: string, part: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of faces) {
    if (f.objectId !== id || f.part !== part) continue
    for (const p of f.pts) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

function openPartPopup(id: string, part: number) {
  revealProps()
  const r = partRect(id, part)
  if (!r) return
  const px = clamp(r.maxX + 12, 12, Math.max(12, w - 300))
  const py = clamp(r.minY, 12, Math.max(12, h - 260))
  partPopup.value = { id, part, x: px, y: py }
  popup.value = null
}

function propsAnchor(): { x: number; y: number } {
  const c = canvasEl.value
  const rect = c?.getBoundingClientRect()
  const WW = 340
  const WH = 590
  if (rect && (pointer.x || pointer.y)) {
    // курсор в координатах вида
    const px = pointer.x - rect.left
    const py = pointer.y - rect.top
    const sidebar = document.querySelector('.sidebar') as HTMLElement | null
    const sideLeft = sidebar
      ? sidebar.getBoundingClientRect().left - rect.left
      : w
    // если курсор над боковой панелью — окно слева от неё, чтобы не перекрывать
    const nearSidebar = px >= sideLeft - 8
    const x = clamp(
      nearSidebar ? sideLeft - WW - 12 : px + 16,
      12,
      Math.max(12, w - WW - 12),
    )
    const y = clamp(py - 24, 12, Math.max(12, h - WH))
    return { x, y }
  }
  const id = state.selection
  if (id) {
    const r = selectionRect(id)
    if (r) {
      return {
        x: clamp(r.maxX + 16, 12, Math.max(12, w - WW - 12)),
        y: clamp(r.minY, 12, Math.max(12, h - WH)),
      }
    }
  }
  return { x: Math.max(12, w - WW - 12), y: 64 }
}

function showProps(): void {
  propsWin.value = propsAnchor()
}

function openGroupPopup() {
  revealProps()
  const r = selectionRect(state.selection ?? '')
  const ids = state.selected
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const b = selectionRect(id)
    if (!b) continue
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  const px = clamp(
    Number.isFinite(maxX) ? maxX + 14 : (r?.maxX ?? 0) + 14,
    12,
    Math.max(12, w - 300),
  )
  const py = clamp(
    Number.isFinite(minY) ? minY : 14,
    12,
    Math.max(12, h - 260),
  )
  popup.value = null
  partPopup.value = null
  groupPopup.value = { x: px, y: py }
}

function openPopup(id: string) {
  if (!state.project.instances.some((i) => i.id === id)) return
  select(id)
  revealProps()
  const r = selectionRect(id)
  const px = clamp(r ? r.maxX + 14 : 14, 12, Math.max(12, w - 324))
  const py = clamp(r ? r.minY : 14, 12, Math.max(12, h - 500))
  popup.value = { id, x: px, y: py }
}

function placedObjects(): PlacedObject[] {
  const out: PlacedObject[] = []
  for (const inst of state.project.instances) {
    const d = derived[inst.id]
    if (!d) continue
    d.objects.forEach((o, part) => {
      out.push({
        object: o,
        placement: {
          id: inst.id,
          x: inst.x,
          y: inst.y,
          rot: inst.rot,
          z: inst.z,
        },
        anim: partAnimValues(inst, part),
        part,
      })
    })
  }
  return out
}

function instancePoints(id: string): Vec3[] {
  const inst = state.project.instances.find((i) => i.id === id)
  if (!inst) return []
  const d = derived[id]
  const rad = (inst.rot * Math.PI) / 180
  const cs = Math.cos(rad)
  const sn = Math.sin(rad)
  const boxPts: Vec3[] = []
  const push = (lx: number, ly: number, lz: number) => {
    boxPts.push([
      inst.x + lx * cs - ly * sn,
      inst.y + lx * sn + ly * cs,
      lz,
    ])
  }

  if (!d) {
    // до первого solve — габарит по параметрам (цоколь + корпус + столешница)
    const { W, H, D } = inst.params
    const top = 100 + H + 38
    for (const ix of [0, W]) {
      for (const iy of [0, D]) {
        for (const iz of [0, top]) push(ix, iy, iz)
      }
    }
    return boxPts
  }

  for (const o of d.objects) {
    for (const ix of [0, 1]) {
      for (const iy of [0, 1]) {
        for (const iz of [0, 1]) {
          push(o.x + ix * o.sx, o.y + iy * o.sy, o.z + iz * o.sz)
        }
      }
    }
  }
  return boxPts
}

function fit(target: 'module' | 'room' = fitTarget.value) {
  const room = state.project.room
  const outline = outlinePoints(room)
  const roomPts: Vec3[] = [
    ...outline.map((p) => [p.x, p.y, 0] as Vec3),
    ...outline.map((p) => [p.x, p.y, room.h] as Vec3),
  ]
  let pts = roomPts
  if (target === 'module' && state.selection) {
    const ip = instancePoints(state.selection)
    if (ip.length) pts = ip
  }
  state.camera25 = fitCamera(
    state.camera25,
    pts,
    w,
    h,
    target === 'module' ? 0.32 : 0.1,
  )
  fitTarget.value = target
  fitW = w
  fitH = h
  fitted = true
  touched = false
}

function resize() {
  const c = canvasEl.value
  if (!c) return
  const r = c.getBoundingClientRect()
  dpr = Math.min(2, window.devicePixelRatio || 1)
  w = Math.max(1, Math.round(r.width))
  h = Math.max(1, Math.round(r.height))
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  ctx = c.getContext('2d')
  if (!fitted || (!touched && (w !== fitW || h !== fitH))) fit()
  invalidate()
}

function draw() {
  if (!ctx) return
  const scene = buildScene({
    objects: placedObjects(),
    room: state.project.room,
    camera: state.camera25,
    materials: state.project.materials,
    width: w,
    height: h,
    style: state.viewMode,
    wallMode: state.wallMode,
  })
  faces = scene.faces
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__faces = faces
  }
  if (partPopup.value) {
    const pp = partPopup.value
    const r = partRect(pp.id, pp.part)
    if (!r) {
      partPopup.value = null
    } else {
      const px = clamp(r.maxX + 12, 12, Math.max(12, w - 300))
      const py = clamp(r.minY, 12, Math.max(12, h - 260))
      if (pp.x !== px || pp.y !== py) {
        partPopup.value = { ...pp, x: px, y: py }
      }
    }
  }
  if (popup.value) {
    const r = selectionRect(popup.value.id)
    if (!r) {
      popup.value = null
    } else {
      const px = clamp(r.maxX + 14, 12, Math.max(12, w - 324))
      const py = clamp(r.minY, 12, Math.max(12, h - 500))
      if (popup.value.x !== px || popup.value.y !== py) {
        popup.value = { ...popup.value, x: px, y: py }
      }
    }
  }

  const sel = selectedInstance.value
  renderView(ctx, {
    width: w,
    height: h,
    dpr,
    faces,
    projector: scene.projector,
    room: state.project.room,
    mode: 'persp',
    style: state.viewMode,
    selection: state.presentation ? null : state.selection,
    selections: state.presentation
      ? []
      : state.selected.length
        ? state.selected
        : state.selection
          ? [state.selection]
          : [],
    part:
      partSelection.instanceId === state.selection
        ? partSelection.part
        : null,
    shadows: scene.shadows,
    selectionLabel:
      !state.presentation && sel
        ? `${sel.params.W} × ${sel.params.H} × ${sel.params.D}`
        : undefined,
  })
}

function invalidate() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    draw()
  })
}

function orbitTo(yaw: number, pitch: number, name: string) {
  viewName.value = name
  cancelAnimationFrame(anim)
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state.camera25.yaw = yaw
    state.camera25.pitch = pitch
    invalidate()
    return
  }
  const y0 = state.camera25.yaw
  const p0 = state.camera25.pitch
  const dyaw = ((yaw - y0 + 540) % 360) - 180
  const t0 = performance.now()
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 240)
    const e = 1 - Math.pow(1 - k, 3)
    state.camera25.yaw = y0 + dyaw * e
    state.camera25.pitch = p0 + (pitch - p0) * e
    invalidate()
    if (k < 1) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

function setFit(target: 'module' | 'room') {
  fit(target)
  invalidate()
}

function setProjection(mode: 'persp' | 'ortho') {
  if ((state.camera25.projection ?? 'ortho') === mode) return
  state.camera25.projection = mode
  if (mode === 'persp' && !state.camera25.distance) {
    state.camera25.distance = 6000
  }
  fit(fitTarget.value)
  invalidate()
}

function onDown(e: PointerEvent) {
  const c = canvasEl.value
  if (!c) return
  c.setPointerCapture(e.pointerId)
  const r = c.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  touched = true
  const hit = pickObject(faces, x, y)
  downHit = hit
  const partHit = pickPart(faces, x, y)
  downPart = partHit && partHit.objectId === hit ? partHit.part : null
  moved = 0
  moveStarted = false
  moveStartFloor = null

  if (e.button === 1 || e.button === 2) {
    dragMode = 'pan'
    popup.value = null
  } else if (hit && (e.shiftKey || e.ctrlKey || e.metaKey)) {
    toggleSelection(hit)
    dragMode = 'move'
    moved = 0
    moveStarted = true
    downPart = null
    const ids = state.selected.length ? state.selected : [hit]
    moveStarts = {}
    for (const id of ids) {
      const i = state.project.instances.find((x) => x.id === id)
      if (i) moveStarts[id] = { x: i.x, y: i.y }
    }
    moveStartFloor = screenToFloor(x, y, state.camera25, w, h)
  } else if (hit) {
    if (!state.selected.includes(hit)) select(hit)
    dragMode = 'move'
    const inst = state.project.instances.find((i) => i.id === hit)
    if (inst) {
      moveStartPos = { x: inst.x, y: inst.y }
      moveStartFloor = screenToFloor(x, y, state.camera25, w, h)
    }
  } else {
    dragMode = 'orbit'
    popup.value = null
  }
  lastX = e.clientX
  lastY = e.clientY
}

function onMove(e: PointerEvent) {
  if (dragMode === 'none') return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY

  moved += Math.abs(dx) + Math.abs(dy)

  if (dragMode === 'move' && downHit && moveStartFloor) {
    if (!moveStarted && moved > 3) {
      moveStarted = true
      beginDrag()
      popup.value = null
      const ids = state.selected.length ? state.selected : [downHit]
      moveStarts = {}
      for (const id of ids) {
        const i = state.project.instances.find((x) => x.id === id)
        if (i) moveStarts[id] = { x: i.x, y: i.y }
      }
    }
    if (moveStarted) {
      const rect = canvasEl.value?.getBoundingClientRect()
      if (rect) {
        const f = screenToFloor(
          e.clientX - rect.left,
          e.clientY - rect.top,
          state.camera25,
          w,
          h,
        )
        const starts = Object.keys(moveStarts).length
          ? moveStarts
          : { [downHit]: moveStartPos }
        moveSelection(
          f[0] - moveStartFloor[0],
          f[1] - moveStartFloor[1],
          starts,
        )
      }
    }
  } else if (dragMode === 'orbit') {
    // камера следует за мышью
    state.camera25.yaw -= dx * 0.35
    const lim = camMode.value === 'orbit' ? 88 : 70
    state.camera25.pitch = clamp(state.camera25.pitch - dy * 0.28, -lim, lim)
  } else if (dragMode === 'pan') {
    const { r, u } = basis(state.camera25)
    const k =
      state.camera25.projection === 'persp'
        ? (state.camera25.distance ?? 6000) / focalPx(state.camera25, h)
        : 1 / state.camera25.zoom
    const t = state.camera25.target
    t[0] += (r[0] * dx - u[0] * dy) * k
    t[1] += (r[1] * dx - u[1] * dy) * k
    t[2] += (r[2] * dx - u[2] * dy) * k
  }
  invalidate()
}

function onUp() {
  if (dragMode === 'move' && downHit && !moveStarted && moved < 4) {
    const inst = state.project.instances.find((i) => i.id === downHit)
    const obj =
      inst && downPart != null ? objectsOf(inst)[downPart] : undefined
    const movable =
      obj && (obj.kind === 'door' || obj.kind === 'drawerfront' ||
        obj.kind === 'drawerbox')
    if (downPart != null) selectPart(downHit, downPart)
    if (state.selected.length > 1) openGroupPopup()
    else if (movable && downPart != null) openPartPopup(downHit, downPart)
    else openPopup(downHit)
  }
  dragMode = 'none'
  downHit = null
  downPart = null
  moveStarted = false
  moveStartFloor = null
  clearGuides()
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const raw = e.dataTransfer?.getData('text/plain') ?? ''
  const key = raw.startsWith('preset:') ? raw.slice(7) : ''
  const preset = MODULE_PRESETS.find((p) => p.key === key)
  const c = canvasEl.value
  if (!preset || !c) return
  const r = c.getBoundingClientRect()
  const p = screenToFloor(
    e.clientX - r.left,
    e.clientY - r.top,
    state.camera25,
    w,
    h,
  )
  const W = preset.params.W ?? 600
  const D = preset.params.D ?? 560
  addInstance(key, p[0] - W / 2, p[1] - D / 2)
}

function onWheel(e: WheelEvent) {
  touched = true
  if (camMode.value !== 'orbit') {
    const cam = state.camera25
    cam.fov = clamp((cam.fov ?? 40) + e.deltaY * 0.02, 18, 75)
    invalidate()
    return
  }
  const c = canvasEl.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const cam = state.camera25
  let delta = e.deltaY
  if (e.deltaMode === 1) delta *= 16
  else if (e.deltaMode === 2) delta *= 400
  const factor = Math.exp(-delta * 0.0011)
  const before = screenToTargetPlane(sx, sy, cam, w, h)

  if (cam.projection === 'persp') {
    // скролл вверх — ближе
    cam.distance = clamp((cam.distance ?? 6000) / factor, 150, 1e6)
  } else {
    cam.zoom = clamp(cam.zoom * factor, 0.02, 3)
  }

  const after = screenToTargetPlane(sx, sy, cam, w, h)
  const t = cam.target
  t[0] += before[0] - after[0]
  t[1] += before[1] - after[1]
  t[2] += before[2] - after[2]
  invalidate()
}

function onDoubleClick(e: MouseEvent) {
  const c = canvasEl.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const hit = pickObject(
    faces,
    e.clientX - rect.left,
    e.clientY - rect.top,
  )
  if (!hit) return
  select(hit)
  fit('module')
  invalidate()
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'SELECT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  ) {
    return
  }
  const key = e.key.toLowerCase()
  if (key === 'f' || key === 'а') {
    fitFromAnywhere(fitTarget.value)
  } else if (key === 'escape') {
    clearSelection()
    groupPopup.value = null
  } else if (key === '1') {
    orbitTo(34, 25, 'iso')
  } else if (key === '2') {
    orbitTo(0, 0, 'front')
  } else if (key === '3') {
    orbitTo(90, 0, 'side')
  } else if (key === '4') {
    orbitTo(0, 90, 'top')
  } else if (key === '0') {
    fit('room')
    orbitTo(34, 25, 'iso')
  }
}

function exportSvg() {
  if (!faces.length) return
  const svg = facesToSvg(faces, w, h)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'view-25d.svg'
  a.click()
  URL.revokeObjectURL(url)
}

watch(() => state.rev, invalidate)
watch(() => state.camera25, invalidate, { deep: true })
watch(
  () => state.fitToken,
  () => {
    fitted = false
    fit()
    invalidate()
  },
)
watch(
  () => [state.selection, state.openingId, state.folderId,
    state.roomSelected, state.roomNode, state.wallIndex] as const,
  () => {
    if (state.selection || state.openingId || state.folderId ||
        state.roomSelected || state.wallIndex != null) showProps()
    else propsWin.value = null
  },
)
watch(
  () => state.propsToken,
  () => {
    if (state.selection || state.openingId || state.folderId ||
        state.roomSelected || state.wallIndex != null) showProps()
    else propsWin.value = null
  },
)

watch(
  () => state.selection,
  (id) => {
    if (popup.value && popup.value.id !== id) popup.value = null
    if (partPopup.value && partPopup.value.id !== id) partPopup.value = null
    if (state.selected.length <= 1) groupPopup.value = null
  },
)
watch(
  () => state.followToken,
  () => {
    if (fitTarget.value === 'module') {
      fit('module')
      invalidate()
    }
  },
)


function onTexture() {
  invalidate()
}

/* ---------- WASD: ходьба и свободный полёт ---------- */

const pressed = new Set<string>()
let moveRaf = 0
let moveLast = 0

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return (
    !!t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'SELECT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  )
}

function onKeyDown(e: KeyboardEvent): void {
  if (isTyping(e)) return
  const k = e.key.toLowerCase()
  const map: Record<string, string> = {
    w: 'w', a: 'a', s: 's', d: 'd', q: 'q', e: 'e',
    ц: 'w', ф: 'a', ы: 's', в: 'd', й: 'q', у: 'e',
    shift: 'shift',
  }
  const code = map[k]
  if (!code) return
  pressed.add(code)
  if (!moveRaf) {
    moveLast = performance.now()
    moveRaf = requestAnimationFrame(moveTick)
  }
}

function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  const map: Record<string, string> = {
    w: 'w', a: 'a', s: 's', d: 'd', q: 'q', e: 'e',
    ц: 'w', ф: 'a', ы: 's', в: 'd', й: 'q', у: 'e',
    shift: 'shift',
  }
  pressed.delete(map[k] ?? k)
}

function moveTick(now: number): void {
  const dt = Math.min(0.05, (now - moveLast) / 1000)
  moveLast = now
  if (!pressed.size) {
    moveRaf = 0
    return
  }
  const cam = state.camera25
  const { r, f } = basis(cam)
  const speed = (pressed.has('shift') ? 3000 : 1400) * dt

  // горизонтальное направление взгляда
  const gl = Math.hypot(f[0], f[1]) || 1
  const fg = [f[0] / gl, f[1] / gl]
  let mx = 0
  let my = 0
  let mz = 0
  const forward = (pressed.has('w') ? 1 : 0) - (pressed.has('s') ? 1 : 0)
  const strafe = (pressed.has('d') ? 1 : 0) - (pressed.has('a') ? 1 : 0)
  const lift = (pressed.has('e') ? 1 : 0) - (pressed.has('q') ? 1 : 0)

  if (camMode.value === 'fly') {
    // свободный полёт: вперёд по взгляду, вверх/вниз — E/Q
    mx = (f[0] * forward + r[0] * strafe) * speed
    my = (f[1] * forward + r[1] * strafe) * speed
    mz = (f[2] * forward + r[2] * strafe) * speed + lift * speed
  } else {
    mx = (fg[0] * forward + r[0] * strafe) * speed
    my = (fg[1] * forward + r[1] * strafe) * speed
  }

  const room = state.project.room
  const bounds = roomBounds(room)
  const t = cam.target
  t[0] = clamp(t[0] + mx, bounds.minX + 50, bounds.maxX - 50)
  t[1] = clamp(t[1] + my, bounds.minY + 50, bounds.maxY - 50)
  if (camMode.value === 'fly') {
    t[2] = clamp(t[2] + mz, 100, room.h - 100)
  } else if (camMode.value === 'first') {
    t[2] = 1600
  }
  state.rev++
  moveRaf = requestAnimationFrame(moveTick)
}

function setCamMode(mode: 'orbit' | 'first' | 'fly'): void {
  const cam = state.camera25
  if (mode === camMode.value) return
  const { f } = basis(cam)
  if (mode === 'orbit') {
    // из глаза — обратно в орбиту
    cam.target = [
      cam.target[0] + f[0] * 2400,
      cam.target[1] + f[1] * 2400,
      Math.max(0, cam.target[2] + f[2] * 2400),
    ]
    cam.distance = 3000
  } else {
    if (camMode.value === 'orbit') {
      // из орбиты — глаз в текущую точку обзора
      const z = mode === 'first' ? 1600 : cam.target[2]
      cam.target = [cam.target[0], cam.target[1], z]
    } else if (mode === 'first') {
      cam.target = [cam.target[0], cam.target[1], 1600]
    }
    cam.distance = 0
    cam.pitch = clamp(cam.pitch, -60, 60)
  }
  camMode.value = mode
  touched = true
  invalidate()
}

/** Всегда возвращаемся в обзор при Fit. */
function fitFromAnywhere(target: 'module' | 'room'): void {
  if (camMode.value !== 'orbit') setCamMode('orbit')
  fit(target)
  invalidate()
}

/** Клик вне попапа закрывает его (и попап модуля, и попап элемента). */
function onDocDown(e: PointerEvent): void {
  const t = e.target as HTMLElement | null
  if (!t) return
  if (partPopup.value && !t.closest('.part-popup')) {
    partPopup.value = null
  }
  if (popup.value && !t.closest('.object-popup')) {
    popup.value = null
  }
  if (groupPopup.value && !t.closest('.group-popup')) {
    groupPopup.value = null
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  document.addEventListener('pointerdown', onDocDown, true)
  window.addEventListener('furniture:texture', onTexture)
  ro = new ResizeObserver(resize)
  if (canvasEl.value) ro.observe(canvasEl.value)
  resize()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('pointerdown', onDocDown, true)
  cancelAnimationFrame(moveRaf)
  window.removeEventListener('furniture:texture', onTexture)
  ro?.disconnect()
  cancelAnimationFrame(raf)
  cancelAnimationFrame(anim)
})
</script>

<template>
  <section class="view">
    <header class="view__head">
      <span class="view__title">2.5D · вид</span>
      <div class="view__actions">
        <button
          class="tab"
          :class="{ 'tab--active': viewName === 'iso' }"
          @click="orbitTo(34, 25, 'iso')"
        >
          Изо
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': viewName === 'front' }"
          @click="orbitTo(0, 0, 'front')"
        >
          Фасад
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': viewName === 'side' }"
          @click="orbitTo(90, 0, 'side')"
        >
          Бок
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': viewName === 'top' }"
          @click="orbitTo(0, 90, 'top')"
        >
          Сверху
        </button>
        <span class="tab-sep"></span>
        <button
          class="tab"
          :class="{ 'tab--active': state.camera25.projection !== 'ortho' }"
          title="Перспективная камера"
          @click="setProjection('persp')"
        >
          Персп
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': state.camera25.projection === 'ortho' }"
          title="Ортографическая камера (точные размеры)"
          @click="setProjection('ortho')"
        >
          Орто
        </button>
        <span class="tab-sep"></span>
        <button
          class="tab"
          :class="{ 'tab--active': camMode === 'orbit' }"
          title="Обзор (орбита)"
          @click="setCamMode('orbit')"
        >
          Обзор
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': camMode === 'first' }"
          title="Вид от лица · WASD — идти"
          @click="setCamMode('first')"
        >
          От лица
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': camMode === 'fly' }"
          title="Свободный полёт · WASD + Q/E"
          @click="setCamMode('fly')"
        >
          Полёт
        </button>
        <span class="tab-sep"></span>
        <button
          class="tab"
          :class="{ 'tab--active': !!propsWin }"
          title="Свойства выбранного"
          @click="propsWin ? (propsWin = null) : showProps()"
        >
          Свойства
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': fitTarget === 'module' }"
          title="Приблизить выбранный модуль"
          @click="setFit('module')"
        >
          Модуль
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': fitTarget === 'room' }"
          title="Показать комнату целиком"
          @click="setFit('room')"
        >
          Комната
        </button>
        <button
          class="tab"
          popovertarget="view-help"
          title="Горячие клавиши"
        >
          ?
        </button>
        <button class="btn btn--ghost btn--sm" title="Экспорт вида в SVG" @click="exportSvg">
          SVG
        </button>
        <div id="view-help" popover class="popover">
          <h4>Камера</h4>
          <dl>
            <dt>ЛКМ / перетаскивание</dt><dd>орбита</dd>
            <dt>Колесо</dt><dd>зум к курсору</dd>
            <dt>Shift / ПКМ</dt><dd>панорама</dd>
            <dt>Двойной клик</dt><dd>фокус на модуле</dd>
            <dt>F</dt><dd>вписать</dd>
            <dt>0</dt><dd>исходный вид</dd>
            <dt>1–4</dt><dd>изо / фасад / бок / сверху</dd>
            <dt>Esc</dt><dd>снять выделение</dd>
          </dl>
        </div>
      </div>
    </header>
    <div class="view__body" :class="{ 'view__body--drop': dragOver }">
      <canvas
        ref="canvasEl"
        class="view__canvas"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @dblclick="onDoubleClick"
        @wheel.prevent="onWheel"
        @dragover.prevent="onDragOver"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
        @contextmenu.prevent
      ></canvas>
      <div v-if="!state.presentation" class="viewcube-wrap">
        <div
          class="viewcube"
          :style="{
            transform: `rotateX(${-state.camera25.pitch}deg) rotateY(${-state.camera25.yaw}deg)`,
          }"
        >
          <button
            class="viewcube__face viewcube__face--front"
            title="Вид спереди"
            @click="orbitTo(0, 0, 'front')"
          >
            ПЕРЕД
          </button>
          <button
            class="viewcube__face viewcube__face--back"
            title="Вид сзади"
            @click="orbitTo(180, 0, 'back')"
          >
            ЗАД
          </button>
          <button
            class="viewcube__face viewcube__face--right"
            title="Вид справа"
            @click="orbitTo(90, 0, 'side')"
          >
            ПРАВ
          </button>
          <button
            class="viewcube__face viewcube__face--left"
            title="Вид слева"
            @click="orbitTo(-90, 0, 'left')"
          >
            ЛЕВ
          </button>
          <button
            class="viewcube__face viewcube__face--top"
            title="Вид сверху"
            @click="orbitTo(0, 90, 'top')"
          >
            ВЕРХ
          </button>
        </div>
        <button
          class="viewcube__home"
          title="Исходный вид (0)"
          @click="fit('room'); orbitTo(34, 25, 'iso')"
        >
          ⌂
        </button>
      </div>
      <div v-if="!state.presentation" class="wallmode">
        <button
          class="tab"
          :class="{ 'tab--active': state.wallMode === 'cutaway' }"
          title="Стены-срез: видны дальние стены"
          @click="setWallMode('cutaway')"
        >
          Срез
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': state.wallMode === 'low' }"
          title="Низкие стены — открытый обзор"
          @click="setWallMode('low')"
        >
          Низкие
        </button>
      </div>
      <PropsWindow
        v-if="propsWin"
        :x="propsWin.x"
        :y="propsWin.y"
        @close="propsWin = null"
      />
      <GroupPopup
        v-if="groupPopup"
        :x="groupPopup.x"
        :y="groupPopup.y"
        @close="groupPopup = null"
      />
      <PartPopup
        v-if="partPopup"
        :instance-id="partPopup.id"
        :part="partPopup.part"
        :x="partPopup.x"
        :y="partPopup.y"
        @close="partPopup = null"
        @keys="openDetail(partPopup.id, partPopup.part); partPopup = null"
      />
      <ObjectPopup
        v-if="popup && popupInstance"
        :instance="popupInstance"
        :x="popup.x"
        :y="popup.y"
        @close="popup = null"
      />
      <div v-if="!state.presentation" class="minimap" :class="{ 'minimap--open': planOpen }">
        <PlanView :compact="!planOpen" />
        <button
          class="minimap__toggle"
          :title="planOpen ? 'Свернуть план' : 'Развернуть план'"
          @click="planOpen = !planOpen"
        >
          {{ planOpen ? '×' : '⤢' }}
        </button>
      </div>
      <span v-if="!state.presentation" class="view__hint view__hint--right">
        {{ camMode === 'orbit'
          ? 'ЛКМ — вращать · WASD — двигать · колесо — масштаб · Shift / ПКМ — панорама'
          : camMode === 'first'
            ? 'WASD — идти · мышь — смотреть · колесо — угол обзора'
            : 'WASD — лететь · Q/E — вниз/вверх · мышь — смотреть · F — обзор' }}
      </span>
    </div>
  </section>
</template>
