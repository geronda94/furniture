<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useModalDrag } from '../composables/useModalDrag'
import NumField from './NumField.vue'
import ModuleWorkbench from './ModuleWorkbench.vue'
import ContextProps from './ContextProps.vue'
import {
  closeObjectModal,
  deleteInstance,
  deleteSelection,
  duplicateInstance,
  duplicateSelection,
  derived,
  kindIsOpen,
  partSelection,
  pushSelection,
  rotateInstance,
  rotateSelection,
  selectedInstance,
  pointer,
  setInstancePosition,
  setObjectModalMode,
  state,
  toggleDoors,
  toggleDrawers,
  toggleZLock,
  ui,
} from '../state/project'
import { roomWalls } from '../render25d/room'
import { moduleInfo, relationsFor, sizeLabel } from '../module/info'

const winEl = ref<HTMLElement | null>(null)
const { style: dragStyle, onDown: onDragStart, reset: resetDrag } = useModalDrag(winEl)
const dock = ref({ left: 0, top: 0, width: 560, height: 600 })
const pos = ref({ x: 0, y: 0 })
let viewRo: ResizeObserver | null = null

const inst = selectedInstance
const full = computed(() => ui.object.mode === 'full' && !!inst.value)
const partEl = computed(() => {
  if (!inst.value || partSelection.instanceId !== inst.value.id) return null
  if (partSelection.part == null) return null
  const info = moduleInfo(inst.value, derived[inst.value.id]?.objects)
  return info?.elements[partSelection.part] ?? null
})
const partRel = computed(() => {
  if (!inst.value || partSelection.part == null) return null
  const info = moduleInfo(inst.value, derived[inst.value.id]?.objects)
  return info ? relationsFor(info, partSelection.part) : null
})
const group = computed(() =>
  state.selected.length > 1
    ? state.selected
        .map((id) => state.project.instances.find((i) => i.id === id))
        .filter((i) => !!i)
    : [],
)
const wall = computed(() =>
  state.wallIndex != null
    ? roomWalls(state.project.room).find((w) => w.index === state.wallIndex)
    : null,
)
const title = computed(() => {
  if (group.value.length) return `Выделено: ${group.value.length}`
  if (inst.value) return inst.value.name || 'Модуль'
  if (wall.value) {
    return wall.value.outer
      ? `Стена ${wall.value.index + 1}`
      : `Перегородка ${wall.value.index + 1}`
  }
  if (state.openingId) return 'Проём'
  if (state.folderId) return 'Папка'
  if (state.roomSelected && state.roomNode === 'floor') return 'Пол'
  if (state.roomSelected && state.roomNode === 'ceiling') return 'Потолок'
  if (state.roomSelected) return 'Комната'
  return 'Объект'
})
const subtitle = computed(() => {
  if (group.value.length) return 'групповые действия'
  if (inst.value) {
    const p = inst.value.params
    return `${p.W}×${p.H}×${p.D}${p.mount === 'wall' ? ' · навесной' : ''}`
  }
  if (wall.value) return `${Math.round(wall.value.len)} мм`
  if (state.openingId) return 'на стене'
  if (state.roomSelected) return 'комната'
  return ''
})

function viewBody(): HTMLElement | null {
  return document.querySelector('.view__body') as HTMLElement | null
}

function dockFraction(): number {
  return 0.58
}

function leftFraction(): number {
  const body = viewBody()
  if (!body) return 0.38
  const r = body.getBoundingClientRect()
  return Math.max(0.2, 1 - dock.value.width / Math.max(1, r.width))
}

function updateDock(): void {
  const body = viewBody()
  if (!body) return
  const r = body.getBoundingClientRect()
  const width = Math.max(420, Math.min(r.width * dockFraction(), r.width - 64))
  dock.value = {
    left: r.left + r.width - width,
    top: r.top,
    width,
    height: r.height,
  }
  state.objectLeft = leftFraction()
  resetDrag()
}

