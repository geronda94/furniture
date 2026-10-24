<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import NumField from './NumField.vue'
import MaterialPanel from './MaterialPanel.vue'
import BomPanel from './BomPanel.vue'
import FurnitureConstructor from './FurnitureConstructor.vue'
import type { Opening, WallIndex, WallItem, WallItemKind } from '../render25d/types'
import {
  addKey,
  addOpening,
  addToFolder,
  addWallItem,
  animState,
  channelsOf,
  derived,
  deleteFolder,
  folderOf,
  kindIsOpen,
  openDetail,
  partIsOpen,
  partSelection,
  playPart,
  pushSelection,
  removeKey,
  removeWall,
  removeWallItem,
  renameFolder,
  renameInstance,
  runners,
  selectWall,
  select,
  selectOpening,
  splitWall,
  setDrawerHeight,
  setInstancePosition,
  setPartChannel,
  setRoom,
  setSurface,
  state,
  toggleDoors,
  toggleDrawers,
  togglePart,
  toggleRoomDoor,
  toggleZLock,
  updateOpening,
  updateWallItem,
  updateParams,
  type Frame,
  type Hardware,
} from '../state/project'
import { moduleInfo, sizeLabel } from '../module/info'
import { outlinePoints, polygonArea, roomWalls } from '../render25d/room'
import type { Channel } from '../anim/channels'

const rootEl = ref<HTMLElement | null>(null)
const constructorOpen = ref(false)

watch(
  () => [
    state.selection,
    state.openingId,
    state.folderId,
    partSelection.part,
  ],
  () => {
    const scroller = rootEl.value?.parentElement
    if (scroller) scroller.scrollTop = 0
  },
)

const room = computed(() => state.project.room)
const isPolygon = computed(() => !!room.value.outline?.length)
const wallOptions = computed(() =>
  roomWalls(room.value).map((w) => ({
    index: w.index,
    label: w.outer ? `Стена ${w.index + 1}` : `Перегородка ${w.index + 1}`,
    length: Math.round(w.len),
  })),
)
const outline = computed(() => outlinePoints(room.value))
const roomArea = computed(() => polygonArea(outline.value) / 1e6)
const wall = computed(() =>
  state.wallIndex != null
    ? (roomWalls(room.value).find((w) => w.index === state.wallIndex) ?? null)
    : null,
)
const wallOpenings = computed(() =>
  wall.value
    ? room.value.openings.filter((o) => o.wall === wall.value!.index)
    : [],
)
const wallItems = computed(() =>
  wall.value
    ? room.value.wallItems.filter((w) => w.wall === wall.value!.index)
    : [],
)
const surface = computed(() =>
  state.roomSelected && (state.roomNode === 'floor' || state.roomNode === 'ceiling')
    ? (state.roomNode === 'floor' ? room.value.floor : room.value.ceiling)
    : null,
)
const surfaceKind = computed(() =>
  state.roomNode === 'ceiling' ? 'ceiling' : 'floor',
)
const wallKindTitle = computed(() =>
  wall.value
    ? (wall.value.outer
        ? `Стена ${wall.value.index + 1}`
        : `Перегородка ${wall.value.index + 1}`)
    : 'Стена',
)
function wallAddOpening(kind: 'window' | 'door' | 'arch'): void {
  if (!wall.value) return
  addOpening(kind, { wall: wall.value.index })
}
function wallAddItem(kind: WallItemKind): void {
  if (!wall.value) return
  addWallItem(kind, wall.value.index)
}
function surfacePatch(patch: Record<string, unknown>): void {
  setSurface(surfaceKind.value, patch)
}
function wallItemNum(item: WallItem, key: 'x' | 'z' | 'w' | 'h', e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  updateWallItem(item.id, { [key]: v })
}
const partitions = computed(() => room.value.partitions ?? [])
const outerCount = computed(
  () => roomWalls(room.value).filter((w) => w.outer).length,
)
const partitionIndex = computed(() =>
  wall.value && !wall.value.outer ? wall.value.index - outerCount.value : -1,
)
const wallOutline = computed(() => outlinePoints(room.value))
function setWallPoint(
  which: 'a' | 'b',
  axis: 0 | 1,
  e: Event,
): void {
  if (!wall.value) return
  const pts = wallOutline.value.map((p) => [p.x, p.y] as [number, number])
  const i = which === 'a'
    ? wall.value.index
    : (wall.value.index + 1) % pts.length
  if (!pts[i]) return
  pts[i][axis] = Number((e.target as HTMLInputElement).value) || 0
  setRoom({ outline: pts })
}
function moveOpening(dx: number): void {
  if (!opening.value) return
  updateOpening(opening.value.id, { x: opening.value.x + dx })
}
function setPartition(i: number, pt: 'a' | 'b', axis: 0 | 1, e: Event): void {
  const v = Number((e.target as HTMLInputElement).value) || 0
  const next = partitions.value.map((p, k) => {
    if (k !== i) return p
    const q = { a: [...p.a] as [number, number], b: [...p.b] as [number, number] }
    q[pt][axis] = v
    return q
  })
  setRoom({ partitions: next })
}
const inst = computed(() =>
  state.selection
    ? (state.project.instances.find((i) => i.id === state.selection) ?? null)
    : null,
)
const info = computed(() =>
  inst.value ? moduleInfo(inst.value, derived[inst.value.id]?.objects) : null,
)
const part = computed(() => {
  if (!inst.value || partSelection.instanceId !== inst.value.id) return null
  return partSelection.part
})
const element = computed(() =>
  info.value && part.value != null
    ? (info.value.elements[part.value] ?? null)
    : null,
)
const channels = computed<Channel[]>(() => {
  if (!inst.value || part.value == null) return []
  const set = channelsOf(inst.value, part.value)
  return set ? Object.values(set) : []
})
const drawerFront = computed(() => {
  const id = element.value?.drawerId
  if (!inst.value || !id) return null
  return derived[inst.value.id]?.drawers.find((d) => d.id === id) ?? null
})
const drawerBaseline = computed(() => {
  const el = element.value
  if (!inst.value || !el?.drawerId) return 0
  return inst.value.params.drawerHeights?.[el.drawerId - 1] ?? 0
})

