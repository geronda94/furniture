<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BabylonRenderer } from '../render3d/babylonScene'
import {
  beginDrag,
  clearSelection,
  createFolder,
  derived,
  moveSelection,
  openObjectModal,
  partIsOpen,
  partSelection,
  select,
  selectQuiet,
  selectOpening,
  selectFolder,
  selectPart,
  selectWall,
  selectWallItem,
  state,
  togglePart,
  toggleSelection,
  ui,
} from '../state/project'
import PlanView from './PlanView.vue'
import { moduleInfo, relationsFor } from '../module/info'

const canvasEl = ref<HTMLCanvasElement | null>(null)
let renderer: BabylonRenderer | null = null
let ro: ResizeObserver | null = null

const viewName = ref('iso')
const camMode = ref<'orbit' | 'first' | 'fly'>('orbit')
const fitTarget = ref<'module' | 'room'>('room')
const planOpen = ref(false)
const dimLines = ref<{
  x1: number; y1: number; x2: number; y2: number
  tx: number; ty: number; label: string
}[]>([])
const partPill = ref<{ id: string; part: number } | null>(null)
const pillPos = ref({ x: 0, y: 0 })
let dimRaf = 0
let dimLast = 0

function sync(): void {
  if (!renderer) return
  renderer.syncRoom(state.project.room, state.project.materials)
  renderer.syncInstances(state.project.instances, derived, state.project.materials)
  renderer.setSelected(state.selected.length ? [...state.selected]
    : state.selection ? [state.selection] : [])
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
  if (!renderer || !ui.dims3d || !state.selection || state.selected.length > 1) {
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
  const add = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    label: string,
  ) => {
    const p1 = renderer!.project(a.x, a.y, a.z)
    const p2 = renderer!.project(b.x, b.y, b.z)
    out.push({
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      tx: (p1.x + p2.x) / 2,
      ty: (p1.y + p2.y) / 2 - 4,
      label,
    })
  }
  const Wp = (lx: number, ly: number, lz: number) => toWorld(inst, lx, ly, lz)
  add(Wp(x0, y0 - pad, z0), Wp(x1, y0 - pad, z0), `${Math.round(W)}`)
  add(Wp(x1 + pad, y0 - pad, z0), Wp(x1 + pad, y0 - pad, z1), `${Math.round(H)}`)
  add(Wp(x1 + pad, y0, z0), Wp(x1 + pad, y1, z0), `${Math.round(D)}`)

  if (el && info) {
    const rel = relationsFor(info, part)
    if (rel?.above && rel.above.distance > 0) {
      add(Wp(x0 - 34, (y0 + y1) / 2, z1), Wp(x0 - 34, (y0 + y1) / 2, rel.above.to), `${rel.above.distance}`)
    }
    if (rel?.below && rel.below.distance > 0) {
      add(Wp(x0 - 34, (y0 + y1) / 2, rel.below.from), Wp(x0 - 34, (y0 + y1) / 2, z0), `${rel.below.distance}`)
    }
    if (rel?.right && rel.right.distance > 0) {
      add(Wp(x1, (y0 + y1) / 2, z1 + 34), Wp(x1 + rel.right.distance, (y0 + y1) / 2, z1 + 34), `${rel.right.distance}`)
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

function dimLoop(t: number): void {
  if (t - dimLast > 33) {
    dimLast = t
    updateDims()
    updatePartPill()
  }
  dimRaf = requestAnimationFrame(dimLoop)
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

function setView(name: 'iso' | 'front' | 'side' | 'top'): void {
  viewName.value = name
  camMode.value = 'orbit'
  renderer?.setMode('orbit')
  renderer?.setView(name)
}

function setProjection(p: 'persp' | 'ortho'): void {
  renderer?.setProjection(p)
}

function setCamMode(mode: 'orbit' | 'first' | 'fly'): void {
  camMode.value = mode
  renderer?.setMode(mode)
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

function setWallMode(mode: 'cutaway' | 'low'): void {
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
let down: {
  x: number
  y: number
  moved: number
  instanceId?: string
  part?: number
  type: 'instance' | 'wall' | 'opening' | 'wallitem'
  wallIndex?: number
  openingId?: string
  itemId?: string
  move: boolean
  startFloor: { x: number; y: number } | null
  starts: Record<string, { x: number; y: number }>
  dragged: boolean
} | null = null

function canvasPoint(e: PointerEvent): { x: number; y: number } {
  const rect = canvasEl.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onDown(e: PointerEvent): void {
  if (!renderer || !canvasEl.value) return
  partPill.value = null
  const p = canvasPoint(e)
  const hit = renderer.pick(p.x, p.y)
  const starts: Record<string, { x: number; y: number }> = {}
  const isInstance = hit?.type === 'instance' && !!hit.instanceId
  const canDrag = isInstance && ui.dragMove
  if (isInstance) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelection(hit.instanceId!)
    else if (!state.selected.includes(hit.instanceId!)) {
      // клик по фасаду/ящику не должен открывать/закрывать окно настроек
      if (hit.part != null) selectQuiet(hit.instanceId!)
      else select(hit.instanceId!)
    } else if (hit.part == null && !ui.object.open) {
      // модуль уже выбран, но окно закрыли — обычный клик открывает снова
      openObjectModal('quick')
    }
    for (const id of state.selected.length ? state.selected : [hit.instanceId!]) {
      const i = state.project.instances.find((x) => x.id === id)
      if (i) starts[id] = { x: i.x, y: i.y }
    }
  }
  down = {
    x: e.clientX,
    y: e.clientY,
    moved: 0,
    instanceId: hit?.instanceId,
    part: hit?.part,
    type: (hit?.type ?? 'instance') as 'instance' | 'wall' | 'opening' | 'wallitem',
    wallIndex: hit?.wallIndex,
    openingId: hit?.openingId,
    itemId: hit?.itemId,
    move: canDrag,
    startFloor: canDrag ? renderer.floorPoint(p.x, p.y) : null,
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
  moveSelection(floor.x - down.startFloor.x, floor.y - down.startFloor.y, down.starts)
}

function onUp(e: PointerEvent): void {
  if (!down || !renderer) return
  const wasMove = down.move
  const moved = down.moved
  const d = down
  down = null
  if (wasMove) renderer.orbit.attachControl(canvasEl.value!, true)
  if (moved >= 4) return
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
  if (!d.instanceId) {
    clearSelection()
    return
  }
  const inst = state.project.instances.find((i) => i.id === d.instanceId)
  if (!inst) return
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

function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
    t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  const k = e.key.toLowerCase()
  if (k === 'f' || k === 'а') fit(fitTarget.value)
  else if (k === 'escape') clearSelection()
  else if (k === '1') setView('iso')
  else if (k === '2') setView('front')
  else if (k === '3') setView('side')
  else if (k === '4') setView('top')
  else if (k === '0') {
    setView('iso')
    fit('room')
  }
}

watch(() => state.rev, sync)
watch(() => state.project.materials, sync, { deep: true })
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
  },
  { deep: true },
)
watch(() => state.fitToken, () => fit(fitTarget.value))
watch(
  () => state.focusToken,
  () => {
    if (state.focusInstanceId) {
      renderer?.focusInstance(state.focusInstanceId, state.focusView, state.focusLeft)
    }
  },
)

// объектный режим: камера вокруг объекта только в конструкторе
let objectModeOn = false
watch(
  () => [ui.object.open, ui.object.mode, state.selection, state.objectLeft] as const,
  () => {
    const active =
      ui.object.open && ui.object.mode === 'full' && !!state.selection
    if (active && state.selection) {
      objectModeOn = true
      renderer?.enterObjectMode(state.selection, state.objectLeft)
    } else if (objectModeOn) {
      objectModeOn = false
      renderer?.exitObjectMode()
    }
  },
)
watch(() => state.wallMode, (m) => renderer?.setWallMode(m))
watch(() => state.viewMode, (m) => renderer?.setQuality(m))

onMounted(() => {
  if (canvasEl.value) {
    renderer = new BabylonRenderer(canvasEl.value)
    renderer.setWallMode(state.wallMode)
    renderer.setQuality(state.viewMode)
    sync()
    renderer.setSelected(state.selected.length ? [...state.selected]
    : state.selection ? [state.selection] : [])
    renderer.fit('room', state.project.room, null)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__babylon = renderer
    }
  }
  ro = new ResizeObserver(() => renderer?.resize())
  if (canvasEl.value) ro.observe(canvasEl.value)
  window.addEventListener('keydown', onKey)
  dimRaf = requestAnimationFrame(dimLoop)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(dimRaf)
  ro?.disconnect()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <section class="view">
    <header class="view__head">
      <span class="view__title">3D · Babylon</span>
      <div class="view__actions">
        <button class="tab" :class="{ 'tab--active': viewName === 'iso' }" @click="setView('iso')">Изо</button>
        <button class="tab" :class="{ 'tab--active': viewName === 'front' }" @click="setView('front')">Фасад</button>
        <button class="tab" :class="{ 'tab--active': viewName === 'side' }" @click="setView('side')">Бок</button>
        <button class="tab" :class="{ 'tab--active': viewName === 'top' }" @click="setView('top')">Сверху</button>
        <span class="tab-sep"></span>
        <button class="tab" title="Перспектива" @click="setProjection('persp')">Персп</button>
        <button class="tab" title="Ортокамера" @click="setProjection('ortho')">Орто</button>
        <span class="tab-sep"></span>
        <button class="tab" :class="{ 'tab--active': camMode === 'orbit' }" @click="setCamMode('orbit')">Обзор</button>
        <button class="tab" :class="{ 'tab--active': camMode === 'first' }" @click="setCamMode('first')">От лица</button>
        <button class="tab" :class="{ 'tab--active': camMode === 'fly' }" @click="setCamMode('fly')">Полёт</button>
        <span class="tab-sep"></span>
        <button class="tab" :class="{ 'tab--active': ui.dragMove }" title="Перемещение модулей мышью по 3D (по умолчанию выключено)" @click="ui.dragMove = !ui.dragMove">{{ ui.dragMove ? '✥ Двигать' : '🔒 Двигать' }}</button>
        <button class="tab" :class="{ 'tab--active': ui.dims3d }" title="Показывать размеры на 3D" @click="ui.dims3d = !ui.dims3d">Размеры</button>
        <button class="tab" :class="{ 'tab--active': ui.facades }" title="Показывать или скрыть фасады" @click="ui.facades = !ui.facades">Фасады</button>
        <button class="tab" :class="{ 'tab--active': fitTarget === 'module' }" @click="fit('module')">Модуль</button>
        <button class="tab" :class="{ 'tab--active': fitTarget === 'room' }" @click="fit('room')">Комната</button>
        <button class="tab" title="Камера в центр комнаты" @click="centerRoom">Центр</button>
        <button class="tab" popovertarget="view-help3d" title="Горячие клавиши">?</button>
        <button class="btn btn--ghost btn--sm" title="Снимок вида" @click="exportPng">PNG</button>
        <div id="view-help3d" popover class="popover">
          <h4>Камера</h4>
          <dl>
            <dt>ЛКМ / перетаскивание</dt><dd>орбита</dd>
            <dt>Колесо</dt><dd>зум</dd>
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
    <div class="view__body">
      <canvas
        ref="canvasEl"
        class="view__canvas"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @dblclick="onDoubleClick"
        @dragover.prevent
        @drop.prevent="onDrop"
        @contextmenu.prevent
      ></canvas>
      <svg v-if="ui.dims3d && dimLines.length" class="view__dims">
        <g v-for="(d, i) in dimLines" :key="i">
          <line :x1="d.x1" :y1="d.y1" :x2="d.x2" :y2="d.y2" />
          <circle :cx="d.x1" :cy="d.y1" r="1.6" />
          <circle :cx="d.x2" :cy="d.y2" r="1.6" />
          <text :x="d.tx" :y="d.ty">{{ d.label }}</text>
        </g>
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
        <button class="tab" :class="{ 'tab--active': state.wallMode === 'cutaway' }" @click="setWallMode('cutaway')">Срез</button>
        <button class="tab" :class="{ 'tab--active': state.wallMode === 'low' }" @click="setWallMode('low')">Низкие</button>
      </div>
      <div v-if="!state.presentation" class="minimap" :class="{ 'minimap--open': planOpen }">
        <PlanView :compact="!planOpen" />
        <div class="minimap__tools">
          <button class="minimap__btn" title="Приблизить план" @click="planZoom(1.25)">＋</button>
          <button class="minimap__btn" title="Отдалить план" @click="planZoom(0.8)">−</button>
          <button class="minimap__btn" title="Вписать комнату" @click="planFit">⌂</button>
          <button class="minimap__btn minimap__btn--wide" title="Добавить комнату" @click="addRoom">＋комната</button>
        </div>
        <button class="minimap__toggle" @click="planOpen = !planOpen">{{ planOpen ? '×' : '⤢' }}</button>
      </div>
      <span v-if="!state.presentation" class="view__hint view__hint--right">
        {{ camMode === 'orbit'
          ? 'ЛКМ — вращать · перетаскивание модуля — двигать · колесо — масштаб'
          : camMode === 'first'
            ? 'WASD — идти · мышь — смотреть'
            : 'WASD — лететь · Q/E — вниз/вверх · мышь — смотреть' }}
      </span>
    </div>
  </section>
</template>
