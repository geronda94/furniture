<script setup lang="ts">
import { computed } from 'vue'
import { selectedDerived } from '../state/project'

const legend = computed(() => {
  const out: Record<string, { label: string; color: string }> = {}
  for (const row of selectedDerived.value?.bom ?? []) {
    for (const side of Object.values(row.edges ?? {})) {
      out[side.type] = { label: side.label, color: side.color }
    }
  }
  return out
})
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <span>Деталировка</span>
      <span v-if="selectedDerived" class="dim">
        {{ selectedDerived.totals.pieces }} шт
      </span>
    </div>
    <div class="panel__body">
      <table v-if="selectedDerived" class="table">
        <thead>
          <tr>
            <th>Деталь</th>
            <th class="num">Ш</th>
            <th class="num">В</th>
            <th class="num">Кол.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in selectedDerived.bom" :key="i">
            <td>
              <span class="table__name">{{ r.name }}</span>
              <span class="bom__edge-row">
                <span class="bom__edge-box" :title="r.edge">
                  <i
                    v-for="(side, key) in (r.edges ?? {})" :key="key"
                    class="bom__edge-side"
                    :class="`bom__edge-side--${key}`"
                    :style="{ background: side.color }"
                    :title="`${side.side_label}: ${side.label}${side.front ? ' · ПЕРЕД' : ''}`"
                  ></i>
                  <b v-if="r.front && r.edges?.[r.front]" class="bom__front-dot"
                    :title="'ПЕРЕД'"></b>
                </span>
                <span class="table__edge">{{ r.edge }}</span>
              </span>
            </td>
            <td class="num">{{ r.w }}</td>
            <td class="num">{{ r.h }}</td>
            <td class="num">{{ r.qty }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="dim">Расчёт…</div>

      <div v-if="selectedDerived" class="bom-foot">
        <span>листов: {{ selectedDerived.totals.sheets }}</span>
        <span>КПД: {{ selectedDerived.totals.kpd }}%</span>
      </div>
      <div v-if="Object.keys(legend).length" class="bom-legend">
        <span v-for="(v, k) in legend" :key="k" class="bom-legend__item">
          <i :style="{ background: v.color }"></i>{{ v.label }}
        </span>
      </div>
    </div>
  </section>
</template>
