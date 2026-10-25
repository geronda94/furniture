<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  apiCreateVersion,
  apiDeleteVersion,
  apiListVersions,
  type ProjectVersion,
} from '../api'
import { restoreProjectVersion, state } from '../state/project'

const emit = defineEmits<{ (e: 'close'): void }>()

const rows = ref<ProjectVersion[]>([])
const name = ref('')
const busy = ref(false)
const error = ref('')
const note = ref('')

function fmt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

async function refresh(): Promise<void> {
  busy.value = true
  try {
    rows.value = await apiListVersions(state.projectId)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function snapshot(): Promise<void> {
  busy.value = true
  try {
    const v = await apiCreateVersion(
      state.projectId,
      name.value.trim() || `Снимок ${rows.value.length + 1}`,
    )
    name.value = ''
    note.value = `Создан снимок «${v.name}»`
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function restore(v: ProjectVersion): Promise<void> {
  if (!window.confirm(
    `Восстановить «${v.name}»? Текущее состояние будет сохранено отдельным снимком.`,
  )) return
  busy.value = true
  try {
    await restoreProjectVersion(v.id)
    note.value = `Восстановлено: «${v.name}»`
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function remove(v: ProjectVersion): Promise<void> {
  if (!window.confirm(`Удалить снимок «${v.name}»?`)) return
  busy.value = true
  try {
    await apiDeleteVersion(state.projectId, v.id)
    note.value = 'Снимок удалён'
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--versions" @click.self="emit('close')">
      <section class="modal__win versions" role="dialog" aria-modal="true" aria-label="Версии проекта">
        <header class="modal__head">
          <span class="modal__title">Версии проекта</span>
          <span class="modal__sub">{{ state.project.name }}</span>
          <div class="modal__tools">
            <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="versions__new">
          <input
            v-model="name"
            class="input"
            placeholder="Название снимка (необязательно)"
            @keydown.enter="snapshot"
          />
          <button class="btn btn--primary" :disabled="busy" @click="snapshot">
            Снять снимок
          </button>
        </div>

        <div class="versions__body">
          <p v-if="note" class="versions__note">{{ note }}</p>
          <p v-if="error" class="versions__error">{{ error }}</p>
          <p v-if="busy && !rows.length" class="dim">Загрузка…</p>
          <p v-else-if="!rows.length" class="dim versions__empty">
            Снимков пока нет. Сделайте первый — текущее состояние проекта
            сохранится на сервере.
          </p>
          <ul v-else class="versions__list">
            <li v-for="v in rows" :key="v.id" class="versions__row">
              <div class="versions__main">
                <b>{{ v.name }}</b>
                <span class="dim">
                  {{ fmt(v.created) }} · модулей: {{ v.instances }}
                </span>
              </div>
              <button class="btn btn--sm" :disabled="busy" @click="restore(v)">
                Восстановить
              </button>
              <button class="btn btn--sm versions__danger" :disabled="busy" @click="remove(v)">
                ×
              </button>
            </li>
          </ul>
        </div>

        <p class="dim versions__hint">
          Восстановление заменяет текущий проект, но сначала автоматически
          создаёт снимок текущего состояния. Снимки лежат в
          projects/&lt;id&gt;/versions/ или в таблице project_versions.
        </p>
      </section>
    </div>
  </Teleport>
</template>
