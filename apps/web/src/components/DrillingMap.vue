<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AssemblyOperation, EdgeSide } from '../api'

const props = withDefaults(defineProps<{
  part: string
  partKind?: string
  w: number
  h: number
  operations: AssemblyOperation[]
  edges?: Record<string, EdgeSide>
  front?: string
  highlight?: string | null
  interactive?: boolean
  /** линии разметки по всем отверстиям (что чертить на пласти) */
  guides?: boolean
}>(), { partKind: 'side', highlight: null, interactive: true, guides: false })

const emit = defineEmits<{ (e: 'pick', id: string): void }>()

const PAD = 34

const BIG_KINDS = new Set([
  'shelf_pin', 'fastener_face', 'hinge_cup', 'handle', 'slide_mount',
  'slide_box', 'gas_strut', 'hinge_plate',
])

const holes = computed(() =>
  props.operations.map((o) => ({
    ...o,
    // координаты присадки: y от низа детали, SVG — сверху
    sy: props.h - o.y,
    // используемые (реальные) отверстия — заметнее технической сетки
    r: Math.max(BIG_KINDS.has(o.kind) ? 10 : 7, o.dia / 2),
  })),
)

const selectedHole = computed(() =>
  props.highlight
    ? holes.value.find((o) => o.id === props.highlight) ?? null
    : null,
)

const guideYs = computed(() =>
  [...new Set(holes.value.map((o) => Math.round(o.sy * 10) / 10))],
)
const guideXs = computed(() =>
  [...new Set(holes.value.map((o) => Math.round(o.x * 10) / 10))],
)

const edgeOps = computed(() =>
  props.operations
    .filter((o) => o.face === 'торец' && o.dia > 0)
    .map((o) => {
      const side = (o as AssemblyOperation & { edge_side?: string }).edge_side || ''
      let x = 0
      let y = 0
      if (props.partKind === 'horizontal' || props.partKind === 'shelf') {
        if (side === 'left' || side === 'right') {
          x = side === 'left' ? 0 : props.w
          y = Math.min(props.h, Math.max(0, o.x))
        } else {
          x = Math.min(props.w, Math.max(0, o.x))
          y = side === 'bottom' ? props.h : 0
        }
      } else if (props.partKind === 'side' || props.partKind === 'divider' ||
                 props.partKind === 'drawer_side') {
        if (side === 'top' || side === 'bottom') {
          x = Math.min(props.w, Math.max(0, o.x))
          y = side === 'bottom' ? props.h : 0
        } else {
          x = side === 'left' ? 0 : props.w
          y = Math.min(props.h, Math.max(0, o.x))
        }
      } else {
        if (side === 'left' || side === 'right') {
          x = side === 'left' ? 0 : props.w
          y = Math.min(props.h, Math.max(0, o.y))
        } else {
          x = Math.min(props.w, Math.max(0, o.x))
          y = side === 'bottom' ? props.h : 0
        }
      }
      return { ...o, side, mx: x, my: y }
    }),
)

const hover = ref<{
  x: number
  y: number
  kind: 'hole' | 'edge'
  op: AssemblyOperation & { edge_side?: string }
  side?: string
} | null>(null)

function showTip(
  e: MouseEvent,
  kind: 'hole' | 'edge',
  op: AssemblyOperation & { edge_side?: string },
  side?: string,
): void {
  hover.value = { x: e.clientX, y: e.clientY, kind, op, side }
}
function moveTip(e: MouseEvent): void {
  if (!hover.value) return
  hover.value = { ...hover.value, x: e.clientX, y: e.clientY }
}
function hideTip(): void {
  hover.value = null
}
const HOVER_KIND: Record<string, string> = {
  fastener_face: 'Крепёж: пласть',
  fastener_end: 'Крепёж: торец',
  hinge_cup: 'Чашка петли',
  hinge_plate: 'Ответная планка',
  shelf_pin: 'Полкодержатель',
  slide_mount: 'Направляющая: корпус',
  slide_box: 'Направляющая: ящик',
  handle: 'Ручка',
  gas_strut: 'Газовый патрон',
  screw_front: 'Саморез фасада ящика',
  system32: 'System 32',
}

const kinds = computed(() => {
  const out: Record<string, { label: string; color: string }> = {}
  for (const o of props.operations) {
    out[o.kind] = KIND[o.kind] ?? { label: o.kind, color: '#999' }
  }
  return out
})

