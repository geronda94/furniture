<script setup lang="ts">
import { ref } from 'vue'
import MaterialLibrary from './MaterialLibrary.vue'
import {
  addMaterialVar,
  createDefaultMaterialVars,
  moveMaterialVar,
  removeMaterialVar,
  state,
  updateMaterialVar,
} from '../state/project'
import {
  PART_LABELS,
  PART_ORDER,
} from '../material/vars'
import type {
  Material,
  MaterialPart,
  MaterialScope,
  MaterialVariable,
} from '../render25d/types'

const libVar = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const openVars = ref<Record<string, boolean>>({})
let texVar = ''

function isOpen(id: string): boolean {
  return openVars.value[id] ?? false
}

function toggleOpen(id: string): void {
  openVars.value = { ...openVars.value, [id]: !isOpen(id) }
}

function toggleAll(): void {
  const anyClosed = state.project.materialVars.some((v) => !isOpen(v.id))
  openVars.value = Object.fromEntries(
    state.project.materialVars.map((v) => [v.id, anyClosed]),
  )
}

function addVar(): void {
  addMaterialVar()
  const last = state.project.materialVars[state.project.materialVars.length - 1]
  if (last) openVars.value = { ...openVars.value, [last.id]: true }
}

function scopeLabel(v: MaterialVariable): string {
  return v.scope === 'floor' ? 'Напольные' : v.scope === 'wall' ? 'Навесные' : 'Все модули'
}

function partsSummary(v: MaterialVariable): string {
  if (v.parts.length <= 2) return v.parts.map((p) => PART_LABELS[p]).join(' · ')
  return `${v.parts.slice(0, 2).map((p) => PART_LABELS[p]).join(' · ')} +${v.parts.length - 2}`
}

const scopes: { id: MaterialScope; label: string }[] = [
  { id: 'all', label: 'Все модули' },
  { id: 'floor', label: 'Напольные' },
  { id: 'wall', label: 'Навесные' },
]

