<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { saveProject, setMaster, state, ui } from '../state/project'
import { auth, logout } from '../state/auth'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'files'): void
  (e: 'history'): void
  (e: 'json'): void
  (e: 'present'): void
  (e: 'layout'): void
}>()

const status = computed(() => {
  if (state.saveState === 'saving') return 'Сохраняем…'
  if (state.saveState === 'error') return 'Не сохранено'
  if (state.dirty) return 'Есть несохранённые изменения'
  return state.savedAt ? `Сохранено в ${state.savedAt}` : 'Проект загружен'
})

async function signOut(): Promise<void> {
  await saveProject().catch(() => {})
  await logout()
  window.location.reload()
}

function act(action: 'files' | 'history' | 'json' | 'present' | 'settings' | 'versions' | 'quote' | 'save' | 'tour' | 'layout' | 'quickstart' | 'result' | 'master'): void {
  if (action === 'master') {
    setMaster(!ui.master)
  } else if (action === 'tour') {
    ui.tourStep = 0
    ui.tourOpen = true
  } else if (action === 'settings') {
    ui.settingsTab = 'globals'
    ui.settingsOpen = true
  } else if (action === 'versions') {
    ui.versionsOpen = true
  } else if (action === 'layout') {
    ui.layoutOpen = true
  } else if (action === 'quickstart') {
    ui.quickOpen = true
  } else if (action === 'result') {
    ui.resultOpen = true
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
            <b>{{ auth.user?.name || 'Меню' }}</b>
            <span class="dim">{{ status }}</span>
          </div>
          <button class="btn btn--ghost btn--sm" title="Закрыть" @click="emit('close')">×</button>
        </header>

        <p v-if="state.saveState === 'error'" class="appmenu__error">
          {{ state.saveError || 'Не удалось сохранить проект' }}
          <button class="link" @click="act('save')">Повторить</button>
        </p>

        <button class="appmenu__current" @click="act('files')">
          <AppIcon name="folder" :size="20" />
          <span class="appmenu__current-text">
            <b>{{ state.project.name || 'Без названия' }}</b>
            <small>Текущий проект · открыть другой</small>
          </span>
          <span class="appmenu__current-arrow" aria-hidden="true">→</span>
        </button>

        <div class="appmenu__section">
          <span class="appmenu__label">Режим</span>
          <div class="appmenu__grid">
            <button class="appmenu__item" @click="act('master')">
              <AppIcon name="eye" class="appmenu__ico" />
              <b>{{ ui.master ? 'Мастер-режим включён' : 'Включить мастер-режим' }}</b>
              <span>Только главное: комната → модули → проверка → проект</span>
            </button>
          </div>
        </div>

        <div class="appmenu__section">
          <span class="appmenu__label">Проект</span>
          <div class="appmenu__grid">
            <button class="appmenu__item" @click="act('quickstart')">
              <AppIcon name="plus" class="appmenu__ico" />
              <span>Быстрый старт</span>
            </button>
            <button class="appmenu__item" @click="act('save')">
              <AppIcon name="save" class="appmenu__ico" />
              <b>Сохранить сейчас</b>
              <span>Отправить текущее состояние на сервер</span>
            </button>
            <button class="appmenu__item" @click="act('files')">
              <AppIcon name="folder" class="appmenu__ico" />
              <b>Проекты и файлы</b>
              <span>Переключиться на другой проект, создать или удалить</span>
            </button>
            <button class="appmenu__item" @click="act('settings')">
              <AppIcon name="settings" class="appmenu__ico" />
              <b>Настройки проекта</b>
              <span>Материалы, параметры, переменные и цены</span>
            </button>
            <button class="appmenu__item" @click="act('versions')">
              <AppIcon name="versions" class="appmenu__ico" />
              <b>Версии</b>
              <span>Снимки состояния и восстановление</span>
            </button>
            <button class="appmenu__item" @click="act('layout')">
              <AppIcon name="layout" class="appmenu__ico" />
              <b>Расстановка мебели</b>
              <span>Стены, проёмы, зазоры и ориентация фасадов</span>
            </button>
          </div>
        </div>

        <div class="appmenu__section">
          <span class="appmenu__label">Документы</span>
          <div class="appmenu__grid">
            <button class="appmenu__item" @click="act('result')">
              <AppIcon name="quote" class="appmenu__ico" />
              <b>Готовый проект</b>
              <span>Детали, раскрой, присадка, фурнитура и смета</span>
            </button>
            <button class="appmenu__item" @click="act('quote')">
              <AppIcon name="quote" class="appmenu__ico" />
              <b>Коммерческое предложение</b>
              <span>Смета и печать для клиента</span>
            </button>
            <button class="appmenu__item" @click="act('history')">
              <AppIcon name="history" class="appmenu__ico" />
              <b>Журнал изменений</b>
              <span>Кто и что менял в проекте</span>
            </button>
            <button class="appmenu__item" @click="act('json')">
              <AppIcon name="export" class="appmenu__ico" />
              <b>Экспорт JSON</b>
              <span>Скачать проект файлом</span>
            </button>
          </div>
        </div>

        <div class="appmenu__section">
          <span class="appmenu__label">Показ и помощь</span>
          <div class="appmenu__grid">
            <button class="appmenu__item" @click="act('present')">
              <AppIcon name="present" class="appmenu__ico" />
              <b>Режим показа</b>
              <span>Полноэкранный вид для клиента</span>
            </button>
            <button class="appmenu__item" @click="act('tour')">
              <AppIcon name="tour" class="appmenu__ico" />
              <b>Обучение</b>
              <span>Короткий тур по интерфейсу</span>
            </button>
          </div>
        </div>

        <div class="appmenu__foot">
          <span class="dim">{{ auth.user?.demo ? 'Гостевой демо-доступ' : auth.user?.email }}</span>
          <button class="link" @click="signOut">Выйти</button>
        </div>
        <p class="dim appmenu__hint">
          Проект сохраняется автоматически. Индикатор в шапке показывает
          состояние связи с сервером.
        </p>
      </section>
    </div>
  </Teleport>
</template>
