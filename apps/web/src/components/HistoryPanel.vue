<script setup lang="ts">
import { computed } from 'vue'
import { canRedo, canUndo, redo, state, undo } from '../state/project'

const emit = defineEmits<{ (e: 'close'): void }>()
const entries = computed(() => [...(state.project.log ?? [])].reverse())
function time(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="modal" @click.self="emit('close')">
      <section class="modal__win history" role="dialog" aria-modal="true" aria-label="Журнал изменений">
        <header class="modal__head">
          <span class="modal__title">Журнал изменений</span>
          <span class="modal__sub">Ctrl+Z / Ctrl+Shift+Z</span>
          <div class="modal__tools">
            <button class="btn btn--sm" :disabled="!canUndo" @click="undo">↶ Отменить</button>
            <button class="btn btn--sm" :disabled="!canRedo" @click="redo">↷ Повторить</button>
            <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
          </div>
        </header>
        <div class="history__body">
          <div v-if="!entries.length" class="dim">Изменений пока нет.</div>
          <ol v-else class="history__list">
            <li v-for="(e, i) in entries" :key="`${e.time}-${i}`">
              <span class="history__time">{{ time(e.time) }}</span>
              <span class="history__label">{{ e.label }}</span>
            </li>
          </ol>
        </div>
      </section>
    </div>
  </Teleport>
</template>
