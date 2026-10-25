<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import '@babylonjs/core/Rendering/edgesRenderer'
import '@babylonjs/core/Culling/ray'
import type { AssemblyOperation, EdgeSide } from '../api'

const props = withDefaults(defineProps<{
  partKind?: string
  w: number
  h: number
  t?: number
  color?: string
  operations: AssemblyOperation[]
  edges?: Record<string, EdgeSide>
}>(), { partKind: 'side', t: 16, color: '#cfcfcf', edges: () => ({}) })

const host = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
let engine: Engine | null = null
let scene: Scene | null = null
let ro: ResizeObserver | null = null
let hoverMesh: Mesh | null = null
let pointerHandler: ((e: PointerEvent) => void) | null = null
let leaveHandler: (() => void) | null = null
const tip = ref<{ x: number; y: number; title: string; lines: string[] } | null>(null)

const KIND_LABEL: Record<string, string> = {
  fastener_face: 'Крепёж: отверстие в пласти',
  fastener_end: 'Крепёж: отверстие в торце',
  hinge_cup: 'Чашка петли',
  hinge_plate: 'Ответная планка',
  shelf_pin: 'Полкодержатель',
  slide_mount: 'Направляющая: корпус',
  slide_box: 'Направляющая: ящик',
  handle: 'Ручка',
  gas_strut: 'Газовый патрон',
  leg_mount: 'Крепление опоры / колеса',
  screw_front: 'Саморез фасада ящика',
  system32: 'System 32',
}

type Axis = 'x' | 'y' | 'z'
interface Dims { x: number; y: number; z: number; mode: 'thin' | 'flat' | 'panel' }

function dims(): Dims {
  const t = Math.max(2, props.t || 16)
  const k = props.partKind
  if (k === 'side' || k === 'divider' || k === 'drawer_side') {
    return { x: t, y: props.h, z: props.w, mode: 'thin' }
  }
  if (k === 'horizontal' || k === 'shelf') {
    return { x: props.w, y: t, z: props.h, mode: 'flat' }
  }
  return { x: props.w, y: props.h, z: t, mode: 'panel' }
}

function facePoint(
  mx: number, my: number, face = '',
): { x: number; y: number; z: number; normal: Axis; sign: number } {
  const d = dims()
  if (d.mode === 'thin') {
    return { x: d.x / 2, y: my - props.h / 2, z: mx - props.w / 2, normal: 'x', sign: 1 }
  }
  if (d.mode === 'flat') {
    const bottom = /сниз|нижн/i.test(face)
    return {
      x: mx - props.w / 2,
      y: (bottom ? -1 : 1) * d.y / 2,
      z: my - props.h / 2,
      normal: 'y',
      sign: bottom ? -1 : 1,
    }
  }
  return { x: mx - props.w / 2, y: my - props.h / 2, z: d.z / 2, normal: 'z', sign: 1 }
}

function hex(c: string): Color3 {
  try { return Color3.FromHexString(c) } catch { return new Color3(0.7, 0.7, 0.7) }
}

