<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import TopBar from './components/TopBar.vue'
import Outliner from './components/Outliner.vue'
const View3D = defineAsyncComponent(() => import('./components/View3D.vue'))
import DraftView from './components/DraftView.vue'
import AddObjectModal from './components/AddObjectModal.vue'
import StatusBar from './components/StatusBar.vue'
import PresentationBar from './components/PresentationBar.vue'
import ObjectModal from './components/ObjectModal.vue'
import AiChatPanel from './components/AiChatPanel.vue'
import PropPanel from './components/PropPanel.vue'
import FinishModal from './components/FinishModal.vue'
import Toast from './components/Toast.vue'
import AuthScreen from './components/AuthScreen.vue'
import DemoTour from './components/DemoTour.vue'
import { auth, initAuth } from './state/auth'
import {
  clearGuides,
  closeObjectModal,
  deleteProp,
  rotateProp,
  selectedProp,
  deleteSelection,
  init,
  layoutState,
  updateProp,
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
  if (ui.propPanelOpen) { ui.propPanelOpen = false; return true }
  if (ui.moreOpen) { ui.moreOpen = false; return true }
  if (ui.viewSheetOpen) { ui.viewSheetOpen = false; return true }
  if (ui.addOpen) { ui.addOpen = false; return true }
  if (ui.quoteOpen) { ui.quoteOpen = false; return true }
  if (ui.versionsOpen) { ui.versionsOpen = false; return true }
  if (ui.layoutOpen) { ui.layoutOpen = false; return true }
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
    ui.versionsOpen || ui.moreOpen || ui.projectsOpen || ui.historyOpen ||
    ui.layoutOpen
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

  const prop = selectedProp.value
  if (prop) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteProp(prop.id)
      return
    }
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      e.preventDefault()
      rotateProp(prop.id, e.shiftKey ? -90 : 90)
      return
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 100 : 10
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
      if (dx || dy) {
        updateProp(prop.id, { x: prop.x + dx, y: prop.y + dy }, true)
      }
      return
    }
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

let appStarted = false

async function startApp(): Promise<void> {
  if (appStarted || !auth.user) return
  appStarted = true
  await init()
  if (auth.user.demo) {
    let seen = ''
    try { seen = localStorage.getItem('furniture.tour.done') || '' } catch { /* ignore */ }
    if (!seen) {
      ui.tourStep = 0
      ui.tourOpen = true
    }
  }
}

async function boot(): Promise<void> {
  // Быстрый вход в 2D для слабых ПК и для проверки развёрток:
  // ?draft=1&tab=plan — план, по умолчанию стены.
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('draft') === '1') {
      ui.renderMode = 'draft'
      ui.draftTab = q.get('tab') === 'plan' ? 'plan' : 'walls'
    }
  } catch {
    /* ignore */
  }
  // На слабом CPU не считаем весь проект сразу: стартуем с одной комнаты.
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
    ui.onlyRoom = true
  }
  await initAuth()
  await startApp()
}

watch(
  () => auth.user,
  (user) => {
    if (user) {
      void startApp()
    } else {
      appStarted = false
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', trackPointer, true)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onBeforeUnload)
  void boot()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', trackPointer, true)
  window.removeEventListener('pagehide', onPageHide)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <AuthScreen v-if="auth.ready && !auth.user" />
  <div
    v-else-if="auth.ready && auth.user"
    class="app"
    :class="{
      'app--presentation': state.presentation,
      'app--panel-open': ui.panelOpen,
      'app--object-open': ui.object.open,
    }"
  >
    <TopBar />
    <main class="workspace">
      <View3D v-if="ui.renderMode === '3d'" />
      <DraftView v-else />
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
        :class="{ 'mobilebar__btn--on': !ui.panelOpen && !ui.viewSheetOpen && !ui.moreOpen }"
        @click="ui.renderMode = '3d'; ui.panelOpen = false; ui.viewSheetOpen = false; ui.moreOpen = false"
      >
        <span class="mobilebar__ico" aria-hidden="true">◧</span>
        <span>Сцена</span>
      </button>
      <button
        class="mobilebar__btn"
        :class="{ 'mobilebar__btn--on': ui.panelOpen }"
        :aria-expanded="ui.panelOpen"
        @click="ui.viewSheetOpen = false; ui.moreOpen = false; ui.panelOpen = !ui.panelOpen"
      >
        <span class="mobilebar__ico" aria-hidden="true">▤</span>
        <span>Объекты</span>
      </button>
      <button
        class="mobilebar__btn mobilebar__btn--accent mobilebar__btn--add"
        title="Добавить объект"
        aria-label="Добавить объект"
        data-tour="add-mobile"
        @click="ui.panelOpen = false; ui.viewSheetOpen = false; ui.moreOpen = false; openAddModal()"
      >＋</button>
      <button
        class="mobilebar__btn"
        :class="{ 'mobilebar__btn--on': ui.viewSheetOpen }"
        :aria-expanded="ui.viewSheetOpen"
        @click="ui.panelOpen = false; ui.moreOpen = false; ui.viewSheetOpen = !ui.viewSheetOpen"
      >
        <span class="mobilebar__ico" aria-hidden="true">◉</span>
        <span>Вид</span>
      </button>
      <button
        class="mobilebar__btn"
        :class="{ 'mobilebar__btn--on': ui.moreOpen }"
        @click="ui.panelOpen = false; ui.viewSheetOpen = false; ui.moreOpen = true"
      >
        <span class="mobilebar__ico" aria-hidden="true">☰</span>
        <span>Меню</span>
      </button>
    </nav>
    <div
      v-if="ui.panelOpen"
      class="mobile-scrim"
      aria-hidden="true"
      @click="ui.panelOpen = false"
    ></div>
    <button
      v-if="!state.presentation && (layoutState.errors || layoutState.warnings)"
      class="m-layout-badge"
      :class="{ 'm-layout-badge--err': layoutState.errors > 0 }"
      :title="layoutState.errors
        ? `Ошибок расстановки: ${layoutState.errors}`
        : `Предупреждений: ${layoutState.warnings}`"
      @click="ui.panelOpen = false; ui.viewSheetOpen = false; ui.layoutOpen = true"
    >
      ⚠ {{ layoutState.errors || layoutState.warnings }}
    </button>
    <PresentationBar v-if="state.presentation" />
    <AddObjectModal v-if="ui.addOpen" @close="ui.addOpen = false" />
    <ObjectModal v-if="ui.object.open" />
    <AiChatPanel />
    <PropPanel v-if="!ui.object.open && !state.presentation" />
    <FinishModal v-if="ui.finishOpen" @close="ui.finishOpen = false" />
    <DemoTour v-if="ui.tourOpen" />
    <Toast />
  </div>
  <div v-else class="auth-loading">
    <div class="boot__mark" aria-hidden="true"></div>
    <span>Проверяем сессию…</span>
  </div>
</template>
