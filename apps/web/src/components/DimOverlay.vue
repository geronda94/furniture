<script setup lang="ts">
import type { DimLine } from '../dims/types'
import {
  DIM_D,
  DIM_H,
  DIM_OUT_OBJ,
  DIM_OUT_WALL,
  DIM_POS,
  DIM_REL,
  DIM_W,
} from '../dims/colors'

defineProps<{ lines: DimLine[] }>()
</script>

<template>
  <svg class="view__dims">
    <defs>
      <marker
        id="dim-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5.5"
        markerHeight="5.5"
        orient="auto-start-reverse"
      >
        <path :d="'M0,0 L10,5 L0,10 z'" :fill="DIM_W" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
      <marker id="dim-arrow-h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" :fill="DIM_H" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
      <marker id="dim-arrow-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" :fill="DIM_D" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
      <marker id="dim-arrow-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" :fill="DIM_POS" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
      <marker id="dim-arrow-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" :fill="DIM_REL" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
      <marker id="dim-arrow-wall" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" :fill="DIM_OUT_WALL" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
      <marker id="dim-arrow-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" :fill="DIM_OUT_OBJ" stroke="#0b0d0f" stroke-width="0.6" />
      </marker>
    </defs>
    <g v-for="(d, i) in lines" :key="i">
      <title v-if="d.hint">{{ d.hint }}</title>
      <line
        :x1="d.x1" :y1="d.y1" :x2="d.x2" :y2="d.y2"
        :style="{ stroke: d.color }"
        :marker-start="`url(#${d.marker})`"
        :marker-end="`url(#${d.marker})`"
      />
      <line
        v-for="(e, ei) in d.edges"
        :key="ei"
        class="view__dims-edge"
        :x1="e[0]" :y1="e[1]" :x2="e[2]" :y2="e[3]"
        :style="{ stroke: d.color }"
      />
      <rect
        class="view__dims-badge"
        :x="d.tx - d.labelW / 2"
        :y="d.ty - 9"
        :width="d.labelW"
        :height="18"
        rx="4"
        :style="{ stroke: d.color }"
      />
      <text :x="d.tx" :y="d.ty" :style="{ fill: d.color }">{{ d.label }}</text>
    </g>
  </svg>
</template>
