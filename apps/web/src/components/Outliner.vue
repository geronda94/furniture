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
  addWallItem,
  createFolder,
  deleteFolder,
  finishCalc,
  openAddModal,
  removeFinish,
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
import type { WallItemKind } from '../render25d/types'

const expanded = ref<Record<string, boolean>>({})
const outlinerTab = ref<'furniture' | 'room'>('furniture')

function toggleExpand(id: string): void {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}
function isClosed(id: string): boolean {
  return expanded.value[id] === false
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
const wallName = (wall: number) => {
  const w = walls.value.find((x) => x.index === wall)
  return w ? (w.outer ? `Стена ${w.index + 1}` : `Перегородка ${w.index + 1}`) : '—'
}
const openingKind = (kind: string) =>
  kind === 'window' ? 'Окно' : kind === 'door' ? 'Дверь' : 'Проём'
const finishes = computed(() => state.project.finishes ?? [])
const finishMeta = (f: (typeof finishes.value)[number]) => {
  const c = finishCalc(f)
  return `${f.w}×${f.d} · ${c.area} м² · ${c.tiles} плит. · ${c.cost}`
}
function openFinish(id: string | null = null): void {
  ui.finishId = id
  ui.finishOpen = true
}
const itemKind = (kind: string) =>
  kind === 'shelf' ? 'Полка' : kind === 'mirror' ? 'Зеркало'
    : kind === 'socket' ? 'Розетка' : 'Выключатель'

function addWallHere(): void {
  splitWall(state.wallIndex ?? 0)
}
function addOpen(wall: number, kind: 'window' | 'door' | 'arch'): void {
  addOpening(kind, { wall })
}
function addItem(wall: number, kind: WallItemKind): void {
  addWallItem(kind, wall)
}
function onFolderAdd(folderId: string): void {
  addToFolder(folderId, state.selected.length ? state.selected : [])
}
function floorSelected(): boolean {
  return state.roomSelected && state.roomNode === 'floor'
}
</script>

<template>
  <section class="panel outliner">
    <div class="panel__head outliner__panel-head">
      <span>Объекты</span>
      <span class="dim">{{ state.project.instances.length }}</span>
      <button
        class="btn btn--sm outliner__add"
        title="Библиотека объектов: мебель, техника, проёмы, отделка"
        @click="openAddModal()"
      >＋ Добавить</button>
      <button
        class="tree__act"
        :class="{ 'tree__act--on': ui.facades }"
        :title="ui.facades ? 'Скрыть фасады во всём проекте' : 'Показать фасады во всём проекте'"
        @click="ui.facades = !ui.facades"
      >{{ ui.facades ? 'Фасады вкл' : 'Фасады выкл' }}</button>
      <button
        class="tree__act outliner__close"
        title="Закрыть панель"
        @click="ui.panelOpen = false"
      >×</button>
    </div>

    <div class="outliner__tabs" role="tablist" aria-label="Разделы объектов" data-tour="objects">
      <button
        class="tab" role="tab"
        :class="{ 'tab--active': outlinerTab === 'furniture' }"
        :aria-selected="outlinerTab === 'furniture'"
        @click="outlinerTab = 'furniture'"
      >Мебель ({{ state.project.instances.length }})</button>
      <button
        class="tab" role="tab"
        :class="{ 'tab--active': outlinerTab === 'room' }"
        :aria-selected="outlinerTab === 'room'"
        @click="outlinerTab = 'room'"
      >Помещение ({{ walls.length }})</button>
    </div>

    <div class="panel__body outliner__body">
      <template v-if="outlinerTab === 'room'">
        <!-- ПОМЕЩЕНИЕ -->
        <div class="tree__row tree__row--root">
          <button class="tree__twist" @click="toggleExpand('room')">
            {{ isClosed('room') ? '▸' : '▾' }}
          </button>
          <span class="tree__name" @click="selectRoom(); revealProps()">Помещение</span>
          <span class="tree__meta">{{ room.w }} × {{ room.d }} × {{ room.h }} · стены {{ room.wallT }}</span>
        </div>

        <template v-if="!isClosed('room')">
          <!-- СТЕНЫ + ОБЪЕКТЫ НА НИХ -->
          <div class="tree__row tree__row--group">
            <button class="tree__twist" @click="toggleExpand('walls')">
              {{ isClosed('walls') ? '▸' : '▾' }}
            </button>
            <span class="tree__name">Стены и объекты на них</span>
            <span class="tree__meta">{{ walls.length }}</span>
            <button class="tree__act" title="Добавить перегородку" @click="addPartition">＋перегородка</button>
          </div>

          <template v-if="!isClosed('walls')">
            <div v-for="w in walls" :key="w.index" class="outliner__wall">
              <div
                class="tree__row tree__row--item tree__row--thumb"
                :class="{ 'is-active': state.wallIndex === w.index }"
                @click="selectWall(w.index); revealProps()"
              >
                <WallThumb :wall-index="w.index" />
                <div class="tree__col">
                  <span class="tree__name">{{ w.outer ? `Стена ${w.index + 1}` : `Перегородка ${w.index + 1}` }}</span>
                  <span class="tree__meta">
                    {{ Math.round(w.len) }} мм · T{{ Math.round(w.wallT ?? room.wallT) }} ·
                    проёмов {{ openingsOf(w.index).length }} · предметов {{ itemsOf(w.index).length }}
                  </span>
                </div>
                <button class="tree__act" title="Разделить стену" @click.stop="selectWall(w.index); addWallHere()">÷</button>
                <button class="tree__act" title="Окно" @click.stop="addOpen(w.index, 'window')">＋о</button>
                <button class="tree__act" title="Дверь" @click.stop="addOpen(w.index, 'door')">＋д</button>
                <button class="tree__act" title="Полка" @click.stop="addItem(w.index, 'shelf')">＋п</button>
                <button class="tree__act" title="Розетка" @click.stop="addItem(w.index, 'socket')">＋р</button>
                <button class="tree__act" title="Удалить стену" @click.stop="removeWall(w.index)">×</button>
              </div>

              <div
                v-for="o in openingsOf(w.index)" :key="o.id"
                class="tree__row tree__row--item tree__row--nested tree__row--child"
                :class="{ 'is-active': state.openingId === o.id }"
                @click="selectOpening(o.id); revealProps()"
              >
                <span class="tree__dot" :class="o.kind"></span>
                <span class="tree__name">{{ openingKind(o.kind) }} · {{ o.w }}×{{ o.z1 - o.z0 }}</span>
                <span class="tree__meta">Z {{ o.z0 }}…{{ o.z1 }}</span>
                <button v-if="o.kind === 'door'" class="tree__act" @click.stop="toggleRoomDoor(o.id)">
                  {{ o.open ? 'закрыть' : 'открыть' }}
                </button>
                <button class="tree__act" title="Удалить" @click.stop="removeOpening(o.id)">×</button>
              </div>

              <div
                v-for="wi in itemsOf(w.index)" :key="wi.id"
                class="tree__row tree__row--item tree__row--nested tree__row--child"
                :class="{ 'is-active': state.wallItemId === wi.id }"
                @click="selectWallItem(wi.wall, wi.id); revealProps()"
              >
                <span class="tree__dot wallitem"></span>
                <span class="tree__name">{{ itemKind(wi.kind) }}</span>
                <span class="tree__meta">{{ wi.w }}×{{ wi.h }} · Z {{ wi.z }}</span>
                <button class="tree__act" title="Удалить" @click.stop="removeWallItem(wi.id)">×</button>
              </div>
              <div
                v-if="!openingsOf(w.index).length && !itemsOf(w.index).length"
                class="tree__row tree__row--nested dim"
              >пусто — добавьте окно/дверь/полку</div>
            </div>
          </template>

          <!-- ПОЛ / ПОТОЛОК -->
          <div
            class="tree__row tree__row--item tree__row--thumb"
            :class="{ 'is-active': floorSelected() }"
            @click="selectRoom('floor'); revealProps()"
          >
            <SurfaceThumb kind="floor" />
            <div class="tree__col">
              <span class="tree__name">Пол</span>
              <span class="tree__meta">{{ materialName('floor') }}</span>
            </div>
          </div>
          <div class="tree__row tree__row--group">
            <button class="tree__twist" @click="toggleExpand('finishes')">
              {{ isClosed('finishes') ? '▸' : '▾' }}
            </button>
            <span class="tree__name">Отделка · плитка/ламинат</span>
            <span class="tree__meta">{{ finishes.length }}</span>
            <button class="tree__act" title="Добавить отделку" @click="openFinish()">＋</button>
          </div>
          <template v-if="!isClosed('finishes')">
            <div
              v-for="f in finishes" :key="f.id"
              class="tree__row tree__row--item tree__row--nested tree__row--child"
              @click="openFinish(f.id)"
            >
              <span class="tree__dot" :style="{ background: f.color }"></span>
              <span class="tree__name">{{ f.name }}</span>
              <span class="tree__meta">{{ f.material }} · {{ finishMeta(f) }}</span>
              <button class="tree__act" title="Удалить" @click.stop="removeFinish(f.id)">×</button>
            </div>
            <div v-if="!finishes.length" class="tree__row tree__row--nested dim">
              Пока нет — добавьте плитку, ламинат или паркет
            </div>
          </template>

          <div
            class="tree__row tree__row--item tree__row--thumb"
            :class="{ 'is-active': state.roomSelected && state.roomNode === 'ceiling' }"
            @click="selectRoom('ceiling'); revealProps()"
          >
            <SurfaceThumb kind="ceiling" />
            <div class="tree__col">
              <span class="tree__name">Потолок</span>
              <span class="tree__meta">{{ materialName('ceiling') }}</span>
            </div>
          </div>
        </template>
      </template>

      <!-- МЕБЕЛЬ -->
      <template v-else>
        <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('groups')">
            {{ isClosed('groups') ? '▸' : '▾' }}
          </button>
          <span class="tree__name">Группы и комнаты</span>
          <span class="tree__meta">{{ folders.length }}</span>
          <button class="tree__act" title="Папка из выделения" @click="createFolder()">＋папка</button>
          <button class="tree__act" title="Комната как группа объектов"
            @click="createFolder('Комната ' + (state.project.folders.length + 1))">＋комната</button>
        </div>
        <template v-if="!isClosed('groups')">
          <div v-for="f in folders" :key="f.id" class="tree__folder">
            <div class="tree__row tree__row--group">
              <button class="tree__twist" @click="toggleExpand(f.id)">
                {{ isClosed(f.id) ? '▸' : '▾' }}
              </button>
              <span class="tree__name" @click="selectFolder(f.id); revealProps()">{{ f.name }}</span>
              <span class="tree__meta">{{ f.ids.length }}</span>
              <button class="tree__act" title="Добавить выделенные в папку" @click="onFolderAdd(f.id)">＋</button>
              <button class="tree__act" title="Удалить папку" @click="deleteFolder(f.id)">×</button>
            </div>
            <template v-if="!isClosed(f.id)">
              <InstanceNode
                v-for="id in f.ids" :key="id"
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

        <div class="tree__row tree__row--group">
          <button class="tree__twist" @click="toggleExpand('furniture')">
            {{ isClosed('furniture') ? '▸' : '▾' }}
          </button>
          <span class="tree__name">Мебель</span>
          <span class="tree__meta">{{ loose.length }}</span>
          <button class="tree__act" title="Выделить всё" @click="selectAll">всё</button>
        </div>
        <template v-if="!isClosed('furniture')">
          <InstanceNode v-for="inst in loose" :key="inst.id" :inst="inst" />
          <div v-if="!loose.length" class="tree__row tree__row--nested dim">
            Свободных модулей нет
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
