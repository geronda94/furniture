<script setup lang="ts">
import { selectedDerived } from '../state/project'
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
              <span class="table__edge">{{ r.edge }}</span>
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
    </div>
  </section>
</template>
