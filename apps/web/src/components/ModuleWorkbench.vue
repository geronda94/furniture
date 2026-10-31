<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ModulePreview from './ModulePreview.vue'
import PartDetail from './PartDetail.vue'
import MaterialLibrary from './MaterialLibrary.vue'
import HardwareLibrary, { type HardwareKind } from './HardwareLibrary.vue'
import NumField from './NumField.vue'
import BomPanel from './BomPanel.vue'
import MaterialPanel from './MaterialPanel.vue'
import ModuleAssemblyTab from './ModuleAssemblyTab.vue'
import ModuleCostTab from './ModuleCostTab.vue'
import ModuleFrontsTab from './ModuleFrontsTab.vue'
import {
  addKey,
  channelsOf,
  deleteInstance,
  derived,
  duplicateInstance,
  handles,
  kindIsOpen,
  partIsOpen,
  partMaterialOverridden,
  partMaterialSource,
  partSelection,
  resetInstanceMaterial,
  playPart,
  addZone,
  resetPartMaterial,
  setEdgePolicy,
  setHiddenFasteners,
  setInstanceZone,
  setPartMaterial,
  setPartMaterialFull,
  setPartMaterialGroup,
  zonesList,
  pushSelection,
  renameInstance,
  removeKey,
  isParamOverridden,
  resetKeys,
  resetParamOverrides,
  rotateInstance,
  runners,
  MANAGED_PARAMS,
  type ManagedParam,
  selectPart,
  setDrawerHeight,
  setInstancePosition,
  setMount,
  setPartChannel,
  state,
  toggleDoors,
  toggleDrawers,
  togglePart,
  toggleZLock,
  ui,
  updateParams,
  type BackKind,
  type Frame,
  type Hardware,
  type Params,
  type Reinforce,
} from '../state/project'
import { moduleInfo, relationsFor, sizeLabel } from '../module/info'
import { apiHardwareCatalog } from '../api'
import { resolveObjectMaterial } from '../material/vars'
import type { Material } from '../render25d/types'
import type { Channel } from '../anim/channels'

const props = defineProps<{ instanceId: string }>()

type Tab = 'overview' | 'fronts' | 'body' | 'details' | 'drawers' | 'assembly' | 'cost' | 'materials' | 'anim'
const tab = ref<Tab>('overview')
const drawerFocus = ref<number | null>(null)
const previewView = ref<'iso' | 'front' | 'side' | 'top'>('iso')
const previewMode = ref<'object' | 'part'>('object')
const partLibOpen = ref(false)
const hwLib = ref<HardwareKind | null>(null)
const listsEl = ref<HTMLElement | null>(null)
const sideEl = ref<HTMLElement | null>(null)

const inst = computed(
  () => state.project.instances.find((i) => i.id === props.instanceId) ?? null,
)
const info = computed(() =>
  inst.value ? moduleInfo(inst.value, derived[inst.value.id]?.objects) : null,
)
const calc = computed(() => derived[props.instanceId] ?? null)
const p = computed<Params | null>(() => inst.value?.params ?? null)
const dims = computed(() => calc.value?.dims ?? null)
const totalHeight = computed(() => {
  const v = p.value
  if (!v) return 0
  const floor = (v.mount || 'floor') !== 'wall'
  return Math.round(v.H + (floor ? Math.max(0, v.plinthH || 0) +
    Math.max(0, v.worktopT || 0) : 0))
})
const drawers = computed(() => calc.value?.drawers ?? [])
const sceneForTab = computed<'all' | 'carcass' | 'fronts' | 'drawers' | 'shelves'>(() => {
  if (tab.value === 'fronts') return 'fronts'
  if (tab.value === 'body') return 'carcass'
  if (tab.value === 'drawers') return 'drawers'
  if (tab.value === 'details') return 'all'
  return 'all'
})
const catalog = ref<null | Awaited<ReturnType<typeof apiHardwareCatalog>>>(null)
onMounted(() => {
  apiHardwareCatalog().then((c) => (catalog.value = c)).catch(() => {})
})
const fasteners = computed(() => catalog.value?.fasteners ?? [])
const shelfSupports = computed(() => catalog.value?.shelf_supports ?? [])
const gasStruts = computed(() => catalog.value?.gas_struts ?? [])
const legMounts = computed(() => catalog.value?.legs ?? [])
const edgeTypes = computed(() => catalog.value?.edge_types ?? [])
const fastenerOptions = computed(() => catalog.value?.fasteners ?? [])
const partSource = computed(() =>
  inst.value && part.value != null
    ? partMaterialSource(inst.value.id, part.value)
    : null,
)
function focusWarning(text: string): void {
  if (!info.value) return
  const el = info.value.elements.find(
    (e) => text.includes(e.title) || text.includes(e.name),
  )
  if (!el) return
  selectPart(props.instanceId, el.index)
  previewMode.value = 'part'
  tab.value = 'details'
}
function onPartGroup(): void {
  if (!inst.value || part.value == null || !partMaterial.value) return
  setPartMaterialGroup(inst.value.id, part.value, {}, partMaterial.value)
}
function onHiddenFasteners(e: Event): void {
  if (!inst.value) return
  setHiddenFasteners(
    inst.value.id,
    (e.target as HTMLSelectElement).value === 'yes',
  )
}
function onEdgeType(which: 'visible' | 'hidden', e: Event): void {
  if (!inst.value) return
  const value = (e.target as HTMLSelectElement).value
  setEdgePolicy(inst.value.id, { [which]: value || undefined })
}
function openPricing(): void {
  ui.settingsTab = 'pricing'
  ui.settingsOpen = true
}
function onHardwareSelect(payload: { kind: HardwareKind; id: string }): void {
  if (!inst.value) return
  if (payload.kind === 'handles') update({ handle: payload.id })
  if (payload.kind === 'hinges') update({ hardware: payload.id as Hardware })
  if (payload.kind === 'runners') update({ runners: payload.id })
  if (payload.kind === 'legs') update({ legMount: payload.id })
  if (payload.kind === 'gas') update({ gasStrut: payload.id })
  if (payload.kind === 'shelf') update({ shelfSupport: payload.id })
  if (payload.kind === 'fasteners') update({ fastener: payload.id })
}
const PARAM_LABELS: Record<ManagedParam, string> = {
  t: 'толщина ЛДСП', back: 'задняя стенка', backT: 'толщина задней',
  roof: 'крыша', reinforce: 'царги', frame: 'каркас',
  hardware: 'петли', runners: 'направляющие', plinthH: 'цоколь',
  worktopT: 'столешница', gapSide: 'зазор сбоку',
  gapBetween: 'зазор между', gapTop: 'зазор сверху',
  gapBottom: 'зазор снизу',
}
const overridden = computed<ManagedParam[]>(() =>
  inst.value
    ? MANAGED_PARAMS.filter((k) => isParamOverridden(inst.value!, k))
    : [],
)

