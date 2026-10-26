<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildScene } from '../render25d/scene'
import { fitCamera, screenToFloor } from '../render25d/camera'
import { outlinePoints, roomBounds, roomWalls } from '../render25d/room'
import {
  pickObject,
  renderView,
  type DimLine,
} from '../render25d/canvas'
import { clamp } from '../render25d/math'
import type { Face, PlacedObject, Vec3 } from '../render25d/types'
import {
  addInstance,
  beginDrag,
  clearGuides,
  derived,
  MODULE_PRESETS,
  effectiveMaterials,
  partAnimValues,
  resizeInstance,
  select,
  selectOpening,
  selectWall,
  moveSelection,
  selectedInstance,
  setPlacement,
  setRoom,
  state,
  toggleSelection,
  updateOpening,
} from '../state/project'
import type { Projector } from '../render25d/camera'
import { resolveObjectMaterial } from '../material/vars'

const props = defineProps<{ compact?: boolean }>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const dragOver = ref(false)

let ctx: CanvasRenderingContext2D | null = null
let w = 0
let h = 0
let dpr = 1
let raf = 0
let fitted = false
let fitW = 0
let fitH = 0
let touched = false
let faces: Face[] = []
let ro: ResizeObserver | null = null
let planProj: Projector | null = null
let wallDrag:
  | { kind: 'opening'; id: string; moved: boolean }
  | {
      kind: 'partition'
      index: number
      start: [number, number]
      parts: { a: [number, number]; b: [number, number]; wallT?: number }[]
      moved: boolean
    }
  | null = null

let drag: {
  id: string
  sx: number
  sy: number
  ox: number
  oy: number
} | null = null
let panning = false
let lastX = 0
let lastY = 0

/* Мультитач и плавный зум */
const pointers = new Map<number, { x: number; y: number }>()
let pinch: {
  dist: number
  zoom: number
  world: [number, number] | null
} | null = null
let zoomTarget = state.cameraPlan.zoom
let zoomRaf = 0
let zoomTs = 0
let handles: { kind: 'w' | 'd'; x: number; y: number }[] = []
let resizing: {
  kind: 'w' | 'd'
  id: string
  startX: number
  startY: number
  startW: number
  startD: number
} | null = null

function placedObjects(): PlacedObject[] {
  const out: PlacedObject[] = []
  for (const inst of state.project.instances) {
    const d = derived[inst.id]
    if (!d) continue
    const mats = effectiveMaterials(inst)
    const realistic = state.viewMode !== 'schematic'
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
        materials: mats,
        material: realistic
          ? resolveObjectMaterial(
              state.project.materials,
              state.project.materialVars,
              inst,
              o,
              part,
            )
          : undefined,
      })
    })
  }
  return out
}

