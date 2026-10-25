<script setup lang="ts">
import { computed, ref } from 'vue'
import Thumb from './Thumb.vue'
import { derived, state } from '../state/project'
import type { SolveResponse } from '../api'

const emit = defineEmits<{ (e: 'close'): void }>()

const costRef = computed(() => solved.value[0]?.cost ?? null)
const money = (v: number) => {
  const c = costRef.value
  return (
    new Intl.NumberFormat(c?.locale || 'ru-RU', { maximumFractionDigits: 0 })
      .format(v) + ' ' + (c?.symbol || c?.currency || '')
  )
}

interface Row {
  id: string
  name: string
  size: string
  pieces: number
  sheets: number
  cost: number
  errors: string[]
}

const rows = computed<Row[]>(() =>
  state.project.instances.map((inst) => {
    const d = derived[inst.id]
    return {
      id: inst.id,
      name: inst.name || 'Модуль',
      size: `${inst.params.W} × ${inst.params.H} × ${inst.params.D}`,
      pieces: d?.totals.pieces ?? 0,
      sheets: d?.totals.sheets ?? 0,
      cost: d?.cost?.total ?? 0,
      errors: d?.validation.errors ?? [],
    }
  }),
)

const solved = computed(() =>
  state.project.instances
    .map((inst) => derived[inst.id])
    .filter((d): d is SolveResponse => !!d),
)

const lines = computed(() => {
  const map = new Map<string, { label: string; unit: string; qty: number; total: number }>()
  for (const d of solved.value) {
    for (const line of d.cost?.lines ?? []) {
      const key = `${line.label}|${line.unit}`
      const cur = map.get(key) ?? { label: line.label, unit: line.unit, qty: 0, total: 0 }
      cur.qty += line.qty
      cur.total += line.total
      map.set(key, cur)
    }
  }
  return [...map.values()]
})

const subtotal = computed(() =>
  solved.value.reduce((sum, d) => sum + (d.cost?.subtotal ?? 0), 0),
)
const markup = computed(() =>
  solved.value.reduce((sum, d) => sum + (d.cost?.markup ?? 0), 0),
)
const partner = computed(() =>
  solved.value.reduce((sum, d) => sum + (d.cost?.partner ?? 0), 0),
)
const total = computed(() =>
  solved.value.reduce((sum, d) => sum + (d.cost?.total ?? 0), 0),
)
const vat = computed(() =>
  solved.value.reduce((sum, d) => sum + (d.cost?.vat ?? 0), 0),
)
const totalWithVat = computed(() =>
  solved.value.reduce((sum, d) => sum + (d.cost?.total_with_vat ?? d.cost?.total ?? 0), 0),
)
const vatPercent = computed(() => costRef.value?.vat_percent ?? 0)
const pricingNote = computed(() => {
  const c = costRef.value
  if (!c) return ''
  return [c.market_name, c.shop_name, c.supplier_name].filter(Boolean).join(' · ')
})
const errors = computed(() =>
  state.project.instances.flatMap((inst) =>
    (derived[inst.id]?.validation.errors ?? []).map((e) => `${inst.name}: ${e}`),
  ),
)
const today = new Date().toLocaleDateString('ru-RU')
const mode = ref<'client' | 'internal'>('client')
const title = computed(() =>
  mode.value === 'client' ? 'Коммерческое предложение' : 'Внутренняя смета',
)

function print(): void {
  window.print()
}
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--quote" @click.self="emit('close')">
      <section class="modal__win quote" role="dialog" aria-modal="true" aria-label="Коммерческое предложение">
        <header class="modal__head quote__head">
          <div>
            <div class="modal__title">{{ title }}</div>
            <div class="modal__sub">
              {{ state.project.name }} · {{ today }}
            </div>
          </div>
          <div class="modal__tools quote__tools">
            <button class="btn btn--sm" @click="print">Печать / PDF</button>
            <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="quote__body">
          <div class="quote__intro">
            <div>
              <b>{{ state.project.name }}</b>
              <p class="dim">
                Комната {{ state.project.room.w }} × {{ state.project.room.d }} ×
                {{ state.project.room.h }} мм · модулей {{ rows.length }}
              </p>
            </div>
            <div class="quote__stamp">
              <span class="dim">Итого</span>
              <b>{{ money(total) }}</b>
              <div class="quote__mode" role="group" aria-label="Вид сметы">
                <button
                  class="tab tab--sm"
                  :class="{ 'tab--active': mode === 'client' }"
                  @click="mode = 'client'"
                >Клиенту</button>
                <button
                  class="tab tab--sm"
                  :class="{ 'tab--active': mode === 'internal' }"
                  @click="mode = 'internal'"
                >Внутренняя</button>
              </div>
            </div>
          </div>

          <ul class="quote__modules">
            <li v-for="r in rows" :key="r.id" class="quote__module">
              <Thumb :instance-id="r.id" :width="92" :height="66" />
              <div class="quote__module-main">
                <b>{{ r.name }}</b>
                <span class="dim">{{ r.size }} мм · {{ r.pieces }} дет. · {{ r.sheets }} л.</span>
                <span v-if="r.errors.length" class="quote__bad">ошибок: {{ r.errors.length }}</span>
              </div>
              <b class="quote__module-price">{{ money(r.cost) }}</b>
            </li>
          </ul>

          <table class="quote__table">
            <thead>
              <tr><th>Позиция</th><th>Кол-во</th><th class="is-right">Сумма</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in lines" :key="l.label + l.unit">
                <td>{{ l.label }}</td>
                <td>{{ l.qty }} {{ l.unit }}</td>
                <td class="is-right">{{ money(l.total) }}</td>
              </tr>
            </tbody>
          </table>

          <ul class="quote__totals">
            <li><span>Материалы и работы</span><b>{{ money(subtotal) }}</b></li>
            <template v-if="mode === 'client'">
              <li><span>Комплектация и оформление</span><b>{{ money(markup) }}</b></li>
            </template>
            <template v-else>
              <li><span>Наценка</span><b>{{ money(markup) }}</b></li>
              <li><span>Партнёрская комиссия</span><b>{{ money(partner) }}</b></li>
            </template>
            <li v-if="vat"><span>НДС {{ vatPercent }}%</span><b>{{ money(vat) }}</b></li>
            <li class="quote__grand"><span>К оплате</span><b>{{ money(totalWithVat) }}</b></li>
          </ul>
          <p v-if="pricingNote" class="dim quote__pricing">
            {{ pricingNote }} · {{ costRef?.currency }}
            <span v-if="costRef?.draft"> · цены-заготовка</span>
          </p>

          <ul v-if="errors.length" class="issues">
            <li v-for="e in errors" :key="e" class="is-err">{{ e }}</li>
          </ul>

          <p class="dim quote__note">
            Цены рассчитаны по спецификации и носят предварительный характер.
            Точная стоимость — после проверки замеров и материалов.
            Деталировка и раскрой прилагаются отдельно.
            <template v-if="mode === 'internal'">
              Внутренняя смета: наценка и партнёрская комиссия видны только
              сотрудникам.
            </template>
          </p>
        </div>
      </section>
    </div>
  </Teleport>
</template>
