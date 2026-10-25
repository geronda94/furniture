<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useModalDrag } from '../composables/useModalDrag'
import ObjectIcon from './ObjectIcon.vue'
import {
  addInstance,
  addOpening,
  closeAddModal,
  defaultParams,
  MODULE_PRESETS,
  runners,
  state,
  suggestDoors,
  type Params,
} from '../state/project'
import type { WallIndex } from '../render25d/types'
import { roomWalls } from '../render25d/room'

const emit = defineEmits<{ (e: 'close'): void }>()
const winEl = ref<HTMLElement | null>(null)
const { style: dragStyle, onDown: onDragStart } = useModalDrag(winEl)

type Tab = 'furniture' | 'tech' | 'opening'
const tab = ref<Tab>('furniture')
const query = ref('')
const group = ref('Все')
const selectedKey = ref(MODULE_PRESETS[0]?.key ?? '')
const mobileSettings = ref(false)
const mobile = ref(false)
const bodyEl = ref<HTMLElement | null>(null)
let mobileQuery: MediaQueryList | null = null

function syncMobile(e?: MediaQueryListEvent): void {
  mobile.value = e ? e.matches : !!mobileQuery?.matches
  if (!mobile.value) mobileSettings.value = false
}

function showStep(settings: boolean): void {
  mobileSettings.value = settings
  nextTick(() => {
    if (bodyEl.value) bodyEl.value.scrollTop = 0
  })
}

function selectCard(key: string): void {
  selectedKey.value = key
  if (mobile.value) showStep(true)
}

function backToCatalog(): void {
  showStep(false)
}

const groups = computed(() => [
  'Все',
  ...Array.from(new Set(
    MODULE_PRESETS.map((p) => p.group).filter((g) => g !== 'Техника'),
  )),
])

const items = computed(() => {
  const q = query.value.trim().toLowerCase()
  return MODULE_PRESETS.filter((p) => {
    if (tab.value === 'tech') {
      if (p.group !== 'Техника') return false
    } else if (p.group === 'Техника') {
      return false
    }
    if (tab.value === 'furniture' && group.value !== 'Все' &&
        p.group !== group.value) return false
    if (!q) return true
    return `${p.label} ${p.hint} ${p.group}`.toLowerCase().includes(q)
  })
})

const selected = computed(
  () => MODULE_PRESETS.find((p) => p.key === selectedKey.value) ?? null,
)

const params = reactive<Params>(defaultParams())

function resetParams(): void {
  const p = selected.value
  Object.assign(
    params,
    defaultParams(),
    p ? p.params : {},
  )
}

watch(selectedKey, resetParams, { immediate: true })
watch(
  () => params.W,
  (w) => {
    if (!params.fronts?.length) {
      params.doors = Math.min(params.doors, suggestDoors(w))
    }
  },
)
watch(tab, () => {
  if (tab.value === 'opening') return
  const first = items.value[0]
  if (first) selectedKey.value = first.key
})

watch(group, () => {
  if (!items.value.some((p) => p.key === selectedKey.value)) {
    const first = items.value[0]
    if (first) selectedKey.value = first.key
  }
})

const wallOptions = computed(() =>
  roomWalls(state.project.room).map((w) => ({
    index: w.index,
    label: w.outer ? `Стена ${w.index + 1}` : `Перегородка ${w.index + 1}`,
    length: Math.round(w.len),
  })),
)
const openingKind = ref<'window' | 'door' | 'arch'>('window')
const OPENING_PRESETS = [
  { id: 'win-1200', kind: 'window' as const, label: 'Окно 1200', w: 1200, z0: 900, z1: 2200 },
  { id: 'win-1500', kind: 'window' as const, label: 'Окно 1500', w: 1500, z0: 800, z1: 2300 },
  { id: 'win-600', kind: 'window' as const, label: 'Окно 600', w: 600, z0: 1100, z1: 2100 },
  { id: 'door-900', kind: 'door' as const, label: 'Дверь 900', w: 900, z0: 0, z1: 2100 },
  { id: 'door-800', kind: 'door' as const, label: 'Дверь 800', w: 800, z0: 0, z1: 2100 },
  { id: 'balcony-900', kind: 'door' as const, label: 'Балкон 900', w: 900, z0: 0, z1: 2200 },
  { id: 'arch-900', kind: 'arch' as const, label: 'Проём 900', w: 900, z0: 0, z1: 2100 },
]
const opening = reactive({
  wall: 0 as WallIndex,
  w: 1200,
  z0: 900,
  z1: 2200,
})

