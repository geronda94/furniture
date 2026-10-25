/* eslint-disable */
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildScene } from '../render25d/scene'
import { fitCamera } from '../render25d/camera'
import {
  drawDims,
  inkAt,
  pickPart,
  renderView,
  type DimLine,
} from '../render25d/canvas'
import { clamp } from '../render25d/math'
import type { Camera, Face, Materials, PlacedObject, Vec3 } from '../render25d/types'
import { derived, effectiveMaterials, partAnimValues, state } from '../state/project'
import { moduleInfo, relationsFor, sizeLabel } from '../module/info'
import { resolveObjectMaterial } from '../material/vars'

const props = withDefaults(
  defineProps<{
    instanceId: string
    height?: number
    showDims?: boolean
    compact?: boolean
    part?: number | null
    drawerId?: number | null
    fill?: boolean
    view?: 'iso' | 'front' | 'side' | 'top'
    schematic?: boolean
  }>(),
  { height: 190, showDims: false, compact: false, part: null,
    drawerId: null, fill: false, view: 'iso', schematic: false },
)

const emit = defineEmits<{
  (e: 'pick', part: number | null): void
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let w = 0
let h = 0
let dpr = 1
let raf = 0
let ro: ResizeObserver | null = null

const cam = ref<Camera>({
  yaw: 34,
  pitch: 18,
  zoom: 0.2,
  target: [0, 0, 0],
  projection: 'persp',
  distance: 3000,
  fov: 32,
})

let faces: Face[] = []
let corners: Vec3[] = []
let fitted = false
let touched = false

let drag = false
let moved = 0
let lastX = 0
let lastY = 0

function visible(i: number): boolean {
  if (props.drawerId == null) return true
  const o = derived[props.instanceId]?.objects[i]
  return !!o && o.drawer_id === props.drawerId
}

function sceneMaterials(): Materials {
  const inst = state.project.instances.find((i) => i.id === props.instanceId)
  const base = effectiveMaterials(inst)
  if (!props.schematic) return base
  const out: Materials = {}
  for (const [key, m] of Object.entries(base)) {
    const light =
      key === 'facade' ? '#c9c9c9' :
      key === 'drawer' ? '#bdbdbd' :
      key === 'back' ? '#efefef' :
      key === 'worktop' ? '#d6d6d6' :
      key === 'plinth' ? '#b8b8b8' :
      '#e4e4e4'
    out[key] = {
      ...m,
      color: light,
      accent: '#9a9a9a',
      pattern: 'solid',
      texture: undefined,
      texScale: undefined,
    }
  }
  return out
}

function objects(): PlacedObject[] {
  const d = derived[props.instanceId]
  if (!d) return []
  const inst = state.project.instances.find((i) => i.id === props.instanceId)
  return d.objects.map((o, index) => ({
    object: o,
    placement: { id: props.instanceId, x: 0, y: 0, rot: 0 },
    anim: partAnimValues(inst, index),
    part: index,
    material: !props.schematic && inst
      ? resolveObjectMaterial(
          state.project.materials,
          state.project.materialVars,
          inst,
          o,
        )
      : undefined,
  })).filter((p) => visible(p.part))
}

function computeCorners(): void {
  const d = derived[props.instanceId]
  if (!d) {
    corners = []
    return
  }
  const out: Vec3[] = []
  for (let oi = 0; oi < d.objects.length; oi++) {
    if (!visible(oi)) continue
    const o = d.objects[oi]
    for (const ix of [0, 1]) {
      for (const iy of [0, 1]) {
        for (const iz of [0, 1]) {
          out.push([o.x + ix * o.sx, o.y + iy * o.sy, o.z + iz * o.sz])
        }
      }
    }
  }
  corners = out
}

function fit(): void {
  if (!corners.length || w < 2 || h < 2) return
  cam.value = fitCamera(
    cam.value,
    corners,
    w,
    h,
    props.fill ? 0.06 : props.compact ? 0.24 : 0.18,
  )
  fitted = true
  touched = false
}

function resize(): void {
  const c = canvasEl.value
  if (!c) return
  const r = c.getBoundingClientRect()
  dpr = Math.min(props.schematic ? 1.25 : 2, window.devicePixelRatio || 1)
  w = Math.max(1, Math.round(r.width))
  h = Math.max(1, Math.round(r.height))
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  ctx = c.getContext('2d')
  computeCorners()
  if (!fitted || !touched) fit()
  invalidate()
}

function dimsFor(
  info: NonNullable<ReturnType<typeof moduleInfo>>,
  proj: ReturnType<typeof buildScene>['projector'],
  sel: number | null,
): DimLine[] {
  const P = (p: Vec3) => {
    const q = proj.point(p)
    return { x: q.x, y: q.y }
  }
  const out: DimLine[] = []
  const W = info.W
  const D = info.D
  const H = info.totalH
  // габариты модуля — только когда деталь не выбрана, иначе подписи
  // перекрывают размеры выбранной полки/ящика
  if (sel == null) {
    out.push({ a: P([0, -30, 0]), b: P([W, -30, 0]), label: `${W}`, offset: -16 })
    out.push({ a: P([-30, 0, 0]), b: P([-30, 0, H]), label: `${H}`, offset: 16 })
    out.push({ a: P([W + 30, 0, 0]), b: P([W + 30, D, 0]), label: `${D}`, offset: 16 })
  }

  if (sel != null) {
    const e = info.elements[sel]
    if (e) {
      const y = e.y + e.d / 2
      out.push({
        a: P([e.x, y, e.z + e.h]),
        b: P([e.x + e.w, y, e.z + e.h]),
        label: `${Math.round(e.w)}`,
        offset: -14,
      })
      out.push({
        a: P([e.x, y, e.z]),
        b: P([e.x, y, e.z + e.h]),
        label: `${Math.round(e.h)}`,
        offset: -14,
      })
      out.push({
        a: P([e.x + e.w / 2, e.y, e.z + e.h]),
        b: P([e.x + e.w / 2, e.y + e.d, e.z + e.h]),
        label: `${Math.round(e.d)}`,
        offset: 14,
      })
      // относительные размеры: до соседней полки/крышки/дна/перегородки
      const rel = relationsFor(info, sel)
      const yMid = e.y + e.d / 2
      if (rel?.above && rel.above.distance > 0) {
        out.push({
          a: P([e.x - 60, yMid, e.z + e.h]),
          b: P([e.x - 60, yMid, rel.above.to]),
          label: `${rel.above.distance}`,
          offset: -12,
        })
      }
      if (rel?.below && rel.below.distance > 0) {
        out.push({
          a: P([e.x - 60, yMid, rel.below.from]),
          b: P([e.x - 60, yMid, e.z]),
          label: `${rel.below.distance}`,
          offset: -12,
        })
      }
      if (rel?.right && rel.right.distance > 0 && rel.right.distance < 2000) {
        out.push({
          a: P([e.x + e.w, yMid, e.z + e.h + 60]),
          b: P([e.x + e.w + rel.right.distance, yMid, e.z + e.h + 60]),
          label: `${rel.right.distance}`,
          offset: 10,
        })
      }
      if (rel?.left && rel.left.distance > 0 && rel.left.distance < 2000) {
        out.push({
          a: P([e.x - rel.left.distance, yMid, e.z + e.h + 60]),
          b: P([e.x, yMid, e.z + e.h + 60]),
          label: `${rel.left.distance}`,
          offset: 10,
        })
      }
    }
  }
  return out
}

function draw(): void {
  if (!ctx) return
  const objectsList = objects()
  if (!objectsList.length) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    return
  }
  const info = moduleInfo(
    state.project.instances.find((i) => i.id === props.instanceId) ?? {
      params: { W: 0, H: 0, D: 0 },
    } as never,
    derived[props.instanceId]?.objects,
  )

  const scene = buildScene({
    objects: objectsList,
    camera: cam.value,
    materials: sceneMaterials(),
    width: w,
    height: h,
    style: props.schematic ? 'schematic' : 'realistic',
    wallMode: 'cutaway',
  })
  faces = scene.faces

  renderView(ctx, {
    width: w,
    height: h,
    dpr,
    faces,
    projector: scene.projector,
    room: {
      w: info?.W ?? 600,
      d: info?.D ?? 500,
      h: info?.totalH ?? 700,
    },
    mode: 'persp',
    style: props.schematic ? 'schematic' : 'realistic',
    background: props.schematic ? 'light' : 'dark',
    selection: null,
  })

  const proj = scene.projector
  const sel = props.part

  // выбранная деталь — заметная заливка поверх схемы
  if (sel != null) {
    for (const f of faces) {
      if (f.objectId !== props.instanceId || f.part !== sel) continue
      if (!f.pts.length) continue
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(f.pts[0].x, f.pts[0].y)
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(224, 163, 62, 0.34)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 205, 105, 0.95)'
      ctx.lineWidth = 1.6
      ctx.stroke()
      ctx.restore()
    }
  }

  // выделение детали: габаритная рамка + подпись с размерами
  if (info && sel != null && info.elements[sel]) {
    const e = info.elements[sel]
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const ix of [0, 1]) {
      for (const iy of [0, 1]) {
        for (const iz of [0, 1]) {
          const q = proj.point([
            e.x + ix * e.w,
            e.y + iy * e.d,
            e.z + iz * e.h,
          ])
          minX = Math.min(minX, q.x)
          minY = Math.min(minY, q.y)
          maxX = Math.max(maxX, q.x)
          maxY = Math.max(maxY, q.y)
        }
      }
    }
    const ink = inkAt(faces, (minX + maxX) / 2, (minY + maxY) / 2)
    ctx.save()
    ctx.strokeStyle = ink.halo
    ctx.lineWidth = 3
    ctx.setLineDash([4, 3])
    ctx.strokeRect(minX - 3, minY - 3, maxX - minX + 6, maxY - minY + 6)
    ctx.strokeStyle = ink.ink
    ctx.lineWidth = 1.2
    ctx.strokeRect(minX - 3, minY - 3, maxX - minX + 6, maxY - minY + 6)
    ctx.setLineDash([])
    const label = `${e.title} · ${sizeLabel(e)}`
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(label).width
    const plate = inkAt(faces, minX + tw / 2, minY - 11)
    ctx.fillStyle = plate.plate
    ctx.strokeStyle = plate.halo
    ctx.beginPath()
    ctx.roundRect(minX - 3, minY - 19, tw + 12, 16, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = plate.text
    ctx.fillText(label, minX + 3, minY - 11)
    ctx.restore()
  }

  if (info && props.showDims) {
    drawDims(ctx, dimsFor(info, proj, sel), faces)
  }
}