const opening = computed<Opening | null>(() =>
  state.openingId
    ? (room.value.openings.find((o) => o.id === state.openingId) ?? null)
    : null,
)
const folder = computed(() =>
  inst.value ? folderOf(inst.value.id) : null,
)
const selectedFolder = computed(() =>
  state.folderId
    ? (state.project.folders.find((f) => f.id === state.folderId) ?? null)
    : null,
)

function upd(patch: Parameters<typeof updateParams>[0]): void {
  updateParams(patch)
}
function frame(e: Event): void {
  upd({ frame: (e.target as HTMLSelectElement).value as Frame })
}
function hinge(e: Event): void {
  upd({ hardware: (e.target as HTMLSelectElement).value as Hardware })
}
function runner(e: Event): void {
  upd({ runners: (e.target as HTMLSelectElement).value })
}

function openingNum(key: 'x' | 'w' | 'z0' | 'z1', value: number): void {
  if (!opening.value) return
  if (Number.isFinite(value)) updateOpening(opening.value.id, { [key]: value })
}
function openingWall(e: Event): void {
  if (!opening.value) return
  updateOpening(opening.value.id, {
    wall: Number((e.target as HTMLSelectElement).value) as WallIndex,
  })
}

function toggleSelectedPart(): void {
  if (inst.value && part.value != null) togglePart(inst.value.id, part.value)
}
function slide(ch: Channel, e: Event): void {
  if (!inst.value || part.value == null) return
  setPartChannel(
    inst.value.id,
    part.value,
    ch.id,
    Number((e.target as HTMLInputElement).value),
  )
}
function key(ch: Channel): void {
  if (inst.value && part.value != null) addKey(inst.value.id, part.value, ch.id)
}
function unkey(ch: Channel, i: number): void {
  if (inst.value && part.value != null) {
    removeKey(inst.value.id, part.value, ch.id, i)
  }
}
function play(): void {
  if (inst.value && part.value != null) playPart(inst.value.id, part.value)
}
function fmt(v: number, unit: string): string {
  return `${Math.round(v)}${unit ? ' ' + unit : ''}`
}

