<script setup lang="ts">
import { computed } from 'vue'
import {
  checkLayout,
  derived,
  layoutState,
  selectedDerived,
  selectedInstance,
  state,
  ui,
} from '../state/project'

const errs = computed(
  () => selectedDerived.value?.validation.errors.length ?? 0,
)
const warns = computed(
  () => selectedDerived.value?.validation.warnings.length ?? 0,
)
const totalCost = computed(() =>
  Object.values(derived).reduce(
    (sum, d) => sum + (d.cost?.total_with_vat ?? d.cost?.total ?? 0),
    0,
  ),
)
const costMeta = computed(() => {
  const first = Object.values(derived).find((d) => d.cost)?.cost
  return {
    locale: first?.locale || 'ru-RU',
    symbol: first?.symbol || first?.currency || '',
    market: first?.market_name || '',
    shop: first?.shop_name || '',
    draft: !!first?.draft,
  }
})

function openPricing(): void {
  ui.settingsTab = 'pricing'
  ui.settingsOpen = true
}

/** Один следующий шаг: ровно одно действие, без выбора из пяти кнопок. */
const nextStep = computed<{ label: string; hint: string; run: () => void; tone: string } | null>(() => {
  if (layoutState.busy && !layoutState.checkedAt) {
    return null
  }
  if (layoutState.errors) {
    return {
      label: `Исправить расстановку (${layoutState.errors})`,
      hint: 'Показать, что мешает: стены, проёмы, зазоры',
      tone: 'error',
      run: () => { ui.layoutOpen = true },
    }
  }
  const modules = state.project.instances.length
  if (!modules) {
    return {
      label: 'Добавьте модуль',
      hint: 'Начните с кухни, шкафа или готового объекта',
      tone: 'accent',
      run: () => { ui.addOpen = true },
    }
  }
  if (layoutState.warnings) {
    return {
      label: `Проверить предупреждения (${layoutState.warnings})`,
      hint: 'Проект можно отдавать, но лучше разобрать',
      tone: 'warn',
      run: () => { ui.layoutOpen = true },
    }
  }
  return {
    label: 'Скачайте проект',
    hint: 'Смета, раскрой, присадка, фурнитура и PDF одним пакетом',
    tone: 'ok',
    run: () => { ui.resultOpen = true },
  }
})
</script>

<template>
  <footer class="statusbar">
    <span class="statusbar__item">
      Комната {{ state.project.room.w }} × {{ state.project.room.d }} ×
      {{ state.project.room.h }}
    </span>
    <span v-if="selectedInstance" class="statusbar__item">
      · Модуль {{ selectedInstance.params.W }} ×
      {{ selectedDerived?.dims?.outer?.H_total ?? selectedInstance.params.H }} ×
      {{ selectedInstance.params.D }}
    </span>
    <span v-if="selectedDerived" class="statusbar__item">
      · {{ selectedDerived.totals.pieces }} деталей ·
      {{ selectedDerived.totals.sheets }} листов · КПД
      {{ selectedDerived.totals.kpd }}%
    </span>
    <button
      v-if="totalCost" class="statusbar__item statusbar__cost"
      title="Открыть рынок / цех / поставщика"
      @click="openPricing"
    >
      · смета {{ new Intl.NumberFormat(costMeta.locale, { maximumFractionDigits: 0 }).format(totalCost) }} {{ costMeta.symbol }}
      <span class="dim">{{ costMeta.market }}<template v-if="costMeta.shop"> · {{ costMeta.shop }}</template></span>
      <span v-if="costMeta.draft" class="statusbar__draft">заготовка</span>
    </button>
    <span class="statusbar__spacer"></span>

    <button
      v-if="layoutState.busy && !layoutState.checkedAt"
      class="statusbar__item"
      title="Проверяем расстановку"
      @click="checkLayout"
    >расстановка…</button>
    <button
      v-else-if="layoutState.errors"
      class="statusbar__item statusbar__error"
      :title="layoutState.issues.filter(i => i.level === 'error').map(i => i.message).join(' · ')"
      @click="ui.layoutOpen = true"
    >расстановка: ошибок {{ layoutState.errors }}</button>
    <button
      v-else-if="layoutState.warnings"
      class="statusbar__item statusbar__warn"
      :title="layoutState.issues.filter(i => i.level !== 'error').map(i => i.message).join(' · ')"
      @click="ui.layoutOpen = true"
    >расстановка: предупр. {{ layoutState.warnings }}</button>
    <span v-else-if="layoutState.checkedAt" class="statusbar__item statusbar__ok">
      расстановка: ок
    </span>

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

    <button
      v-if="nextStep"
      class="statusbar__next"
      :class="`statusbar__next--${nextStep.tone}`"
      :title="nextStep.hint"
      @click="nextStep.run()"
    >{{ nextStep.label }} →</button>
  </footer>
</template>