function fit() {
  const room = state.project.room
  const outline = outlinePoints(room)
  const pts: Vec3[] = outline.map((p) => [p.x, p.y, 0] as Vec3)
  state.cameraPlan = fitCamera(
    state.cameraPlan,
    pts,
    w,
    h,
    props.compact ? 0.08 : 0.2,
  )
  zoomTarget = state.cameraPlan.zoom
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
  const room = state.project.room
  const scene = buildScene({
    objects: placedObjects(),
    room,
    camera: state.cameraPlan,
    materials: state.project.materials,
    width: w,
    height: h,
    style: state.viewMode,
    wallMode: state.wallMode,
  })
  faces = scene.faces
  const proj = scene.projector
  planProj = proj


  const bounds = roomBounds(room)
  const dims: DimLine[] = [
    {
      a: proj.point([bounds.minX, bounds.minY, 0]),
      b: proj.point([bounds.maxX, bounds.minY, 0]),
      label: `${Math.round(bounds.maxX - bounds.minX)}`,
      offset: 30,
    },
    {
      a: proj.point([bounds.minX, bounds.minY, 0]),
      b: proj.point([bounds.minX, bounds.maxY, 0]),
      label: `${Math.round(bounds.maxY - bounds.minY)}`,
      offset: -30,
    },
  ]

  const inst = selectedInstance.value
  const d = inst ? derived[inst.id] : null
  if (inst && d) {
    const W = d.corpus.W
    const D = d.corpus.D
    const rad = (inst.rot * Math.PI) / 180
    const cs = Math.cos(rad)
    const sn = Math.sin(rad)
    const p = (lx: number, ly: number): Vec3 => [
      inst.x + lx * cs - ly * sn,
      inst.y + lx * sn + ly * cs,
      0,
    ]
    dims.push({
      a: proj.point(p(0, 0)),
      b: proj.point(p(W, 0)),
      label: `${W}`,
      offset: 18,
    })
    dims.push({
      a: proj.point(p(0, 0)),
      b: proj.point(p(0, D)),
      label: `${D}`,
      offset: -18,
    })
  }

  renderView(ctx, {
    width: w,
    height: h,
    dpr,
    faces,
    projector: proj,
    room,
    mode: 'plan',
    style: state.viewMode,
    selection: state.selection,
    selections: state.selected.length ? state.selected : [],
    dims: props.compact ? [] : dims,
  })

  // Декор демо-сцены: кровать, диван, сантехника.
  for (const pr of state.project.props ?? []) {
    const rad = ((pr.rot || 0) * Math.PI) / 180
    const cs = Math.cos(rad)
    const sn = Math.sin(rad)
    const corner = (lx: number, ly: number): Vec3 => [
      pr.x + lx * cs - ly * sn,
      pr.y + lx * sn + ly * cs,
      0,
    ]
    const pts = [
      corner(-pr.w / 2, -pr.d / 2), corner(pr.w / 2, -pr.d / 2),
      corner(pr.w / 2, pr.d / 2), corner(-pr.w / 2, pr.d / 2),
    ].map((q) => proj.point(q))
    ctx.save()
    ctx.globalAlpha = 0.62
    ctx.fillStyle = pr.color || '#8b8f95'
    ctx.strokeStyle = 'rgba(18, 21, 24, 0.85)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.globalAlpha = 1
    if (!props.compact && pr.w * pr.d > 500000) {
      ctx.fillStyle = 'rgba(235, 238, 240, 0.9)'
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      const mid = proj.point([pr.x, pr.y, 0])
      ctx.fillText(pr.name, mid.x, mid.y)
    }
    ctx.restore()
  }

  // Отделка пола: зоны плитки/ламината (схематично, полупрозрачно)
  for (const f of state.project.finishes ?? []) {
    if (f.kind !== 'floor') continue
    const pts = [
      [f.x, f.y], [f.x + f.w, f.y],
      [f.x + f.w, f.y + f.d], [f.x, f.y + f.d],
    ].map((p) => proj.point([p[0], p[1], 0]))
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = f.color
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 0.9
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = f.color
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(230,235,240,0.9)'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    const mid = proj.point([f.x + f.w / 2, f.y + f.d / 2, 0])
    ctx.textAlign = 'center'
    const area = Math.round((f.w * f.d) / 10000) / 100
    ctx.fillText(`${f.name} · ${area} м²`, mid.x, mid.y)
    ctx.restore()
  }

  // направляющие привязки
  const gx = state.guides?.x ?? null
  const gy = state.guides?.y ?? null
  if (gx != null || gy != null) {
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(87, 199, 184, 0.95)'
    if (gx != null) {
      const a = proj.point([gx, 0, 0])
      const b = proj.point([gx, room.d, 0])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    if (gy != null) {
      const a = proj.point([0, gy, 0])
      const b = proj.point([room.w, gy, 0])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // маркеры изменения размеров (только в раскрытом плане)
  handles = []
  const sel = selectedInstance.value
  if (!props.compact && sel) {
    const W = sel.params.W
    const D = sel.params.D
    const rad = (sel.rot * Math.PI) / 180
    const cs = Math.cos(rad)
    const sn = Math.sin(rad)
    const world = (lx: number, ly: number): Vec3 => [
      sel.x + lx * cs - ly * sn,
      sel.y + lx * sn + ly * cs,
      0,
    ]
    const hw = proj.point(world(W, D / 2))
    const hd = proj.point(world(W / 2, D))
    handles = [
      { kind: 'w', x: hw.x, y: hw.y },
      { kind: 'd', x: hd.x, y: hd.y },
    ]
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__planHandles = handles
    }
    for (const h of handles) {
      ctx.save()
      ctx.fillStyle = 'rgba(224, 163, 62, 0.95)'
      ctx.strokeStyle = 'rgba(20, 22, 26, 0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.rect(h.x - 4, h.y - 4, 8, 8)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }
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
    state.cameraPlan,
    w,
    h,
  )
  const W = preset.params.W ?? 600
  const D = preset.params.D ?? 560
  addInstance(key, p[0] - W / 2, p[1] - D / 2)
}

function invalidate() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    draw()
  })
}

