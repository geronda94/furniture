<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import DrillingMap from './DrillingMap.vue'
import Part3DView from './Part3DView.vue'
import MaterialLibrary from './MaterialLibrary.vue'
import {
  derived,
  partMaterialOverridden,
  partMaterialSource,
  resetPartMaterial,
  setEdgeOverride,
  setPartMaterial,
  setPartMaterialFull,
  setPartMaterialGroup,
  state,
} from '../state/project'
import { apiHardwareCatalog, type AssemblyOperation, type EdgePlanRow, type EdgeSide } from '../api'
import { moduleInfo, sizeLabel } from '../module/info'
import { resolveObjectMaterial } from '../material/vars'
import type { Material } from '../render25d/types'

const props = defineProps<{ instanceId: string; partIndex: number | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', index: number): void
}>()
const libOpen = ref(false)

const selectedHole = ref<string | null>(null)
const view = ref<'flat' | 'iso'>('flat')
const guides = ref(true)
const edgeTypes = ref<{ id: string; name: string; thickness: number; color: string }[]>([])
onMounted(() => {
  apiHardwareCatalog()
    .then((c) => (edgeTypes.value = c.edge_types ?? []))
    .catch(() => {})
})
const KIND_LABEL: Record<string, string> = {
  fastener_face: 'Крепёж: отверстие в пласти',
  fastener_end: 'Крепёж: отверстие в торец',
  hinge_cup: 'Чашка петли',
  hinge_plate: 'Ответная планка',
  system32: 'System 32',
  shelf_pin: 'Полкодержатель',
  slide_mount: 'Направляющая: корпус',
  slide_box: 'Направляющая: ящик',
  handle: 'Ручка',
  gas_strut: 'Газовый патрон',
  leg_mount: 'Крепление опоры / колеса',
}
const ALIAS: Record<string, string> = {
  'Боковина Л': 'Боковина лев.',
  'Боковина П': 'Боковина прав.',
}

const inst = computed(() =>
  state.project.instances.find((i) => i.id === props.instanceId) ?? null,
)
const info = computed(() =>
  inst.value ? moduleInfo(inst.value, derived[inst.value.id]?.objects) : null,
)
const calc = computed(() => derived[props.instanceId] ?? null)
const element = computed(() =>
  info.value && props.partIndex != null
    ? info.value.elements[props.partIndex] ?? null
    : null,
)

function findPlanRow(): EdgePlanRow | null {
  const el = element.value
  if (!el || !calc.value) return null
  const rows = calc.value.edge_plan ?? []
  const alias = ALIAS[el.name] || el.name
  return (
    rows.find((r) => r.part === alias) ||
    rows.find((r) => r.part === el.name) ||
    rows.find((r) => r.part.startsWith(alias)) ||
    rows.find((r) => alias.startsWith(r.part)) ||
    null
  )
}
const planRow = computed(findPlanRow)

function matches(opPart: string, name: string): boolean {
  const alias = ALIAS[name] || name
  return (
    opPart === alias ||
    opPart === name ||
    opPart.startsWith(alias) ||
    alias.startsWith(opPart)
  )
}