function placeNearPointer(): void {
  const w = Math.min(390, window.innerWidth - 16)
  const h = Math.min(winEl.value?.offsetHeight || 480, window.innerHeight - 100)
  const sidebar = document.querySelector('.sidebar') as HTMLElement | null
  const sideLeft = sidebar ? sidebar.getBoundingClientRect().left : window.innerWidth
  const nearSidebar = pointer.x >= sideLeft - 8
  const x = nearSidebar ? sideLeft - w - 12 : pointer.x + 16
  const y = pointer.y + 12
  pos.value = {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(86, y), Math.max(86, window.innerHeight - h - 8)),
  }
  resetDrag()
}

function syncPlacement(): void {
  if (full.value) updateDock()
  else placeNearPointer()
}

function close(): void {
  closeObjectModal()
}
function back(): void {
  setObjectModalMode('quick')
}
function toFull(): void {
  setObjectModalMode('full')
}
function setPos(key: 'x' | 'y' | 'z', value: number): void {
  if (inst.value) setInstancePosition(inst.value.id, { [key]: value })
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  syncPlacement()
  const body = viewBody()
  if (body) {
    viewRo = new ResizeObserver(() => {
      if (full.value) updateDock()
    })
    viewRo.observe(body)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  viewRo?.disconnect()
})

