<script setup lang="ts">
import {
  addInstance,
  deleteInstance,
  duplicateInstance,
  MODULE_PRESETS,
  select,
  state,
} from '../state/project'

function onDrag(e: DragEvent, key: string) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/plain', `preset:${key}`)
  e.dataTransfer.effectAllowed = 'copy'
}

function label(name: string | undefined, i: number) {
  return name || `Модуль ${i + 1}`
}
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <span>Модули</span>
      <span class="dim">{{ state.project.instances.length }}</span>
    </div>
    <div class="panel__body">
      <div class="preset-grid">
        <div
          v-for="p in MODULE_PRESETS"
          :key="p.key"
          class="preset"
          draggable="true"
          role="button"
          tabindex="0"
          :title="`${p.label} · ${p.hint}. Перетащи в план или нажми`"
          @dragstart="onDrag($event, p.key)"
          @click="addInstance(p.key)"
          @keydown.enter="addInstance(p.key)"
        >
          <span class="preset__name">{{ p.label }}</span>
          <span class="preset__hint">{{ p.hint }}</span>
        </div>
      </div>

      <div class="modules">
        <div
          v-for="(inst, i) in state.project.instances"
          :key="inst.id"
          class="module-row"
          :class="{ 'module-row--on': state.selection === inst.id }"
          @click="select(inst.id)"
        >
          <span class="module-row__name">{{ label(inst.name, i) }}</span>
          <span class="module-row__size">
            {{ inst.params.W }}×{{ inst.params.H }}×{{ inst.params.D }}
          </span>
          <button
            class="module-row__btn"
            title="Дублировать"
            @click.stop="duplicateInstance(inst.id)"
          >
            ⧉
          </button>
          <button
            class="module-row__btn"
            title="Удалить"
            @click.stop="deleteInstance(inst.id)"
          >
            ×
          </button>
        </div>
      </div>

      <p class="editor-hint">
        Перетащи пресет в план или 2.5D. <b>Delete</b> — удалить, стрелки —
        сдвиг (Shift — 100 мм), двойной клик — фокус.
      </p>
    </div>
  </section>
</template>
