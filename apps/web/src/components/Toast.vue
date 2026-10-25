<script setup lang="ts">
import { dismissToast, ui, undo } from '../state/project'

function act(): void {
  if (ui.toast?.action === 'undo') undo()
  dismissToast()
}
</script>

<template>
  <div
    v-if="ui.toast"
    class="toast"
    :class="`toast--${ui.toast.kind}`"
    role="status"
    aria-live="polite"
  >
    <span class="toast__text">{{ ui.toast.text }}</span>
    <button v-if="ui.toast.action" class="toast__action" @click="act">Отменить</button>
    <button class="toast__close" title="Закрыть" @click="dismissToast">×</button>
  </div>
</template>
