<script setup lang="ts">
import { computed, ref } from 'vue'
import NumField from './NumField.vue'
import ModulePreview from './ModulePreview.vue'
import FurnitureConstructor from './FurnitureConstructor.vue'
import {
  deleteInstance,
  duplicateInstance,
  kindIsOpen,
  partSelection,
  renameInstance,
  rotateInstance,
  runners,
  selectPart,
  toggleDoors,
  toggleDrawers,
  updateParams,
  type Instance,
} from '../state/project'

const props = defineProps<{
  instance: Instance
  x: number
  y: number
}>()

const emit = defineEmits<{ (e: 'close'): void }>()
const constructorOpen = ref(false)

const part = computed(() =>
  partSelection.instanceId === props.instance.id
    ? partSelection.part
    : null,
)

function onPick(p: number | null): void {
  selectPart(props.instance.id, p)
}

function onName(e: Event) {
  renameInstance(
    props.instance.id,
    (e.target as HTMLInputElement).value,
  )
}
</script>

<template>
  <aside
    class="object-popup"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
  >
    <div class="object-popup__head">
      <span class="object-popup__title">Настройки</span>
      <input
        class="object-popup__name"
        :value="instance.name"
        aria-label="Название модуля"
        @change="onName"
      />
      <button
        class="object-popup__close"
        title="Закрыть"
        @click="emit('close')"
      >
        ×
      </button>
    </div>

    <ModulePreview
      :instance-id="instance.id"
      :height="168"
      compact
      :part="part"
      @pick="onPick"
    />

    <div class="field-row field-row--3">
      <NumField
        label="Ширина"
        :value="instance.params.W"
        :min="200"
        :max="3000"
        :step="10"
        @change="updateParams({ W: $event })"
      />
      <NumField
        label="Высота"
        :value="instance.params.H"
        :min="200"
        :max="2600"
        :step="10"
        @change="updateParams({ H: $event })"
      />
      <NumField
        label="Глубина"
        :value="instance.params.D"
        :min="200"
        :max="900"
        :step="10"
        @change="updateParams({ D: $event })"
      />
    </div>

    <label v-if="instance.params.drawers > 0" class="field">
      <span class="field__label">Направляющие</span>
      <select
        class="select"
        :value="instance.params.runners"
        @change="updateParams({ runners: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="r in runners" :key="r.id" :value="r.id">
          {{ r.name }}
        </option>
      </select>
    </label>

    <div class="object-popup__toggles">
      <button
        class="btn btn--sm"
        :class="{ 'btn--primary': kindIsOpen(instance, 'door') }"
        :disabled="instance.params.doors === 0"
        @click="toggleDoors(instance.id)"
      >
        Двери: {{ kindIsOpen(instance, 'door') ? 'открыты' : 'закрыты' }}
      </button>
      <button
        class="btn btn--sm"
        :class="{ 'btn--primary': kindIsOpen(instance, 'drawer') }"
        :disabled="instance.params.drawers === 0"
        @click="toggleDrawers(instance.id)"
      >
        Ящики: {{ kindIsOpen(instance, 'drawer') ? 'выдвинуты' : 'закрыты' }}
      </button>
    </div>

    <div class="object-popup__actions">
      <button class="btn btn--sm btn--primary" @click="constructorOpen = true">
        Конструктор
      </button>
      <button
        class="btn btn--sm"
        :title="`Развернуть на 90° (R). Сейчас ${instance.rot}°`"
        @click="rotateInstance(instance.id, 90)"
      >
        ⟳ 90°
      </button>
      <button class="btn btn--sm" @click="duplicateInstance(instance.id)">
        Дублировать
      </button>
      <button
        class="btn btn--sm object-popup__danger"
        @click="deleteInstance(instance.id)"
      >
        Удалить
      </button>
    </div>

    <FurnitureConstructor
      v-if="constructorOpen"
      :instance-id="instance.id"
      @close="constructorOpen = false"
    />
  </aside>
</template>
