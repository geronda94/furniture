<script setup lang="ts">
import { ref } from 'vue'
import ProjectManager from './ProjectManager.vue'
import HistoryPanel from './HistoryPanel.vue'
import {
  canRedo,
  canUndo,
  redo,
  rename,
  saveProject,
  setPresentation,
  setViewMode,
  state,
  undo,
} from '../state/project'

function onRename(e: Event) {
  rename((e.target as HTMLInputElement).value)
}
const projectsOpen = ref(false)
const historyOpen = ref(false)

function exportJson(): void {
  const blob = new Blob([JSON.stringify(state.project, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.project.name.replace(/\s+/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="brand__mark" aria-hidden="true"></span>
      <span class="brand__name">FURNITURE</span>
      <span class="brand__sub">constructor</span>
    </div>

    <input
      class="project-name"
      :value="state.project.name"
      aria-label="Название проекта"
      @change="onRename"
    />

    <div class="seg" role="group" aria-label="Режим отображения">
      <button
        class="seg__btn"
        :class="{ 'seg__btn--on': state.viewMode === 'schematic' }"
        @click="setViewMode('schematic')"
      >
        Каркас
      </button>
      <button
        class="seg__btn"
        :class="{ 'seg__btn--on': state.viewMode === 'realistic' }"
        @click="setViewMode('realistic')"
      >
        Полный
      </button>
    </div>

    <span class="spacer"></span>

    <span v-if="state.busy" class="badge badge--warn">расчёт…</span>
    <span v-else-if="state.savedAt" class="save-hint">
      сохранено {{ state.savedAt }}
    </span>

    <button
      class="btn btn--ghost btn--icon"
      :disabled="!canUndo"
      title="Отменить (Ctrl+Z)"
      @click="undo"
    >
      ↶
    </button>
    <button
      class="btn btn--ghost btn--icon"
      :disabled="!canRedo"
      title="Повторить (Ctrl+Shift+Z)"
      @click="redo"
    >
      ↷
    </button>
    <button class="btn btn--ghost" @click="historyOpen = true">Журнал</button>
    <button class="btn btn--ghost" @click="projectsOpen = true">Проекты</button>
    <button class="btn btn--ghost" @click="exportJson">JSON</button>
    <button class="btn" @click="setPresentation(true)">Показ</button>
    <button class="btn btn--primary" @click="saveProject">Сохранить</button>
    <ProjectManager v-if="projectsOpen" @close="projectsOpen = false" />
    <HistoryPanel v-if="historyOpen" @close="historyOpen = false" />
  </header>
</template>
