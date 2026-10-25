<script setup lang="ts">
import { ref } from 'vue'
import MaterialLibrary from './MaterialLibrary.vue'
import type { Material } from '../render25d/types'
import {
  MATERIAL_ROLES,
  effectiveMaterials,
  instanceMaterialOverridden,
  resetInstanceMaterial,
  setMaterial,
  setTexture,
  state,
} from '../state/project'

const props = withDefaults(
  defineProps<{
    roles?: { key: string; label: string }[]
    /** если задан — правки применяются только к этому модулю */
    instanceId?: string
  }>(),
  { roles: () => MATERIAL_ROLES },
)

const inst = () =>
  props.instanceId
    ? state.project.instances.find((i) => i.id === props.instanceId) ?? null
    : null
const scoped = () => !!props.instanceId

const fileInput = ref<HTMLInputElement | null>(null)
const libRole = ref<string | null>(null)
let texRole = ''

function m(role: string): Material {
  const i = inst()
  const mats = i ? effectiveMaterials(i) : state.project.materials
  return mats[role]
}

function swatchStyle(role: string) {
  const mat = m(role)
  if (mat.texture) {
    return {
      backgroundImage: `url(${mat.texture})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return { background: mat.color }
}

function onColor(role: string, e: Event) {
  setMaterial(role, { color: (e.target as HTMLInputElement).value }, props.instanceId)
}

function onPattern(role: string, e: Event) {
  const pattern = (e.target as HTMLSelectElement).value as Material['pattern']
  setMaterial(role, { pattern }, props.instanceId)
}

function pickTexture(role: string) {
  texRole = role
  fileInput.value?.click()
}

function clearTexture(role: string) {
  setTexture(role, null, props.instanceId)
}

function resetRole(role: string) {
  if (props.instanceId) resetInstanceMaterial(props.instanceId, role)
}

function resetAll() {
  if (props.instanceId) resetInstanceMaterial(props.instanceId)
}

async function fileToTexture(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('image'))
    img.src = url
  })
  const size = 512
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2d')
  const s = Math.min(img.width, img.height)
  g.drawImage(
    img,
    (img.width - s) / 2,
    (img.height - s) / 2,
    s,
    s,
    0,
    0,
    size,
    size,
  )
  URL.revokeObjectURL(url)
  return c.toDataURL('image/jpeg', 0.86)
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !texRole) return
  try {
    const data = await fileToTexture(file)
    setTexture(texRole, data, props.instanceId)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <span>Материалы</span>
      <span class="dim">{{ scoped() ? 'только этот модуль' : 'весь проект' }}</span>
      <button
        v-if="scoped() && inst()?.materials"
        class="link"
        title="Вернуть все материалы проекта"
        @click="resetAll"
      >сбросить все</button>
    </div>
    <div class="panel__body">
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept="image/*"
        @change="onFile"
      />
      <div v-for="r in props.roles" :key="r.key" class="material-block">
        <div class="material-row">
          <span class="material-row__name" :title="m(r.key).name">
            {{ r.label }}
          </span>
          <label
            class="swatch"
            :style="swatchStyle(r.key)"
            :title="m(r.key).texture ? 'Реальная текстура' : m(r.key).name"
          >
            <input
              type="color"
              :value="m(r.key).color"
              @input="onColor(r.key, $event)"
            />
          </label>
          <select
            class="select"
            :value="m(r.key).pattern"
            @change="onPattern(r.key, $event)"
          >
            <option value="solid">Цвет</option>
            <option value="wood">Дерево</option>
            <option value="stone">Камень</option>
            <option value="metal">Металл</option>
          </select>
        </div>
        <div class="material-tools">
          <button class="link" @click="libRole = r.key">библиотека…</button>
          <button class="link" @click="pickTexture(r.key)">своя текстура…</button>
          <button
            v-if="m(r.key).texture"
            class="link"
            @click="clearTexture(r.key)"
          >
            без текстуры
          </button>
          <button
            v-if="scoped() && instanceMaterialOverridden(inst(), r.key)"
            class="link"
            title="Вернуть материал проекта"
            @click="resetRole(r.key)"
          >
            к проекту
          </button>
          <span v-if="m(r.key).texture" class="mat-dot"></span>
          <span v-else class="dim">процедурная</span>
        </div>
      </div>
    </div>
    <MaterialLibrary
      v-if="libRole"
      :role="libRole"
      :instance-id="props.instanceId"
      :label="props.roles.find((r) => r.key === libRole)?.label || libRole"
      @close="libRole = null"
    />
  </section>
</template>
