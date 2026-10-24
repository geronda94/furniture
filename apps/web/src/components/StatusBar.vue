<script setup lang="ts">
import { computed } from 'vue'
import {
  derived,
  selectedDerived,
  selectedInstance,
  state,
} from '../state/project'

const errs = computed(
  () => selectedDerived.value?.validation.errors.length ?? 0,
)
const warns = computed(
  () => selectedDerived.value?.validation.warnings.length ?? 0,
)
const totalCost = computed(() =>
  Object.values(derived).reduce((sum, d) => sum + (d.cost?.total ?? 0), 0),
)
</script>

<template>
  <footer class="statusbar">
    <span class="statusbar__item">
      Комната {{ state.project.room.w }} × {{ state.project.room.d }} ×
      {{ state.project.room.h }}
    </span>
    <span v-if="selectedInstance" class="statusbar__item">
      · Модуль {{ selectedInstance.params.W }} ×
      {{ selectedInstance.params.H }} × {{ selectedInstance.params.D }}
    </span>
    <span v-if="selectedDerived" class="statusbar__item">
      · {{ selectedDerived.totals.pieces }} деталей ·
      {{ selectedDerived.totals.sheets }} листов · КПД
      {{ selectedDerived.totals.kpd }}%
    </span>
    <span v-if="totalCost" class="statusbar__item">
      · смета {{ new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(totalCost) }} ₽
    </span>
    <span class="statusbar__spacer"></span>

    <span v-if="state.error" class="statusbar__item statusbar__error" :title="state.error">
      API: ошибка
    </span>
    <span v-else-if="errs" class="statusbar__item statusbar__error">
      ошибок: {{ errs }}
    </span>
    <span v-else-if="warns" class="statusbar__item statusbar__warn">
      предупр.: {{ warns }}
    </span>
    <span v-else class="statusbar__item statusbar__ok">валидатор: ок</span>

    <span v-if="state.busy" class="statusbar__item">расчёт…</span>
  </footer>
</template>
