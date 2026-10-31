<script setup lang="ts">
import { dismissToast, ui, undo } from '../state/project'

function act(): void {
  const action = ui.toast?.action
  if (action === 'undo') undo()
  else if (action === 'layout') ui.layoutOpen = true
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
    <button v-if="ui.toast.action" class="toast__action" @click="act">
      {{ ui.toast.action === 'layout' ? 'Проверить' : 'Отменить' }}
    </button>
    <button class="toast__close" title="Закрыть" @click="dismissToast">×</button>
  </div>
</template>