function invalidate(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    draw()
  })
}

function zoomBy(k: number): void {
  touched = true
  cam.value = {
    ...cam.value,
    distance: clamp((cam.value.distance ?? 3500) * k, 200, 40000),
  }
  invalidate()
}

function fitView(): void {
  touched = false
  computeCorners()
  fit()
  invalidate()
}

function orbitTo(yaw: number, pitch: number): void {
  touched = true
  cam.value = { ...cam.value, yaw, pitch }
  const keep = cam.value
  computeCorners()
  if (corners.length) {
    cam.value = fitCamera(keep, corners, w, h, props.fill ? 0.06 : props.compact ? 0.24 : 0.18)
  }
  invalidate()
}

function pick(e: PointerEvent): void {
  const c = canvasEl.value
  if (!c) return
  const r = c.getBoundingClientRect()
  const hit = pickPart(faces, e.clientX - r.left, e.clientY - r.top)
  emit('pick', hit ? hit.part : null)
}

function onDown(e: PointerEvent): void {
  const c = canvasEl.value
  if (!c) return
  c.setPointerCapture(e.pointerId)
  drag = true
  moved = 0
  lastX = e.clientX
  lastY = e.clientY
}

function onMove(e: PointerEvent): void {
  if (!drag) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  moved += Math.abs(dx) + Math.abs(dy)
  if (moved < 2) return
  touched = true
  cam.value = {
    ...cam.value,
    yaw: cam.value.yaw - dx * 0.4,
    pitch: clamp(cam.value.pitch - dy * 0.32, -25, 88),
  }
  invalidate()
}

