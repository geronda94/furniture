<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ModulePreview from './ModulePreview.vue'
import NumField from './NumField.vue'
import BomPanel from './BomPanel.vue'
import MaterialPanel from './MaterialPanel.vue'
import {
  addKey,
  channelsOf,
  defaultParams,
  deleteInstance,
  derived,
  duplicateInstance,
  kindIsOpen,
  partIsOpen,
  partSelection,
  playPart,
  pushSelection,
  renameInstance,
  removeKey,
  resetKeys,
  rotateInstance,
  runners,
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
  type FrontBlock,
  type Hardware,
  type Params,
  type Reinforce,
} from '../state/project'
import { moduleInfo, relationsFor, sizeLabel } from '../module/info'
import type { Channel } from '../anim/channels'

const props = defineProps<{ instanceId: string }>()

type Tab = 'overview' | 'fronts' | 'body' | 'details' | 'drawers' | 'cost' | 'materials' | 'anim'
const tab = ref<Tab>('overview')
const drawerFocus = ref<number | null>(null)
const previewView = ref<'iso' | 'front' | 'side' | 'top'>('iso')

const inst = computed(
  () => state.project.instances.find((i) => i.id === props.instanceId) ?? null,
)
const info = computed(() =>
  inst.value ? moduleInfo(inst.value, derived[inst.value.id]?.objects) : null,
)
const calc = computed(() => derived[props.instanceId] ?? null)
const p = computed<Params | null>(() => inst.value?.params ?? null)
const dims = computed(() => calc.value?.dims ?? null)
const drawers = computed(() => calc.value?.drawers ?? [])
const cost = computed(() => calc.value?.cost ?? null)
const money = (v: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₽'

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

const gapBottom = 2
const gapTop = 2
const gapBetween = 3
const openH = computed(() => (p.value ? p.value.H - gapTop - gapBottom : 0))

/* ---------- фасады ---------- */
function legacyBlocks(v: Params): FrontBlock[] {
  if (v.fronts?.length) return v.fronts.map((b) => ({ ...b }))
  if (v.drawers && v.doors) {
    return [
      { type: 'drawers', count: 1, height: 200 },
      { type: 'doors', count: v.doors, height: 0 },
    ]
  }
  if (v.drawers) {
    const hs = v.drawerHeights?.length
      ? v.drawerHeights
      : Array.from({ length: v.drawers }, () => 0)
    return hs.map((h) => ({
      type: 'drawers' as const,
      count: 1,
      height: Math.round(h),
    }))
  }
  return v.doors ? [{ type: 'doors', count: v.doors, height: 0 }] : []
}

const blocks = computed<FrontBlock[]>(() => (p.value ? legacyBlocks(p.value) : []))

function counts(list: FrontBlock[]): { doors: number; drawers: number } {
  return {
    doors: list.filter((b) => b.type === 'doors').reduce((s, b) => s + b.count, 0),
    drawers: list.filter((b) => b.type === 'drawers').reduce((s, b) => s + b.count, 0),
  }
}
function writeFronts(next: FrontBlock[]): void {
  const c = counts(next)
  updateParams({ fronts: next, doors: c.doors, drawers: c.drawers })
}
function setBlock(i: number, patch: Partial<FrontBlock>): void {
  writeFronts(blocks.value.map((b, k) => (k === i ? { ...b, ...patch } : b)))
}
function addBlock(type: 'doors' | 'drawers'): void {
  writeFronts([...blocks.value, { type, count: 1, height: 0 }])
}
function removeBlock(i: number): void {
  writeFronts(blocks.value.filter((_, k) => k !== i))
}
function move(i: number, dy: number): void {
  const next = [...blocks.value]
  const j = i + dy
  if (j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j], next[i]]
  writeFronts(next)
}
function preset(key: string): void {
  const v = p.value
  if (!v) return
  if (key === 'doors') {
    writeFronts([{ type: 'doors', count: Math.max(1, Math.ceil(v.W / 600)), height: 0 }])
  } else if (key === 'drawers') {
    writeFronts([
      { type: 'drawers', count: 1, height: 0 },
      { type: 'drawers', count: 1, height: 0 },
      { type: 'drawers', count: 1, height: 0 },
    ])
  } else if (key === 'mix') {
    writeFronts([
      { type: 'drawers', count: 1, height: 200 },
      { type: 'drawers', count: 1, height: 200 },
      { type: 'doors', count: 2, height: 0 },
    ])
  } else if (key === 'drawer-door') {
    writeFronts([
      { type: 'drawers', count: 1, height: 200 },
      { type: 'doors', count: 2, height: 0 },
    ])
  } else if (key === 'door-drawer') {
    writeFronts([
      { type: 'doors', count: 2, height: 0 },
      { type: 'drawers', count: 1, height: 200 },
    ])
  } else if (key === 'reset') {
    updateParams({ fronts: undefined })
  }
}

