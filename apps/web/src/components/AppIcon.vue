<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  size?: number
}>(), { size: 18 })

const paths: Record<string, string[]> = {
  save: ['M4 3h10l3 3v11H4z', 'M7 3v5h7V3', 'M7 14h7'],
  plus: ['M10 4v12', 'M4 10h12'],
  folder: ['M3 6h6l2 2h7v9H3z', 'M3 6V4h5l2 2'],
  project: ['M3 7l7-4 7 4v10l-7 4-7-4z', 'M3 7l7 4 7-4', 'M10 11v10'],
  settings: ['M10 3v2', 'M10 15v2', 'M3 10h2', 'M15 10h2',
    'M5.1 5.1l1.4 1.4', 'M13.5 13.5l1.4 1.4', 'M14.9 5.1l-1.4 1.4',
    'M6.5 13.5l-1.4 1.4', 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  versions: ['M4 10a6 6 0 1 0 2-4.5', 'M4 4v4h4', 'M10 7v4l3 2'],
  layout: ['M3 3h14v14H3z', 'M3 8h14', 'M9 8v9', 'M3 13h6'],
  quote: ['M5 2h7l4 4v12H5z', 'M12 2v4h4', 'M7 9h6', 'M7 12h6', 'M7 15h4'],
  history: ['M4 4h12', 'M4 8h12', 'M4 12h8', 'M4 16h10'],
  export: ['M10 2v9', 'M7 8l3 3 3-3', 'M4 13v5h12v-5'],
  present: ['M3 4h14v10H3z', 'M7 18l3-4 3 4', 'M9 8l4 2-4 2z'],
  tour: ['M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M8 8a2 2 0 1 1 3 1.7c-.7.5-1 1-1 1.8', 'M10 14h.01'],
  chevron: ['M7 8l3 3 3-3'],
}

const d = computed(() => paths[props.name] ?? paths.project)
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(p, i) in d" :key="i" :d="p" />
  </svg>
</template>
