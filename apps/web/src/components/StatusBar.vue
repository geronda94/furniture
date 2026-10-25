<script setup lang="ts">
import { computed } from 'vue'
import {
  derived,
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