const part = computed(() =>
  partSelection.instanceId === props.instanceId ? partSelection.part : null,
)
const element = computed(() =>
  info.value && part.value != null ? (info.value.elements[part.value] ?? null) : null,
)
const relations = computed(() =>
  info.value ? relationsFor(info.value, part.value) : null,
)
const edgeLabel = computed(() => {
  if (!element.value || !calc.value) return ''
  const name = element.value.name
  const alias: Record<string, string> = {
    'Боковина Л': 'Боковина лев.',
    'Боковина П': 'Боковина прав.',
  }
  const rows = calc.value.bom.filter(
    (b) => b.name === name || b.name === alias[name] || b.name.startsWith(name),
  )
  if (!rows.length) return ''
  return [...new Set(rows.map((r) => r.edge))].join(' · ')
})
const channels = computed<Channel[]>(() => {
  if (!inst.value || part.value == null) return []
  const set = channelsOf(inst.value, part.value)
  return set ? Object.values(set) : []
})
const selectedOpen = computed(() =>
  inst.value && part.value != null ? partIsOpen(inst.value, part.value) : false,
)
const selectedFacade = computed(() => {
  const k = element.value?.kind
  return k === 'door' || k === 'drawerfront'
})
const selectedIsDrawer = computed(() => element.value?.kind === 'drawerfront')
function toggleSelectedPart(): void {
  if (inst.value && part.value != null) togglePart(inst.value.id, part.value)
}
function onTogglePart(index: number): void {
  selectPart(props.instanceId, index)
  previewMode.value = 'part'
  const kind = info.value?.elements[index]?.kind
  if (kind === 'door' || kind === 'drawerfront') {
    togglePart(props.instanceId, index)
  }
}

/* ---------- материал выбранной детали ---------- */
const partObject = computed(() => {
  if (part.value == null) return null
  return calc.value?.objects[part.value] ?? null
})
const partMaterial = computed<Material | null>(() => {
  if (!inst.value || !partObject.value) return null
  return resolveObjectMaterial(
    state.project.materials,
    state.project.materialVars,
    inst.value,
    partObject.value,
    part.value ?? undefined,
  )
})
const partMaterialOwn = computed(() =>
  inst.value && part.value != null
    ? partMaterialOverridden(inst.value, part.value)
    : false,
)
function onPartColor(e: Event): void {
  if (!inst.value || part.value == null) return
  setPartMaterial(inst.value.id, part.value, {
    color: (e.target as HTMLInputElement).value,
  })
}
function onPartPattern(e: Event): void {
  if (!inst.value || part.value == null) return
  setPartMaterial(inst.value.id, part.value, {
    pattern: (e.target as HTMLSelectElement).value as Material['pattern'],
  })
}
function resetPartColor(): void {
  if (inst.value && part.value != null) {
    resetPartMaterial(inst.value.id, part.value)
  }
}
function onPartPick(payload: { material?: Material; texture?: string }): void {
  if (!inst.value || part.value == null) return
  const base = payload.material ?? partMaterial.value
  if (!base) return
  setPartMaterialFull(inst.value.id, part.value, {
    ...base,
    texture: payload.texture ?? base.texture,
    pattern: payload.texture ? 'solid' : base.pattern,
  })
  partLibOpen.value = false
}

/* ---------- зона модуля и действующие переменные ---------- */
const moduleMaterialRoles = computed(() =>
  inst.value?.materials ? Object.keys(inst.value.materials) : [],
)
function resetModuleMaterials(): void {
  if (!inst.value) return
  resetInstanceMaterial(inst.value.id)
}

const applicableVars = computed(() => {
  if (!inst.value) return []
  const mount = inst.value.params.mount === 'wall' ? 'wall' : 'floor'
  const zone = (inst.value.zone || '').trim()
  return state.project.materialVars.filter((v) => {
    if (!v.enabled) return false
    if (v.scope !== 'all' && v.scope !== mount) return false
    const z = (v.zone || '').trim()
    return !z || z === zone
  })
})
function setZone(e: Event): void {
  if (!inst.value) return
  setInstanceZone(
    inst.value.id,
    (e.target as HTMLSelectElement).value,
  )
}
function addZoneForModule(e: Event): void {
  const input = e.target as HTMLInputElement
  const zone = addZone(input.value)
  input.value = ''
  if (zone && inst.value) setInstanceZone(inst.value.id, zone)
}
function openVars(): void {
  ui.settingsTab = 'vars'
  ui.settingsOpen = true
}

/* ---------- корпус ---------- */
function num(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}
function update(patch: Partial<Params>): void {
  updateParams(patch)
}
function resetBody(): void {
  if (!inst.value) return
  setMount(inst.value.id, 'floor')
  resetParamOverrides(inst.value.id)
}

const cutouts = computed(() => p.value?.cutouts ?? [])
function addCutout(): void {
  update({ cutouts: [...cutouts.value, { x: 200, y: 150, w: 400, h: 350 }] })
}
function setCutout(i: number, key: 'x' | 'y' | 'w' | 'h', e: Event): void {
  update({
    cutouts: cutouts.value.map((c, k) => (k === i ? { ...c, [key]: num(e) } : c)),
  })
}
function removeCutout(i: number): void {
  update({ cutouts: cutouts.value.filter((_, k) => k !== i) })
}

