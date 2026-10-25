<script setup lang="ts">
const props = defineProps<{ kind: string }>()
</script>

<template>
  <svg class="obj-icon" viewBox="0 0 64 48" aria-hidden="true">
    <g v-if="kind === 'fridge'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="20" y="3" width="24" height="42" rx="2" />
      <line x1="20" y1="17" x2="44" y2="17" />
      <line x1="40" y1="8" x2="40" y2="14" />
      <line x1="40" y1="21" x2="40" y2="30" />
    </g>
    <g v-else-if="kind === 'oven'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="12" y="12" width="40" height="30" rx="2" />
      <rect x="17" y="19" width="30" height="17" />
      <circle cx="50" cy="7" r="2" /><circle cx="43" cy="7" r="2" />
    </g>
    <g v-else-if="kind === 'microwave'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="8" y="15" width="48" height="22" rx="2" />
      <rect x="14" y="20" width="28" height="12" />
      <circle cx="50" cy="26" r="2" />
    </g>
    <g v-else-if="kind === 'cooktop'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="10" y="14" width="44" height="24" rx="2" />
      <circle cx="22" cy="23" r="3.5" /><circle cx="34" cy="23" r="3.5" />
      <circle cx="22" cy="32" r="3.5" /><circle cx="34" cy="32" r="3.5" />
      <circle cx="46" cy="27" r="3.5" />
    </g>
    <g v-else-if="kind === 'sink'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="8" y="14" width="48" height="22" rx="3" />
      <rect x="15" y="19" width="34" height="12" rx="2" />
      <line x1="46" y1="19" x2="46" y2="24" />
    </g>
    <g v-else-if="kind === 'drawers'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="16" y="4" width="32" height="40" rx="2" />
      <line x1="16" y1="17" x2="48" y2="17" />
      <line x1="16" y1="30" x2="48" y2="30" />
      <line x1="29" y1="10" x2="35" y2="10" />
      <line x1="29" y1="23" x2="35" y2="23" />
      <line x1="29" y1="36" x2="35" y2="36" />
    </g>
    <g v-else-if="kind === 'wardrobe'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="16" y="3" width="32" height="42" rx="2" />
      <line x1="32" y1="3" x2="32" y2="45" />
      <line x1="28" y1="20" x2="28" y2="28" />
      <line x1="36" y1="20" x2="36" y2="28" />
    </g>
    <g v-else-if="kind === 'tile'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="8" y="8" width="48" height="32" />
      <line x1="24" y1="8" x2="24" y2="40" />
      <line x1="40" y1="8" x2="40" y2="40" />
      <line x1="8" y1="24" x2="56" y2="24" />
    </g>
    <g v-else-if="kind === 'door'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="16" y="4" width="30" height="40" rx="1" />
      <circle cx="40" cy="24" r="1.8" fill="currentColor" />
    </g>
    <g v-else-if="kind === 'window'" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="10" y="10" width="44" height="28" />
      <line x1="32" y1="10" x2="32" y2="38" />
      <line x1="10" y1="24" x2="54" y2="24" />
    </g>
    <g v-else fill="none" stroke="currentColor" stroke-width="2">
      <rect x="14" y="8" width="36" height="34" rx="2" />
      <line x1="14" y1="23" x2="50" y2="23" />
    </g>
  </svg>
</template>