function edgeVisuals(): { x: number; y: number; z: number; color: string; label: string; thickness: number }[] {
  const d = dims()
  const out: { x: number; y: number; z: number; color: string; label: string; thickness: number }[] = []
  for (const [side, row] of Object.entries(props.edges || {})) {
    if (!row || !row.thickness) continue
    const et = Math.max(1.4, row.thickness)
    if (d.mode === 'thin') {
      if (side === 'left' || side === 'right') {
        out.push({ x: d.x, y: d.y, z: et,
          color: row.color, label: row.label, thickness: row.thickness })
        out[out.length - 1].z = et
        ;(out[out.length - 1] as never as Record<string, number>).posZ =
          (side === 'left' ? -1 : 1) * (d.z / 2 + et / 2)
      } else {
        out.push({ x: d.x, y: et, z: d.z,
          color: row.color, label: row.label, thickness: row.thickness })
        ;(out[out.length - 1] as never as Record<string, number>).posY =
          (side === 'top' ? 1 : -1) * (d.y / 2 + et / 2)
      }
    } else if (d.mode === 'flat') {
      if (side === 'left' || side === 'right') {
        out.push({ x: et, y: d.y, z: d.z,
          color: row.color, label: row.label, thickness: row.thickness })
        ;(out[out.length - 1] as never as Record<string, number>).posX =
          (side === 'left' ? -1 : 1) * (d.x / 2 + et / 2)
      } else {
        out.push({ x: d.x, y: d.y, z: et,
          color: row.color, label: row.label, thickness: row.thickness })
        ;(out[out.length - 1] as never as Record<string, number>).posZ =
          (side === 'bottom' ? -1 : 1) * (d.z / 2 + et / 2)
      }
    } else {
      if (side === 'left' || side === 'right') {
        out.push({ x: et, y: d.y, z: d.z,
          color: row.color, label: row.label, thickness: row.thickness })
        ;(out[out.length - 1] as never as Record<string, number>).posX =
          (side === 'left' ? -1 : 1) * (d.x / 2 + et / 2)
      } else {
        out.push({ x: d.x, y: et, z: d.z,
          color: row.color, label: row.label, thickness: row.thickness })
        ;(out[out.length - 1] as never as Record<string, number>).posY =
          (side === 'bottom' ? -1 : 1) * (d.y / 2 + et / 2)
      }
    }
  }
  return out
}