const operations = computed<AssemblyOperation[]>(() => {
  const el = element.value
  if (!el || !calc.value) return []
  return (calc.value.operations ?? []).filter((o) => matches(o.part, el.name))
})
const edges = computed<Record<string, EdgeSide>>(
  () => planRow.value?.sides ?? {},
)
const edgeEntries = computed(() =>
  Object.entries(edges.value).map(([side, row]) => ({ side, ...row })),
)
const edgeCount = computed(() => edgeEntries.value.length)
const currentHole = computed(() =>
  operations.value.find((o) => o.id === selectedHole.value) ?? null,
)
const w = computed(() => planRow.value?.w ?? element.value?.w ?? 0)
const h = computed(() => planRow.value?.h ?? element.value?.h ?? 0)
const qty = computed(() => planRow.value?.qty ?? 1)
const object = computed(() =>
  props.partIndex != null ? calc.value?.objects[props.partIndex] ?? null : null,
)
const material = computed<Material | null>(() => {
  if (!inst.value || !object.value) return null
  return resolveObjectMaterial(
    state.project.materials,
    state.project.materialVars,
    inst.value,
    object.value,
    props.partIndex ?? undefined,
  )
})
const materialOwn = computed(() =>
  inst.value && props.partIndex != null
    ? partMaterialOverridden(inst.value, props.partIndex)
    : false,
)
const materialSource = computed(() =>
  inst.value && props.partIndex != null
    ? partMaterialSource(inst.value.id, props.partIndex)
    : null,
)
const edgePartName = computed(() => planRow.value?.part || element.value?.name || '')
const EDGE_SIDES = [
  { key: 'left', label: 'лево' },
  { key: 'top', label: 'верх' },
  { key: 'right', label: 'право' },
  { key: 'bottom', label: 'низ' },
]
function edgeValue(side: string): string {
  return inst.value?.params.edges?.byPart?.[edgePartName.value]?.[side] || 'auto'
}
function edgeNow(side: string): EdgeSide | null {
  return edges.value[side] ?? null
}
function onEdge(side: string, e: Event): void {
  if (!inst.value) return
  setEdgeOverride(
    inst.value.id,
    edgePartName.value,
    side,
    (e.target as HTMLSelectElement).value,
  )
}
const plateOps = computed(() =>
  operations.value.filter((o) => o.face !== 'торец' && o.dia > 0),
)
const edgeHoleOps = computed(() =>
  operations.value.filter((o) => o.face === 'торец' && o.dia > 0),
)
function r1(v: number): number {
  return Math.round(v * 10) / 10
}
function uniqNums(list: number[]): number[] {
  return [...new Set(list.map(r1))].sort((a, b) => a - b)
}
const mark = computed(() => {
  const ys = uniqNums(
    plateOps.value.map((o) => o.y).filter((y) => y >= 0 && y <= h.value),
  )
  const xs = uniqNums(
    plateOps.value.map((o) => o.x).filter((x) => x >= 0 && x <= w.value),
  )
  const yBottom = [0, ...ys.filter((y) => y > 0 && y < h.value), h.value]
  const xLeft = [0, ...xs.filter((x) => x > 0 && x < w.value), w.value]
  const diffs = (a: number[]) => a.slice(1).map((v, i) => r1(v - a[i]))
  return {
    xLeft,
    xRight: [...xLeft].reverse().map((x) => r1(w.value - x)),
    xSteps: diffs(xLeft),
    yBottom,
    yTop: [...yBottom].reverse().map((y) => r1(h.value - y)),
    ySteps: diffs(yBottom),
  }
})
const basis = computed(() => plateOps.value[0]?.basis || '')
const axes = computed(() => {
  const k = plateOps.value[0]?.part_kind || ''
  if (k === 'side' || k === 'divider' || k === 'drawer_side') {
    return {
      x1: 'От передней кромки', x2: 'От задней кромки',
      y1: 'От низа', y2: 'От верха',
      sx: 'Шаги по глубине', sy: 'Шаги по высоте',
    }
  }
  if (k === 'horizontal' || k === 'shelf') {
    return {
      x1: 'От левого торца', x2: 'От правого торца',
      y1: 'От передней кромки', y2: 'От задней кромки',
      sx: 'Шаги по ширине', sy: 'Шаги по глубине',
    }
  }
  return {
    x1: 'От левого торца', x2: 'От правого торца',
    y1: 'От низа', y2: 'От верха',
    sx: 'Шаги по ширине', sy: 'Шаги по высоте',
  }
})

