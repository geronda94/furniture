<script setup lang="ts">
import type { Opening, WallIndex } from '../render25d/types'
import {
  addOpening,
  removeOpening,
  state,
  toggleRoomDoor,
  updateOpening,
  wallLength,
} from '../state/project'

function num(o: Opening, key: 'x' | 'w' | 'z0' | 'z1', e: Event) {
  const v = (e.target as HTMLInputElement).valueAsNumber
  if (Number.isFinite(v)) updateOpening(o.id, { [key]: v })
}

function onWall(o: Opening, e: Event) {
  const v = Number((e.target as HTMLSelectElement).value) as WallIndex
  updateOpening(o.id, { wall: v })
}

function maxOffset(o: Opening) {
  return Math.max(0, wallLength(o.wall, state.project.room) - o.w)
}
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <span>Окна и двери</span>
      <span class="dim">{{ state.project.room.openings.length }}</span>
    </div>
    <div class="panel__body">
      <div class="panel__actions">
        <button class="btn btn--sm" @click="addOpening('window')">
          + Окно
        </button>
        <button class="btn btn--sm" @click="addOpening('door')">
          + Дверь
        </button>
      </div>

      <div
        v-for="o in state.project.room.openings"
        :key="o.id"
        class="opening"
      >
        <div class="opening__head">
          <span
            class="badge"
            :class="o.kind === 'window' ? 'badge--warn' : 'badge--ok'"
          >
            {{ o.kind === 'window' ? 'Окно' : 'Дверь' }}
          </span>
          <button class="link" @click="removeOpening(o.id)">удалить</button>
        </div>

        <div class="field-row field-row--3">
          <label class="field">
            <span class="field__label">Стена</span>
            <select
              class="select"
              :value="o.wall"
              aria-label="Стена проёма"
              @change="onWall(o, $event)"
            >
              <option :value="0">Задняя</option>
              <option :value="1">Правая</option>
              <option :value="3">Левая</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Отступ</span>
            <input
              class="input"
              type="number"
              step="50"
              min="0"
              :max="maxOffset(o)"
              :value="o.x"
              aria-label="Отступ проёма"
              @change="num(o, 'x', $event)"
            />
          </label>
          <label class="field">
            <span class="field__label">Ширина</span>
            <input
              class="input"
              type="number"
              step="50"
              min="200"
              :value="o.w"
              aria-label="Ширина проёма"
              @change="num(o, 'w', $event)"
            />
          </label>
        </div>

        <button
          v-if="o.kind === 'door'"
          class="btn btn--sm"
          :class="{ 'btn--primary': o.open }"
          @click="toggleRoomDoor(o.id)"
        >
          {{ o.open ? 'Закрыть дверь' : 'Открыть дверь' }}
        </button>

        <div class="field-row">
          <label class="field">
            <span class="field__label">Низ, мм</span>
            <input
              class="input"
              type="number"
              step="50"
              min="0"
              :value="o.z0"
              aria-label="Низ проёма"
              @change="num(o, 'z0', $event)"
            />
          </label>
          <label class="field">
            <span class="field__label">Верх, мм</span>
            <input
              class="input"
              type="number"
              step="50"
              min="0"
              :value="o.z1"
              aria-label="Верх проёма"
              @change="num(o, 'z1', $event)"
            />
          </label>
        </div>
      </div>

      <div v-if="!state.project.room.openings.length" class="dim">
        Проёмов нет.
      </div>
    </div>
  </section>
</template>
