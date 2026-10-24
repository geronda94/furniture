<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import TopBar from './components/TopBar.vue'
import Outliner from './components/Outliner.vue'
import View3D from './components/View3D.vue'
import AddObjectModal from './components/AddObjectModal.vue'
import StatusBar from './components/StatusBar.vue'
import PresentationBar from './components/PresentationBar.vue'
import ObjectModal from './components/ObjectModal.vue'
import {
  clearGuides,
  deleteSelection,
  init,
  moveSelection,
  pointer,
  redo,
  rotateSelection,
  selectAll,
  selectedInstance,
  state,
  ui,
  undo,
} from './state/project'

function onKey(e: KeyboardEvent) {
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

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', trackPointer, true)
  void init()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', trackPointer, true)
})
</script>

<template>
  <div class="app" :class="{ 'app--presentation': state.presentation }">
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
    <PresentationBar v-if="state.presentation" />
    <AddObjectModal v-if="ui.addOpen" @close="ui.addOpen = false" />
    <ObjectModal v-if="ui.object.open" />
  </div>
</template>
