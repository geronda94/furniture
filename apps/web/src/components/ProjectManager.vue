<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useModalDrag } from '../composables/useModalDrag'
import {
  createProject,
  listProjects,
  openProject,
  state,
} from '../state/project'

const emit = defineEmits<{ (e: 'close'): void }>()
const winEl = ref<HTMLElement | null>(null)
const { style: dragStyle, onDown: onDragStart } = useModalDrag(winEl)
const rows = ref<{ id: string; name: string; updated: string }[]>([])
const name = ref('')
const busy = ref(false)
const error = ref('')

async function refresh(): Promise<void> {
  try {
    rows.value = await listProjects()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function open(id: string): Promise<void> {
  if (id === state.projectId) {
    emit('close')
    return
  }
  busy.value = true
  try {
    await openProject(id)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function create(): Promise<void> {
  busy.value = true
  try {
    await createProject(name.value)
    emit('close')
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
    <div class="modal modal--projects" @click.self="emit('close')">
      <section class="modal__win pm" ref="winEl" :style="dragStyle">
        <header class="modal__head" @pointerdown="onDragStart">
          <span class="modal__title">Проекты</span>
          <span class="modal__sub">файлы на диске</span>
          <div class="modal__tools">
            <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="pm__body">
          <aside class="pm__list">
            <button
              v-for="r in rows"
              :key="r.id"
              class="pm__row"
              :class="{ 'pm__row--on': r.id === state.projectId }"
              :disabled="busy"
              @click="open(r.id)"
            >
              <span class="pm__name">{{ r.name }}</span>
              <span class="pm__id">{{ r.id }}</span>
            </button>
            <div v-if="!rows.length" class="dim pm__empty">Проектов пока нет</div>
          </aside>

          <div class="pm__new">
            <b>Новый проект</b>
            <p class="dim pm__hint">
              Создаст пустой проект. Дальше — комната, стены и мебель.
            </p>
            <label class="field">
              <span class="field__label">Название</span>
              <input
                v-model="name"
                class="input"
                placeholder="Кухня клиента"
                @keydown.enter="create"
              />
            </label>
            <button class="btn btn--primary" :disabled="busy" @click="create">
              Создать
            </button>
            <p v-if="error" class="pm__error">{{ error }}</p>
            <p class="dim pm__hint">
              Текущий: <b>{{ state.project.name }}</b> ({{ state.projectId }})
            </p>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
