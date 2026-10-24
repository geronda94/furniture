<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { state } from '../state/project'
import { roomWalls } from '../render25d/room'

const props = withDefaults(defineProps<{ wallIndex: number }>(), {})
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
  g.clearRect(0, 0, w, h)
  g.fillStyle = '#171b20'
  g.fillRect(0, 0, w, h)
  const room = state.project.room
  const seg = roomWalls(room).find((s) => s.index === props.wallIndex)
  if (!seg) return
  const pad = 5
  const scale = Math.min((w - pad * 2) / Math.max(1, seg.len),
    (h - pad * 2) / Math.max(1, room.h))
  const ww = seg.len * scale
  const wh = room.h * scale
  const x0 = (w - ww) / 2
  const y1 = h - pad
  g.fillStyle = seg.outer ? '#5b626c' : '#4d5560'
  g.fillRect(x0, y1 - wh, ww, wh)
  g.strokeStyle = 'rgba(255,255,255,.25)'
  g.strokeRect(x0, y1 - wh, ww, wh)

  for (const o of room.openings.filter((o) => o.wall === seg.index)) {
    const ox = x0 + o.x * scale
    const ow = o.w * scale
    const oy = y1 - o.z1 * scale
    const oh = (o.z1 - o.z0) * scale
    g.clearRect(ox, oy, ow, oh)
    g.fillStyle = o.kind === 'window' ? 'rgba(143,185,204,.35)'
      : o.kind === 'arch' ? 'rgba(30,34,40,.5)' : 'rgba(224,163,62,.18)'
    g.fillRect(ox, oy, ow, oh)
    g.strokeStyle = o.kind === 'window' ? '#8fb9cc' : '#e0a33e'
    g.lineWidth = 1
    g.strokeRect(ox, oy, ow, oh)
    if (o.kind === 'door') {
      g.beginPath()
      g.strokeStyle = 'rgba(224,163,62,.8)'
      g.moveTo(ox, y1 - o.z0 * scale)
      g.lineTo(ox + ow, y1 - o.z0 * scale)
      g.stroke()
    }
  }

  for (const it of room.wallItems.filter((w) => w.wall === seg.index)) {
    const ix = x0 + it.x * scale
    const iy = y1 - (it.z + it.h) * scale
    const iw = Math.max(1, it.w * scale)
    const ih = Math.max(1, it.h * scale)
    g.fillStyle = it.kind === 'mirror' ? '#a9c8d6'
      : it.kind === 'shelf' ? '#b98a4a' : '#2a2e33'
    g.fillRect(ix, iy, iw, ih)
  }
}

watch(
  () => [state.rev, state.project.room, state.project.materials, props.wallIndex],
  draw,
  { deep: true },
)
onMounted(draw)
</script>

<template>
  <canvas ref="el" class="thumb" aria-hidden="true"></canvas>
</template>