const KIND: Record<string, { label: string; color: string }> = {
  system32: { label: 'System 32', color: '#8a8f96' },
  shelf_pin: { label: 'Полкодержатель', color: '#39c28b' },
  fastener_face: { label: 'Крепёж: пласть', color: '#e0533d' },
  fastener_end: { label: 'Крепёж: торец', color: '#c23d2a' },
  hinge_cup: { label: 'Чашка петли', color: '#3d8fe0' },
  hinge_plate: { label: 'Ответная планка', color: '#7fb4df' },
  handle: { label: 'Ручка', color: '#e8b25a' },
  slide_mount: { label: 'Направляющая: корпус', color: '#b58cff' },
  slide_box: { label: 'Направляющая: ящик', color: '#9b6bff' },
  gas_strut: { label: 'Газовый патрон', color: '#ff6fae' },
  leg_mount: { label: 'Крепление опоры', color: '#f2a23c' },
}

const edgeBars = computed(() => {
  const out: { x: number; y: number; w: number; h: number; color: string; label: string }[] = []
  const e = props.edges || {}
  // Кромка — на торце, поэтому рисуем полосу СНАРУЖИ контура пласти,
  // а не поверх площади. В 3D она показана на самом торце.
  const bw = 7
  const gap = 2
  for (const [side, row] of Object.entries(e)) {
    if (!row || !row.thickness) continue
    const label = row.front ? `${row.label} · ПЕРЕД` : row.label
    if (side === 'left') {
      out.push({ x: -bw - gap, y: 0, w: bw, h: props.h, color: row.color, label })
    }
    if (side === 'right') {
      out.push({ x: props.w + gap, y: 0, w: bw, h: props.h, color: row.color, label })
    }
    if (side === 'top') {
      out.push({ x: 0, y: -bw - gap, w: props.w, h: bw, color: row.color, label })
    }
    if (side === 'bottom') {
      out.push({ x: 0, y: props.h + gap, w: props.w, h: bw, color: row.color, label })
    }
  }
  return out
})

const frontLabel = computed(() => {
  const map: Record<string, string> = {
    left: 'ПЕРЕД ←', right: '→ ПЕРЕД', top: '↑ ПЕРЕД', bottom: 'ПЕРЕД ↓',
  }
  return props.front ? map[props.front] ?? '' : ''
})
</script>