function onUp(e: PointerEvent): void {
  if (drag && moved < 3) pick(e)
  drag = false
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  touched = true
  const factor = Math.exp(-e.deltaY * 0.0012)
  cam.value = {
    ...cam.value,
    distance: clamp((cam.value.distance ?? 3500) / factor, 200, 40000),
  }
  invalidate()
}

watch(
  () => props.view,
  (v) => {
    if (v === 'front') orbitTo(0, 0)
    else if (v === 'side') orbitTo(90, 0)
    else if (v === 'top') orbitTo(0, 87)
    else orbitTo(34, 18)
  },
)
watch(
  () => [props.instanceId, props.drawerId],
  () => {
    fitted = false
    touched = false
    computeCorners()
    fit()
    invalidate()
  },
)
watch(
  () => [props.part, props.showDims, props.schematic],
  () => {
    computeCorners()
    if (!touched) fit()
    invalidate()
  },
)
watch(
  () => state.rev,
  () => {
    computeCorners()
    if (!touched) fit()
    invalidate()
  },
)

onMounted(() => {
  ro = new ResizeObserver(resize)
  if (canvasEl.value) ro.observe(canvasEl.value)
  resize()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="module-preview" :style="fill ? { height: '100%' } : { height: `${height}px` }">
    <canvas
      ref="canvasEl"
      class="module-preview__canvas"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @wheel="onWheel"
    ></canvas>
    <div class="module-preview__views">
      <button class="tab tab--sm" title="Изометрия" @click="orbitTo(34, 18)">
        Изо
      </button>
      <button class="tab tab--sm" title="Фасад" @click="orbitTo(0, 0)">
        Фасад
      </button>
      <button class="tab tab--sm" title="Бок" @click="orbitTo(90, 0)">
        Бок
      </button>
      <button class="tab tab--sm" title="Сверху" @click="orbitTo(0, 87)">
        Верх
      </button>
      <button class="tab tab--sm" title="Приблизить" @click="zoomBy(0.8)">＋</button>
      <button class="tab tab--sm" title="Отдалить" @click="zoomBy(1.25)">−</button>
      <button class="tab tab--sm" title="Вписать" @click="fitView">⤢</button>
    </div>
  </div>
</template>
