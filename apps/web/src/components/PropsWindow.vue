<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ContextProps from './ContextProps.vue'
import { state } from '../state/project'
import { roomWalls } from '../render25d/room'

const props = defineProps<{ x: number; y: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const pos = ref({ x: props.x, y: props.y })
watch(
  () => [props.x, props.y],
  ([x, y]) => {
    pos.value = { x, y }
  },
)

const wall = computed(() =>
  state.wallIndex != null
    ? (roomWalls(state.project.room).find((w) => w.index === state.wallIndex) ?? null)
    : null,
)
const title = computed(() => {
  if (wall.value) {
    return wall.value.outer
      ? `Стена ${wall.value.index + 1}`
      : `Перегородка ${wall.value.index + 1}`
  }
  if (state.roomSelected && state.roomNode === 'floor') return 'Пол'
  if (state.roomSelected && state.roomNode === 'ceiling') return 'Потолок'
  if (state.roomSelected) return 'Комната'
  if (state.openingId) return 'Проём'
  if (state.folderId) return 'Папка'
  const inst = state.project.instances.find((i) => i.id === state.selection)
  if (inst) return inst.name || 'Модуль'
  return 'Комната'
})

let drag: { dx: number; dy: number } | null = null

function onHeadDown(e: PointerEvent): void {
  drag = { dx: e.clientX - pos.value.x, dy: e.clientY - pos.value.y }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onHeadMove(e: PointerEvent): void {
  if (!drag) return
  pos.value = {
    x: Math.max(0, e.clientX - drag.dx),
    y: Math.max(0, e.clientY - drag.dy),
  }
}
function onHeadUp(): void {
  drag = null
}
</script>

<template>
  <aside
    class="props-win"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    @pointerdown.stop
  >
    <header
      class="props-win__head"
      @pointerdown="onHeadDown"
      @pointermove="onHeadMove"
      @pointerup="onHeadUp"
      @pointercancel="onHeadUp"
    >
      <span class="props-win__title">{{ title }}</span>
      <span class="props-win__hint">свойства</span>
      <button class="props-win__close" title="Закрыть" @click="emit('close')">
        ×
      </button>
    </header>
    <div class="props-win__body">
      <ContextProps />
    </div>
  </aside>
</template>