function exportCuttingSvg(): void {
  if (!inst.value) return
  const d = derived[inst.value.id]
  const sh = d?.sheet
  if (!d || !sh) return
  const pad = 20
  const scale = 0.22
  const sw = sh.w * scale + pad * 2
  const sheetH = sh.h * scale + pad * 2
  const rows: string[] = []
  d.sheets.forEach((sheet, si) => {
    const oy = pad + si * (sheetH + 34)
    rows.push(`<text x="${pad}" y="${oy - 8}" font-size="13" fill="#333">${sheet.material} — лист ${si + 1} (${sh.w}×${sh.h})</text>`)
    rows.push(`<rect x="${pad}" y="${oy}" width="${sh.w * scale}" height="${sh.h * scale}" fill="#fff" stroke="#888"/>`)
    for (const p of sheet.placements ?? []) {
      const x = pad + (sh.trim + p.x) * scale
      const y = oy + (sh.trim + p.y) * scale
      const w = p.w * scale
      const h = p.h * scale
      rows.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#cfe3ff" stroke="#3b6ea5"/>`)
      if (w > 40 && h > 14) {
        rows.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2).toFixed(1)}" font-size="9" text-anchor="middle" fill="#123">${p.name}</text>`)
      }
    }
  })
  const totalH = pad * 2 + d.sheets.length * (sheetH + 34)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${totalH}" font-family="sans-serif"><rect width="100%" height="100%" fill="#f4f4f4"/>${rows.join('')}</svg>`
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(inst.value.name || 'module').replace(/\s+/g, '-')}-cutting.svg`
  a.click()
  URL.revokeObjectURL(url)
}

function exportBom(): void {
  if (!inst.value) return
  const d = derived[inst.value.id]
  if (!d) return
  const head = ['Деталь', 'Кол-во', 'W', 'H', 'Пильный W', 'Пильный H',
    'Кромка', 'Материал']
  const lines = [head.join(';')]
  for (const b of d.bom) {
    lines.push([
      b.name, b.qty, b.w, b.h, b.saw_w, b.saw_h, b.edge, b.material,
    ].join(';'))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(inst.value.name || 'module').replace(/\s+/g, '-')}-bom.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section ref="rootEl" class="panel ctx">
    <!-- СТЕНА -->
    <template v-if="wall">
      <div class="panel__head">
        <span>{{ wallKindTitle }}</span>
        <span class="dim">
          {{ Math.round(wall.len) }} мм · T{{ room.wallT }}
        </span>
      </div>
      <div class="panel__body">
        <div class="ctx__sub">
          Высота {{ room.h }} мм · {{ wall.outer ? 'наружная' : 'перегородка' }}
        </div>
        <div class="ctx__actions ctx__actions--wrap">
          <button class="btn btn--sm" @click="wallAddOpening('window')">＋окно</button>
          <button class="btn btn--sm" @click="wallAddOpening('door')">＋дверь</button>
          <button class="btn btn--sm" @click="wallAddOpening('arch')">＋проём</button>
        </div>
        <div class="ctx__actions ctx__actions--wrap">
          <button class="btn btn--sm" @click="wallAddItem('shelf')">＋полка</button>
          <button class="btn btn--sm" @click="wallAddItem('mirror')">＋зеркало</button>
          <button class="btn btn--sm" @click="wallAddItem('socket')">＋розетка</button>
          <button class="btn btn--sm" @click="wallAddItem('switch')">＋выключатель</button>
        </div>

        <div class="ctx__sub">Проёмы · {{ wallOpenings.length }}</div>
        <div v-for="o in wallOpenings" :key="o.id" class="ctx__wall-row">
          <span class="ctx__dot" :class="o.kind"></span>
          <span class="ctx__wall-name">
            {{ o.kind === 'window' ? 'Окно' : o.kind === 'door' ? 'Дверь' : 'Проём' }}
            · {{ o.w }}×{{ o.z1 - o.z0 }}
          </span>
          <button class="tree__act" title="Свойства" @click="selectOpening(o.id)">⚙</button>
          <button class="tree__act" title="Удалить" @click="removeOpening(o.id)">×</button>
        </div>
        <div v-if="!wallOpenings.length" class="dim ctx__note">Проёмов нет.</div>

        <div v-if="wallItems.length" class="ctx__sub">На стене · {{ wallItems.length }}</div>
        <div
          v-for="w in wallItems" :key="w.id"
          class="ctx__wall-item"
          :class="{ 'is-active': state.wallItemId === w.id }"
        >
          <div class="ctx__wall-row">
            <span class="ctx__wall-name">
              {{ w.kind === 'shelf' ? 'Полка' : w.kind === 'mirror' ? 'Зеркало'
                : w.kind === 'socket' ? 'Розетка' : 'Выключатель' }}
            </span>
            <button class="tree__act" title="Удалить" @click="removeWallItem(w.id)">×</button>
          </div>
          <div class="ctx__part-grid">
            <label class="coord"><span>X</span>
              <input type="number" :value="w.x" step="10" @change="wallItemNum(w, 'x', $event)" />
            </label>
            <label class="coord"><span>Z</span>
              <input type="number" :value="w.z" step="10" @change="wallItemNum(w, 'z', $event)" />
            </label>
            <label class="coord"><span>W</span>
              <input type="number" :value="w.w" step="10" @change="wallItemNum(w, 'w', $event)" />
            </label>
            <label class="coord"><span>H</span>
              <input type="number" :value="w.h" step="10" @change="wallItemNum(w, 'h', $event)" />
            </label>
          </div>
        </div>

        <details v-if="!wall.outer && partitionIndex >= 0" class="ctx__details" open>
          <summary>Перегородка: координаты</summary>
          <div class="ctx__part-grid">
            <label class="coord"><span>AX</span>
              <input type="number" :value="partitions[partitionIndex]?.a[0]" step="50"
                @change="setPartition(partitionIndex, 'a', 0, $event)" />
            </label>
            <label class="coord"><span>AY</span>
              <input type="number" :value="partitions[partitionIndex]?.a[1]" step="50"
                @change="setPartition(partitionIndex, 'a', 1, $event)" />
            </label>
            <label class="coord"><span>BX</span>
              <input type="number" :value="partitions[partitionIndex]?.b[0]" step="50"
                @change="setPartition(partitionIndex, 'b', 0, $event)" />
            </label>
            <label class="coord"><span>BY</span>
              <input type="number" :value="partitions[partitionIndex]?.b[1]" step="50"
                @change="setPartition(partitionIndex, 'b', 1, $event)" />
            </label>
          </div>
        </details>
        <details v-else-if="wall.outer" class="ctx__details" open>
          <summary>Стена: координаты концов</summary>
          <div class="ctx__part-grid">
            <label class="coord"><span>AX</span>
              <input type="number" :value="wallOutline[wall.index]?.x" step="50"
                @change="setWallPoint('a', 0, $event)" />
            </label>
            <label class="coord"><span>AY</span>
              <input type="number" :value="wallOutline[wall.index]?.y" step="50"
                @change="setWallPoint('a', 1, $event)" />
            </label>
            <label class="coord"><span>BX</span>
              <input type="number" :value="wallOutline[(wall.index + 1) % wallOutline.length]?.x" step="50"
                @change="setWallPoint('b', 0, $event)" />
            </label>
            <label class="coord"><span>BY</span>
              <input type="number" :value="wallOutline[(wall.index + 1) % wallOutline.length]?.y" step="50"
                @change="setWallPoint('b', 1, $event)" />
            </label>
          </div>
        </details>

        <div class="ctx__actions">
          <button
            v-if="wall.outer"
            class="btn btn--sm"
            @click="splitWall(wall.index)"
          >
            Разделить стену
          </button>
          <button class="btn btn--sm" @click="removeWall(wall.index)">
            Удалить {{ wall.outer ? 'стену' : 'перегородку' }}
          </button>
        </div>
      </div>
    </template>

    <!-- ПОЛ / ПОТОЛОК -->
    <template v-else-if="surface">
      <div class="panel__head">
        <span>{{ state.roomNode === 'floor' ? 'Пол' : 'Потолок' }}</span>
        <span class="dim">{{ surface.enabled ? 'включён' : 'выключен' }}</span>
      </div>
      <div class="panel__body">
        <label class="field">
          <span class="field__label">Показывать</span>
          <button
            class="btn btn--sm"
            :class="{ 'btn--primary': surface.enabled }"
            @click="surfacePatch({ enabled: !surface.enabled })"
          >
            {{ surface.enabled ? 'Включено' : 'Выключено' }}
          </button>
        </label>
        <NumField
          label="Толщина покрытия"
          :value="surface.t ?? 0"
          :min="0"
          :max="100"
          :step="1"
          @change="surfacePatch({ t: $event })"
        />
        <details class="ctx__details" open>
          <summary>Материал</summary>
          <MaterialPanel
            :roles="[{ key: surfaceKind, label: state.roomNode === 'floor' ? 'Пол' : 'Потолок' }]"
          />
        </details>
      </div>
    </template>

    <!-- ПРОЁМ -->
    <template v-else-if="opening">
      <div class="panel__head">
        <span>{{ opening.kind === 'window' ? 'Окно' : 'Дверь' }}</span>
        <span class="dim">на стене</span>
      </div>
      <div class="panel__body">
        <div class="field-row field-row--2">
          <label class="field">
            <span class="field__label">Стена</span>
            <select
              class="select"
              :value="opening.wall"
              @change="openingWall"
            >
              <option v-for="w in wallOptions" :key="w.index" :value="w.index">
                {{ w.label }} · {{ w.length }} мм
              </option>
            </select>
          </label>
          <NumField
            label="Смещение"
            :value="opening.x"
            :min="0"
            :step="10"
            @change="openingNum('x', $event)"
          />
        </div>
        <div class="ctx__actions">
          <button class="btn btn--sm" title="Сдвинуть к началу стены" @click="moveOpening(-100)">⟵ 100</button>
          <button class="btn btn--sm" title="Сдвинуть к концу стены" @click="moveOpening(100)">100 ⟶</button>
        </div>
        <div class="field-row field-row--2">
          <NumField
            label="Ширина"
            :value="opening.w"
            :min="200"
            :step="10"
            @change="openingNum('w', $event)"
          />
          <NumField
            label="Нижний Z"
            :value="opening.z0"
            :min="0"
            :step="10"
            @change="openingNum('z0', $event)"
          />
        </div>
        <div class="field-row field-row--2">
          <NumField
            label="Верхний Z"
            :value="opening.z1"
            :min="100"
            :step="10"
            @change="openingNum('z1', $event)"
          />
          <label class="field">
            <span class="field__label">Состояние</span>
            <button
              v-if="opening.kind === 'door'"
              class="btn btn--sm"
              :class="{ 'btn--primary': opening.open }"
              @click="toggleRoomDoor(opening.id)"
            >
              {{ opening.open ? 'Открыта' : 'Закрыта' }}
            </button>
            <span v-else class="dim ctx__note">стекло, проём</span>
          </label>
        </div>
        <div v-if="opening.kind === 'door'" class="field-row field-row--2">
          <label class="field">
            <span class="field__label">Петли</span>
            <select
              class="select"
              :value="opening.hinge ?? 'left'"
              @change="updateOpening(opening.id, { hinge: ($event.target as HTMLSelectElement).value as 'left' | 'right' })"
            >
              <option value="left">Слева</option>
              <option value="right">Справа</option>
            </select>
          </label>
          <NumField
            label="Угол, °"
            :value="opening.angle ?? 80"
            :min="0"
            :max="120"
            :step="5"
            @change="updateOpening(opening.id, { angle: $event })"
          />
        </div>
        <div class="field-row">
          <button class="btn btn--sm" @click="state.openingId = null">
            Готово
          </button>
        </div>
      </div>
    </template>

    <!-- ПАПКА -->
    <template v-else-if="selectedFolder">
      <div class="panel__head">
        <span>Папка</span>
        <span class="dim">{{ selectedFolder.ids.length }}</span>
      </div>
      <div class="panel__body">
        <label class="field">
          <span class="field__label">Название</span>
          <input
            class="input"
            :value="selectedFolder.name"
            @change="
              renameFolder(
                selectedFolder.id,
                ($event.target as HTMLInputElement).value,
              )
            "
          />
        </label>
        <div class="ctx__actions">
          <button
            class="btn btn--sm"
            :disabled="!state.selected.length"
            @click="addToFolder(selectedFolder.id, state.selected)"
          >
            Добавить выделенные
          </button>
          <button
            class="btn btn--sm"
            @click="deleteFolder(selectedFolder.id); state.folderId = null"
          >
            Удалить папку
          </button>
        </div>
      </div>
    </template>

    <!-- ДЕТАЛЬ -->
    <template v-else-if="inst && element && part != null">
      <div class="panel__head">
        <span>{{ element.title }}</span>
        <span class="dim">{{ sizeLabel(element) }}</span>
      </div>
      <div class="panel__body">
        <div class="ctx__sub">
          X {{ Math.round(element.x) }} · Y {{ Math.round(element.y) }} · Z
          {{ Math.round(element.z) }}
        </div>
        <div v-if="element.drawerId && drawerFront" class="field-row">
          <NumField
            label="Высота ящика"
            :value="Math.round(drawerFront.front_h)"
            :min="100"
            :max="600"
            :step="10"
            @change="setDrawerHeight(inst.id, element.drawerId!, $event)"
          />
          <span class="dim ctx__note">
            ящик {{ element.drawerId }} из {{ info?.drawers.length }}
            <template v-if="drawerBaseline">
              · задано {{ drawerBaseline }} мм
            </template>
          </span>
        </div>

        <div v-if="channels.length" class="ctx__anim">
          <div v-for="ch in channels" :key="ch.id" class="chan">
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
                <button class="chan__del" @click="unkey(ch, i)">×</button>
              </li>
              <li v-if="!ch.keys.length" class="chan__empty">
                ключей нет — статическое значение
              </li>
            </ul>
            <div class="chan__actions">
              <button class="btn btn--sm" @click="key(ch)">＋ ключ</button>
            </div>
          </div>
          <div class="chan__actions chan__actions--row">
            <button class="btn btn--sm btn--primary" @click="toggleSelectedPart">
              {{ partIsOpen(inst, part) ? 'Закрыть' : 'Открыть' }}
            </button>
            <button class="btn btn--sm" @click="play">▶</button>
            <button class="btn btn--sm" @click="openDetail(inst.id, part)">
              Просмотр
            </button>
          </div>
        </div>
        <div v-else class="dim ctx__note">
          Деталь корпуса — не подвижная.
        </div>
      </div>
    </template>

    <!-- ОБЪЕКТ -->
    <template v-else-if="inst">
      <div class="panel__head">
        <span>{{ inst.name || 'Модуль' }}</span>
        <span class="dim">
          {{ inst.params.W }}×{{ inst.params.H }}×{{ inst.params.D }}
        </span>
      </div>
      <div class="panel__body">
        <label class="field">
          <span class="field__label">Название</span>
          <input
            class="input"
            :value="inst.name"
            @change="
              renameInstance(
                inst!.id,
                ($event.target as HTMLInputElement).value,
              )
            "
          />
        </label>

        <div class="field-row field-row--3">
          <NumField label="Ширина" :value="inst.params.W" :min="200" :max="3000" :step="10" @change="upd({ W: $event })" />
          <NumField label="Высота" :value="inst.params.H" :min="200" :max="2600" :step="10" @change="upd({ H: $event })" />
          <NumField label="Глубина" :value="inst.params.D" :min="200" :max="900" :step="10" @change="upd({ D: $event })" />
        </div>

        <div class="field-row field-row--3">
          <NumField label="Двери" :value="inst.params.doors" :min="0" :max="6" :step="1" @change="upd({ doors: $event })" />
          <NumField label="Ящики" :value="inst.params.drawers" :min="0" :max="6" :step="1" @change="upd({ drawers: $event })" />
          <NumField label="Полки" :value="inst.params.shelves" :min="0" :max="8" :step="1" @change="upd({ shelves: $event })" />
        </div>

        <div class="field-row field-row--2">
          <label class="field">
            <span class="field__label">Каркас</span>
            <select class="select" :value="inst.params.frame" @change="frame">
              <option value="inset">Вкладной</option>
              <option value="overlay">Накладной</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Петли</span>
            <select class="select" :value="inst.params.hardware" @change="hinge">
              <option value="blum">Blum</option>
              <option value="hettich">Hettich</option>
              <option value="gtv">GTV</option>
            </select>
          </label>
        </div>

        <label v-if="inst.params.drawers > 0" class="field">
          <span class="field__label">Направляющие ящиков</span>
          <select class="select" :value="inst.params.runners" @change="runner">
            <option v-for="r in runners" :key="r.id" :value="r.id">
              {{ r.name }} · зазор {{ r.side_gap }} мм
            </option>
          </select>
        </label>

        <div class="ctx__coords">
          <div class="tree__coords-title">
            Координаты <span class="dim">в комнате, мм</span>
          </div>
          <div class="coords-row">
            <label class="coord">
              <span>X</span>
              <input type="number" :value="inst.x" step="10"
                @change="setInstancePosition(inst.id, { x: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <label class="coord">
              <span>Y</span>
              <input type="number" :value="inst.y" step="10"
                @change="setInstancePosition(inst.id, { y: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <label class="coord" :class="{ 'is-locked': inst.zLocked }">
              <span>Z</span>
              <input type="number" :value="inst.z" :disabled="inst.zLocked" step="10"
                @change="setInstancePosition(inst.id, { z: Number(($event.target as HTMLInputElement).value) })" />
            </label>
            <button class="tree__act coord__lock" @click="toggleZLock(inst.id)">
              {{ inst.zLocked ? '🔒' : '🔓' }}
            </button>
          </div>
        </div>

        <div class="ctx__push">
          <span class="field__label">К стене</span>
          <button class="btn btn--sm" title="К левой стене" @click="pushSelection('left')">⟵</button>
          <button class="btn btn--sm" title="К правой стене" @click="pushSelection('right')">⟶</button>
          <button class="btn btn--sm" title="К дальней стене" @click="pushSelection('back')">↑</button>
          <button class="btn btn--sm" title="К передней стене" @click="pushSelection('front')">↓</button>
        </div>

        <div class="ctx__actions">
          <button class="btn btn--sm" @click="toggleDoors(inst.id)" :disabled="!inst.params.doors">
            Двери: {{ kindIsOpen(inst, 'door') ? 'открыты' : 'закрыты' }}
          </button>
          <button class="btn btn--sm" @click="toggleDrawers(inst.id)" :disabled="!inst.params.drawers">
            Ящики: {{ kindIsOpen(inst, 'drawer') ? 'выдвинуты' : 'закрыты' }}
          </button>
        </div>
        <div class="ctx__actions">
          <button class="btn btn--sm btn--primary" @click="constructorOpen = true">
            Конструктор
          </button>

          <button v-if="folder" class="btn btn--sm" disabled>
            в «{{ folder.name }}»
          </button>
        </div>

        <details class="ctx__details">
          <summary>Схема сборки</summary>
          <ol class="ctx__assembly">
            <li v-for="(step, i) in derived[inst.id]?.assembly ?? []" :key="i">
              {{ step }}
            </li>
          </ol>
        </details>
        <details class="ctx__details">
          <summary>Деталировка</summary>
          <div class="ctx__actions">
            <button class="btn btn--sm" @click="exportBom">Скачать CSV</button>
            <button class="btn btn--sm" @click="exportCuttingSvg">Раскрой SVG</button>
          </div>
          <div
            v-if="derived[inst.id]?.edges_m"
            class="dim ctx__note"
          >
            Кромка:
            <template
              v-for="(m, t, i) in derived[inst.id].edges_m"
              :key="t"
            >{{ i ? ' · ' : '' }}{{ t }} мм — {{ m }} м</template>
          </div>
          <BomPanel />
        </details>
      </div>
    </template>

    <!-- КОМНАТА -->
    <template v-else>
      <div class="panel__head">
        <span>Комната</span>
        <span class="dim">
          {{ room.w }} × {{ room.d }} × {{ room.h }} · {{ roomArea.toFixed(1) }} м²
        </span>
      </div>
      <div class="panel__body">
        <div class="field-row field-row--3">
          <NumField label="Ширина" :value="room.w" :min="1200" :max="12000" :step="50" @change="setRoom({ w: $event })" />
          <NumField label="Глубина" :value="room.d" :min="1200" :max="12000" :step="50" @change="setRoom({ d: $event })" />
          <NumField label="Высота" :value="room.h" :min="2000" :max="4500" :step="50" @change="setRoom({ h: $event })" />
        </div>
        <div class="field-row">
          <NumField label="Толщина стен" :value="room.wallT" :min="40" :max="300" :step="10" @change="setRoom({ wallT: $event })" />
        </div>
        <details class="ctx__details" :open="isPolygon">
          <summary>Форма комнаты · {{ outline.length }} стен</summary>
          <div class="ctx__actions">
            <button class="btn btn--sm" @click="setRoom({ outline: [] })">
              Прямоугольник
            </button>
            <button
              class="btn btn--sm"
              @click="setRoom({ outline: [[0,0],[room.w,0],[room.w,room.d],[room.w*0.55,room.d],[room.w*0.55,room.d*0.55],[0,room.d*0.55]] })"
            >
              L-форма
            </button>
            <button
              class="btn btn--sm"
              @click="setRoom({ outline: [[0,0],[room.w,0],[room.w,room.d*0.8],[room.w*0.8,room.d],[0,room.d]] })"
            >
              Скос
            </button>
            <button
              class="btn btn--sm"
              @click="setRoom({ outline: [...outline.map((p) => [p.x, p.y] as [number, number]), [outline[outline.length-1].x + 400, outline[outline.length-1].y]] })"
            >
              ＋ точка
            </button>
          </div>
          <div v-if="isPolygon" class="ctx__outline">
            <div v-for="(pt, i) in outline" :key="i" class="ctx__outline-row">
              <span class="ctx__outline-no">{{ i + 1 }}</span>
              <label class="coord">
                <span>X</span>
                <input type="number" :value="pt.x" step="50"
                  @change="setRoom({ outline: outline.map((q, k) => k === i ? [Number(($event.target as HTMLInputElement).value), q.y] : [q.x, q.y]) })" />
              </label>
              <label class="coord">
                <span>Y</span>
                <input type="number" :value="pt.y" step="50"
                  @change="setRoom({ outline: outline.map((q, k) => k === i ? [q.x, Number(($event.target as HTMLInputElement).value)] : [q.x, q.y]) })" />
              </label>
              <button class="tree__act" title="Удалить точку"
                :disabled="outline.length <= 3"
                @click="setRoom({ outline: outline.filter((_, k) => k !== i).map((q) => [q.x, q.y]) })">
                ×
              </button>
            </div>
            <p class="dim ctx__note">
              Точки по порядку, в мм. Стены строятся между соседними точками;
              проёмы выбираются по номеру стены.
            </p>
          </div>
          <p v-else class="dim ctx__note">
            Прямоугольник {{ room.w }} × {{ room.d }} мм. Добавьте точку или
            выберите L-форму, чтобы сделать комнату сложной.
          </p>
        </details>
        <details class="ctx__details" :open="!!partitions.length">
          <summary>Перегородки · {{ partitions.length }}</summary>
          <div class="ctx__actions">
            <button
              class="btn btn--sm"
              @click="setRoom({ partitions: [...partitions.map((p) => ({ a: [...p.a], b: [...p.b] })), { a: [room.w / 2, 0], b: [room.w / 2, room.d] }] })"
            >
              ＋ перегородка
            </button>
          </div>
          <div v-if="partitions.length" class="ctx__outline">
            <div v-for="(pt, i) in partitions" :key="i" class="ctx__part">
              <div class="ctx__part-head">
                <span class="ctx__outline-no">{{ i + 1 }}</span>
                <span class="dim">A → B</span>
                <button class="tree__act" title="Удалить"
                  @click="setRoom({ partitions: partitions.filter((_, k) => k !== i).map((p) => ({ a: [...p.a], b: [...p.b] })) })">
                  ×
                </button>
              </div>
              <div class="ctx__part-grid">
                <label class="coord"><span>AX</span>
                  <input type="number" :value="pt.a[0]" step="50" @change="setPartition(i, 'a', 0, $event)" />
                </label>
                <label class="coord"><span>AY</span>
                  <input type="number" :value="pt.a[1]" step="50" @change="setPartition(i, 'a', 1, $event)" />
                </label>
                <label class="coord"><span>BX</span>
                  <input type="number" :value="pt.b[0]" step="50" @change="setPartition(i, 'b', 0, $event)" />
                </label>
                <label class="coord"><span>BY</span>
                  <input type="number" :value="pt.b[1]" step="50" @change="setPartition(i, 'b', 1, $event)" />
                </label>
              </div>
            </div>
            <p class="dim ctx__note">
              Перегородка — стена между комнатами. Проём на ней выбирается
              в свойствах проёма по номеру стены; дверь общая для двух комнат.
            </p>
          </div>
        </details>
        <details class="ctx__details">
          <summary>Материалы</summary>
          <MaterialPanel />
        </details>
      </div>
    </template>
    <FurnitureConstructor
      v-if="constructorOpen && inst"
      :instance-id="inst.id"
      @close="constructorOpen = false"
    />
  </section>
</template>
