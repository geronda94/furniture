<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import TopBar from './components/TopBar.vue'
import Outliner from './components/Outliner.vue'
import View3D from './components/View3D.vue'
import AddObjectModal from './components/AddObjectModal.vue'
import StatusBar from './components/StatusBar.vue'
import PresentationBar from './components/PresentationBar.vue'
import ObjectModal from './components/ObjectModal.vue'
import Toast from './components/Toast.vue'
import {
  clearGuides,
  closeObjectModal,
  deleteSelection,
  init,
  moveSelection,
  openAddModal,
  pointer,
  redo,
  rotateSelection,
  saveOnExit,
  selectAll,
  selectedInstance,
  state,
  ui,
  undo,
} from './state/project'

function closeTopLayer(): boolean {
  if (ui.moreOpen) { ui.moreOpen = false; return true }
  if (ui.addOpen) { ui.addOpen = false; return true }
  if (ui.quoteOpen) { ui.quoteOpen = false; return true }
  if (ui.versionsOpen) { ui.versionsOpen = false; return true }
  if (ui.settingsOpen) { ui.settingsOpen = false; return true }
  if (ui.projectsOpen) { ui.projectsOpen = false; return true }
  if (ui.historyOpen) { ui.historyOpen = false; return true }
  if (ui.object.open) { closeObjectModal(); return true }
  if (ui.panelOpen) { ui.panelOpen = false; return true }
  return false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (closeTopLayer()) {
      e.preventDefault()
      return
    }
  }

  const t = e.target as HTMLElement | null
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'SELECT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  ) {
    return
  }

  // Пока открыта модалка, фоновые Delete/R/стрелки не должны менять проект.
  if (
    ui.addOpen || ui.object.open || ui.settingsOpen || ui.quoteOpen ||
    ui.versionsOpen || ui.moreOpen || ui.projectsOpen || ui.historyOpen
  ) {
    return
  }

  const mod = e.ctrlKey || e.metaKey
  if (mod) {
    const key = e.key.toLowerCase()
    if (key === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (key === 'y') {
      e.preventDefault()
      redo()
    } else if (key === 'a') {
      e.preventDefault()
      selectAll()
    }
    return
  }

  const inst = selectedInstance.value
  if (!inst) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    deleteSelection()
    return
  }
  if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
    e.preventDefault()
    rotateSelection(e.shiftKey ? -90 : 90)
    return
  }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault()
    const step = e.shiftKey ? 100 : 10
    const dx =
      e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
    if (dx || dy) {
      const ids = state.selected.length ? state.selected : [inst.id]
      const starts: Record<string, { x: number; y: number }> = {}
      for (const id of ids) {
        const i = state.project.instances.find((x) => x.id === id)
        if (i) starts[id] = { x: i.x, y: i.y }
      }
      moveSelection(dx, dy, starts)
      window.setTimeout(clearGuides, 800)
    }
  }
}

function trackPointer(e: PointerEvent): void {
  pointer.x = e.clientX
  pointer.y = e.clientY
}

function onPageHide(): void {
  saveOnExit()
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (state.dirty || state.saveState === 'error') {
    e.preventDefault()
    e.returnValue = ''
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', trackPointer, true)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onBeforeUnload)
  void init()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', trackPointer, true)
  window.removeEventListener('pagehide', onPageHide)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div
    class="app"
    :class="{
      'app--presentation': state.presentation,
      'app--panel-open': ui.panelOpen,
      'app--object-open': ui.object.open,
    }"
  >
    <TopBar />
    <main class="workspace">
      <View3D />
      <aside class="sidebar">
        <div class="sidebar__tree">
          <Outliner />
        </div>
      </aside>
    </main>
    <StatusBar />
    <nav v-if="!state.presentation" class="mobilebar" aria-label="Мобильная навигация">
      <button
        class="mobilebar__btn"
        :class="{ 'mobilebar__btn--on': !ui.panelOpen }"
        @click="ui.panelOpen = false"
      >3D</button>
      <button
        class="mobilebar__btn"
        :class="{ 'mobilebar__btn--on': ui.panelOpen }"
        :aria-expanded="ui.panelOpen"
        @click="ui.panelOpen = !ui.panelOpen"
      >Объекты</button>
      <button
        class="mobilebar__btn mobilebar__btn--accent"
        title="Добавить объект"
        @click="openAddModal"
      >＋</button>
      <button
        class="mobilebar__btn"
        @click="ui.settingsTab = 'globals'; ui.settingsOpen = true"
      >Проект</button>
      <button
        class="mobilebar__btn"
        :class="{ 'mobilebar__btn--on': ui.moreOpen }"
        @click="ui.moreOpen = true"
      >Ещё</button>
    </nav>
    <div
      v-if="ui.panelOpen"
      class="mobile-scrim"
      aria-hidden="true"
      @click="ui.panelOpen = false"
    ></div>
    <PresentationBar v-if="state.presentation" />
    <AddObjectModal v-if="ui.addOpen" @close="ui.addOpen = false" />
    <ObjectModal v-if="ui.object.open" />
    <Toast />
  </div>
</template>