// если выделение снято снаружи — модалка закрывается
watch(
  () => [state.selection, state.openingId, state.folderId,
    state.roomSelected, state.wallIndex, state.selected.length] as const,
  () => {
    if (!state.selection && !state.openingId && !state.folderId &&
      !state.roomSelected && state.wallIndex == null) close()
    else nextTick(syncPlacement)
  },
)
watch(() => ui.object.mode, () => nextTick(syncPlacement))
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--object">
      <section
        ref="winEl"
        class="modal__win object-modal"
        :class="{ 'object-modal--full': full }"
        :style="[dragStyle, full
          ? {
              left: `${dock.left}px`,
              top: `${dock.top}px`,
              width: `${dock.width}px`,
              height: `${dock.height}px`,
            }
          : {
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              width: '390px',
              height: 'auto',
            }]"
        @pointerdown.stop
      >
        <header class="modal__head" @pointerdown="onDragStart">
          <button
            v-if="full"
            class="btn btn--ghost btn--sm object-modal__back"
            title="Назад к быстрым действиям"
            @click="back"
          >←</button>
          <span class="modal__title">{{ title }}</span>
          <span class="modal__sub">{{ subtitle }}</span>
          <div class="modal__tools">
            <button
              v-if="inst"
              class="tab"
              :class="{ 'tab--active': ui.dims3d }"
              title="Показывать размеры на 3D"
              @click="ui.dims3d = !ui.dims3d"
            >Размеры</button>
            <button
              v-if="inst"
              class="tab"
              :class="{ 'tab--active': ui.facades }"
              title="Показывать или скрыть фасады"
              @click="ui.facades = !ui.facades"
            >Фасады</button>
            <button class="btn btn--ghost btn--sm" title="Закрыть (Esc)" @click="close">×</button>
          </div>
        </header>

        <!-- БЫСТРЫЕ ДЕЙСТВИЯ: МОДУЛЬ -->
        <div v-if="inst && !full" class="om">
          <div v-if="partEl" class="wb__side-sel">
            <div class="wb__side-sel-head">
              <b>{{ partEl.title }}</b>
              <span>{{ sizeLabel(partEl) }} мм</span>
            </div>
            <ul v-if="partRel" class="wb__rel">
              <li v-if="partRel.above"><span>↑ {{ partRel.above.label }}</span><b>{{ partRel.above.distance }} мм</b></li>
              <li v-if="partRel.below"><span>↓ {{ partRel.below.label }}</span><b>{{ partRel.below.distance }} мм</b></li>
              <li v-if="partRel.left"><span>← {{ partRel.left.label }}</span><b>{{ partRel.left.distance }} мм</b></li>
              <li v-if="partRel.right"><span>→ {{ partRel.right.label }}</span><b>{{ partRel.right.distance }} мм</b></li>
            </ul>
          </div>

          <div class="om__label">Положение <span class="dim">в комнате, мм</span></div>
          <div class="om__coords">
            <NumField label="X" :value="inst.x" :min="0" :step="10" @change="setPos('x', $event)" />
            <NumField label="Y" :value="inst.y" :min="0" :step="10" @change="setPos('y', $event)" />
            <div class="om__z">
              <NumField
                label="Z"
                :value="inst.z"
                :min="0"
                :step="10"
                :disabled="inst.zLocked"
                @change="setPos('z', $event)"
              />
              <button
                class="btn btn--sm om__lock"
                :class="{ 'btn--primary': !inst.zLocked }"
                :title="inst.zLocked ? 'Разблокировать Z' : 'Заблокировать Z'"
                @click="toggleZLock(inst.id)"
              >{{ inst.zLocked ? '🔒' : '🔓' }}</button>
            </div>
          </div>

          <div class="om__toggles">
            <button
              class="btn btn--sm"
              :class="{ 'btn--primary': kindIsOpen(inst, 'door') }"
              :disabled="!inst.params.doors"
              @click="toggleDoors(inst.id)"
            >Двери: {{ kindIsOpen(inst, 'door') ? 'открыты' : 'закрыты' }}</button>
            <button
              class="btn btn--sm"
              :class="{ 'btn--primary': kindIsOpen(inst, 'drawer') }"
              :disabled="!inst.params.drawers"
              @click="toggleDrawers(inst.id)"
            >Ящики: {{ kindIsOpen(inst, 'drawer') ? 'выдвинуты' : 'закрыты' }}</button>
          </div>

          <div class="om__actions">
            <button class="btn btn--sm" @click="rotateInstance(inst.id, 90)">⟳ 90°</button>
            <button class="btn btn--sm" @click="duplicateInstance(inst.id)">Дублировать</button>
            <button class="btn btn--sm om__danger" @click="deleteInstance(inst.id)">Удалить</button>
          </div>
          <div class="om__actions">
            <span class="dim om__push-label">К стене:</span>
            <button class="btn btn--sm" title="Влево" @click="pushSelection('left')">⟵</button>
            <button class="btn btn--sm" title="Вправо" @click="pushSelection('right')">⟶</button>
            <button class="btn btn--sm" title="Назад" @click="pushSelection('back')">↑</button>
            <button class="btn btn--sm" title="Вперёд" @click="pushSelection('front')">↓</button>
          </div>

          <button class="btn btn--primary om__full-btn" @click="toFull">
            Детали и конструктор · раскрой
          </button>
          <p class="dim om__hint">
            Движение мышью по 3D выключено — включить можно кнопкой «Двигать» в шапке 3D.
          </p>
        </div>
        <!-- ГРУППА -->
        <div v-else-if="group.length" class="om">
          <p class="dim om__hint">Действия применяются ко всем выделенным модулям.</p>
          <div class="om__actions">
            <button class="btn btn--sm" @click="rotateSelection(90)">⟳ Повернуть 90°</button>
            <button class="btn btn--sm" @click="duplicateSelection">Дублировать</button>
            <button class="btn btn--sm om__danger" @click="deleteSelection">Удалить</button>
          </div>
          <ul class="detail__list">
            <li v-for="i in group" :key="i!.id">
              <span class="detail__name">{{ i!.name }}</span>
              <span class="detail__size">{{ i!.params.W }}×{{ i!.params.H }}×{{ i!.params.D }}</span>
            </li>
          </ul>
        </div>

        <!-- ДЕТАЛЬНЫЙ РЕЖИМ -->
        <div v-else-if="inst" class="object-modal__body">
          <ModuleWorkbench :instance-id="inst.id" />
        </div>

        <!-- КОМНАТА / СТЕНА / ПРОЁМ / ПАПКА -->
        <div v-else class="object-modal__body object-modal__body--ctx">
          <ContextProps />
        </div>
      </section>
    </div>
  </Teleport>
</template>
