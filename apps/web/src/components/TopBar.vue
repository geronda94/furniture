<script setup lang="ts">
import { computed } from 'vue'
import ProjectManager from './ProjectManager.vue'
import HistoryPanel from './HistoryPanel.vue'
import ProjectSettings from './ProjectSettings.vue'
import QuotePanel from './QuotePanel.vue'
import VersionsPanel from './VersionsPanel.vue'
import TopBarMenu from './TopBarMenu.vue'
import {
  canRedo,
  canUndo,
  redo,
  rename,
  saveProject,
  setPresentation,
  setViewMode,
  state,
  ui,
  undo,
} from '../state/project'

function onRename(e: Event) {
  rename((e.target as HTMLInputElement).value)
}
const saveText = computed(() => {
  if (state.saveState === 'saving') return 'Сохраняем…'
  if (state.saveState === 'error') return 'Не сохранено'
  if (state.dirty) return 'Есть изменения'
  return state.savedAt ? `Сохранено ${state.savedAt}` : 'Готово'
})

const saveTitle = computed(() => {
  if (state.saveState === 'error') return state.saveError || 'Ошибка сохранения'
  if (state.saveState === 'saving') return 'Идёт сохранение проекта'
  if (state.dirty) return 'Изменения ещё не отправлены на сервер'
  return 'Проект сохранён'
})

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

    <button
      class="save-state"
      :class="`save-state--${state.saveState}`"
      :title="saveTitle"
      :aria-label="saveTitle"
      @click="ui.moreOpen = true"
    >
      <span class="save-state__dot"></span>
      <span class="save-state__text">{{ saveText }}</span>
    </button>

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
    <button class="btn btn--primary topbar__save" @click="saveProject">Сохранить</button>
    <button class="btn btn--ghost topbar__more" title="Ещё" @click="ui.moreOpen = true">
      Ещё
    </button>
    <ProjectManager v-if="ui.projectsOpen" @close="ui.projectsOpen = false" />
    <HistoryPanel v-if="ui.historyOpen" @close="ui.historyOpen = false" />
    <ProjectSettings v-if="ui.settingsOpen" @close="ui.settingsOpen = false" />
    <QuotePanel v-if="ui.quoteOpen" @close="ui.quoteOpen = false" />
    <VersionsPanel v-if="ui.versionsOpen" @close="ui.versionsOpen = false" />
    <TopBarMenu
      v-if="ui.moreOpen"
      @close="ui.moreOpen = false"
      @files="ui.projectsOpen = true"
      @history="ui.historyOpen = true"
      @json="exportJson"
      @present="setPresentation(true)"
    />
  </header>
</template>