function build(): void {
  const canvas = canvasEl.value
  const box = host.value
  if (!canvas || !box) return
  dispose()
  engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.06, 0.07, 0.085, 1)

  const d = dims()
  const maxDim = Math.max(d.x, d.y, d.z)
  const camera = new ArcRotateCamera(
    'part-cam', -Math.PI / 3.1, Math.PI / 2.45, maxDim * 2.0,
    Vector3.Zero(), scene,
  )
  camera.lowerRadiusLimit = maxDim * 0.55
  camera.upperRadiusLimit = maxDim * 7
  camera.wheelDeltaPercentage = 0.015
  camera.panningSensibility = 900
  camera.minZ = 1
  camera.maxZ = maxDim * 40
  camera.attachControl(canvas, true)

  const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene)
  hemi.intensity = 0.95
  hemi.groundColor = new Color3(0.12, 0.13, 0.15)
  const dir = new DirectionalLight('dir', new Vector3(-0.7, -1, -0.6), scene)
  dir.intensity = 0.55
  const fill = new DirectionalLight('fill', new Vector3(0.8, -0.2, -0.5), scene)
  fill.intensity = 0.25
  fill.diffuse = new Color3(0.75, 0.78, 0.82)

  const panelMat = new StandardMaterial('panel', scene)
  // Почти серый с лёгким оттенком материала — цвет не отвлекает от
  // кромок/отверстий, но деталь остаётся «своей».
  const tint = hex(props.color || '#cfcfcf')
  panelMat.diffuseColor = new Color3(0.62, 0.64, 0.67)
    .scale(0.78).add(tint.scale(0.22))
  panelMat.specularColor = new Color3(0.04, 0.04, 0.04)
  panelMat.roughness = 0.9
  const panel = CreateBox('panel', { width: d.x, height: d.y, depth: d.z }, scene)
  panel.material = panelMat
  panel.metadata = { kind: 'panel' }
  panel.enableEdgesRendering(0.999)
  panel.edgesWidth = 2
  panel.edgesColor = new Color4(0.05, 0.06, 0.07, 0.85)

  const edgeMats = new Map<string, StandardMaterial>()
  const edgeMat = (color: string): StandardMaterial => {
    let m = edgeMats.get(color)
    if (m) return m
    m = new StandardMaterial(`edge-${color}`, scene)
    m.diffuseColor = hex(color)
    m.emissiveColor = hex(color).scale(0.18)
    m.specularColor = new Color3(0.08, 0.08, 0.08)
    edgeMats.set(color, m)
    return m
  }
  for (const e of edgeVisuals()) {
    const mesh = CreateBox('edge', { width: e.x, height: e.y, depth: e.z }, scene)
    const rec = e as unknown as Record<string, number>
    mesh.position.x = rec.posX ?? 0
    mesh.position.y = rec.posY ?? 0
    mesh.position.z = rec.posZ ?? 0
    mesh.material = edgeMat(e.color)
    mesh.metadata = { kind: 'edge', row: e }
    mesh.isPickable = true
  }

  // Отверстия на пласти: диски на видимой грани (та же проекция, что карта).
  const faceOps = props.operations.filter(
    (o) => o.face !== 'торец' && o.dia > 0,
  )
  for (const o of faceOps) {
    const p = facePoint(o.x, o.y, o.face)
    const mat = new StandardMaterial(`hole-${o.id}`, scene)
    mat.diffuseColor = new Color3(1.0, 0.66, 0.24)
    mat.emissiveColor = new Color3(0.55, 0.32, 0.08)
    mat.specularColor = Color3.Black()
    const hole = CreateCylinder(`hole-${o.id}`, {
      height: 1.6, diameter: Math.max(11, o.dia), tessellation: 24,
    }, scene)
    const off = 0.9 * (p.sign || 1)
    hole.position = new Vector3(
      p.x + (p.normal === 'x' ? off : 0),
      p.y + (p.normal === 'y' ? off : 0),
      p.z + (p.normal === 'z' ? off : 0),
    )
    if (p.normal === 'x') hole.rotation.z = Math.PI / 2
    if (p.normal === 'z') hole.rotation.x = Math.PI / 2
    hole.material = mat
    hole.metadata = { kind: 'hole', op: o, base: mat.emissiveColor.clone() }
    hole.isPickable = true
    hole.enableEdgesRendering(0.999)
    hole.edgesWidth = 2.5
    hole.edgesColor = new Color4(0.05, 0.04, 0.03, 0.9)
  }

  // Торцевые отверстия: маркеры на нужном торце (edge_side).
  for (const o of props.operations) {
    if (o.face !== 'торец' || o.dia <= 0) continue
    const side = (o as AssemblyOperation & { edge_side?: string }).edge_side
    if (!side) continue
    const mat = new StandardMaterial(`ehole-${o.id}`, scene)
    mat.diffuseColor = new Color3(1.0, 0.32, 0.28)
    mat.emissiveColor = new Color3(0.55, 0.12, 0.10)
    const hole = CreateCylinder(`ehole-${o.id}`, {
      height: 1.6, diameter: Math.max(11, o.dia), tessellation: 24,
    }, scene)
    if (d.mode === 'thin') {
      if (side === 'top' || side === 'bottom') {
        hole.position.y = (side === 'top' ? 1 : -1) * (d.y / 2 + 0.7)
        hole.position.z = o.x - props.w / 2
      } else {
        hole.position.z = (side === 'right' ? 1 : -1) * (d.z / 2 + 0.7)
        hole.position.y = o.y - props.h / 2
        hole.rotation.x = Math.PI / 2
      }
    } else if (d.mode === 'flat') {
      if (side === 'left' || side === 'right') {
        hole.position.x = (side === 'right' ? 1 : -1) * (d.x / 2 + 0.7)
        hole.position.z = o.x - props.h / 2
        hole.rotation.z = Math.PI / 2
      } else {
        hole.position.z = (side === 'top' ? 1 : -1) * (d.z / 2 + 0.7)
        hole.rotation.x = Math.PI / 2
      }
    } else if (side === 'left' || side === 'right') {
      hole.position.x = (side === 'right' ? 1 : -1) * (d.x / 2 + 0.7)
      hole.rotation.z = Math.PI / 2
    } else {
      hole.position.y = (side === 'top' ? 1 : -1) * (d.y / 2 + 0.7)
    }
    hole.material = mat
    hole.metadata = {
      kind: 'edgehole', op: o,
      base: mat.emissiveColor.clone(),
    }
    hole.isPickable = true
    hole.enableEdgesRendering(0.999)
    hole.edgesWidth = 2.5
    hole.edgesColor = new Color4(0.05, 0.04, 0.03, 0.9)
  }

  const clearHover = () => {
    if (!hoverMesh) return
    hoverMesh.scaling.set(1, 1, 1)
    const m = hoverMesh.material as StandardMaterial | null
    const base = (hoverMesh.metadata?.base as Color3 | undefined)
    if (m && base) m.emissiveColor = base.clone()
    hoverMesh = null
  }

  pointerHandler = (ev: PointerEvent) => {
    if (!scene) return
    if (ev.buttons > 0) {
      tip.value = null
      clearHover()
      return
    }
    const pick = scene.pick(scene.pointerX, scene.pointerY)
    const meta = pick?.pickedMesh?.metadata as
      { kind?: string; op?: AssemblyOperation; row?: { label: string; thickness: number }; base?: Color3 } | undefined
    if (!pick?.hit || !meta) {
      tip.value = null
      clearHover()
      return
    }
    if (meta.kind === 'hole' || meta.kind === 'edgehole') {
      const o = meta.op!
      const mesh = pick.pickedMesh as Mesh
      if (hoverMesh !== mesh) {
        clearHover()
        hoverMesh = mesh
        mesh.scaling.set(1.45, 1.1, 1.45)
        const m = mesh.material as StandardMaterial | null
        if (m) m.emissiveColor = new Color3(0.9, 0.65, 0.2)
      }
      const edgeSide = (o as AssemblyOperation & { edge_side?: string }).edge_side
      tip.value = {
        x: ev.clientX, y: ev.clientY,
        title: KIND_LABEL[o.kind] || o.hardware,
        lines: [
          o.hardware,
          `Ø${o.dia} × ${o.depth} мм`,
          `x ${o.x} · y ${o.y} · ${o.face}`,
          edgeSide ? `торец: ${edgeSide} (сверлить с торца)` : '',
          o.note,
        ].filter(Boolean),
      }
    } else if (meta.kind === 'edge' && meta.row) {
      tip.value = {
        x: ev.clientX, y: ev.clientY,
        title: 'Кромка на торце',
        lines: [meta.row.label, `толщина ${meta.row.thickness} мм`],
      }
      clearHover()
    } else {
      tip.value = null
      clearHover()
    }
  }
  canvas.addEventListener('pointermove', pointerHandler)
  leaveHandler = () => {
    tip.value = null
    clearHover()
  }
  canvas.addEventListener('pointerleave', leaveHandler)

  engine.runRenderLoop(() => scene?.render())
  ro = new ResizeObserver(() => engine?.resize())
  ro.observe(box)
  engine.resize()
}