const warnings = computed(() => {
  const v = p.value
  if (!v) return []
  const out: string[] = []
  if (!v.roof) out.push('Без крыши добавятся верхние царги 60 мм.')
  if (v.back === 'none') out.push('Без задней стенки добавятся задние царги.')
  if (v.back === 'cardboard') out.push('Картон 3 мм — рекомендуются задние царги.')
  if (v.t !== 16) out.push(`Толщина ЛДСП ${v.t} мм: пересчитаны вкладные размеры.`)
  if (v.doors > 2 && v.W < 500) out.push('На узкий корпус лучше одну створку.')
  return out
})

/* ---------- детали и анимация ---------- */
function pick(partIndex: number | null): void {
  selectPart(props.instanceId, partIndex)
  if (partIndex != null) previewMode.value = 'part'
}
function pickDrawer(id: number): void {
  drawerFocus.value = id
  const idx = info.value?.elements.findIndex(
    (e) => e.drawerId === id && e.kind === 'drawerfront',
  )
  if (idx != null && idx >= 0) selectPart(props.instanceId, idx)
  tab.value = 'drawers'
}
const drawerElements = computed(() => {
  if (drawerFocus.value == null || !info.value) return []
  return (
    info.value.groups.find((g) => g.key === `drawer-${drawerFocus.value}`)
      ?.elements ?? []
  )
})

function drawerFrontIndex(id: number): number | null {
  const idx = info.value?.elements.findIndex(
    (e) => e.drawerId === id && e.kind === 'drawerfront',
  )
  return idx != null && idx >= 0 ? idx : null
}
function toggleDrawer(id: number): void {
  const idx = drawerFrontIndex(id)
  if (idx != null) togglePart(props.instanceId, idx)
}
function slide(ch: Channel, e: Event): void {
  if (!inst.value || part.value == null) return
  setPartChannel(inst.value.id, part.value, ch.id, Number((e.target as HTMLInputElement).value))
}
function key(ch: Channel): void {
  if (inst.value && part.value != null) addKey(inst.value.id, part.value, ch.id)
}
function unkey(ch: Channel, i: number): void {
  if (inst.value && part.value != null) removeKey(inst.value.id, part.value, ch.id, i)
}
function play(): void {
  if (inst.value && part.value != null) playPart(inst.value.id, part.value)
}
function resetAll(): void {
  if (inst.value && part.value != null) resetKeys(inst.value.id, part.value)
}
function toggleSelected(): void {
  if (inst.value && part.value != null) togglePart(inst.value.id, part.value)
}
function fmt(v: number, unit: string): string {
  return `${Math.round(v)}${unit ? ' ' + unit : ''}`
}

watch(
  () => tab.value,
  () => {
    void nextTick(() => {
      if (listsEl.value) listsEl.value.scrollTop = 0
      if (sideEl.value) sideEl.value.scrollTop = 0
    })
  },
)

watch(
  () => props.instanceId,
  () => {
    tab.value = 'overview'
    drawerFocus.value = null
  },
)

// клик по детали в 3D: сразу показываем её размеры (или ящик целиком)
watch(part, (value) => {
  if (value == null) return
  const e = element.value
  if (e?.drawerId) {
    drawerFocus.value = e.drawerId
    if (tab.value === 'overview') tab.value = 'drawers'
  } else if (tab.value === 'overview') {
    tab.value = 'details'
  }
}, { immediate: true })

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'fronts', label: 'Фасады' },
  { id: 'body', label: 'Корпус' },
  { id: 'details', label: 'Детали' },
  { id: 'drawers', label: 'Ящики' },
  { id: 'assembly', label: 'Сборка' },
  { id: 'cost', label: 'Смета' },
  { id: 'materials', label: 'Материалы' },
  { id: 'anim', label: 'Анимация' },
]
</script>