function pickOpening(kind: 'window' | 'door' | 'arch'): void {
  openingKind.value = kind
  if (kind === 'door' || kind === 'arch') {
    opening.wall = Math.max(0, wallOptions.value.length - 1)
    opening.w = 900
    opening.z0 = 0
    opening.z1 = 2100
  } else {
    opening.wall = 0
    opening.w = 1200
    opening.z0 = 900
    opening.z1 = 2200
  }
}
function applyOpeningPreset(p: (typeof OPENING_PRESETS)[number]): void {
  openingKind.value = p.kind
  opening.wall = p.kind === 'window' ? 0 : Math.max(0, wallOptions.value.length - 1)
  opening.w = p.w
  opening.z0 = p.z0
  opening.z1 = p.z1
}
pickOpening('window')

const canAdd = computed(() => {
  if (tab.value === 'furniture' || tab.value === 'tech') {
    return !!selected.value && (!mobile.value || mobileSettings.value)
  }
  return opening.w >= 200 && opening.z1 > opening.z0
})

function num(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}

function add(): void {
  if (!canAdd.value) return
  if (tab.value === 'furniture' || tab.value === 'tech') {
    addInstance(selectedKey.value, undefined, undefined, { ...params })
  } else {
    addOpening(openingKind.value, {
      wall: opening.wall,
      w: opening.w,
      z0: opening.z0,
      z1: opening.z1,
    })
  }
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  mobileQuery = window.matchMedia('(max-width: 760px)')
  syncMobile()
  mobileQuery.addEventListener('change', syncMobile)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  mobileQuery?.removeEventListener('change', syncMobile)
})
</script>