function screenSeg(
  a: { x: number; y: number },
  dx: number,
  dy: number,
  s0: number,
  s1: number,
): [{ x: number; y: number }, { x: number; y: number }] {
  const p = planProj!
  return [
    p.point([a.x + dx * s0, a.y + dy * s0, 0]),
    p.point([a.x + dx * s1, a.y + dy * s1, 0]),
  ]
}

function distToSeg(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 < 1e-6) return Math.hypot(px - a.x, py - a.y)
  let t = ((px - a.x) * vx + (py - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t))
}

function hitOpening(x: number, y: number): string | null {
  if (!planProj) return null
  const room = state.project.room
  const walls = roomWalls(room)
  for (const o of room.openings) {
    const seg = walls.find((w) => w.index === o.wall)
    if (!seg) continue
    const [a, b] = screenSeg(seg.a, seg.dx, seg.dy, o.x, o.x + o.w)
    if (distToSeg(x, y, a, b) < 26) return o.id
  }
  return null
}

function hitPartition(x: number, y: number): number | null {
  if (!planProj) return null
  for (const seg of roomWalls(state.project.room)) {
    if (seg.outer) continue
    const a = planProj.point([seg.a.x, seg.a.y, 0])
    const b = planProj.point([seg.b.x, seg.b.y, 0])
    if (distToSeg(x, y, a, b) < 18) return seg.index
  }
  return null
}

function onDown(e: PointerEvent) {
  const c = canvasEl.value
  if (!c) return
  touched = true
  c.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (e.pointerType === 'touch' && pointers.size === 2) {
    startPinch()
    return
  }
  if (pointers.size > 1) return
  const r = c.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top

  if (!props.compact && e.button === 0) {
    const handle = handles.find(
      (h) => Math.hypot(h.x - x, h.y - y) <= 10,
    )
    const inst = selectedInstance.value
    if (handle && inst) {
      beginDrag()
      const f = screenToFloor(x, y, state.cameraPlan, w, h)
      resizing = {
        kind: handle.kind,
        id: inst.id,
        startX: f[0],
        startY: f[1],
        startW: inst.params.W,
        startD: inst.params.D,
      }
      return
    }
  }

  // проёмы и перегородки: тянем прямо на плане
  if (e.button === 0) {
    const opening = hitOpening(x, y)
    if (opening) {
      selectOpening(opening, false)
      beginDrag()
      wallDrag = { kind: 'opening', id: opening, moved: false }
      return
    }
    const part = hitPartition(x, y)
    if (part != null) {
      selectWall(part, false)
      beginDrag()
      const parts = (state.project.room.partitions ?? []).map((p) => ({
        a: [...p.a] as [number, number],
        b: [...p.b] as [number, number],
        wallT: p.wallT,
      }))
      const f = screenToFloor(x, y, state.cameraPlan, w, h)
      wallDrag = {
        kind: 'partition',
        index: part,
        start: [f[0], f[1]],
        parts,
        moved: false,
      }
      return
    }
  }

  const hit = pickObject(faces, x, y)

  if (hit && e.button === 0) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelection(hit)
    else if (!state.selected.includes(hit)) select(hit)
    const inst = state.project.instances.find((i) => i.id === hit)
    if (inst) {
      beginDrag()
      const f = screenToFloor(x, y, state.cameraPlan, w, h)
      drag = {
        id: hit,
        sx: f[0],
        sy: f[1],
        ox: inst.x,
        oy: inst.y,
      }
    }
  } else {
    panning = true
  }
  lastX = e.clientX
  lastY = e.clientY
}

