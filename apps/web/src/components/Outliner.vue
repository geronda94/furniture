<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { roomWalls } from '../render25d/room'
import InstanceNode from './InstanceNode.vue'
import WallThumb from './WallThumb.vue'
import SurfaceThumb from './SurfaceThumb.vue'
import {
  addOpening,
  addPartition,
  addToFolder,
  createFolder,
  deleteFolder,
  openAddModal,
  partSelection,
  removeOpening,
  removeWall,
  removeWallItem,
  revealProps,
  select,
  selectAll,
  selectFolder,
  selectOpening,
  selectRoom,
  selectWall,
  selectWallItem,
  splitWall,
  state,
  toggleRoomDoor,
  ui,
} from '../state/project'

const expanded = ref<Record<string, boolean>>({})
const outlinerTab = ref<'furniture' | 'room'>('furniture')

function toggleExpand(id: string): void {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

watch(
  () => [state.selection, state.roomSelected, state.wallIndex] as const,
  () => {
    if (state.roomSelected || state.wallIndex != null) outlinerTab.value = 'room'
    else if (state.selection) outlinerTab.value = 'furniture'
  },
)

const room = computed(() => state.project.room)
const folders = computed(() => state.project.folders)
const folderIds = computed(
  () => new Set(state.project.folders.flatMap((f) => f.ids)),
)
const loose = computed(() =>
  state.project.instances.filter((i) => !folderIds.value.has(i.id)),
)
const walls = computed(() => roomWalls(room.value))
const materialName = (kind: 'floor' | 'ceiling') =>
  state.project.materials[kind]?.name || (kind === 'floor' ? 'Пол' : 'Потолок')
const openingsOf = (wall: number) =>
  room.value.openings.filter((o) => o.wall === wall)
const itemsOf = (wall: number) =>
  room.value.wallItems.filter((w) => w.wall === wall)
const allOpenings = computed(() => room.value.openings)
const allItems = computed(() => room.value.wallItems)
const wallName = (wall: number) => {
  const w = walls.value.find((x) => x.index === wall)
  return w ? (w.outer ? `Стена ${w.index + 1}` : `Перегородка ${w.index + 1}`) : '—'
}
const openingKind = (kind: string) =>
  kind === 'window' ? 'Окно' : kind === 'door' ? 'Дверь' : 'Проём'
const itemKind = (kind: string) =>
  kind === 'shelf' ? 'Полка' : kind === 'mirror' ? 'Зеркало'
    : kind === 'socket' ? 'Розетка' : 'Выключатель' 
function addWallHere(): void {
  splitWall(state.wallIndex ?? 0)
}
function addOpen(wall: number, kind: 'window' | 'door' | 'arch'): void {
  addOpening(kind, { wall })
}

function onFolderAdd(folderId: string): void {
  addToFolder(folderId, state.selected.length ? state.selected : [])
}
</script>

<template>
  <section class="panel outliner">
    <div class="panel__head outliner__panel-head">
      <span>Объекты</span>
      <span class="dim">{{ state.project.instances.length }}</span>
      <button
        class="tree__act"
        :class="{ 'tree__act--on': ui.facades }"
        :title="ui.facades ? 'Скрыть фасады во всём проекте' : 'Показать фасады во всём проекте'"
        @click="ui.facades = !ui.facades"
      >{{ ui.facades ? 'Фасады вкл' : 'Фасады выкл' }}</button>
      <button class="tree__act tree__act--add" title="Добавить объект" @click="openAddModal">
        ＋ объект
      </button>
      <button
        class="tree__act outliner__close"
        title="Закрыть панель"
        @click="ui.panelOpen = false"
      >×</button>
    </div>
    <div class="outliner__tabs" role="tablist" aria-label="Разделы объектов">
      <button
        class="tab"
        role="tab"
        :class="{ 'tab--active': outlinerTab === 'furniture' }"
        :aria-selected="outlinerTab === 'furniture'"
        @click="outlinerTab = 'furniture'"
      >Мебель ({{ state.project.instances.length }})</button>
      <button
        class="tab"
        role="tab"
        :class="{ 'tab--active': outlinerTab === 'room' }"
        :aria-selected="outlinerTab === 'room'"
        @click="outlinerTab = 'room'"
      >Комната</button>
    </div>
    <div class="panel__body outliner__body">
      <template v-if="outlinerTab === 'room'">
      <!-- КОМНАТА -->
      <div class="tree__row tree__row--root">
        <button class="tree__twist" @click="toggleExpand('room')">
          {{ expanded.room === false ? '▸' : '▾' }}
        </button>
        <span class="tree__name" @click="selectRoom(); revealProps()">Комната</span>
        <span class="tree__meta">{{ room.w }} × {{ room.d }} × {{ room.h }}</span>
      </div>

      <template v-if="expanded.room !== false">
        <!-- СТЕНЫ -->
        <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('walls')">
            {{ expanded.walls === false ? '▸' : '▾' }}
          </button>
          <span class="tree__name">Стены</span>
          <span class="tree__meta">{{ walls.length }}</span>
          <button class="tree__act" title="Разделить выбранную стену" @click="addWallHere">
            ＋стена
          </button>
          <button class="tree__act" title="Добавить перегородку" @click="addPartition">
            ＋перегородка
          </button>
        </div>

        <template v-if="expanded.walls !== false">
          <div
            v-for="w in walls"
            :key="w.index"
            class="tree__row tree__row--item tree__row--thumb"
            :class="{ 'is-active': state.wallIndex === w.index }"
            @click="selectWall(w.index); revealProps()"
          >
            <WallThumb :wall-index="w.index" />
            <div class="tree__col">
              <span class="tree__name">
                {{ w.outer ? `Стена ${w.index + 1}` : `Перегородка ${w.index + 1}` }}
              </span>
              <span class="tree__meta">
                {{ Math.round(w.len) }} мм · проёмов {{ openingsOf(w.index).length }}
                <template v-if="itemsOf(w.index).length"> · предметов {{ itemsOf(w.index).length }}</template>
              </span>
            </div>
            <button class="tree__act" title="Добавить окно" @click.stop="addOpen(w.index, 'window')">+о</button>
            <button class="tree__act" title="Добавить дверь" @click.stop="addOpen(w.index, 'door')">+д</button>
            <button class="tree__act" title="Удалить стену" @click.stop="removeWall(w.index)">×</button>
          </div>
        </template>

        <!-- ПРОЁМЫ -->
        <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('openings')">
            {{ expanded.openings === false ? '▸' : '▾' }}
          </button>
          <span class="tree__name">Проёмы</span>
          <span class="tree__meta">{{ allOpenings.length }}</span>
        </div>
        <template v-if="expanded.openings !== false">
          <div
            v-for="o in allOpenings"
            :key="o.id"
            class="tree__row tree__row--item tree__row--nested"
            :class="{ 'is-active': state.openingId === o.id }"
            @click="selectOpening(o.id); revealProps()"
          >
            <span class="tree__dot" :class="o.kind"></span>
            <span class="tree__name">{{ openingKind(o.kind) }}</span>
            <span class="tree__meta">{{ wallName(o.wall) }} · {{ o.w }} · Z {{ o.z0 }}…{{ o.z1 }}</span>
            <button
              v-if="o.kind === 'door'"
              class="tree__act"
              @click.stop="toggleRoomDoor(o.id)"
            >{{ o.open ? 'закрыть' : 'открыть' }}</button>
            <button class="tree__act" title="Удалить" @click.stop="removeOpening(o.id)">×</button>
          </div>
          <div v-if="!allOpenings.length" class="tree__row tree__row--nested dim">
            Проёмов пока нет
          </div>
        </template>

        <!-- ПРЕДМЕТЫ НА СТЕНАХ -->
        <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('wallitems')">
            {{ expanded.wallitems === false ? '▸' : '▾' }}
          </button>
          <span class="tree__name">На стенах</span>
          <span class="tree__meta">{{ allItems.length }}</span>
        </div>
        <template v-if="expanded.wallitems !== false">
          <div
            v-for="wi in allItems"
            :key="wi.id"
            class="tree__row tree__row--item tree__row--nested"
            :class="{ 'is-active': state.wallItemId === wi.id }"
            @click="selectWallItem(wi.wall, wi.id); revealProps()"
          >
            <span class="tree__dot wallitem"></span>
            <span class="tree__name">{{ itemKind(wi.kind) }}</span>
            <span class="tree__meta">{{ wallName(wi.wall) }} · {{ wi.w }}×{{ wi.h }} · Z {{ wi.z }}</span>
            <button class="tree__act" title="Удалить" @click.stop="removeWallItem(wi.id)">×</button>
          </div>
          <div v-if="!allItems.length" class="tree__row tree__row--nested dim">
            Предметов нет
          </div>
        </template>

        <!-- ПОЛ / ПОТОЛОК -->
        <div
          class="tree__row tree__row--item tree__row--thumb"
          :class="{ 'is-active': state.roomSelected && state.roomNode === 'floor' }"
          @click="selectRoom('floor'); revealProps()"
        >
          <button class="tree__twist" @click.stop="toggleExpand('floor')">
            {{ expanded.floor === false ? '▸' : '▾' }}
          </button>
          <SurfaceThumb kind="floor" />
          <div class="tree__col">
            <span class="tree__name">Пол</span>
            <span class="tree__meta">{{ materialName('floor') }}</span>
          </div>
        </div>
        <template v-if="expanded.floor !== false">
          <div class="tree__row tree__row--item tree__row--nested" @click="selectRoom('floor'); revealProps()">
            <span class="tree__dot"></span>
            <span class="tree__name">Материал</span>
            <span class="tree__meta">{{ materialName('floor') }}</span>
          </div>
        </template>

        <div
          class="tree__row tree__row--item tree__row--thumb"
          :class="{ 'is-active': state.roomSelected && state.roomNode === 'ceiling' }"
          @click="selectRoom('ceiling'); revealProps()"
        >
          <button class="tree__twist" @click.stop="toggleExpand('ceiling')">
            {{ expanded.ceiling === false ? '▸' : '▾' }}
          </button>
          <SurfaceThumb kind="ceiling" />
          <div class="tree__col">
            <span class="tree__name">Потолок</span>
            <span class="tree__meta">{{ materialName('ceiling') }}</span>
          </div>
        </div>
        <template v-if="expanded.ceiling !== false">
          <div class="tree__row tree__row--item tree__row--nested" @click="selectRoom('ceiling'); revealProps()">
            <span class="tree__dot"></span>
            <span class="tree__name">Материал</span>
            <span class="tree__meta">{{ materialName('ceiling') }}</span>
          </div>
        </template>

      </template>
      </template>

      <template v-else>
      <!-- ГРУППЫ И КОМНАТЫ -->
      <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('groups')">
            {{ expanded.groups === false ? '▸' : '▾' }}
          </button>
          <span class="tree__name">Группы и комнаты</span>
          <span class="tree__meta">{{ folders.length }}</span>
          <button class="tree__act" title="Папка из выделения" @click="createFolder()">
            ＋папка
          </button>
          <button
            class="tree__act"
            title="Комната как группа объектов"
            @click="createFolder('Комната ' + (state.project.folders.length + 1))"
          >
            ＋комната
          </button>
        </div>
        <template v-if="expanded.groups !== false">
          <div v-for="f in folders" :key="f.id" class="tree__folder">
            <div class="tree__row tree__row--group">
              <button class="tree__twist" @click="toggleExpand(f.id)">
                {{ expanded[f.id] === false ? '▸' : '▾' }}
              </button>
              <span class="tree__name" @click="selectFolder(f.id); revealProps()">{{ f.name }}</span>
              <span class="tree__meta">{{ f.ids.length }}</span>
              <button class="tree__act" title="Добавить выделенные в папку" @click="onFolderAdd(f.id)">＋</button>
              <button class="tree__act" title="Удалить папку" @click="deleteFolder(f.id)">×</button>
            </div>
            <template v-if="expanded[f.id] !== false">
              <InstanceNode
                v-for="id in f.ids"
                :key="id"
                v-show="state.project.instances.some((i) => i.id === id)"
                :inst="state.project.instances.find((i) => i.id === id)!"
                nested
              />
            </template>
          </div>
          <div v-if="!folders.length" class="tree__row tree__row--nested dim">
            Папок и комнат пока нет
          </div>
        </template>

        <!-- МЕБЕЛЬ -->
        <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('furniture')">
            {{ expanded.furniture === false ? '▸' : '▾' }}
          </button>
          <span class="tree__name">Мебель</span>
          <span class="tree__meta">{{ loose.length }}</span>
          <button class="tree__act" title="Выделить всё" @click="selectAll">всё</button>
        </div>
      <template v-if="expanded.furniture !== false">
        <InstanceNode v-for="inst in loose" :key="inst.id" :inst="inst" />
        <div v-if="!loose.length" class="tree__row tree__row--nested dim">
          Свободных модулей нет
        </div>
      </template>
      </template>
    </div>
  </section>
</template>