const holeGroups = computed(() => {
  const map = new Map<string, {
    key: string
    kind: string
    hardware: string
    dia: number
    depth: number
    note: string
    items: AssemblyOperation[]
  }>()
  for (const o of operations.value) {
    const key = `${o.kind}|${o.hardware}|${o.dia}|${o.depth}`
    let g = map.get(key)
    if (!g) {
      g = {
        key, kind: o.kind, hardware: o.hardware,
        dia: o.dia, depth: o.depth, note: o.note, items: [],
      }
      map.set(key, g)
    }
    g.items.push(o)
  }
  return [...map.values()]
})
function onGroupMaterial(): void {
  if (!inst.value || props.partIndex == null || !material.value) return
  setPartMaterialGroup(inst.value.id, props.partIndex, {}, material.value)
}
function onColor(e: Event): void {
  if (!inst.value || props.partIndex == null) return
  setPartMaterial(inst.value.id, props.partIndex, {
    color: (e.target as HTMLInputElement).value,
  })
}
function onPattern(e: Event): void {
  if (!inst.value || props.partIndex == null) return
  setPartMaterial(inst.value.id, props.partIndex, {
    pattern: (e.target as HTMLSelectElement).value as Material['pattern'],
  })
}
function resetColor(): void {
  if (inst.value && props.partIndex != null) {
    resetPartMaterial(inst.value.id, props.partIndex)
  }
}
function onPick(payload: { material?: Material; texture?: string }): void {
  if (!inst.value || props.partIndex == null) return
  const base = payload.material ?? material.value
  if (!base) return
  setPartMaterialFull(inst.value.id, props.partIndex, {
    ...base,
    texture: payload.texture ?? base.texture,
    pattern: payload.texture ? 'solid' : base.pattern,
  })
  libOpen.value = false
}
const parts = computed(() => info.value?.elements ?? [])

const partKind = computed(() => {
  const fromOp = plateOps.value[0]?.part_kind
  if (fromOp) return fromOp
  const name = planRow.value?.part || element.value?.name || ''
  if (name.startsWith('Боковина')) return 'side'
  if (name === 'Перегородка') return 'divider'
  if (name === 'Полка') return 'shelf'
  if (name === 'Крыша' || name === 'Дно') return 'horizontal'
  if (name.startsWith('Фасад дверь')) return 'door'
  if (name.startsWith('Фасад ящик')) return 'drawer_front'
  if (name === 'Ящик боковина') return 'drawer_side'
  if (name.startsWith('Ящик')) return 'drawer_panel'
  return 'side'
})

function stepPart(delta: number): void {
  const list = parts.value
  if (!list.length || props.partIndex == null) return
  const i = list.findIndex((p) => p.index === props.partIndex)
  const next = list[Math.max(0, Math.min(list.length - 1, i + delta))]
  if (next) emit('select', next.index)
}
function printPart(): void {
  window.print()
}

const shortDims = computed(() => {
  const o = currentHole.value
  if (!o || !w.value || !h.value) return null
  return {
    left: Math.round(o.x * 10) / 10,
    right: Math.round((w.value - o.x) * 10) / 10,
    bottom: Math.round(o.y * 10) / 10,
    top: Math.round((h.value - o.y) * 10) / 10,
  }
})

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

watch(
  () => props.partIndex,
  () => {
    selectedHole.value = null
  },
)
watch(
  () => operations.value.map((o) => o.id).join(','),
  () => {
    if (selectedHole.value &&
        !operations.value.some((o) => o.id === selectedHole.value)) {
      selectedHole.value = null
    }
  },
)
</script>

