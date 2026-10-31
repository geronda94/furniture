<script setup lang="ts">
import type { CostInfo } from '../api'

const props = defineProps<{ cost: CostInfo | null }>()

function money(v: number, withVat = false): string {
  const c = props.cost
  const locale = c?.locale || 'ru-RU'
  const symbol = c?.symbol || c?.currency || ''
  const value = withVat && c?.total_with_vat != null ? c.total_with_vat : v
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value) +
    ' ' + symbol
  )
}
</script>

<template>
  <div class="wb__costtab">
    <div v-if="!cost" class="dim wb__note">Смета ещё не рассчитана.</div>
    <template v-else>
      <div class="wb__label">Смета модуля · {{ cost.currency }} · {{ cost.market_name }}</div>
      <div class="wb__price-note">
        {{ cost.shop_name }} · {{ cost.supplier_name }}
        <span v-if="cost.draft" class="wb__draft">цены-заготовка</span>
      </div>
      <ul class="detail__gaps wb__cost">
        <li v-for="(line, i) in cost.lines" :key="i" class="wb__cost-line">
          <span class="wb__cost-name">
            {{ line.label }}
            <small>{{ line.qty }} {{ line.unit }} × {{ money(line.unit_price) }}</small>
          </span>
          <b>{{ money(line.total) }}</b>
        </li>
      </ul>
      <ul class="detail__gaps wb__cost-total">
        <li><span>Материалы и работы</span><b>{{ money(cost.subtotal) }}</b></li>
        <li><span>Наценка {{ cost.markup_percent }}%</span><b>{{ money(cost.markup) }}</b></li>
        <li><span>Партнёрская комиссия {{ cost.partner_percent }}%</span><b>{{ money(cost.partner) }}</b></li>
        <li v-if="cost.vat" class="wb__cost-vat">
          <span>НДС {{ cost.vat_percent }}%</span><b>{{ money(cost.vat ?? 0) }}</b>
        </li>
        <li class="wb__cost-grand"><span>С НДС</span><b>{{ money(0, true) }}</b></li>
      </ul>
      <p class="dim wb__note">
        Цены: {{ cost.source || 'прайс рынка' }} · обновлено {{ cost.updated || '—' }}.
        {{ cost.shop_name }} / {{ cost.supplier_name }}. Наценка и партнёрская
        комиссия — заготовка для КП.
      </p>
    </template>
  </div>
</template>
