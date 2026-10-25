<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { buildScene } from '../render25d/scene'
import { fitCamera } from '../render25d/camera'
import { renderView } from '../render25d/canvas'
import { derived, effectiveMaterials, state } from '../state/project'
import { resolveObjectMaterial } from '../material/vars'
import type { Camera, PlacedObject, Vec3 } from '../render25d/types'

const props = withDefaults(
  defineProps<{ instanceId: string; width?: number; height?: number }>(),
  { width: 68, height: 50 },
)

const canvasEl = ref<HTMLCanvasElement | null>(null)

const signature = computed(() => {
  const inst = state.project.instances.find((i) => i.id === props.instanceId)
  const d = derived[props.instanceId]
  if (!inst || !d) return ''
  const anim = Object.entries(inst.anim ?? {})
    .map(
      ([k, set]) =>
        `${k}:${Object.values(set)
          .map((c) => Math.round(c.value))
          .join(',')}`,
    )
    .join(';')
  return `${JSON.stringify(inst.params)}|${JSON.stringify(effectiveMaterials(inst))}|${JSON.stringify(state.project.materialVars)}|${d.objects.length}|${anim}`
})

function draw(): void {
  const c = canvasEl.value
  const inst = state.project.instances.find((i) => i.id === props.instanceId)
  const d = derived[props.instanceId]
  if (!c || !inst || !d) return

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = props.width
  const h = props.height
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')
  if (!ctx) return

  const objects: PlacedObject[] = d.objects.map((o, part) => ({
    object: o,
    placement: { id: inst.id, x: 0, y: 0, rot: 0, z: 0 },
    part,
    material: resolveObjectMaterial(
      state.project.materials,
      state.project.materialVars,
      inst,
      o,
    ),
    anim: Object.fromEntries(
      Object.entries(
        inst.anim?.[
          o.kind === 'drawerfront' || o.kind === 'drawerbox'
            ? `drawer:${o.drawer_id ?? part}`
            : `door:${part}`
        ] ?? {},
      ).map(([id, ch]) => [id, ch.value]),
    ),
  }))

  const pts: Vec3[] = []
  for (const o of d.objects) {
    for (const ix of [0, 1]) {
      for (const iy of [0, 1]) {
        for (const iz of [0, 1]) {
          pts.push([o.x + ix * o.sx, o.y + iy * o.sy, o.z + iz * o.sz])
        }
      }
    }
  }

  let cam: Camera = {
    yaw: 34,
    pitch: 22,
    zoom: 0.2,
    target: [0, 0, 0],
    projection: 'persp',
    distance: 2500,
    fov: 30,
  }
  if (pts.length) cam = fitCamera(cam, pts, w, h, 0.1)

  const scene = buildScene({
    objects,
    camera: cam,
    materials: effectiveMaterials(inst),
    width: w,
    height: h,
    style: 'realistic',
    wallMode: 'cutaway',
  })

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  renderView(ctx, {
    width: w,
    height: h,
    dpr,
    faces: scene.faces,
    projector: scene.projector,
    room: { w: inst.params.W, d: inst.params.D, h: inst.params.H },
    mode: 'persp',
    style: 'realistic',
    selection: null,
  })
}

watch(signature, () => draw(), { immediate: true })
onMounted(() => draw())
</script>

<template>
  <canvas
    ref="canvasEl"
    class="thumb"
    :style="{ width: `${width}px`, height: `${height}px` }"
  ></canvas>
</template>
