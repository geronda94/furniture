<script setup lang="ts">
import { computed } from 'vue'
import NumField from './NumField.vue'
import {
  derived,
  kindIsOpen,
  openDetail,
  partSelection,
  renameInstance,
  runners,
  rotateInstance,
  selectedDerived,
  selectedInstance,
  setRoom,
  state,
  toggleDoors,
  toggleDrawers,
  updateParams,
  type Frame,
  type Hardware,
} from '../state/project'
import { moduleInfo, sizeLabel } from '../module/info'

const inst = selectedInstance

const partEl = computed(() => {
  if (!inst.value || partSelection.instanceId !== inst.value.id) return null
  if (partSelection.part == null) return null
  const info = moduleInfo(inst.value, derived[inst.value.id]?.objects)
  return info?.elements[partSelection.part] ?? null
})

function onName(e: Event) {
  if (!inst.value) return
  renameInstance(inst.value.id, (e.target as HTMLInputElement).value)
}

function onFrame(e: Event) {
  updateParams({ frame: (e.target as HTMLSelectElement).value as Frame })
}

function onHardware(e: Event) {
  updateParams({ hardware: (e.target as HTMLSelectElement).value as Hardware })
}

function onRunners(e: Event) {
  updateParams({ runners: (e.target as HTMLSelectElement).value })
}

const stats = () => selectedDerived.value?.totals
const issues = () => selectedDerived.value?.validation
</script>

<template>
  <section class="panel">
    <div class="panel__head">Комната</div>
    <div class="panel__body">
      <div class="field-row field-row--3">
        <NumField
          label="Ширина"
          :value="state.project.room.w"
          :min="1200"
          :max="12000"
          :step="50"
          @change="setRoom({ w: $event })"
        />
        <NumField
          label="Глубина"
          :value="state.project.room.d"
          :min="1200"
          :max="12000"
          :step="50"
          @change="setRoom({ d: $event })"
        />
        <NumField
          label="Высота"
          :value="state.project.room.h"
          :min="2000"
          :max="4500"
          :step="50"
          @change="setRoom({ h: $event })"
        />
      </div>
      <div class="field-row">
        <NumField
          label="Толщина стен"
          :value="state.project.room.wallT"
          :min="40"
          :max="300"
          :step="10"
          @change="setRoom({ wallT: $event })"
        />
      </div>
    </div>
  </section>

  <section class="panel">
    <div class="panel__head">
      <span>Модуль</span>
      <span v-if="inst" class="dim">{{ inst.name }}</span>
    </div>
    <div v-if="!inst" class="panel__body dim">
      Ничего не выбрано. Выбери модуль в списке, на плане или в 2.5D.
    </div>
    <div v-else class="panel__body">
      <label class="field module-name">
        <span class="field__label">Название</span>
        <input
          class="input"
          :value="inst.name"
          aria-label="Название модуля"
          @change="onName"
        />
      </label>

      <div class="field-row field-row--3">
        <NumField
          label="Ширина"
          :value="inst.params.W"
          :min="200"
          :max="3000"
          :step="10"
          @change="updateParams({ W: $event })"
        />
        <NumField
          label="Высота"
          :value="inst.params.H"
          :min="200"
          :max="2600"
          :step="10"
          @change="updateParams({ H: $event })"
        />
        <NumField
          label="Глубина"
          :value="inst.params.D"
          :min="200"
          :max="900"
          :step="10"
          @change="updateParams({ D: $event })"
        />
      </div>

      <div class="field-row field-row--3">
        <NumField
          label="Двери"
          :value="inst.params.doors"
          :min="0"
          :max="6"
          :step="1"
          @change="updateParams({ doors: $event })"
        />
        <NumField
          label="Ящики"
          :value="inst.params.drawers"
          :min="0"
          :max="6"
          :step="1"
          @change="updateParams({ drawers: $event })"
        />
        <NumField
          label="Полки"
          :value="inst.params.shelves"
          :min="0"
          :max="8"
          :step="1"
          @change="updateParams({ shelves: $event })"
        />
      </div>

      <div class="field-row">
        <label class="field">
          <span class="field__label">Поворот</span>
          <div class="rotate-row">
            <button
              class="btn btn--sm"
              title="Развернуть против часовой на 90°"
              @click="rotateInstance(inst.id, -90)"
            >
              ⟲
            </button>
            <span class="rotate-value">{{ inst.rot }}°</span>
            <button
              class="btn btn--sm"
              title="Развернуть на 90° (R)"
              @click="rotateInstance(inst.id, 90)"
            >
              ⟳
            </button>
          </div>
        </label>
      </div>

      <label v-if="inst.params.drawers > 0" class="field">
        <span class="field__label">Направляющие ящиков</span>
        <select class="select" :value="inst.params.runners" @change="onRunners">
          <option v-for="r in runners" :key="r.id" :value="r.id">
            {{ r.name }} · зазор {{ r.side_gap }} мм
          </option>
        </select>
      </label>

      <div class="field-row">
        <button
          class="btn btn--sm"
          :class="{ 'btn--primary': kindIsOpen(inst, 'door') }"
          :disabled="inst.params.doors === 0"
          @click="toggleDoors(inst.id)"
        >
          Двери: {{ kindIsOpen(inst, 'door') ? 'открыты' : 'закрыты' }}
        </button>
        <button
          class="btn btn--sm"
          :class="{ 'btn--primary': kindIsOpen(inst, 'drawer') }"
          :disabled="inst.params.drawers === 0"
          @click="toggleDrawers(inst.id)"
        >
          Ящики: {{ kindIsOpen(inst, 'drawer') ? 'выдвинуты' : 'закрыты' }}
        </button>
      </div>

      <div class="field-row">
        <label class="field">
          <span class="field__label">Каркас</span>
          <select class="select" :value="inst.params.frame" @change="onFrame">
            <option value="inset">Вкладной</option>
            <option value="overlay">Накладной</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Петли</span>
          <select
            class="select"
            :value="inst.params.hardware"
            @change="onHardware"
          >
            <option value="blum">Blum</option>
            <option value="hettich">Hettich</option>
            <option value="gtv">GTV</option>
          </select>
        </label>
      </div>

      <div class="field-row">
        <button
          class="btn btn--sm"
          @click="inst && openDetail(inst.id, partEl?.index ?? null)"
        >
          Размеры и элементы
        </button>
      </div>

      <div v-if="partEl" class="part-card">
        <span class="part-card__name">{{ partEl.title }}</span>
        <span class="part-card__size">{{ sizeLabel(partEl) }} мм</span>
      </div>

      <div v-if="stats()" class="stats">
        <div class="stat">
          <div class="stat__k">позиций</div>
          <div class="stat__v">{{ stats()!.positions }}</div>
        </div>
        <div class="stat">
          <div class="stat__k">деталей</div>
          <div class="stat__v">{{ stats()!.pieces }}</div>
        </div>
        <div class="stat">
          <div class="stat__k">листов</div>
          <div class="stat__v">{{ stats()!.sheets }}</div>
        </div>
        <div class="stat">
          <div class="stat__k">КПД</div>
          <div class="stat__v">{{ stats()!.kpd }}%</div>
        </div>
      </div>

      <template v-if="issues()">
        <ul v-if="issues()!.errors.length" class="issues">
          <li v-for="(e, i) in issues()!.errors" :key="i">{{ e }}</li>
        </ul>
        <ul v-if="issues()!.warnings.length" class="issues">
          <li
            v-for="(w, i) in issues()!.warnings"
            :key="i"
            class="is-warn"
          >
            {{ w }}
          </li>
        </ul>
      </template>
    </div>
  </section>

</template>
