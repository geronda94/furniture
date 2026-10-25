<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { saveProject, state, ui } from '../state/project'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'files'): void
  (e: 'history'): void
  (e: 'json'): void
  (e: 'present'): void
}>()

const status = computed(() => {
  if (state.saveState === 'saving') return 'Сохраняем…'
  if (state.saveState === 'error') return 'Не сохранено'
  if (state.dirty) return 'Есть несохранённые изменения'
  return state.savedAt ? `Сохранено в ${state.savedAt}` : 'Проект загружен'
})

function act(action: 'files' | 'history' | 'json' | 'present' | 'settings' | 'versions' | 'quote' | 'save'): void {
  if (action === 'settings') {
    ui.settingsTab = 'globals'
    ui.settingsOpen = true
  } else if (action === 'versions') {
    ui.versionsOpen = true
  } else if (action === 'quote') {
    ui.quoteOpen = true
  } else if (action === 'save') {
    void saveProject()
  } else {
    emit(action)
  }
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--menu" @click.self="emit('close')">
      <section class="appmenu" role="dialog" aria-modal="true" aria-label="Меню проекта">
        <header class="appmenu__head">
          <div>
            <b>Меню</b>
            <span class="dim">{{ status }}</span>
          </div>
          <button class="btn btn--ghost btn--sm" title="Закрыть" @click="emit('close')">×</button>
        </header>

        <p v-if="state.saveState === 'error'" class="appmenu__error">
          {{ state.saveError || 'Не удалось сохранить проект' }}
          <button class="link" @click="act('save')">Повторить</button>
        </p>

        <div class="appmenu__grid">
          <button class="appmenu__item" @click="act('save')">
            <b>Сохранить сейчас</b>
            <span>Отправить текущее состояние на сервер</span>
          </button>
          <button class="appmenu__item" @click="act('files')">
            <b>Файлы</b>
            <span>Проекты на диске и новый проект</span>
          </button>
          <button class="appmenu__item" @click="act('settings')">
            <b>Настройки проекта</b>
            <span>Параметры, материалы, переменные</span>
          </button>
          <button class="appmenu__item" @click="act('versions')">
            <b>Версии</b>
            <span>Снимки и восстановление</span>
          </button>
          <button class="appmenu__item" @click="act('quote')">
            <b>Коммерческое предложение</b>
            <span>Смета и печать для клиента</span>
          </button>
          <button class="appmenu__item" @click="act('history')">
            <b>Журнал</b>
            <span>История изменений</span>
          </button>
          <button class="appmenu__item" @click="act('present')">
            <b>Показ</b>
            <span>Полноэкранный режим для клиента</span>
          </button>
          <button class="appmenu__item" @click="act('json')">
            <b>Экспорт JSON</b>
            <span>Скачать проект файлом</span>
          </button>
        </div>

        <p class="dim appmenu__hint">
          Проект сохраняется автоматически. Индикатор в шапке показывает
          состояние связи с сервером.
        </p>
      </section>
    </div>
  </Teleport>
</template>
