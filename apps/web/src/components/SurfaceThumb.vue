<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { state } from '../state/project'

const props = defineProps<{ kind: 'floor' | 'ceiling' }>()
const el = ref<HTMLCanvasElement | null>(null)

function draw(): void {
  const c = el.value
  if (!c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = 72
  const h = 54
  c.width = w * dpr
  c.height = h * dpr
  const g = c.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const m = state.project.materials[props.kind]
  g.fillStyle = m?.color || '#888'
  g.fillRect(0, 0, w, h)
  if (m?.pattern === 'wood') {
    g.strokeStyle = m.accent || 'rgba(0,0,0,.25)'
    g.globalAlpha = 0.35
    for (let y = 8; y < h; y += 10) {
      g.beginPath()
      g.moveTo(0, y)
      g.bezierCurveTo(w * 0.3, y - 4, w * 0.7, y + 4, w, y)
      g.stroke()
    }
    g.globalAlpha = 1
  } else if (m?.pattern === 'stone') {
    g.fillStyle = m.accent || 'rgba(0,0,0,.2)'
    for (let i = 0; i < 8; i++) {
      const x = (i * 37) % w
      const y = (i * 19) % h
      g.fillRect(x, y, 6, 3)
    }
  }
  g.strokeStyle = 'rgba(255,255,255,.25)'
  g.strokeRect(0.5, 0.5, w - 1, h - 1)
}

watch(
  () => [state.rev, state.project.materials[props.kind], props.kind],
  draw,
  { deep: true },
)
onMounted(draw)
</script>

<template>
  <canvas ref="el" class="thumb" aria-hidden="true"></canvas>
</template>