function dispose(): void {
  if (canvasEl.value) {
    if (pointerHandler) canvasEl.value.removeEventListener('pointermove', pointerHandler)
    if (leaveHandler) canvasEl.value.removeEventListener('pointerleave', leaveHandler)
  }
  pointerHandler = null
  leaveHandler = null
  hoverMesh = null
  tip.value = null
  ro?.disconnect()
  ro = null
  scene?.dispose()
  scene = null
  engine?.dispose()
  engine = null
}

onMounted(build)
onBeforeUnmount(dispose)
watch(
  () => [props.w, props.h, props.t, props.partKind, props.color,
    props.operations, props.edges],
  build,
)
</script>

<template>
  <figure class="p3dv">
    <div ref="host" class="p3dv__host">
      <canvas ref="canvasEl" class="p3dv__canvas"></canvas>
    </div>
    <div class="p3dv__hud">
      <b>X {{ w }}</b> · <b>Y {{ h }}</b> · <b>t {{ t }}</b> мм
      <span>· серый — пласть, полоса — кромка, оранжевые — пласти, красные — торец</span>
    </div>
    <figcaption class="p3dv__cap">
      Вращайте мышью / пальцем, колесо — масштаб. Наведите на отверстие —
      будут координаты, Ø, глубина и назначение.
    </figcaption>
    <div
      v-if="tip"
      class="p3dv__tip"
      :style="{ left: `${tip.x + 14}px`, top: `${tip.y + 14}px` }"
    >
      <b>{{ tip.title }}</b>
      <span v-for="(line, i) in tip.lines" :key="i">{{ line }}</span>
    </div>
  </figure>
</template>