<template>
  <figure class="dmap">
    <svg
      class="dmap__svg"
      :viewBox="`${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}`"
      :style="{ aspectRatio: `${w + PAD * 2} / ${h + PAD * 2}` }"
      role="img"
      :aria-label="`Карта присадки: ${part}`"
    >
      <rect
        :x="0" :y="0" :width="w" :height="h" rx="2"
        fill="rgba(255,255,255,0.13)" stroke="rgba(255,255,255,0.55)"
        stroke-width="1"
      />
      <rect
        v-for="(b, i) in edgeBars" :key="`e${i}`"
        :x="b.x" :y="b.y" :width="b.w" :height="b.h"
        :fill="b.color" opacity="0.9"
      >
        <title>{{ b.label }}</title>
      </rect>

      <g v-if="guides" class="dmap__guides">
        <line v-for="y in guideYs" :key="`gy${y}`"
          :x1="0" :y1="y" :x2="w" :y2="y"
          stroke="rgba(232,178,90,0.32)" stroke-width="0.8" stroke-dasharray="4 3" />
        <line v-for="x in guideXs" :key="`gx${x}`"
          :x1="x" :y1="0" :x2="x" :y2="h"
          stroke="rgba(127,180,223,0.30)" stroke-width="0.8" stroke-dasharray="3 4" />
      </g>

      <g v-for="(o, i) in holes" :key="`h${i}`">
        <circle
          :cx="o.x" :cy="o.sy" :r="o.r"
          :fill="(kinds[o.kind] ?? { color: '#999' }).color"
          :stroke="o.id === highlight ? '#ffffff'
            : o.requires_pattern ? '#ffcc55' : 'rgba(0,0,0,0.55)'"
          :stroke-width="o.id === highlight ? 2.8
            : BIG_KINDS.has(o.kind) ? 1.5 : 0.8"
          :stroke-dasharray="o.requires_pattern && o.id !== highlight ? '2 1.6' : undefined"
          opacity="0.92"
          :style="interactive ? 'cursor:pointer' : ''"
          @click="emit('pick', o.id)"
          @mouseenter="showTip($event, 'hole', o)"
          @mousemove="moveTip"
          @mouseleave="hideTip"
        >
          <title>{{ o.hardware }} · Ø{{ o.dia }} × {{ o.depth }} · x{{ o.x }} y{{ o.y }} · {{ o.face }}</title>
        </circle>
      </g>

      <g v-if="selectedHole" class="dmap__dims">
        <line
          :x1="0" :y1="selectedHole.sy" :x2="selectedHole.x" :y2="selectedHole.sy"
          stroke="#e8b25a" stroke-width="0.8" stroke-dasharray="3 2"
        />
        <line
          :x1="selectedHole.x" :y1="h" :x2="selectedHole.x" :y2="selectedHole.sy"
          stroke="#e8b25a" stroke-width="0.8" stroke-dasharray="3 2"
        />
        <line
          :x1="selectedHole.x" :y1="selectedHole.sy" :x2="w" :y2="selectedHole.sy"
          stroke="rgba(127,180,223,0.8)" stroke-width="0.7" stroke-dasharray="2 3"
        />
        <line
          :x1="selectedHole.x" :y1="selectedHole.sy" :x2="selectedHole.x" :y2="0"
          stroke="rgba(127,180,223,0.8)" stroke-width="0.7" stroke-dasharray="2 3"
        />
      </g>

      <g v-for="(o, i) in edgeOps" :key="`eo${i}`">
        <circle
          :cx="o.mx" :cy="o.my" r="11"
          fill="rgba(10,13,16,0.55)" stroke="#e8b25a"
          stroke-width="1.6" stroke-dasharray="3 2"
          style="cursor:help"
          @mouseenter="showTip($event, 'edge', o, o.side)"
          @mousemove="moveTip"
          @mouseleave="hideTip"
        />
        <circle :cx="o.mx" :cy="o.my" r="3" fill="#e8b25a" />
      </g>

      <text
        v-if="frontLabel" :x="w / 2" :y="h + 25"
        text-anchor="middle" class="dmap__front"
      >{{ frontLabel }}</text>
      <text :x="w / 2" :y="-14" text-anchor="middle" class="dmap__dim">{{ w }} мм</text>
      <text :x="-16" :y="h / 2" text-anchor="middle" class="dmap__dim"
        :transform="`rotate(-90 -16 ${h / 2})`">{{ h }} мм</text>
    </svg>

    <div v-if="selectedHole" class="dmap__measure">
      <span title="До левой грани"><b>← {{ Math.round(selectedHole.x * 10) / 10 }}</b></span>
      <span title="До правой грани"><b>{{ Math.round((w - selectedHole.x) * 10) / 10 }} →</b></span>
      <span title="До нижней грани"><b>↓ {{ Math.round(selectedHole.y * 10) / 10 }}</b></span>
      <span title="До верхней грани"><b>↑ {{ Math.round((h - selectedHole.y) * 10) / 10 }}</b></span>
      <em>мм</em>
    </div>

    <figcaption class="dmap__legend">
      <span v-for="(k, id) in kinds" :key="id" class="dmap__key">
        <i :style="{ background: k.color }"></i>{{ k.label }}
      </span>
      <span v-if="Object.keys(edges || {}).length" class="dmap__key">
        <i class="dmap__key--edge"></i>кромка на торце (цвет = тип)
      </span>
      <span v-if="edgeOps.length" class="dmap__key">
        <i class="dmap__key--hole"></i>◌ отверстие в торце (сверлить с торца)
      </span>
    </figcaption>

    <div
      v-if="hover"
      class="dmap__tip"
      :style="{ left: `${hover.x + 14}px`, top: `${hover.y + 14}px` }"
    >
      <b>{{ HOVER_KIND[hover.op.kind] || hover.op.kind }}</b>
      <span>{{ hover.op.hardware }}</span>
      <span v-if="hover.op.dia">
        Ø{{ hover.op.dia }} × {{ hover.op.depth }} мм
      </span>
      <span v-if="hover.kind === 'edge'">
        Сверлить с торца: {{ hover.side }} · x{{ hover.op.x }} y{{ hover.op.y }}
      </span>
      <span v-else>
        пласть: x{{ hover.op.x }} · y{{ hover.op.y }}
        <template v-if="hover.op.face"> · {{ hover.op.face }}</template>
      </span>
      <span v-if="hover.op.note" class="dmap__tip-note">{{ hover.op.note }}</span>
    </div>
  </figure>
</template>
