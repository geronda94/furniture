<script setup lang="ts">
import { computed } from 'vue'
import {
  animState,
  channelsOf,
  objectsOf,
  partIsOpen,
  playPart,
  setPartChannel,
  state,
  togglePart,
} from '../state/project'
import { moduleInfo, sizeLabel } from '../module/info'

const props = defineProps<{
  instanceId: string
  part: number
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'keys'): void
}>()

const inst = computed(
  () =>
    state.project.instances.find((i) => i.id === props.instanceId) ?? null,
)
const info = computed(() =>
  inst.value ? moduleInfo(inst.value, objectsOf(inst.value)) : null,
)
const element = computed(() => info.value?.elements[props.part] ?? null)
const channels = computed(() => {
  const i = inst.value
  if (!i) return []
  const set = channelsOf(i, props.part)
  return set ? Object.values(set) : []
})
const isOpen = computed(() =>
  inst.value ? partIsOpen(inst.value, props.part) : false,
)
const playing = computed(
  () =>
    animState.playing &&
    animState.instanceId === props.instanceId &&
    inst.value !== null,
)

function toggle(): void {
  if (inst.value) togglePart(inst.value.id, props.part)
}

function onSlide(id: string, e: Event): void {
  if (!inst.value) return
  setPartChannel(inst.value.id, props.part, id, Number((e.target as HTMLInputElement).value))
}

function play(): void {
  if (inst.value) playPart(inst.value.id, props.part)
}

function formatValue(v: number, unit: string): string {
  return `${Math.round(v)}${unit ? ' ' + unit : ''}`
}
</script>

<template>
  <aside
    v-if="inst && element"
    class="part-popup"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
  >
    <div class="part-popup__head">
      <span class="part-popup__title">{{ element.title }}</span>
      <button class="part-popup__close" title="Закрыть" @click="emit('close')">
        ×
      </button>
    </div>
    <div class="part-popup__size">{{ sizeLabel(element) }} мм</div>

    <label
      v-for="ch in channels"
      :key="ch.id"
      class="part-popup__chan"
    >
      <span class="part-popup__chan-label">
        {{ ch.label }}
        <b>{{ formatValue(ch.value, ch.unit) }}</b>
      </span>
      <input
        class="part-popup__range"
        type="range"
        :min="ch.min"
        :max="ch.max"
        :step="ch.id === 'open' ? 1 : 5"
        :value="ch.value"
        @input="onSlide(ch.id, $event)"
      />
    </label>

    <div class="part-popup__actions">
      <button class="btn btn--sm btn--primary" @click="toggle">
        {{ isOpen ? 'Закрыть' : 'Открыть' }}
      </button>
      <button
        class="btn btn--sm"
        :class="{ 'btn--primary': playing }"
        title="Проиграть анимацию по ключам"
        @click="play"
      >
        ▶
      </button>
      <button class="btn btn--sm" @click="emit('keys')">
        Ключи
      </button>
    </div>
  </aside>
</template>
