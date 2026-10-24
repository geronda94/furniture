<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ContextProps from './ContextProps.vue'
import ModuleWorkbench from './ModuleWorkbench.vue'
import {
  deleteSelection,
  duplicateSelection,
  rotateSelection,
  selectedInstance,
  state,
} from '../state/project'
import { roomWalls } from '../render25d/room'

const inst = selectedInstance
const bodyEl = ref<HTMLElement | null>(null)

watch(
  () => [state.selection, state.openingId, state.folderId, state.roomSelected,
    state.roomNode, state.wallIndex, state.selected.length],
  () => {
    if (bodyEl.value) bodyEl.value.scrollTop = 0
  },
)
const group = computed(() =>
  state.selected.length > 1
    ? state.selected
        .map((id) => state.project.instances.find((i) => i.id === id))
        .filter((i) => !!i)
    : [],
)
const wall = computed(() =>
  state.wallIndex != null
    ? roomWalls(state.project.room).find((w) => w.index === state.wallIndex)
    : null,
)
const title = computed(() => {
  if (group.value.length) return `Выделено: ${group.value.length}`
  if (inst.value) return inst.value.name || 'Модуль'
  if (wall.value) {
    return wall.value.outer
      ? `Стена ${wall.value.index + 1}`
      : `Перегородка ${wall.value.index + 1}`
  }
  if (state.openingId) return 'Проём'
  if (state.folderId) return 'Папка'
  if (state.roomSelected && state.roomNode === 'floor') return 'Пол'
  if (state.roomSelected && state.roomNode === 'ceiling') return 'Потолок'
  if (state.roomSelected) return 'Комната'
  return 'Инспектор'
})
const kind = computed(() => {
  if (group.value.length) return 'группа'
  if (inst.value) return 'модуль'
  if (state.openingId) return 'проём'
  if (state.folderId) return 'папка'
  if (state.roomSelected) return `${state.project.room.w}×${state.project.room.d} мм`
  return ''
})
const empty = computed(
  () =>
    !inst.value && !group.value.length && !state.openingId &&
    !state.folderId && !state.roomSelected && state.wallIndex == null,
)
</script>

<template>
  <section class="panel inspector">
    <div class="panel__head inspector__head">
      <span>{{ title }}</span>
      <span class="dim">{{ kind }}</span>
    </div>

    <div ref="bodyEl" class="panel__body inspector__body">
      <template v-if="group.length">
        <p class="dim wb__note">
          Групповые действия применяются ко всем выделенным модулям.
        </p>
        <div class="wb__actions">
          <button class="btn btn--sm" @click="rotateSelection(90)">⟳ Повернуть 90°</button>
          <button class="btn btn--sm" @click="duplicateSelection">Дублировать</button>
          <button class="btn btn--sm wb__danger" @click="deleteSelection">Удалить</button>
        </div>
        <ul class="detail__list">
          <li v-for="i in group" :key="i!.id">
            <span class="detail__name">{{ i!.name }}</span>
            <span class="detail__size">{{ i!.params.W }}×{{ i!.params.H }}×{{ i!.params.D }}</span>
          </li>
        </ul>
      </template>

      <ModuleWorkbench
        v-else-if="inst"
        :instance-id="inst.id"
      />

      <ContextProps v-else-if="!empty" />

      <div v-else class="dim wb__note">
        Выберите объект в дереве, на плане или в 3D — здесь появятся его
        параметры, детали и размеры.
      </div>
    </div>
  </section>
</template>