function onMove(e: PointerEvent) {
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  if (pinch) {
    movePinch()
    return
  }
  if (wallDrag) {
    const r = canvasEl.value?.getBoundingClientRect()
    if (!r || !planProj) return
    const f = screenToFloor(
      e.clientX - r.left,
      e.clientY - r.top,
      state.cameraPlan,
      w,
      h,
    )
    wallDrag.moved = true
    if (wallDrag.kind === 'opening') {
      const room = state.project.room
      const o = room.openings.find((x) => x.id === wallDrag!.id)
      const seg = roomWalls(room).find((x) => x.index === o?.wall)
      if (o && seg) {
        const s = (f[0] - seg.a.x) * seg.dx + (f[1] - seg.a.y) * seg.dy
        const nx = clamp(
          Math.round((s - o.w / 2) / 10) * 10,
          0,
          Math.max(0, seg.len - o.w),
        )
        updateOpening(o.id, { x: nx }, false)
      }
    } else {
      const dx = f[0] - wallDrag.start[0]
      const dy = f[1] - wallDrag.start[1]
      setRoom(
        {
          partitions: wallDrag.parts.map((p) => ({
            a: [Math.round(p.a[0] + dx), Math.round(p.a[1] + dy)] as [
              number,
              number,
            ],
            b: [Math.round(p.b[0] + dx), Math.round(p.b[1] + dy)] as [
              number,
              number,
            ],
            wallT: p.wallT,
          })),
        },
        false,
      )
    }
    return
  }
  if (resizing) {
    const r = canvasEl.value?.getBoundingClientRect()
    if (!r) return
    const f = screenToFloor(
      e.clientX - r.left,
      e.clientY - r.top,
      state.cameraPlan,
      w,
      h,
    )
    // тянем вдоль локальных осей модуля (с учётом поворота)
    const inst = state.project.instances.find((i) => i.id === resizing!.id)
    const rad = ((inst?.rot ?? 0) * Math.PI) / 180
    const cs = Math.cos(rad)
    const sn = Math.sin(rad)
    const dx = f[0] - resizing.startX
    const dy = f[1] - resizing.startY
    if (resizing.kind === 'w') {
      const along = dx * cs + dy * sn
      const nw = Math.round((resizing.startW + along) / 10) * 10
      resizeInstance(resizing.id, { W: nw })
    } else {
      const along = -dx * sn + dy * cs
      const nd = Math.round((resizing.startD + along) / 10) * 10
      resizeInstance(resizing.id, { D: nd })
    }
    return
  }
  if (drag) {
    const r = canvasEl.value?.getBoundingClientRect()
    if (!r) return
    const f = screenToFloor(
      e.clientX - r.left,
      e.clientY - r.top,
      state.cameraPlan,
      w,
      h,
    )
    const ids = state.selected.length ? state.selected : [drag.id]
    const starts: Record<string, { x: number; y: number }> = {}
    for (const id of ids) {
      const i = state.project.instances.find((v) => v.id === id)
      if (i) starts[id] = { x: i.x, y: i.y }
    }
    moveSelection(f[0] - drag.sx, f[1] - drag.sy, starts)
    return
  }
  if (!panning) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  const t = state.cameraPlan.target
  t[0] -= dx / state.cameraPlan.zoom
  t[1] += dy / state.cameraPlan.zoom
  invalidate()
}

function onUp(e?: PointerEvent) {
  if (e) pointers.delete(e.pointerId)
  if (pinch) {
    if (pointers.size < 2) {
      pinch = null
      const rest = pointers.values().next().value
      if (rest) {
        lastX = rest.x
        lastY = rest.y
      }
    }
    return
  }
  if (drag) state.followToken++
  if (wallDrag && !wallDrag.moved) {
    if (wallDrag.kind === 'opening') selectOpening(wallDrag.id)
    else selectWall(wallDrag.index)
  }
  drag = null
  panning = false
  resizing = null
  wallDrag = null
  clearGuides()
}