const preview = computed(() => {
  const v = p.value
  if (!v) return []
  const available = openH.value
  const fixed = blocks.value.reduce((s, b) => s + (b.height || 0), 0)
  const autos = blocks.value.filter((b) => !b.height).length
  const autoH = autos
    ? Math.max(0, available - fixed - gapBetween * (blocks.value.length - 1)) / autos
    : 0
  return blocks.value.map((b, i) => ({
    ...b,
    i,
    h: b.height || autoH,
    label:
      b.type === 'doors'
        ? `${b.count} ${b.count === 1 ? 'дверь' : 'двери'}`
        : `${b.count} ${b.count === 1 ? 'ящик' : 'ящика'}`,
  }))
})

/* ---------- корпус ---------- */
function num(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}
function update(patch: Partial<Params>): void {
  updateParams(patch)
}
function resetBody(): void {
  if (inst.value) setMount(inst.value.id, 'floor')
  update(defaultParams())
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
  { id: 'cost', label: 'Смета' },
  { id: 'materials', label: 'Материалы' },
  { id: 'anim', label: 'Анимация' },
]
</script>

<template>
  <div v-if="inst && p" class="wb">
    <div class="wb__top">
      <!-- КРУПНАЯ ЗАКРЕПЛЁННАЯ КАРТИНКА -->
      <div class="wb__visual">
        <ModulePreview
          :instance-id="instanceId"
          fill
          schematic
          :view="previewView"
          show-dims
          :part="part"
          :drawer-id="tab === 'drawers' ? drawerFocus : null"
          @pick="pick"
        />
      </div>

      <!-- МЕНЮ И ВАЖНЫЕ ФУНКЦИИ -->
      <div class="wb__side">
        <header class="wb__head">
          <input
            class="input wb__name"
            :value="inst.name"
            aria-label="Название модуля"
            @change="renameInstance(inst.id, ($event.target as HTMLInputElement).value)"
          />
          <span class="dim">{{ p.W }}×{{ p.H }}×{{ p.D }}</span>
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

        <div class="wb__quick">
          <button class="btn btn--sm wb__eye" title="Показать объект анфас" @click="previewView = 'front'">👁 Напротив</button>
          <button class="btn btn--sm" @click="previewView = 'iso'">Изо</button>
          <button class="btn btn--sm" @click="previewView = 'side'">Бок</button>
          <button class="btn btn--sm" @click="previewView = 'top'">Верх</button>
        </div>

        <div class="wb__coords">
          <div class="wb__label">Положение <span class="dim">в комнате, мм</span></div>
          <div class="coords-row">
            <label class="coord"><span>X</span>
              <input type="number" :value="inst.x" step="10"
                @change="setInstancePosition(inst.id, { x: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <label class="coord"><span>Y</span>
              <input type="number" :value="inst.y" step="10"
                @change="setInstancePosition(inst.id, { y: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <label class="coord" :class="{ 'is-locked': inst.zLocked }"><span>Z</span>
              <input type="number" :value="inst.z" :disabled="inst.zLocked" step="10"
                @change="setInstancePosition(inst.id, { z: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <button class="tree__act coord__lock" @click="toggleZLock(inst.id)">
              {{ inst.zLocked ? '🔒' : '🔓' }}
            </button>
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
            <li v-if="relations.left"><span>← {{ relations.left.label }}</span><b>{{ relations.left.distance }} мм</b></li>
            <li v-if="relations.right"><span>→ {{ relations.right.label }}</span><b>{{ relations.right.distance }} мм</b></li>
          </ul>
          <div v-if="edgeLabel" class="wb__edge">Кромка: {{ edgeLabel }}</div>
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
          <b>{{ dims.outer.W }}×{{ dims.outer.H }}×{{ dims.outer.D }}</b>
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
    <div class="wb__lists">
      <template v-if="tab === 'overview'">
        <div v-if="calc" class="wb__stats">
          <div class="stat"><div class="stat__k">позиций</div><div class="stat__v">{{ calc.totals.positions }}</div></div>
          <div class="stat"><div class="stat__k">деталей</div><div class="stat__v">{{ calc.totals.pieces }}</div></div>
          <div class="stat"><div class="stat__k">листов</div><div class="stat__v">{{ calc.totals.sheets }}</div></div>
          <div class="stat"><div class="stat__k">КПД</div><div class="stat__v">{{ calc.totals.kpd }}%</div></div>
        </div>
        <ul v-if="calc?.validation.errors.length" class="issues">
          <li v-for="(e, i) in calc.validation.errors" :key="i">{{ e }}</li>
        </ul>
        <ul v-if="calc?.validation.warnings.length" class="issues">
          <li v-for="(w, i) in calc.validation.warnings" :key="i" class="is-warn">{{ w }}</li>
        </ul>
        <details v-if="calc" class="wb__group" open>
          <summary>Схема сборки</summary>
          <ol class="ctx__assembly"><li v-for="(step, i) in calc.assembly ?? []" :key="i">{{ step }}</li></ol>
        </details>
      </template>

      <template v-else-if="tab === 'fronts'">
        <div class="wb__chips">
          <button class="chip" @click="preset('doors')">Только двери</button>
          <button class="chip" @click="preset('drawers')">Только ящики</button>
          <button class="chip" @click="preset('drawer-door')">Ящик + двери</button>
          <button class="chip" @click="preset('door-drawer')">Двери + ящик</button>
          <button class="chip" @click="preset('mix')">Микс</button>
          <button class="chip" @click="preset('reset')">Авто</button>
        </div>
        <div class="fc__blocks">
          <div v-for="(b, i) in blocks" :key="i" class="fc-block">
            <div class="fc-block__head">
              <span class="fc-block__no">{{ i + 1 }}</span>
              <select class="select fc-block__type" :value="b.type"
                @change="setBlock(i, { type: ($event.target as HTMLSelectElement).value as 'doors' | 'drawers' })">
                <option value="doors">Двери</option><option value="drawers">Ящики</option>
              </select>
              <div class="fc-block__acts">
                <button class="tree__act" title="Выше" @click="move(i, -1)">↑</button>
                <button class="tree__act" title="Ниже" @click="move(i, 1)">↓</button>
                <button class="tree__act" title="Удалить" @click="removeBlock(i)">×</button>
              </div>
            </div>
            <div class="fc-block__row">
              <label class="field"><span class="field__label">{{ b.type === 'doors' ? 'Полотен' : 'Ящиков' }}</span>
                <input class="input" type="number" min="1" max="6" :value="b.count" @input="setBlock(i, { count: num($event) })" />
              </label>
              <label class="field"><span class="field__label">Высота, мм (0 — авто)</span>
                <input class="input" type="number" min="0" max="2000" step="10" :value="b.height" @input="setBlock(i, { height: num($event) })" />
              </label>
            </div>
          </div>
          <div v-if="!blocks.length" class="dim wb__note">Фасадов нет — открытая секция.</div>
        </div>
        <div class="wb__actions">
          <button class="btn btn--sm" @click="addBlock('doors')">＋ двери</button>
          <button class="btn btn--sm" @click="addBlock('drawers')">＋ ящики</button>
        </div>
        <div class="fc__elevation wb__elevation" :style="{ aspectRatio: `${p.W} / ${p.H}` }">
          <div v-for="b in preview" :key="b.i" class="fc__band" :class="`fc__band--${b.type}`" :style="{ flexGrow: Math.max(1, b.h) }">
            <span>{{ b.label }}</span><small>{{ b.height ? `${Math.round(b.height)} мм` : 'авто' }}</small>
          </div>
          <div v-if="!preview.length" class="fc__band fc__band--open"><span>Открытая секция</span></div>
        </div>
        <p class="dim wb__note">Сверху вниз. Высота 0 — блок добирает остаток. Зазоры 2/3 мм учитываются автоматически.</p>
      </template>

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
          </label>
        </div>
        <label class="field"><span class="field__label">Направляющие ящиков</span>
          <select class="select" :value="p.runners" :disabled="!p.drawers" @change="update({ runners: ($event.target as HTMLSelectElement).value })">
            <option v-for="r in runners" :key="r.id" :value="r.id">{{ r.name }} · зазор {{ r.side_gap }} мм</option>
          </select>
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

      <template v-else-if="tab === 'materials'">
        <MaterialPanel
          :roles="[
            { key: 'corpus', label: 'Корпус' },
            { key: 'facade', label: 'Фасады' },
            { key: 'worktop', label: 'Столешница' },
            { key: 'plinth', label: 'Цоколь' },
            { key: 'back', label: 'Задняя стенка' },
            { key: 'drawer', label: 'Ящики' },
          ]"
        />
        <p class="dim wb__note">
          Цвет и текстура применяются ко всем модулям проекта. Библиотека —
          декоры ЛДСП, штукатурка, паркет/ламинат, столешницы.
        </p>
      </template>

      <template v-else-if="tab === 'cost'">
        <div v-if="!cost" class="dim wb__note">Смета ещё не рассчитана.</div>
        <template v-else>
          <div class="wb__label">Смета модуля · {{ cost.currency }}</div>
          <ul class="detail__gaps wb__cost">
            <li v-for="(line, i) in cost.lines" :key="i" class="wb__cost-line">
              <span class="wb__cost-name">
                {{ line.label }}
                <small>{{ line.qty }} {{ line.unit }} × {{ money(line.unit_price) }}</small>
              </span>
              <b>{{ money(line.total) }}</b>
            </li>
          </ul>
          <ul class="detail__gaps wb__cost-total">
            <li><span>Материалы и работы</span><b>{{ money(cost.subtotal) }}</b></li>
            <li><span>Наценка {{ cost.markup_percent }}%</span><b>{{ money(cost.markup) }}</b></li>
            <li><span>Партнёрская комиссия {{ cost.partner_percent }}%</span><b>{{ money(cost.partner) }}</b></li>
            <li class="wb__cost-grand"><span>К оплате</span><b>{{ money(cost.total) }}</b></li>
          </ul>
          <p class="dim wb__note">
            Цены берутся из specs/pricing.yaml. Наценка и партнёрская комиссия —
            заготовка для КП и работы с партнёрами.
          </p>
        </template>
      </template>

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
  </div>
  <div v-else class="dim wb__note">Модуль не найден.</div>
</template>