function swatch(v: MaterialVariable) {
  return v.material.texture
    ? {
        backgroundImage: `url(${v.material.texture})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: v.material.color }
}

function togglePart(v: MaterialVariable, part: MaterialPart): void {
  const parts = v.parts.includes(part)
    ? v.parts.filter((p) => p !== part)
    : [...v.parts, part]
  updateMaterialVar(v.id, { parts: parts.length ? parts : [part] })
}

function onScope(v: MaterialVariable, e: Event): void {
  updateMaterialVar(v.id, {
    scope: (e.target as HTMLSelectElement).value as MaterialScope,
  })
}

function onColor(v: MaterialVariable, e: Event): void {
  updateMaterialVar(v.id, {
    material: { color: (e.target as HTMLInputElement).value },
  })
}

function onPattern(v: MaterialVariable, e: Event): void {
  updateMaterialVar(v.id, {
    material: {
      pattern: (e.target as HTMLSelectElement).value as Material['pattern'],
    },
  })
}

function clearTexture(v: MaterialVariable): void {
  updateMaterialVar(v.id, { material: { texture: undefined } })
}

function pickTexture(v: MaterialVariable): void {
  texVar = v.id
  fileInput.value?.click()
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

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !texVar) return
  try {
    const texture = await fileToTexture(file)
    updateMaterialVar(texVar, { material: { texture } })
  } catch {
    /* ignore */
  }
}

function defaultSet(): void {
  if (
    state.project.materialVars.length &&
    !window.confirm('Заменить текущие переменные базовым набором?')
  ) return
  createDefaultMaterialVars(true)
  const first = state.project.materialVars[0]
  if (first) openVars.value = { [first.id]: true }
}

function onPick(payload: { material?: Material; texture?: string }): void {
  if (!libVar.value) return
  if (payload.material) {
    updateMaterialVar(libVar.value, {
      material: { ...payload.material, texture: payload.texture },
    })
  } else {
    updateMaterialVar(libVar.value, {
      material: { texture: payload.texture },
    })
  }
  libVar.value = null
}
</script>

<template>
  <section class="mvar">
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="image/*"
      @change="onFile"
    />

    <div class="mvar__head">
      <div>
        <b>Переменные материалов</b>
        <p class="dim mvar__hint">
          Декор + к каким элементам применяется. Ниже в списке — выше приоритет
          внутри одного охвата. Материал модуля перекрывает переменные.
        </p>
      </div>
      <div class="mvar__head-actions">
        <button class="btn btn--sm" @click="addVar">＋ переменная</button>
        <button class="btn btn--sm" @click="defaultSet">Базовый набор</button>
        <button
          v-if="state.project.materialVars.length"
          class="btn btn--ghost btn--sm"
          @click="toggleAll"
        >{{ state.project.materialVars.every((v) => isOpen(v.id)) ? 'Свернуть' : 'Развернуть' }}</button>
      </div>
    </div>

    <div v-if="!state.project.materialVars.length" class="mvar__empty">
      <p>
        Пока переменных нет — используются материалы проекта по ролям.
        Базовый набор создаст готовые правила для напольного и навесного
        корпуса, фасадов, ящиков и полок.
      </p>
      <div class="mvar__empty-actions">
        <button class="btn btn--primary btn--sm" @click="defaultSet">Создать базовый набор</button>
        <button class="btn btn--sm" @click="addVar">Создать свою</button>
      </div>
    </div>

    <article
      v-for="(v, i) in state.project.materialVars"
      :key="v.id"
      class="mvar__card"
      :class="{ 'mvar__card--off': !v.enabled }"
    >
      <header class="mvar__row mvar__card-head">
        <button
          class="mvar__toggle"
          :title="isOpen(v.id) ? 'Свернуть' : 'Развернуть'"
          :aria-expanded="isOpen(v.id)"
          @click="toggleOpen(v.id)"
        >{{ isOpen(v.id) ? '▾' : '▸' }}</button>
        <span class="mvar__mini" :style="swatch(v)" :title="v.material.name"></span>
        <div class="mvar__title">
          <input
            class="input mvar__name"
            :value="v.name"
            @change="updateMaterialVar(v.id, { name: ($event.target as HTMLInputElement).value })"
          />
          <span class="mvar__meta">
            {{ scopeLabel(v) }} · {{ partsSummary(v) }}
            <template v-if="!v.enabled"> · выключена</template>
          </span>
        </div>
        <button
          class="btn btn--sm"
          :class="{ 'btn--primary': v.enabled }"
          :title="v.enabled ? 'Выключить' : 'Включить'"
          @click="updateMaterialVar(v.id, { enabled: !v.enabled })"
        >{{ v.enabled ? 'вкл' : 'выкл' }}</button>
        <button class="btn btn--sm mvar__move" :disabled="i === 0" title="Выше" @click="moveMaterialVar(v.id, -1)">↑</button>
        <button class="btn btn--sm mvar__move" :disabled="i === state.project.materialVars.length - 1" title="Ниже" @click="moveMaterialVar(v.id, 1)">↓</button>
        <button class="btn btn--sm mvar__danger" title="Удалить" @click="removeMaterialVar(v.id)">×</button>
      </header>

      <div v-if="isOpen(v.id)" class="mvar__body">
      <div class="mvar__row mvar__row--wrap">
        <label class="mvar__swatch" :style="swatch(v)" :title="v.material.name">
          <input type="color" :value="v.material.color" @input="onColor(v, $event)" />
        </label>
        <select class="select mvar__scope" :value="v.scope" @change="onScope(v, $event)">
          <option v-for="s in scopes" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <select class="select mvar__pattern" :value="v.material.pattern" @change="onPattern(v, $event)">
          <option value="solid">Цвет</option>
          <option value="wood">Дерево</option>
          <option value="stone">Камень</option>
          <option value="metal">Металл</option>
        </select>
        <button class="link" @click="libVar = v.id">библиотека…</button>
        <button class="link" @click="pickTexture(v)">своя текстура…</button>
        <button v-if="v.material.texture" class="link" @click="clearTexture(v)">без текстуры</button>
      </div>

      <div class="mvar__parts">
        <button
          v-for="p in PART_ORDER"
          :key="p"
          class="chip"
          :class="{ 'chip--on': v.parts.includes(p) }"
          @click="togglePart(v, p)"
        >{{ PART_LABELS[p] }}</button>
      </div>
      </div>
    </article>

    <MaterialLibrary
      v-if="libVar"
      mode="pick"
      role=""
      :label="state.project.materialVars.find((v) => v.id === libVar)?.name || 'Материал'"
      @pick="onPick"
      @close="libVar = null"
    />
  </section>
</template>