<template>
  <div class="modal modal--add" @click.self="emit('close')">
    <section class="modal__win add" ref="winEl" :style="dragStyle" role="dialog" aria-modal="true" aria-label="Добавить объект">
      <header class="modal__head" @pointerdown="onDragStart">
        <span class="modal__title">Библиотека объектов</span>
        <span class="modal__sub">{{ state.project.name }}</span>
        <div class="modal__tools">
          <button class="btn btn--ghost btn--sm" title="Закрыть" @click="emit('close')">
            ×
          </button>
        </div>
      </header>

      <div class="add__body" ref="bodyEl">
        <div
          class="add__catalog"
          :class="{ 'add__step-hidden': (tab === 'furniture' || tab === 'tech') && mobileSettings }"
        >
          <div class="add__tabs">
            <button
              class="add__tab"
              :class="{ 'add__tab--on': tab === 'furniture' }"
              @click="tab = 'furniture'"
            >
              Мебель
            </button>
            <button
              class="add__tab"
              :class="{ 'add__tab--on': tab === 'tech' }"
              @click="tab = 'tech'"
            >
              Техника
            </button>
            <button
              class="add__tab"
              :class="{ 'add__tab--on': tab === 'opening' }"
              @click="tab = 'opening'"
            >
              Окна и двери
            </button>
          </div>

          <template v-if="tab === 'furniture' || tab === 'tech'">
            <div v-if="tab === 'tech'" class="add__hint">
              Ниши/тумбы под встроенную технику. Технику ставим отдельным
              объектом; глубину и высоту можно уточнить в параметрах.
            </div>
            <input
              v-model="query"
              class="input add__search"
              type="search"
              placeholder="Поиск: тумба, ящики, мойка…"
            />
            <div v-if="tab === 'furniture'" class="add__groups">
              <button
                v-for="g in groups"
                :key="g"
                class="chip"
                :class="{ 'chip--on': group === g }"
                @click="group = g"
              >
                {{ g }}
              </button>
            </div>
            <div class="add__grid">
              <button
                v-for="p in items"
                :key="p.key"
                class="cat-card"
                :class="{ 'cat-card--on': p.key === selectedKey }"
                @click="selectCard(p.key)"
                @dblclick="selectedKey = p.key; add()"
              >
                <ObjectIcon
                  class="cat-card__icon"
                  :kind="p.key.replace('tech-', '')"
                />
                <span class="cat-card__name">{{ p.label }}</span>
                <span class="cat-card__hint">{{ p.hint }}</span>
                <span class="cat-card__group">{{ p.group }}</span>
              </button>
              <div v-if="!items.length" class="cat-empty">
                Ничего не найдено
              </div>
            </div>
          </template>

          <template v-else>
            <div class="add__grid add__grid--openings">
              <button
                class="cat-card"
                :class="{ 'cat-card--on': openingKind === 'window' }"
                @click="pickOpening('window')"
              >
                <ObjectIcon class="cat-card__icon" kind="window" />
                <span class="cat-card__name">Окно</span>
                <span class="cat-card__hint">закреплено за стеной</span>
                <span class="cat-card__group">Проёмы</span>
              </button>
              <button
                class="cat-card"
                :class="{ 'cat-card--on': openingKind === 'door' }"
                @click="pickOpening('door')"
              >
                <ObjectIcon class="cat-card__icon" kind="door" />
                <span class="cat-card__name">Дверь</span>
                <span class="cat-card__hint">открывается в комнату</span>
                <span class="cat-card__group">Проёмы</span>
              </button>
              <button
                class="cat-card"
                :class="{ 'cat-card--on': openingKind === 'arch' }"
                @click="pickOpening('arch')"
              >
                <ObjectIcon class="cat-card__icon" kind="arch" />
                <span class="cat-card__name">Проём</span>
                <span class="cat-card__hint">без створки</span>
                <span class="cat-card__group">Проёмы</span>
              </button>
            </div>
            <div class="add__groups" style="margin-top: 8px">
              <button
                v-for="p in OPENING_PRESETS"
                :key="p.id"
                class="chip"
                @click="applyOpeningPreset(p)"
              >{{ p.label }}</button>
            </div>
          </template>
        </div>

        <aside
          class="add__settings"
          :class="{ 'add__step-hidden': (tab === 'furniture' || tab === 'tech') && !mobileSettings }"
        >
          <button
            class="btn btn--ghost btn--sm add__back"
            @click="backToCatalog"
          >← К каталогу</button>
          <div v-if="(tab === 'furniture' || tab === 'tech') && selected" class="add__settings-head">
            <b>{{ selected.label }}</b>
            <span class="dim">{{ selected.group }}</span>
          </div>
          <div v-else-if="tab === 'opening'" class="add__settings-head">
            <b>{{ openingKind === 'window' ? 'Окно' : openingKind === 'arch' ? 'Проём' : 'Дверь' }}</b>
            <span class="dim">проём в стене</span>
          </div>

          <template v-if="tab === 'furniture' || tab === 'tech'">
            <label class="field">
              <span class="field__label">Ширина, мм</span>
              <input
                class="input" type="number" step="10" min="200" max="3000"
                :value="params.W"
                @input="params.W = num($event)"
              />
            </label>
            <label class="field">
              <span class="field__label">Высота, мм</span>
              <input
                class="input" type="number" step="10" min="200" max="2600"
                :value="params.H"
                @input="params.H = num($event)"
              />
            </label>
            <label class="field">
              <span class="field__label">Глубина, мм</span>
              <input
                class="input" type="number" step="10" min="200" max="900"
                :value="params.D"
                @input="params.D = num($event)"
              />
            </label>

            <div class="add__row3">
              <label class="field">
                <span class="field__label">Двери</span>
                <input
                  class="input" type="number" step="1" min="0" max="6"
                  :value="params.doors"
                  @input="params.doors = num($event)"
                />
              </label>
              <label class="field">
                <span class="field__label">Ящики</span>
                <input
                  class="input" type="number" step="1" min="0" max="6"
                  :value="params.drawers"
                  @input="params.drawers = num($event)"
                />
              </label>
              <label class="field">
                <span class="field__label">Полки</span>
                <input
                  class="input" type="number" step="1" min="0" max="8"
                  :value="params.shelves"
                  @input="params.shelves = num($event)"
                />
              </label>
            </div>

            <label class="field">
              <span class="field__label">Перегородки (0 — без стоек)</span>
              <input
                class="input" type="number" step="1" min="0" max="4"
                :value="params.dividers"
                @input="params.dividers = num($event)"
              />
            </label>

            <label class="field">
              <span class="field__label">Тип модуля</span>
              <select class="select" v-model="params.mount">
                <option value="floor">Напольный</option>
                <option value="wall">Навесной</option>
              </select>
            </label>

            <div class="add__row2">
              <label class="field">
                <span class="field__label">Каркас</span>
                <select class="select" v-model="params.frame">
                  <option value="inset">Вкладной</option>
                  <option value="overlay">Накладной</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Петли</span>
                <select class="select" v-model="params.hardware">
                  <option value="blum">Blum</option>
                  <option value="hettich">Hettich</option>
                  <option value="gtv">GTV</option>
                </select>
              </label>
            </div>

            <label v-if="params.drawers > 0" class="field">
              <span class="field__label">Направляющие ящиков</span>
              <select class="select" v-model="params.runners">
                <option v-for="r in runners" :key="r.id" :value="r.id">
                  {{ r.name }} · зазор {{ r.side_gap }} мм
                </option>
              </select>
            </label>
          </template>

          <template v-else>
            <label class="field">
              <span class="field__label">Стена</span>
              <select class="select" v-model.number="opening.wall">
                <option v-for="w in wallOptions" :key="w.index" :value="w.index">
                  {{ w.label }} · {{ w.length }} мм
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Ширина, мм</span>
              <input
                class="input" type="number" step="10" min="200" max="6000"
                :value="opening.w"
                @input="opening.w = num($event)"
              />
            </label>
            <div class="add__row2">
              <label class="field">
                <span class="field__label">Нижний Z, мм</span>
                <input
                  class="input" type="number" step="10" min="0"
                  :value="opening.z0"
                  @input="opening.z0 = num($event)"
                />
              </label>
              <label class="field">
                <span class="field__label">Верхний Z, мм</span>
                <input
                  class="input" type="number" step="10" min="100"
                  :value="opening.z1"
                  @input="opening.z1 = num($event)"
                />
              </label>
            </div>
            <p class="dim add__note">
              Проём встанет по центру выбранной стены. Положение вдоль стены
              меняется после добавления — в свойствах проёма.
            </p>
          </template>
        </aside>
      </div>

      <footer class="add__foot">
        <span class="dim">
          {{
            (tab === 'furniture' || tab === 'tech')
              ? (mobileSettings
                ? 'Проверьте размеры и добавьте модуль'
                : 'Выберите модуль из каталога')
              : 'Проём закрепляется за выбранной стеной'
          }}
        </span>
        <span class="spacer"></span>
        <button class="btn" @click="emit('close')">Отмена</button>
        <button
          v-if="tab === 'furniture' && mobile && !mobileSettings"
          class="btn btn--primary"
          :disabled="!selected"
          @click="showStep(true)"
        >Настроить</button>
        <button v-else class="btn btn--primary" :disabled="!canAdd" @click="add">
          {{ (tab === 'furniture' || tab === 'tech') ? 'Добавить модуль' : 'Добавить проём' }}
        </button>
      </footer>
    </section>
  </div>
</template>
