<script setup lang="ts">
import { computed, ref } from 'vue'
import NumField from './NumField.vue'
import { useModalDrag } from '../composables/useModalDrag'
import {
  deleteProp,
  duplicateProp,
  focusProp,
  rotateProp,
  selectedProp,
  setPropPanel,
  state,
  updateProp,
} from '../state/project'

const winEl = ref<HTMLElement | null>(null)
const collapsed = ref(false)
const { style: dragStyle, onDown: onDragStart, reset: resetDrag } = useModalDrag(winEl)

const prop = selectedProp
const typeLabel: Record<string, string> = {
  bed: 'Кровать', sofa: 'Диван', armchair: 'Кресло', chair: 'Стул',
  'coffee-table': 'Стол', tv: 'Телевизор', rug: 'Ковёр', bathtub: 'Ванна',
  toilet: 'Унитаз', vanity: 'Тумба с раковиной', shower: 'Душевая',
  plant: 'Растение', dresser: 'Комод', lamp: 'Торшер', fridge: 'Холодильник',
  stove: 'Плита', sink: 'Мойка',
}

const title = computed(() =>
  prop.value ? prop.value.name || typeLabel[prop.value.type] || 'Декор' : 'Декор',
)

function close(): void {
  resetDrag()
  setPropPanel(false)
}

function set(patch: Record<string, number | string>): void {
  if (!prop.value) return
  updateProp(prop.value.id, patch)
}

function moveTo(key: 'x' | 'y' | 'z', value: number): void {
  if (!prop.value) return
  set({ [key]: value })
}
</script>

<template>
  <Teleport to="body">
    <section
      v-if="prop && state.propPanelOpen"
      ref="winEl"
      class="prop-panel"
      :style="dragStyle"
      aria-label="Декоративный объект"
    >
      <header class="prop-panel__head" @pointerdown="onDragStart">
        <span class="prop-panel__ico" aria-hidden="true">◆</span>
        <div class="prop-panel__title">
          <b>{{ title }}</b>
          <small>{{ typeLabel[prop.type] || prop.type }} · декор, не в смете</small>
        </div>
        <button
          class="btn btn--ghost btn--sm prop-panel__fold"
          :title="collapsed ? 'Развернуть' : 'Свернуть'"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        >{{ collapsed ? '⌃' : '⌄' }}</button>
        <button class="btn btn--ghost btn--sm" title="Закрыть" @click="close">×</button>
      </header>

      <div v-if="collapsed" class="prop-panel__mini">
        <button class="btn btn--sm" @click="rotateProp(prop.id, 90)">⟳</button>
        <button class="btn btn--sm" @click="duplicateProp(prop.id)">Копия</button>
        <button class="btn btn--sm prop-panel__danger" @click="deleteProp(prop.id)">
          Удалить
        </button>
      </div>
      <div v-else class="prop-panel__body">
        <div class="prop-panel__row">
          <button class="btn btn--sm" title="Повернуть на −90°" @click="rotateProp(prop.id, -90)">⟲ 90°</button>
          <button class="btn btn--sm" title="Повернуть на +90°" @click="rotateProp(prop.id, 90)">⟳ 90°</button>
          <button class="btn btn--sm" @click="duplicateProp(prop.id)">Копия</button>
          <button class="btn btn--sm" title="Показать в 3D" @click="focusProp(prop.id)">Показать</button>
          <button class="btn btn--sm prop-panel__danger" @click="deleteProp(prop.id)">Удалить</button>
        </div>

        <div class="prop-panel__grid">
          <NumField label="X, мм" :value="prop.x" :step="50" @change="moveTo('x', $event)" />
          <NumField label="Y, мм" :value="prop.y" :step="50" @change="moveTo('y', $event)" />
          <NumField label="Z, мм" :value="prop.z ?? 0" :step="50" :min="0" @change="moveTo('z', $event)" />
        </div>

        <div class="prop-panel__grid">
          <NumField label="Ш, мм" :value="prop.w" :min="100" :step="50" @change="set({ w: $event })" />
          <NumField label="Г, мм" :value="prop.d" :min="100" :step="50" @change="set({ d: $event })" />
          <NumField label="В, мм" :value="prop.h" :min="50" :step="50" @change="set({ h: $event })" />
        </div>

        <div class="prop-panel__grid prop-panel__grid--2">
          <label class="prop-panel__color">
            <span>Цвет</span>
            <input
              type="color"
              :value="prop.color || '#8b8f95'"
              @input="set({ color: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="prop-panel__color">
            <span>Акцент</span>
            <input
              type="color"
              :value="prop.accent || prop.color || '#8b8f95'"
              @input="set({ accent: ($event.target as HTMLInputElement).value })"
            />
          </label>
        </div>

        <p class="prop-panel__hint">
          Декор чувствуется валидатором как твёрдое тело: стены, проёмы,
          мебель и другой декор. Размеры — по габариту, поворот — 0/90/180/270.
        </p>
      </div>
    </section>
  </Teleport>
</template>