<template>
  <div v-if="element" class="pdetail">
    <header class="pdetail__head">
      <button class="btn btn--sm pdetail__back" @click="emit('close')">← Объект</button>
      <button class="btn btn--sm pdetail__step" title="Предыдущая деталь" @click="stepPart(-1)">‹</button>
      <select
        class="select pdetail__select"
        :value="partIndex ?? ''"
        @change="emit('select', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="p in parts" :key="p.index" :value="p.index">
          {{ p.title }}
        </option>
      </select>
      <button class="btn btn--sm pdetail__step" title="Следующая деталь" @click="stepPart(1)">›</button>
      <button class="btn btn--sm" title="Печать карты детали" @click="printPart">Печать</button>
      <span class="pdetail__count">
        {{ operations.length }} отв. ·
        {{ edgeCount }} {{ plural(edgeCount, 'кромка', 'кромки', 'кромок') }}
      </span>
    </header>

    <div class="pdetail__sub">
      <span class="dim">
        {{ planRow?.w ?? element.w }} × {{ planRow?.h ?? element.h }} мм
        <template v-if="qty > 1"> · {{ qty }} шт</template>
      </span>
      <div class="pmat pmat--inline">
        <label
          class="swatch pmat__swatch"
          :style="material?.texture
            ? { backgroundImage: `url(${material.texture})`, backgroundSize: 'cover' }
            : { background: material?.color || '#999' }"
          title="Цвет детали"
        >
          <input type="color" :value="material?.color || '#999999'" @input="onColor" />
        </label>
        <select class="select pmat__pattern" :value="material?.pattern || 'solid'" @change="onPattern">
          <option value="solid">Цвет</option>
          <option value="wood">Дерево</option>
          <option value="stone">Камень</option>
          <option value="metal">Металл</option>
        </select>
        <button class="btn btn--sm" @click="libOpen = true">Декор…</button>
        <button class="btn btn--sm" title="Применить этот цвет/декор всем одинаковым деталям" @click="onGroupMaterial">Всем таким</button>
        <button v-if="materialOwn" class="btn btn--sm" @click="resetColor">К переменной</button>
      </div>
    </div>
    <div class="pdetail__source dim">
      Материал: {{ materialSource?.label || 'проект' }} →
      {{ material?.name }}
    </div>
    <div class="pdetail__viewtabs" role="group" aria-label="Вид детали">
      <button class="tab tab--sm" :class="{ 'tab--active': view === 'flat' }"
        @click="view = 'flat'">Пласть</button>
      <button class="tab tab--sm" :class="{ 'tab--active': view === 'iso' }"
        @click="view = 'iso'">3D</button>
      <button v-if="view === 'flat'" class="tab tab--sm"
        :class="{ 'tab--active': guides }" @click="guides = !guides">
        Линии
      </button>
      <span class="dim">{{ view === 'flat' ? 'разметка и отверстия' : 'толщина и сторона сверления' }}</span>
    </div>

    <div class="pdetail__body">
      <div class="pdetail__map">
        <template v-if="w && h">
          <DrillingMap
            v-if="view === 'flat'"
            :part="element.title"
            :part-kind="partKind"
            :w="w" :h="h"
            :operations="operations"
            :edges="edges"
            :front="planRow?.front || ''"
            :highlight="selectedHole"
            :guides="guides"
            @pick="selectedHole = $event"
          />
          <Part3DView
            v-else
            :part-kind="partKind"
            :w="w" :h="h" :t="inst?.params.t || 16"
            :color="material?.color || '#cfcfcf'"
            :operations="operations" :edges="edges"
          />
        </template>
        <p v-else class="dim">Для этой детали нет плоской карты присадки.</p>
      </div>

      <aside class="pdetail__side">
        <div class="pdetail__block">
          <div class="pdetail__label">
            Кромка: {{ edgeCount }}
            {{ plural(edgeCount, 'сторона', 'стороны', 'сторон') }}
          </div>
          <ul class="pdetail__edge-edit">
            <li v-for="s in EDGE_SIDES" :key="s.key">
              <i
                :style="{ background: edgeNow(s.key)?.color || 'transparent' }"
                :class="{ 'is-off': !edgeNow(s.key) }"
              ></i>
              <span>
                {{ s.label }}
                <b v-if="planRow?.front === s.key" class="pdetail__front">ПЕРЕД</b>
              </span>
              <select
                class="select pdetail__edge-select"
                :value="edgeValue(s.key)"
                @change="onEdge(s.key, $event)"
              >
                <option value="auto">
                  Авто{{ edgeNow(s.key) ? ` · ${edgeNow(s.key)?.label}` : ' · без' }}
                </option>
                <option value="none">Без кромки</option>
                <option v-for="t in edgeTypes" :key="t.id" :value="t.id">
                  {{ t.name }}
                </option>
              </select>
            </li>
          </ul>
          <p class="dim pdetail__edge-hint">
            Авто — по правилу видимости торцов и типу каркаса. Можно снять
            кромку или поставить другой тип. На карте пласти полоса означает
            кромку на прилегающем торце; в 3D она показана на площади торца.
          </p>
        </div>

        <div v-if="currentHole" class="pdetail__block pdetail__hole">
          <div class="pdetail__label">{{ kindLabel(currentHole.kind) }}</div>
          <div class="pdetail__hole-name">{{ currentHole.hardware }}</div>
          <ul class="pdetail__dims">
            <li><span>Ø / глубина</span><b>Ø{{ currentHole.dia }} × {{ currentHole.depth }} мм</b></li>
            <li><span>Грань</span><b>{{ currentHole.face }}</b></li>
            <li><span>Координаты</span><b>x {{ currentHole.x }} · y {{ currentHole.y }}</b></li>
            <template v-if="shortDims">
              <li><span>Слева / справа</span><b>{{ shortDims.left }} / {{ shortDims.right }} мм</b></li>
              <li><span>Снизу / сверху</span><b>{{ shortDims.bottom }} / {{ shortDims.top }} мм</b></li>
            </template>
            <li><span>Для чего</span><b>{{ currentHole.note || '—' }}</b></li>
          </ul>
          <p v-if="currentHole.requires_pattern" class="pdetail__warn">
            Проверить по шаблону производителя
          </p>
          <p class="dim pdetail__basis">{{ currentHole.basis }}</p>
        </div>
        <div v-else class="pdetail__block pdetail__hint">
          Нажмите отверстие на карте — покажу, для чего оно, Ø, глубину и
          расстояния до кромок.
        </div>

        <div v-if="plateOps.length" class="pdetail__block">
          <div class="pdetail__label">Разметка на пласти</div>
          <div class="pdetail__mark">
            <span>{{ axes.y1 }}</span>
            <b>{{ mark.yBottom.join(' · ') }}</b>
          </div>
          <div class="pdetail__mark">
            <span>{{ axes.sy }}</span>
            <b>{{ mark.ySteps.join(' · ') }}</b>
          </div>
          <div class="pdetail__mark">
            <span>{{ axes.y2 }}</span>
            <b>{{ mark.yTop.join(' · ') }}</b>
          </div>
          <div class="pdetail__mark">
            <span>{{ axes.x1 }}</span>
            <b>{{ mark.xLeft.join(' · ') }}</b>
          </div>
          <div class="pdetail__mark">
            <span>{{ axes.sx }}</span>
            <b>{{ mark.xSteps.join(' · ') }}</b>
          </div>
          <div class="pdetail__mark">
            <span>{{ axes.x2 }}</span>
            <b>{{ mark.xRight.join(' · ') }}</b>
          </div>
          <p class="dim pdetail__basis">{{ basis }}</p>
          <p v-if="edgeHoleOps.length" class="dim">
            Торцевые отверстия: {{ edgeHoleOps.length }} — сверлить с торца,
            координаты в списке ниже.
          </p>
        </div>

        <div v-if="holeGroups.length" class="pdetail__block">
          <div class="pdetail__label">Отверстия по типам</div>
          <div v-for="g in holeGroups" :key="g.key" class="pdetail__group">
            <div class="pdetail__group-head">
              <span>{{ kindLabel(g.kind) }}</span>
              <b>×{{ g.items.length }}</b>
              <span class="dim">Ø{{ g.dia }}×{{ g.depth }}</span>
            </div>
            <div class="pdetail__group-name">{{ g.hardware }}</div>
            <div class="pdetail__group-coords">
              <button
                v-for="o in g.items" :key="o.id"
                class="pdetail__coord"
                :class="{ 'is-on': o.id === selectedHole }"
                @click="selectedHole = o.id"
              >x{{ o.x }} y{{ o.y }}</button>
            </div>
          </div>
          <p v-if="!operations.length" class="dim">Отверстий нет.</p>
        </div>
      </aside>
    </div>

    <footer class="pdetail__foot dim">
      {{ sizeLabel(element) }} · {{ element.kind }}
      <template v-if="planRow?.summary"> · {{ planRow.summary }}</template>
    </footer>

    <MaterialLibrary
      v-if="libOpen"
      mode="pick"
      role=""
      :label="`Деталь: ${element.title}`"
      @pick="onPick"
      @close="libOpen = false"
    />
  </div>

  <div v-else class="pdetail pdetail--empty">
    <p>Выберите деталь на объекте или в списке «Детали».</p>
    <p class="dim">
      В режиме «Деталь» показывается только выбранная пластина: отверстия,
      кромка по сторонам и расстояния для разметки.
    </p>
  </div>
</template>
