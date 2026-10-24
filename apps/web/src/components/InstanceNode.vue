<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  deleteInstance,
  derived,
  duplicateInstance,
  folderOf,
  partSelection,
  removeFromFolder,
  revealProps,
  select,
  selectPart,
  state,
  toggleSelection,
  updateParams,
  type Instance,
} from '../state/project'
import { moduleInfo, sizeLabel } from '../module/info'
import Thumb from './Thumb.vue'

const props = defineProps<{ inst: Instance; nested?: boolean }>()
const open = ref(false)
const openGroups = ref<Record<string, boolean>>({})

const info = computed(() => moduleInfo(props.inst, derived[props.inst.id]?.objects))
const selected = computed(() => state.selected.includes(props.inst.id))
const folder = computed(() => folderOf(props.inst.id))
const rowEl = ref<HTMLElement | null>(null)

watch(selected, (on) => {
  if (on && rowEl.value) {
    rowEl.value.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
})

function onRow(e: MouseEvent): void {
  if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelection(props.inst.id)
  else select(props.inst.id)
  revealProps()
}

function onPart(part: number): void {
  select(props.inst.id)
  selectPart(props.inst.id, part)
  revealProps()
}

function isPartActive(part: number): boolean {
  return (
    partSelection.instanceId === props.inst.id &&
    partSelection.part === part
  )
}

function addShelves(): void {
  select(props.inst.id)
  updateParams({ shelves: props.inst.params.shelves + 1 })
}
function addDoors(): void {
  select(props.inst.id)
  updateParams({ doors: props.inst.params.doors + 1 })
}
function addDrawers(): void {
  select(props.inst.id)
  updateParams({ drawers: props.inst.params.drawers + 1 })
}
function delShelves(): void {
  if (props.inst.params.shelves <= 0) return
  select(props.inst.id)
  updateParams({ shelves: props.inst.params.shelves - 1 })
}
function delDoors(): void {
  if (props.inst.params.doors <= 0) return
  select(props.inst.id)
  updateParams({ doors: props.inst.params.doors - 1 })
}
function delDrawers(): void {
  if (props.inst.params.drawers <= 0) return
  select(props.inst.id)
  updateParams({ drawers: props.inst.params.drawers - 1 })
}

function toggleGroup(key: string): void {
  openGroups.value = { ...openGroups.value, [key]: !openGroups.value[key] }
}
</script>

<template>
  <div class="tree__instance">
    <div
      ref="rowEl"
      class="tree__row tree__row--item tree__row--thumb"
      :class="{ 'is-active': selected, 'tree__row--nested': nested }"
      @click="onRow"
    >
      <button class="tree__twist" @click.stop="open = !open">
        {{ open ? '▾' : '▸' }}
      </button>
      <Thumb :instance-id="inst.id" :width="72" :height="54" />
      <div class="tree__col">
        <span class="tree__name">{{ inst.name || 'Модуль' }}</span>
        <span class="tree__meta">
          {{ inst.params.W }}×{{ inst.params.H }}×{{ inst.params.D }}
          <template v-if="inst.z"> · Z{{ inst.z }}</template>
        </span>
      </div>
      <button class="tree__act" title="Дублировать" @click.stop="duplicateInstance(inst.id)">
        ⧉
      </button>
      <button class="tree__act" title="Удалить" @click.stop="deleteInstance(inst.id)">
        ×
      </button>
    </div>

    <div v-if="open" class="tree__subs">
      <div v-if="folder" class="tree__hint">
        в папке «{{ folder.name }}»
        <button class="link" @click="removeFromFolder(folder.id, inst.id)">
          вынуть
        </button>
      </div>

      <div class="tree__hint tree__hint--actions">
        субобъекты
        <span class="tree__sep"></span>
        <button class="tree__act" title="Добавить полку" @click="addShelves">＋полка</button>
        <button class="tree__act" title="Убрать полку" :disabled="!inst.params.shelves" @click="delShelves">−</button>
        <button class="tree__act" title="Добавить дверь" @click="addDoors">＋дверь</button>
        <button class="tree__act" title="Убрать дверь" :disabled="!inst.params.doors" @click="delDoors">−</button>
        <button class="tree__act" title="Добавить ящик" @click="addDrawers">＋ящик</button>
        <button class="tree__act" title="Убрать ящик" :disabled="!inst.params.drawers" @click="delDrawers">−</button>
      </div>

      <template v-if="info">
        <div v-for="g in info.groups" :key="g.key" class="tree__group">
          <div class="tree__row tree__row--sub" @click="toggleGroup(g.key)">
            <button class="tree__twist">
              {{ openGroups[g.key] ? '▾' : '▸' }}
            </button>
            <span class="tree__name">{{ g.label }}</span>
            <span class="tree__meta">{{ g.elements.length }}</span>
          </div>
          <template v-if="openGroups[g.key]">
            <div
              v-for="e in g.elements"
              :key="e.index"
              class="tree__row tree__row--part"
              :class="{ 'is-active': isPartActive(e.index) }"
              @click="onPart(e.index)"
            >
              <span class="tree__name">{{ e.title }}</span>
              <span class="tree__meta">{{ sizeLabel(e) }}</span>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>
