<script setup lang="ts">
import {
  applyView,
  deleteView,
  saveView,
  setPresentation,
  state,
} from '../state/project'
</script>

<template>
  <div class="present" role="toolbar" aria-label="Презентация">
    <span class="present__label">Виды</span>
    <div class="present__list">
      <div v-for="v in state.project.views" :key="v.id" class="present__view">
        <button
          class="present__apply"
          :title="`Показать: ${v.name}`"
          @click="applyView(v.id)"
        >
          {{ v.name }}
        </button>
        <button
          class="present__del"
          title="Удалить вид"
          @click="deleteView(v.id)"
        >
          ×
        </button>
      </div>
      <span v-if="!state.project.views.length" class="present__hint">
        Сохраните ракурс
      </span>
    </div>
    <button class="btn btn--sm" @click="saveView">+ Вид</button>
    <button class="btn btn--sm btn--primary" @click="setPresentation(false)">
      Выход
    </button>
  </div>
</template>
