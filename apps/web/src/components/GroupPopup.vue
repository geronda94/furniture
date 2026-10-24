<script setup lang="ts">
import { computed } from 'vue'
import {
  deleteSelection,
  duplicateSelection,
  pushSelection,
  rotateSelection,
  state,
} from '../state/project'

const props = defineProps<{ x: number; y: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const count = computed(() => state.selected.length)
const names = computed(() =>
  state.project.instances
    .filter((i) => state.selected.includes(i.id))
    .slice(0, 3)
    .map((i) => i.name || 'Модуль'),
)

function rotate(): void {
  rotateSelection(90)
}
function duplicate(): void {
  duplicateSelection()
}
function remove(): void {
  deleteSelection()
  emit('close')
}
function ungroup(): void {
  state.selected = state.selection ? [state.selection] : []
  emit('close')
}
</script>

<template>
  <aside
    class="group-popup"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
  >
    <div class="group-popup__head">
      <span class="group-popup__title">Группа · {{ count }}</span>
      <button class="group-popup__close" title="Закрыть" @click="emit('close')">
        ×
      </button>
    </div>
    <div class="group-popup__list">
      {{ names.join(', ') }}<span v-if="count > 3"> и ещё {{ count - 3 }}</span>
    </div>
    <div class="group-popup__hint">
      Shift+клик — добавить/убрать · перетаскивание и стрелки двигают группу
    </div>
    <div class="group-popup__actions group-popup__actions--push">
      <span class="dim">к стене:</span>
      <button class="btn btn--sm" title="Влево" @click="pushSelection('left')">⟵</button>
      <button class="btn btn--sm" title="Вправо" @click="pushSelection('right')">⟶</button>
      <button class="btn btn--sm" title="Назад" @click="pushSelection('back')">↑</button>
      <button class="btn btn--sm" title="Вперёд" @click="pushSelection('front')">↓</button>
    </div>
    <div class="group-popup__actions">
      <button class="btn btn--sm" @click="rotate">⟳ 90°</button>
      <button class="btn btn--sm" @click="duplicate">Дублировать</button>
      <button class="btn btn--sm" @click="ungroup">Разгруппировать</button>
      <button class="btn btn--sm object-popup__danger" @click="remove">
        Удалить
      </button>
    </div>
  </aside>
</template>