function startPinch(): void {
  const a = [...pointers.values()]
  if (a.length < 2) return
  const r = canvasEl.value?.getBoundingClientRect()
  if (!r) return
  drag = null
  panning = false
  resizing = null
  wallDrag = null
  cancelAnimationFrame(zoomRaf)
  zoomRaf = 0
  zoomTarget = state.cameraPlan.zoom
  const [p1, p2] = a
  const mx = (p1.x + p2.x) / 2 - r.left
  const my = (p1.y + p2.y) / 2 - r.top
  const world = screenToFloor(mx, my, state.cameraPlan, w, h)
  pinch = {
    dist: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
    zoom: state.cameraPlan.zoom,
    world: world ? [world[0], world[1]] : null,
  }
  clearGuides()
}

function movePinch(): void {
  const a = [...pointers.values()]
  const r = canvasEl.value?.getBoundingClientRect()
  if (!pinch || a.length < 2 || !r) return
  const [p1, p2] = a
  const dist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y))
  const mx = (p1.x + p2.x) / 2 - r.left
  const my = (p1.y + p2.y) / 2 - r.top
  touched = true
  state.cameraPlan.zoom = clamp(pinch.zoom * (dist / pinch.dist), 0.02, 3)
  const cur = screenToFloor(mx, my, state.cameraPlan, w, h)
  if (pinch.world && cur) {
    state.cameraPlan.target[0] += pinch.world[0] - cur[0]
    state.cameraPlan.target[1] += pinch.world[1] - cur[1]
  }
  invalidate()
}

function zoomFrame(ts: number): void {
  const dt = Math.max(1, ts - zoomTs)
  zoomTs = ts
  const k = 1 - Math.exp(-dt / 90)
  const next = state.cameraPlan.zoom +
    (zoomTarget - state.cameraPlan.zoom) * k
  if (Math.abs(next - zoomTarget) < 0.0004) {
    state.cameraPlan.zoom = zoomTarget
    zoomRaf = 0
    invalidate()
    return
  }
  state.cameraPlan.zoom = next
  invalidate()
  zoomRaf = requestAnimationFrame(zoomFrame)
}

function onWheel(e: WheelEvent) {
  touched = true
  let delta = e.deltaY
  if (e.deltaMode === 1) delta *= 16
  else if (e.deltaMode === 2) delta *= 400
  // трекпад/пинч-жест в браузере приходит с ctrlKey — чуть чувствительнее
  const k = Math.exp(-delta * (e.ctrlKey ? 0.004 : 0.0014))
  zoomTarget = clamp(zoomTarget * k, 0.02, 3)
  if (!zoomRaf) {
    zoomTs = performance.now()
    zoomRaf = requestAnimationFrame(zoomFrame)
  }
}

watch(
  () => props.compact,
  async () => {
    await nextTick()
    fitted = false
    resize()
    invalidate()
  },
)
watch(() => state.rev, invalidate)
watch(
  () => state.cameraPlan,
  () => {
    if (!zoomRaf) zoomTarget = state.cameraPlan.zoom
    invalidate()
  },
  { deep: true },
)
watch(
  () => state.fitToken,
  () => {
    fitted = false
    fit()
    invalidate()
  },
)

function onTexture() {
  invalidate()
}

onMounted(() => {
  window.addEventListener('furniture:texture', onTexture)
  ro = new ResizeObserver(resize)
  if (canvasEl.value) ro.observe(canvasEl.value)
  resize()
})

onBeforeUnmount(() => {
  window.removeEventListener('furniture:texture', onTexture)
  ro?.disconnect()
  cancelAnimationFrame(raf)
  cancelAnimationFrame(zoomRaf)
})
</script>

<template>
  <section class="view" :class="{ 'view--mini': props.compact }">
    <header class="view__head">
      <span class="view__title">
        {{ props.compact ? 'План' : 'План · 1 : 20' }}
      </span>
      <div class="view__actions">
        <span v-if="!props.compact" class="dim">
          {{ state.project.room.w }} × {{ state.project.room.d }}
        </span>
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
        @wheel.prevent="onWheel"
        @dragover.prevent="onDragOver"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
        @contextmenu.prevent
      ></canvas>
      <span v-if="!props.compact" class="view__hint">
        Тянуть модуль — двигать · маркеры — размер · колесо — масштаб · ПКМ —
        панорама
      </span>
    </div>
  </section>
</template>
