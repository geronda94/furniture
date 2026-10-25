<script setup lang="ts">
defineProps<{ kind?: string }>()
</script>

<template>
  <svg class="hw-icon" viewBox="0 0 64 48" aria-hidden="true">
    <g v-if="kind === 'bar' || kind === 'rail'" fill="none" stroke="currentColor" stroke-width="2.2">
      <line x1="12" y1="24" x2="52" y2="24" />
      <line x1="18" y1="20" x2="18" y2="28" />
      <line x1="46" y1="20" x2="46" y2="28" />
    </g>
    <g v-else-if="kind === 'knob'" fill="none" stroke="currentColor" stroke-width="2.2">
      <circle cx="32" cy="24" r="8" />
      <line x1="32" y1="32" x2="32" y2="40" />
    </g>
    <g v-else-if="kind === 'profile'" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M12 20 h40 v8 h-40 z" />
      <path d="M18 20 v-6 h28 v6" />
    </g>
    <g v-else-if="kind === 'cup'" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M18 18 a14 14 0 0 0 28 0 v12 a14 14 0 0 1 -28 0 z" />
      <line x1="32" y1="10" x2="32" y2="40" />
    </g>
    <g v-else-if="kind === 'hinge'" fill="none" stroke="currentColor" stroke-width="2.2">
      <circle cx="22" cy="24" r="8" />
      <rect x="30" y="18" width="22" height="12" rx="2" />
      <line x1="22" y1="16" x2="22" y2="32" />
    </g>
    <g v-else-if="kind === 'runner'" fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="10" y="20" width="44" height="8" rx="1" />
      <rect x="18" y="24" width="28" height="14" rx="1" />
      <line x1="12" y1="22" x2="20" y2="26" />
      <line x1="52" y1="22" x2="44" y2="26" />
    </g>
    <g v-else-if="kind === 'leg'" fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="20" y="8" width="24" height="7" rx="1" />
      <line x1="32" y1="15" x2="32" y2="34" />
      <rect x="24" y="34" width="16" height="6" rx="2" />
    </g>
    <g v-else-if="kind === 'gas'" fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="12" y="20" width="32" height="8" rx="4" />
      <line x1="44" y1="24" x2="54" y2="24" />
      <circle cx="14" cy="24" r="3" /><circle cx="52" cy="24" r="3" />
    </g>
    <g v-else-if="kind === 'shelf'" fill="none" stroke="currentColor" stroke-width="2.2">
      <line x1="12" y1="30" x2="52" y2="30" />
      <line x1="24" y1="14" x2="24" y2="30" />
      <line x1="40" y1="14" x2="40" y2="30" />
      <circle cx="24" cy="30" r="2.5" /><circle cx="40" cy="30" r="2.5" />
    </g>
    <g v-else-if="kind === 'fastener'" fill="none" stroke="currentColor" stroke-width="2.2">
      <line x1="14" y1="30" x2="44" y2="30" />
      <path d="M44 24 l8 6 -8 6" />
      <line x1="18" y1="24" x2="18" y2="36" />
      <line x1="24" y1="24" x2="24" y2="36" />
    </g>
    <g v-else fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="14" y="12" width="36" height="24" rx="3" />
    </g>
  </svg>
</template>