<template>
  <div v-if="inst && p" class="wb">
    <div class="wb__top" :class="{
      'wb__top--compact': ['assembly', 'drawers', 'details'].includes(tab),
      'wb__top--part': previewMode === 'part',
    }">
      <!-- КРУПНАЯ ЗАКРЕПЛЁННАЯ КАРТИНКА -->
      <div class="wb__visual" :class="{ 'wb__visual--part': previewMode === 'part' }">
        <div class="wb-mode-rail" role="tablist" aria-label="Режим просмотра">
          <button
            class="wb-mode-rail__btn"
            :class="{ 'wb-mode-rail__btn--on': previewMode === 'object' }"
            role="tab"
            :aria-selected="previewMode === 'object'"
            title="Объект целиком"
            @click="previewMode = 'object'"
          ><span>Объект</span></button>
          <button
            class="wb-mode-rail__btn"
            :class="{ 'wb-mode-rail__btn--on': previewMode === 'part' }"
            role="tab"
            :aria-selected="previewMode === 'part'"
            :disabled="part == null"
            title="Выбранная деталь"
            @click="previewMode = 'part'"
          ><span>Деталь</span></button>
        </div>
        <div class="wb__view-ctl" role="group" aria-label="Ракурс">
          <button
            v-for="v in [
              { id: 'iso', icon: '◇', label: 'Изо' },
              { id: 'front', icon: '▣', label: 'Фасад' },
              { id: 'side', icon: '◧', label: 'Бок' },
              { id: 'top', icon: '⬒', label: 'Сверху' },
            ] as const"
            :key="v.id"
            class="wb__view-btn"
            :class="{ 'wb__view-btn--on': previewView === v.id }"
            :title="v.label"
            :aria-label="v.label"
            @click="previewView = v.id"
          >{{ v.icon }}</button>
        </div>
        <Transition name="wb-slide" mode="out-in">
          <div :key="previewMode" class="wb__visual-inner">
            <ModulePreview
              v-if="previewMode === 'object'"
              :instance-id="instanceId"
              fill
              schematic
              :view="previewView"
              :scene="sceneForTab"
              show-dims
              :part="part"
              :drawer-id="tab === 'drawers' ? drawerFocus : null"
              @pick="pick"
              @toggle="onTogglePart"
            />
            <PartDetail
              v-else
              :instance-id="instanceId"
              :part-index="part"
              @close="previewMode = 'object'"
              @select="pick"
            />
          </div>
        </Transition>
      </div>

      <!-- МЕНЮ И ВАЖНЫЕ ФУНКЦИИ -->
      <div ref="sideEl" class="wb__side" :class="`wb__side--${tab}`">
        <header class="wb__head">
          <input
            class="input wb__name"
            :value="inst.name"
            aria-label="Название модуля"
            @change="renameInstance(inst.id, ($event.target as HTMLInputElement).value)"
          />
          <span class="dim" :title="`Полная высота; корпус ${p.H} мм`">
            {{ p.W }}×{{ totalHeight }}×{{ p.D }}
          </span>
        </header>

        <div class="wb__tabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            class="wb__tab"
            :class="{ 'wb__tab--on': tab === t.id }"
            @click="tab = t.id"
          >{{ t.label }}</button>
        </div>

        <div class="wb__size">
          <div class="wb__label">Габариты <span class="dim">пересчёт зависимых деталей</span></div>
          <div class="wb__size-row">
            <NumField label="Ш, мм" :value="p.W" :min="200" :max="3000" :step="50"
              @change="update({ W: $event })" />
            <NumField label="В, мм" :value="p.H" :min="200" :max="2600" :step="50"
              @change="update({ H: $event })" />
            <NumField label="Г, мм" :value="p.D" :min="200" :max="900" :step="10"
              @change="update({ D: $event })" />
          </div>
        </div>

        <div class="wb__quick">
          <button class="btn btn--sm" :class="{ 'btn--primary': kindIsOpen(inst, 'door') }"
            :disabled="!p.doors" @click="toggleDoors(inst.id)">
            Двери: {{ kindIsOpen(inst, 'door') ? 'открыты' : 'закрыты' }}
          </button>
          <button class="btn btn--sm" :class="{ 'btn--primary': kindIsOpen(inst, 'drawer') }"
            :disabled="!p.drawers" @click="toggleDrawers(inst.id)">
            Ящики: {{ kindIsOpen(inst, 'drawer') ? 'выдвинуты' : 'закрыты' }}
          </button>
          <button class="btn btn--sm" :class="{ 'btn--primary': ui.facades }" @click="ui.facades = !ui.facades">
            Фасады: {{ ui.facades ? 'видны' : 'скрыты' }}
          </button>
          <button class="btn btn--sm" :class="{ 'btn--primary': ui.hardware }" @click="ui.hardware = !ui.hardware">
            Фурнитура: {{ ui.hardware ? 'видна' : 'скрыта' }}
          </button>
        </div>

        <div class="wb__quick">
          <button class="btn btn--sm" @click="rotateInstance(inst.id, 90)">⟳ 90°</button>
          <button class="btn btn--sm" @click="duplicateInstance(inst.id)">Дублировать</button>
          <button class="btn btn--sm wb__danger" @click="deleteInstance(inst.id)">Удалить</button>
          <button class="btn btn--sm" title="К левой стене" @click="pushSelection('left')">⟵</button>
          <button class="btn btn--sm" title="К правой стене" @click="pushSelection('right')">⟶</button>
          <button class="btn btn--sm" title="К дальней стене" @click="pushSelection('back')">↑</button>
          <button class="btn btn--sm" title="К передней стене" @click="pushSelection('front')">↓</button>
        </div>



        <!-- выбранная деталь и её относительные размеры всегда под рукой -->
        <div v-if="element" class="wb__side-sel">
          <div class="wb__side-sel-head">
            <b>{{ element.title }}</b>
            <span>{{ sizeLabel(element) }}</span>
          </div>
          <ul v-if="relations" class="wb__rel">
            <li v-if="relations.above"><span>↑ {{ relations.above.label }}</span><b>{{ relations.above.distance }} мм</b></li>
            <li v-if="relations.below"><span>↓ {{ relations.below.label }}</span><b>{{ relations.below.distance }} мм</b></li>
            <li v-if="relations.toSideTop != null">
              <span>⤒ до верхнего торца боковины</span><b>{{ relations.toSideTop }} мм</b>
            </li>
            <li v-if="relations.toSideBottom != null">
              <span>⤓ до нижнего торца боковины</span><b>{{ relations.toSideBottom }} мм</b>
            </li>
            <li v-if="relations.left"><span>← {{ relations.left.label }}</span><b>{{ relations.left.distance }} мм</b></li>
            <li v-if="relations.right"><span>→ {{ relations.right.label }}</span><b>{{ relations.right.distance }} мм</b></li>
          </ul>
          <div v-if="edgeLabel" class="wb__edge">Кромка: {{ edgeLabel }}</div>
          <button
            v-if="selectedFacade"
            class="btn btn--sm btn--primary wb__toggle-part"
            @click="toggleSelectedPart"
          >{{ selectedOpen ? (selectedIsDrawer ? 'Задвинуть ящик' : 'Закрыть дверь') : (selectedIsDrawer ? 'Выдвинуть ящик' : 'Открыть дверь') }}</button>
          <div class="pmat">
            <div class="pmat__head">
              <span>Материал детали</span>
              <span class="dim">{{ partMaterial?.name }}</span>
            </div>
            <div class="pmat__row">
              <label
                class="swatch pmat__swatch"
                :style="partMaterial?.texture
                  ? { backgroundImage: `url(${partMaterial.texture})`, backgroundSize: 'cover' }
                  : { background: partMaterial?.color || '#999' }"
                title="Цвет этой детали"
              >
                <input
                  type="color"
                  :value="partMaterial?.color || '#999999'"
                  @input="onPartColor"
                />
              </label>
              <select
                class="select pmat__pattern"
                :value="partMaterial?.pattern || 'solid'"
                @change="onPartPattern"
              >
                <option value="solid">Цвет</option>
                <option value="wood">Дерево</option>
                <option value="stone">Камень</option>
                <option value="metal">Металл</option>
              </select>
              <button class="btn btn--sm" @click="partLibOpen = true">Декор…</button>
              <button
                class="btn btn--sm"
                title="Применить всем одинаковым деталям"
                @click="onPartGroup"
              >Всем таким</button>
              <button
                v-if="partMaterialOwn"
                class="btn btn--sm"
                title="Вернуть цвет из переменной/проекта"
                @click="resetPartColor"
              >К переменной</button>
            </div>
            <div class="dim pmat__hint">
              {{ partMaterialOwn
                ? 'Индивидуально: ' + (partSource?.label || 'эта деталь')
                : 'По умолчанию: ' + (partSource?.label || 'переменная/проект') }}
            </div>
          </div>
          <div v-if="relations" class="wb__bounds">
            <span>Слева</span><b>{{ relations.toLeft }}</b>
            <span>Справа</span><b>{{ relations.toRight }}</b>
            <span>Снизу</span><b>{{ relations.toBottom }}</b>
            <span>Сверху</span><b>{{ relations.toTop }}</b>
            <span>От фасада</span><b>{{ relations.toFront }}</b>
            <span>До задней</span><b>{{ relations.toBack }}</b>
          </div>
        </div>
        <p v-else class="dim wb__note">
          Кликните деталь на картинке или в списках ниже — покажу её размеры и
          просветы до соседних элементов.
        </p>

        <div v-if="dims" class="wb__side-dims">
          <span>Снаружи</span>
          <b>{{ dims.outer.W }}×{{ dims.outer.H_total || dims.outer.H }}×{{ dims.outer.D }}</b>
          <span class="dim">корпус</span>
          <b class="dim">{{ dims.outer.H }} мм</b>
          <span>Внутри</span>
          <b>{{ dims.inner.W }}×{{ dims.inner.H }}×{{ dims.inner.D }}</b>
          <span>Плита / задник</span>
          <b>{{ dims.t }} / {{ dims.t_back }} мм</b>
        </div>

        <div v-if="info?.shelves.length" class="wb__side-chain">
          <div class="wb__label">Цепочка высот</div>
          <ul class="detail__gaps">
            <li v-for="(g, i) in info.shelves" :key="`ch${i}`">
              <span>{{ g.label }}</span><b>{{ g.size }} мм</b>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- СПИСКИ И ПРОЧЕЕ -->
    <div ref="listsEl" class="wb__lists">
      <template v-if="tab === 'overview'">
        <div v-if="calc" class="wb__stats">
          <div class="stat"><div class="stat__k">позиций</div><div class="stat__v">{{ calc.totals.positions }}</div></div>
          <div class="stat"><div class="stat__k">деталей</div><div class="stat__v">{{ calc.totals.pieces }}</div></div>
          <div class="stat"><div class="stat__k">листов</div><div class="stat__v">{{ calc.totals.sheets }}</div></div>
          <div class="stat"><div class="stat__k">КПД</div><div class="stat__v">{{ calc.totals.kpd }}%</div></div>
        </div>
        <ul v-if="calc?.validation.errors.length" class="issues">
          <li v-for="(e, i) in calc.validation.errors" :key="i"
            class="wb__issue" title="Открыть деталь" @click="focusWarning(e)">{{ e }}</li>
        </ul>
        <ul v-if="calc?.validation.warnings.length" class="issues">
          <li v-for="(w, i) in calc.validation.warnings" :key="i"
            class="is-warn wb__issue" title="Открыть деталь" @click="focusWarning(w)">{{ w }}</li>
        </ul>
        <details v-if="calc" class="wb__group" open>
          <summary>Схема сборки</summary>
          <ol class="ctx__assembly"><li v-for="(step, i) in calc.assembly ?? []" :key="i">{{ step }}</li></ol>
        </details>
      </template>

      <ModuleFrontsTab v-else-if="tab === 'fronts'" :params="p" />
      <template v-else-if="tab === 'body'">
        <div class="wb__row wb__row--3">
          <label class="field"><span class="field__label">Толщина ЛДСП</span>
            <select class="select" :value="p.t" @change="update({ t: Number(($event.target as HTMLSelectElement).value) })">
              <option :value="10">10 мм</option><option :value="16">16 мм</option><option :value="18">18 мм</option><option :value="22">22 мм</option>
            </select>
          </label>
          <NumField label="Полки" :value="p.shelves" :min="0" :max="8" :step="1" @change="update({ shelves: $event })" />
          <NumField label="Перегородки" :value="p.dividers ?? 0" :min="0" :max="4" :step="1" @change="update({ dividers: $event })" />
        </div>
        <div class="wb__row wb__row--2">
          <NumField label="Цоколь, мм" :value="p.plinthH" :min="0" :max="300" :step="10" @change="update({ plinthH: $event })" />
          <NumField label="Столешница, мм" :value="p.worktopT" :min="0" :max="80" :step="2" @change="update({ worktopT: $event })" />
        </div>
        <div class="wb__row wb__row--2">
          <label class="field"><span class="field__label">Крыша</span>
            <select class="select" :value="p.roof ? 'yes' : 'no'" @change="update({ roof: ($event.target as HTMLSelectElement).value === 'yes' })">
              <option value="yes">Есть</option><option value="no">Нет (царги)</option>
            </select>
          </label>
          <label class="field"><span class="field__label">Царги</span>
            <select class="select" :value="p.reinforce" @change="update({ reinforce: ($event.target as HTMLSelectElement).value as Reinforce })">
              <option value="auto">Авто</option><option value="on">Всегда</option><option value="off">Нет</option>
            </select>
          </label>
        </div>
        <div class="wb__row wb__row--3">
          <label class="field"><span class="field__label">Задняя стенка</span>
            <select class="select" :value="p.back" @change="update({ back: ($event.target as HTMLSelectElement).value as BackKind })">
              <option value="dvp">ДВП</option><option value="same">ЛДСП</option><option value="cardboard">Картон</option><option value="none">Нет</option>
            </select>
          </label>
          <NumField label="Толщина задней" :value="p.backT" :min="1" :max="18" :step="1" @change="update({ backT: $event })" />
          <label class="field"><span class="field__label">Петли</span>
            <select class="select" :value="p.hardware" @change="update({ hardware: ($event.target as HTMLSelectElement).value as Hardware })">
              <option value="blum">Blum</option><option value="hettich">Hettich</option><option value="gtv">GTV</option>
            </select>
            <button class="btn btn--sm" @click="hwLib = 'hinges'">Библиотека…</button>
          </label>
        </div>
        <label class="field"><span class="field__label">Направляющие ящиков</span>
          <select class="select" :value="p.runners" :disabled="!p.drawers" @change="update({ runners: ($event.target as HTMLSelectElement).value })">
            <option v-for="r in runners" :key="r.id" :value="r.id">{{ r.name }} · зазор {{ r.side_gap }} мм</option>
          </select>
          <button class="btn btn--sm" @click="hwLib = 'runners'">С картинками…</button>
        </label>
        <label class="field"><span class="field__label">Ручки фасадов</span>
          <select class="select" :value="p.handle" @change="update({ handle: ($event.target as HTMLSelectElement).value })">
            <option v-for="h in handles" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
          <button class="btn btn--sm" @click="hwLib = 'handles'">С картинками…</button>
        </label>
        <div class="wb__row wb__row--2">
          <label class="field"><span class="field__label">Крепёж корпуса</span>
            <select class="select" :value="p.fastener || 'auto'" @change="update({ fastener: ($event.target as HTMLSelectElement).value })">
              <option value="auto">Авто (по соединению)</option>
              <option v-for="f in fastenerOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <button class="btn btn--sm" @click="hwLib = 'fasteners'">Библиотека…</button>
          </label>
          <label class="field"><span class="field__label">Опора полок</span>
            <select class="select" :value="p.shelfSupport || 'system32'" @change="update({ shelfSupport: ($event.target as HTMLSelectElement).value })">
              <option v-for="s in shelfSupports" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <button class="btn btn--sm" @click="hwLib = 'shelf'">С картинками…</button>
          </label>
        </div>
        <div class="wb__row wb__row--2">
          <label class="field"><span class="field__label">Газовый патрон (верхняя дверь)</span>
            <select class="select" :value="p.gasStrut || ''" @change="update({ gasStrut: ($event.target as HTMLSelectElement).value })">
              <option value="">Нет</option>
              <option v-for="g in gasStruts" :key="g.id" :value="g.id">{{ g.name }} · до {{ g.door_weight_max }} кг</option>
            </select>
            <button class="btn btn--sm" @click="hwLib = 'gas'">Библиотека…</button>
          </label>
          <label class="field"><span class="field__label">Сетка 32 мм</span>
            <select class="select" :value="p.system32 === false ? 'no' : 'yes'" @change="update({ system32: ($event.target as HTMLSelectElement).value === 'yes' })">
              <option value="yes">Привязывать полкодержатели</option>
              <option value="no">По факту полки</option>
            </select>
          </label>
        </div>
        <div class="wb__row wb__row--2">
          <label class="field"><span class="field__label">Скрытый крепёж (авто)</span>
            <select class="select" :value="p.hiddenFasteners ? 'yes' : 'no'" @change="onHiddenFasteners">
              <option value="no">Видимый (евровинт)</option>
              <option value="yes">Скрытый (минификс)</option>
            </select>
          </label>
          <label class="field"><span class="field__label">Кромка видимая</span>
            <select class="select" :value="p.edges?.visible || ''" @change="onEdgeType('visible', $event)">
              <option value="">По умолчанию (2 мм)</option>
              <option v-for="t in edgeTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
          <label class="field"><span class="field__label">Кромка скрытая</span>
            <select class="select" :value="p.edges?.hidden || ''" @change="onEdgeType('hidden', $event)">
              <option value="">По умолчанию (0.4 мм)</option>
              <option v-for="t in edgeTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
        </div>
        <label class="field"><span class="field__label">Крепление опор / колёс</span>
          <select class="select" :value="p.legMount || 'leg-plate-60'" @change="update({ legMount: ($event.target as HTMLSelectElement).value })">
            <option v-for="l in legMounts" :key="l.id" :value="l.id">
              {{ l.name }}<template v-if="l.holes.length"> · {{ l.holes.length }} отв./опора</template>
            </option>
          </select>
          <button class="btn btn--sm" @click="hwLib = 'legs'">С картинками…</button>
        </label>
        <div class="wb__cutouts">
          <div class="wb__label">Вырезы в столешнице <button class="btn btn--sm" @click="addCutout">＋ вырез</button></div>
          <div v-for="(c, i) in cutouts" :key="i" class="fc__cutout">
            <div class="fc__cutout-head">
              <span class="ctx__outline-no">{{ i + 1 }}</span>
              <span class="dim">X {{ c.x }} · Y {{ c.y }} · {{ c.w }}×{{ c.h }}</span>
              <button class="tree__act" title="Удалить" @click="removeCutout(i)">×</button>
            </div>
            <div class="ctx__part-grid">
              <label class="coord"><span>X</span><input type="number" :value="c.x" step="10" @change="setCutout(i, 'x', $event)" /></label>
              <label class="coord"><span>Y</span><input type="number" :value="c.y" step="10" @change="setCutout(i, 'y', $event)" /></label>
              <label class="coord"><span>Ш</span><input type="number" :value="c.w" step="10" @change="setCutout(i, 'w', $event)" /></label>
              <label class="coord"><span>Г</span><input type="number" :value="c.h" step="10" @change="setCutout(i, 'h', $event)" /></label>
            </div>
          </div>
        </div>
        <div v-if="overridden.length" class="wb__overrides">
          <span class="dim">Свои значения:</span>
          <span class="wb__overrides-list">
            <span v-for="k in overridden" :key="k" class="wb__override-chip">
              {{ PARAM_LABELS[k] }}
            </span>
          </span>
          <button class="btn btn--sm" @click="resetParamOverrides(inst.id, overridden)">
            К глобальным
          </button>
        </div>
        <div class="wb__actions"><button class="btn btn--sm" @click="resetBody">Сбросить корпус</button></div>
        <ul v-if="warnings.length" class="issues"><li v-for="w in warnings" :key="w" class="is-warn">{{ w }}</li></ul>
      </template>

      <template v-else-if="tab === 'details'">
        <div v-if="dims" class="detail__gaps">
          <div class="wb__label">Корпус</div>
          <ul class="detail__gaps">
            <li><span>Наружные (Ш × В × Г)</span><b>{{ dims.outer.W }} × {{ dims.outer.H }} × {{ dims.outer.D }}</b></li>
            <li><span>Внутренние</span><b>{{ dims.inner.W }} × {{ dims.inner.H }} × {{ dims.inner.D }}</b></li>
            <li><span>ЛДСП / задник</span><b>{{ dims.t }} / {{ dims.t_back }} мм</b></li>
          </ul>
        </div>
        <div v-if="info" class="wb__groups">
          <details v-for="g in info.groups" :key="g.key" open class="wb__group">
            <summary>{{ g.label }} · {{ g.elements.length }}</summary>
            <ul class="detail__list">
              <li v-for="e in g.elements" :key="e.index" :class="{ 'is-active': part === e.index }" @click="pick(e.index)">
                <span class="detail__name">{{ e.title }}</span>
                <span class="detail__size">{{ sizeLabel(e) }}</span>
              </li>
            </ul>
          </details>
        </div>
        <div v-if="calc?.shelves?.length" class="wb__group">
          <div class="wb__label">Полки: положение от пола</div>
          <ul class="detail__gaps">
            <li v-for="(s, i) in calc.shelves" :key="`sp${i}`">
              <span>
                Полка {{ i + 1 }} · {{ s.w }}×{{ s.d }}×{{ s.t }}
                <small v-if="s.to_shelf_above != null" class="dim">
                  ↑ {{ s.to_shelf_above }} мм
                </small>
                <small v-if="s.from_shelf_below != null" class="dim">
                  ↓ {{ s.from_shelf_below }} мм
                </small>
              </span>
              <b>{{ s.z_from_floor }} мм от пола</b>
            </li>
          </ul>
        </div>
        <div v-if="info?.shelves.length" class="wb__group">
          <div class="wb__label">Просветы полок</div>
          <ul class="detail__gaps"><li v-for="(g, i) in info.shelves" :key="`s${i}`"><span>{{ g.label }}</span><b>{{ g.size }} мм</b></li></ul>
        </div>
        <div v-if="info?.facadeGaps.length" class="wb__group">
          <div class="wb__label">Просветы фасадов</div>
          <ul class="detail__gaps"><li v-for="(g, i) in info.facadeGaps" :key="`g${i}`"><span>{{ g.label }}</span><b>{{ g.size }} мм</b></li></ul>
        </div>
        <details v-if="calc" class="wb__group">
          <summary>Деталировка и раскрой</summary>
          <div v-if="calc.edges_m" class="dim wb__note">
            Кромка: <template v-for="(m, t, i) in calc.edges_m" :key="t">{{ i ? ' · ' : '' }}{{ t }} мм — {{ m }} м</template>
          </div>
          <BomPanel />
        </details>
      </template>

      <template v-else-if="tab === 'drawers'">
        <div v-if="!drawers.length" class="dim wb__note">В этом модуле нет ящиков.</div>
        <div v-else class="wb__drawers">
          <button v-for="d in drawers" :key="d.id" class="wb__drawer"
            :class="{ 'wb__drawer--on': drawerFocus === d.id }" @click="pickDrawer(d.id)">
            <span class="wb__drawer-no">№{{ d.id }}</span>
            <span>короб <b>{{ d.box_w }}×{{ d.box_h }}×{{ d.box_len }}</b></span>
            <span>фасад <b>{{ d.front_w }}×{{ d.front_h }}</b></span>
          </button>
        </div>
        <template v-if="drawerFocus != null">
          <div v-for="d in drawers.filter((x) => x.id === drawerFocus)" :key="d.id" class="wb__group">
            <div class="wb__label">Ящик №{{ d.id }} · отдельный просмотр</div>
            <ul class="detail__gaps">
              <li><span>Короб снаружи (Ш × В × Г)</span><b>{{ d.box_w }} × {{ d.box_h }} × {{ d.box_len }}</b></li>
              <li><span>Короб изнутри</span><b>{{ d.inner_w }} × {{ d.inner_h }} × {{ d.inner_len }}</b></li>
              <li><span>Передняя стенка под фасад</span><b>{{ d.panel_w }}×{{ d.panel_h }}×{{ d.panel_t }}</b></li>
              <li><span>Фасад</span><b>{{ d.front_w }}×{{ d.front_h }}×{{ d.front_t }}</b></li>
              <li><span>Зазор направляющей</span><b>{{ d.side_gap }} мм / сторона</b></li>
              <li v-if="d.side_extra"><span>Борта выше переда/зада</span><b>+{{ d.side_extra }} мм</b></li>
              <li><span>Низ короба от пола</span><b>{{ d.box_bottom_from_floor }} мм</b></li>
              <li><span>Центр направляющей от пола</span><b>{{ d.runner_center_from_floor }} мм</b></li>
              <li><span>Низ фасада от пола</span><b>{{ d.front_bottom_from_floor }} мм</b></li>
              <li><span>Верх фасада до потолка модуля</span><b>{{ d.front_top_from_ceiling }} мм</b></li>
            </ul>
            <p class="dim wb__note">Фасад крепится саморезами изнутри к передней стенке короба — это отдельная панель ЛДСП, а не сам корпус.</p>
            <div class="wb__row wb__row--2">
              <NumField label="Высота ряда" :value="Math.round(d.front_h)" :min="100" :max="600" :step="10" @change="setDrawerHeight(inst.id, d.id, $event)" />
              <button class="btn btn--sm" @click="toggleDrawer(d.id)">Открыть / закрыть</button>
            </div>
            <div v-if="drawerElements.length" class="wb__group">
              <div class="wb__label">Детали ящика</div>
              <ul class="detail__list">
                <li v-for="e in drawerElements" :key="e.index" @click="pick(e.index)">
                  <span class="detail__name">{{ e.title }}</span>
                  <span class="detail__size">{{ sizeLabel(e) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </template>

      <ModuleAssemblyTab
        v-else-if="tab === 'assembly'"
        :calc="calc" :inst="inst" :params="p"
        :fastener-options="fastenerOptions"
      />
      <template v-else-if="tab === 'materials'">
        <div class="wb__zone">
          <label class="field">
            <span class="field__label">Зона / этаж модуля</span>
            <select class="select" :value="inst.zone || ''" @change="setZone">
              <option value="">Без зоны</option>
              <option v-for="z in zonesList()" :key="z" :value="z">{{ z }}</option>
            </select>
          </label>
          <input
            class="input"
            placeholder="＋ зона (Enter)"
            @keyup.enter="addZoneForModule"
          />
        </div>
        <div v-if="moduleMaterialRoles.length" class="wb__override-note">
          <span>
            У модуля свои материалы:
            <b>{{ moduleMaterialRoles.join(', ') }}</b> — они перекрывают
            материалы проекта.
          </span>
          <button class="btn btn--sm" @click="resetModuleMaterials">
            Вернуть материалы проекта
          </button>
        </div>
        <div class="wb__vars-now">
          <div class="wb__label">
            Действующие переменные
            <button class="link" @click="openVars">настроить…</button>
          </div>
          <ul v-if="applicableVars.length">
            <li v-for="v in applicableVars" :key="v.id">
              <i :style="{ background: v.material.color }"></i>
              <span>{{ v.name }}</span>
              <span class="dim">{{ v.zone ? `зона ${v.zone}` : (v.scope === 'floor' ? 'напольные' : v.scope === 'wall' ? 'навесные' : 'все') }}</span>
            </li>
          </ul>
          <p v-else class="dim">
            Нет переменных для этой зоны/типа модуля — используются материалы
            проекта, затем материал модуля, затем цвет детали.
          </p>
        </div>
        <MaterialPanel
          :instance-id="inst.id"
          :roles="[
            { key: 'corpus', label: 'Корпус' },
            { key: 'facade', label: 'Фасады' },
            { key: 'worktop', label: 'Столешница' },
            { key: 'plinth', label: 'Цоколь' },
            { key: 'back', label: 'Задняя стенка' },
            { key: 'drawer', label: 'Ящики' },
          ]"
        />
        <button
          class="btn btn--sm"
          @click="ui.settingsTab = 'vars'; ui.settingsOpen = true"
        >Глобальные переменные…</button>
        <p class="dim wb__note">
          Правки относятся к этому модулю. Материалы остальных модулей и
          комнаты — в «Проект → Материалы». Библиотека: декоры ЛДСП,
          штукатурка, паркет/ламинат, столешницы.
        </p>
      </template>

      <ModuleCostTab v-else-if="tab === 'cost'" :cost="calc?.cost ?? null" />

      <template v-else>
        <div v-if="!element" class="dim wb__note">Выберите дверь/ящик на картинке или в «Деталях».</div>
        <template v-else>
          <div v-for="ch in channels" :key="ch.id" class="chan">
            <div class="chan__head"><span>{{ ch.label }}</span><b>{{ fmt(ch.value, ch.unit) }}</b></div>
            <input class="chan__range" type="range" :min="ch.min" :max="ch.max"
              :step="ch.id === 'open' ? 1 : 5" :value="ch.value" @input="slide(ch, $event)" />
            <ul class="chan__keys">
              <li v-for="(k, i) in ch.keys" :key="i">
                <span>{{ k.t.toFixed(2) }} с</span><b>{{ fmt(k.v, ch.unit) }}</b>
                <button class="chan__del" @click="unkey(ch, i)">×</button>
              </li>
              <li v-if="!ch.keys.length" class="chan__empty">ключей нет — статическое значение</li>
            </ul>
            <div class="chan__actions"><button class="btn btn--sm" @click="key(ch)">＋ ключ</button></div>
          </div>
          <div v-if="!channels.length" class="dim wb__note">Деталь неподвижна: у неё нет каналов анимации.</div>
          <div v-else class="wb__actions">
            <button class="btn btn--sm btn--primary" @click="toggleSelected">{{ selectedOpen ? 'Закрыть' : 'Открыть' }}</button>
            <button class="btn btn--sm" @click="play">▶ Проиграть</button>
            <button class="btn btn--sm" @click="resetAll">Ключи по умолчанию</button>
          </div>
        </template>
      </template>
    </div>
    <HardwareLibrary
      v-if="hwLib"
      :kind="hwLib"
      :current="hwLib === 'handles' ? p.handle
        : hwLib === 'hinges' ? p.hardware
        : hwLib === 'runners' ? p.runners
        : hwLib === 'legs' ? (p.legMount || '')
        : hwLib === 'gas' ? (p.gasStrut || '')
        : hwLib === 'shelf' ? (p.shelfSupport || '')
        : (p.fastener || '')"
      @select="onHardwareSelect"
      @close="hwLib = null"
    />
    <MaterialLibrary
      v-if="partLibOpen"
      mode="pick"
      role=""
      :label="`Деталь: ${element?.title || ''}`"
      @pick="onPartPick"
      @close="partLibOpen = false"
    />
  </div>
  <div v-else class="dim wb__note">Модуль не найден.</div>
</template>
