<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useModalDrag } from '../composables/useModalDrag'
import ModulePreview from './ModulePreview.vue'
import {
  addKey,
  animState,
  channelsOf,
  derived,
  objectsOf,
  partIsOpen,
  partSelection,
  playPart,
  removeKey,
  resetKeys,
  setPartChannel,
  togglePart,
  kindIsOpen,
  selectPart,
  state,
  toggleDoors,
  toggleDrawers,
} from '../state/project'
import { moduleInfo, sizeLabel } from '../module/info'
import type { Channel } from '../anim/channels'

const props = defineProps<{ instanceId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const winEl = ref<HTMLElement | null>(null)
const { style: dragStyle, onDown: onDragStart } = useModalDrag(winEl)

const inst = computed(
  () =>
    state.project.instances.find((i) => i.id === props.instanceId) ?? null,
)
const info = computed(() =>
  inst.value
    ? moduleInfo(inst.value, derived[props.instanceId]?.objects)
    : null,
)

const calc = computed(() => derived[props.instanceId] ?? null)

const sel = computed(() =>
  partSelection.instanceId === props.instanceId
    ? partSelection.part
    : null,
)

const selElement = computed(() =>
  info.value && sel.value != null
    ? (info.value.elements[sel.value] ?? null)
    : null,
)

function pick(part: number | null): void {
  selectPart(props.instanceId, part)
}

const channels = computed<Channel[]>(() => {
  if (!inst.value || sel.value == null) return []
  const set = channelsOf(inst.value, sel.value)
  return set ? Object.values(set) : []
})

const selectedOpen = computed(() =>
  inst.value && sel.value != null ? partIsOpen(inst.value, sel.value) : false,
)

function toggleSelected(): void {
  if (inst.value && sel.value != null) togglePart(inst.value.id, sel.value)
}

function slide(ch: Channel, e: Event): void {
  if (!inst.value || sel.value == null) return
  setPartChannel(
    inst.value.id,
    sel.value,
    ch.id,
    Number((e.target as HTMLInputElement).value),
  )
}

function key(ch: Channel): void {
  if (inst.value && sel.value != null) {
    addKey(inst.value.id, sel.value, ch.id)
  }
}

function unkey(ch: Channel, i: number): void {
  if (inst.value && sel.value != null) {
    removeKey(inst.value.id, sel.value, ch.id, i)
  }
}

function resetAll(): void {
  if (inst.value && sel.value != null) resetKeys(inst.value.id, sel.value)
}

function play(): void {
  if (inst.value && sel.value != null) playPart(inst.value.id, sel.value)
}

function fmt(v: number, unit: string): string {
  return `${Math.round(v)}${unit ? ' ' + unit : ''}`
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <section class="modal__win" ref="winEl" :style="dragStyle">
      <header class="modal__head" @pointerdown="onDragStart">
        <span class="modal__title">{{ inst?.name ?? 'Модуль' }}</span>
        <span class="modal__sub">детали и размеры</span>
        <div class="modal__tools">
          <button
            v-if="inst && inst.params.doors > 0"
            class="btn btn--sm"
            :class="{ 'btn--primary': kindIsOpen(inst, 'door') }"
            @click="toggleDoors(inst.id)"
          >
            Двери: {{ kindIsOpen(inst, 'door') ? 'открыты' : 'закрыты' }}
          </button>
          <button
            v-if="inst && inst.params.drawers > 0"
            class="btn btn--sm"
            :class="{ 'btn--primary': kindIsOpen(inst, 'drawer') }"
            @click="toggleDrawers(inst.id)"
          >
            Ящики: {{ kindIsOpen(inst, 'drawer') ? 'выдвинуты' : 'закрыты' }}
          </button>
          <button
            class="btn btn--sm"
            title="Закрыть (Esc)"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
      </header>

      <div class="detail">
        <div class="detail__view">
          <ModulePreview
            :instance-id="instanceId"
            :height="440"
            show-dims
            :part="sel"
            @pick="pick"
          />
          <p class="detail__hint">
            ЛКМ — вращать · колесо — масштаб · клик по детали — выделить ·
            Esc — закрыть
          </p>
        </div>

        <aside class="detail__side">
          <template v-if="info">
            <div class="detail__total">
              <div class="stat">
                <div class="stat__k">габарит</div>
                <div class="stat__v stat__v--sm">
                  {{ info.W }} × {{ info.H }} × {{ info.D }}
                </div>
              </div>
              <div class="stat">
                <div class="stat__k">полная высота</div>
                <div class="stat__v stat__v--sm">{{ info.totalH }}</div>
              </div>
            </div>

            <div v-if="calc" class="detail__group">
              <div class="detail__group-title">Размеры корпуса</div>
              <ul class="detail__gaps">
                <li>
                  <span>Наружные (Ш × В × Г)</span>
                  <b>
                    {{ calc.dims.outer.W }} × {{ calc.dims.outer.H }} ×
                    {{ calc.dims.outer.D }}
                  </b>
                </li>
                <li>
                  <span>Внутренние</span>
                  <b>
                    {{ calc.dims.inner.W }} × {{ calc.dims.inner.H }} ×
                    {{ calc.dims.inner.D }}
                  </b>
                </li>
                <li>
                  <span>ЛДСП / ДВП</span>
                  <b>{{ calc.dims.t }} / {{ calc.dims.t_back }} мм</b>
                </li>
              </ul>
            </div>

            <div v-if="calc?.drawers.length" class="detail__group">
              <div class="detail__group-title">Ящики и фурнитура</div>
              <ul class="detail__gaps">
                <li>
                  <span>Направляющие</span>
                  <b>{{ calc.hardware.name }}</b>
                </li>
                <li>
                  <span>Зазор на сторону</span>
                  <b>{{ calc.hardware.side_gap }} мм</b>
                </li>
                <li v-for="d in calc.drawers" :key="`d${d.id}`">
                  <span>Короб {{ d.id }} (Ш × В × Г)</span>
                  <b>{{ d.box_w }} × {{ d.box_h }} × {{ d.box_len }}</b>
                </li>
                <li v-for="d in calc.drawers" :key="`f${d.id}`">
                  <span>Фасад {{ d.id }} (Ш × В)</span>
                  <b>{{ d.front_w }} × {{ d.front_h }}</b>
                </li>
              </ul>
            </div>

            <div v-if="selElement" class="detail__sel">
              <div class="detail__sel-name">{{ selElement.title }}</div>
              <div class="detail__sel-size">{{ sizeLabel(selElement) }} мм</div>
              <div class="detail__sel-pos">
                X {{ Math.round(selElement.x) }} · Y
                {{ Math.round(selElement.y) }} · Z
                {{ Math.round(selElement.z) }}
              </div>
            </div>

            <div
              v-for="g in info.groups"
              :key="g.key"
              class="detail__group detail__group--grow"
            >
              <div class="detail__group-title">
                <span>{{ g.label }}</span>
                <span class="dim">{{ g.elements.length }}</span>
              </div>
              <ul class="detail__list">
                <li
                  v-for="e in g.elements"
                  :key="e.index"
                  :class="{ 'is-active': sel === e.index }"
                  @click="pick(e.index)"
                >
                  <span class="detail__name">{{ e.title }}</span>
                  <span class="detail__size">{{ sizeLabel(e) }}</span>
                  <span v-if="e.kind === 'door' || e.kind === 'drawerfront'" class="detail__dot" :class="{ 'is-on': inst && partIsOpen(inst, e.index) }"></span>
                </li>
              </ul>
            </div>
          </template>
          <div v-else class="dim">Нет данных расчёта для этого модуля.</div>
            <div v-if="channels.length" class="detail__group">
              <div class="detail__group-title">
                <span>Анимация</span>
                <span class="dim">
                  {{ animState.playing && animState.instanceId === instanceId
                    ? animState.time.toFixed(2) + ' с'
                    : channels.reduce((m, c) => Math.max(m, c.keys.length ? c.keys[c.keys.length - 1].t : 0), 0).toFixed(2) + ' с' }}
                </span>
              </div>

              <div class="chan" v-for="ch in channels" :key="ch.id">
                <div class="chan__head">
                  <span>{{ ch.label }}</span>
                  <b>{{ fmt(ch.value, ch.unit) }}</b>
                </div>
                <input
                  class="chan__range"
                  type="range"
                  :min="ch.min"
                  :max="ch.max"
                  :step="ch.id === 'open' ? 1 : 5"
                  :value="ch.value"
                  @input="slide(ch, $event)"
                />
                <ul class="chan__keys">
                  <li v-for="(k, i) in ch.keys" :key="i">
                    <span>{{ k.t.toFixed(2) }} с</span>
                    <b>{{ fmt(k.v, ch.unit) }}</b>
                    <button
                      class="chan__del"
                      title="Удалить ключ"
                      @click="unkey(ch, i)"
                    >
                      ×
                    </button>
                  </li>
                  <li v-if="!ch.keys.length" class="chan__empty">
                    ключей нет — значение статическое
                  </li>
                </ul>
                <div class="chan__actions">
                  <button class="btn btn--sm" @click="key(ch)">＋ Ключ</button>
                </div>
              </div>

              <div class="chan__actions chan__actions--row">
                <button class="btn btn--sm" @click="toggleSelected">
                  {{ selectedOpen ? 'Закрыть' : 'Открыть' }}
                </button>
                <button class="btn btn--sm" @click="play">▶ Проиграть</button>
                <button class="btn btn--sm" @click="resetAll">
                  Ключи по умолчанию
                </button>
              </div>
            </div>

            <div v-if="info.shelves.length" class="detail__group">
              <div class="detail__group-title">Расстояния полок</div>
              <ul class="detail__gaps">
                <li v-for="(g, i) in info.shelves" :key="`s${i}`">
                  <span>{{ g.label }}</span>
                  <b>{{ g.size }} мм</b>
                </li>
              </ul>
            </div>

            <div v-if="info.facades.length" class="detail__group">
              <div class="detail__group-title">Фасады</div>
              <ul class="detail__gaps">
                <li
                  v-for="f in info.facades"
                  :key="`f${f.index}`"
                  :class="{ 'is-active': sel === f.index }"
                  @click="pick(f.index)"
                >
                  <span>{{ f.title }}</span>
                  <b>{{ sizeLabel(f) }}</b>
                </li>
              </ul>
              <ul v-if="info.facadeGaps.length" class="detail__gaps">
                <li v-for="(g, i) in info.facadeGaps" :key="`g${i}`">
                  <span>просвет {{ i + 1 }}</span>
                  <b>{{ g.size }} мм</b>
                </li>
              </ul>
            </div>

        </aside>
      </div>
    </section>
  </div>
</template>
