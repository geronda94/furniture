<script setup lang="ts">
import { computed, ref } from 'vue'
import DrillingMap from './DrillingMap.vue'
import type { AssemblyOperation, EdgePlanRow, SolveResponse } from '../api'
import type { Instance, Params } from '../state/defaults'
import { setConnectionOverride, toggleAssemblyStep } from '../state/project'

const props = defineProps<{
  calc: SolveResponse | null
  inst: Instance
  params: Params
  fastenerOptions: { id: string; name: string; kind?: string; face_dia?: number }[]
}>()

type OpGroup = {
  part: string
  kind: string
  ops: AssemblyOperation[]
  w: number
  h: number
  edges: Record<string, EdgePlanRow['sides'][string]>
  front: string
}

const OP_KINDS = [
  ['fastener_face', 'Крепёж (пласть)'],
  ['fastener_end', 'Крепёж (торец)'],
  ['hinge_cup', 'Петли'],
  ['hinge_plate', 'Ответные планки'],
  ['shelf_pin', 'Полкодержатели'],
  ['slide_mount', 'Направляющие'],
  ['slide_box', 'Направляющие ящика'],
  ['handle', 'Ручки'],
  ['gas_strut', 'Газовые патроны'],
] as const

const hiddenKinds = ref<Record<string, boolean>>({})
const opKinds = computed(() => {
  const counts: Record<string, number> = {}
  for (const o of props.calc?.operations ?? []) {
    counts[o.kind] = (counts[o.kind] ?? 0) + 1
  }
  return OP_KINDS
    .filter(([id]) => counts[id])
    .map(([id, label]) => ({ id, label, count: counts[id] }))
})

const PART_ALIAS: Record<string, string> = {
  'Боковина Л': 'Боковина лев.',
  'Боковина П': 'Боковина прав.',
}

function findPlanRow(part: string): EdgePlanRow | null {
  const rows = props.calc?.edge_plan ?? []
  const base = part.split(' · ')[0]
  const alias = PART_ALIAS[base] || base
  return (
    rows.find((r) => r.part === alias) ||
    rows.find((r) => r.part === base) ||
    rows.find((r) => r.part.startsWith(alias)) ||
    rows.find((r) => alias.startsWith(r.part)) ||
    null
  )
}

const opGroups = computed<OpGroup[]>(() => {
  const map = new Map<string, OpGroup>()
  for (const o of props.calc?.operations ?? []) {
    if (hiddenKinds.value[o.kind]) continue
    let g = map.get(o.part)
    if (!g) {
      const row = findPlanRow(o.part)
      g = {
        part: o.part,
        kind: o.part_kind || '',
        ops: [],
        w: row?.w ?? 0,
        h: row?.h ?? 0,
        edges: row?.sides ?? {},
        front: row?.front ?? '',
      }
      map.set(o.part, g)
    }
    g.ops.push(o)
  }
  const order = ['side', 'horizontal', 'divider', 'shelf', 'door',
    'drawer_front', 'drawer_side', 'drawer_panel']
  return [...map.values()].sort((a, b) => {
    const ia = order.indexOf(a.kind)
    const ib = order.indexOf(b.kind)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) ||
      a.part.localeCompare(b.part, 'ru')
  })
})

const assemblyDone = computed(() => new Set(props.inst.assemblyDone ?? []))
const assemblyProgress = computed(() => {
  const total = props.calc?.assembly?.length ?? 0
  if (!total) return 0
  let done = 0
  for (let i = 0; i < total; i++) if (assemblyDone.value.has(i)) done++
  return Math.round((done / total) * 100)
})

function toggleKind(id: string): void {
  hiddenKinds.value = { ...hiddenKinds.value, [id]: !hiddenKinds.value[id] }
}

function onConnection(cls: string, e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  setConnectionOverride(props.inst.id, cls, value)
}

function printMaps(): void {
  window.print()
}
</script>

<template>
  <div class="wb__assembly">

        <div v-if="!calc" class="dim wb__note">Присадка ещё не рассчитана.</div>
        <template v-else>
          <div class="wb__assembly-head">
            <div class="wb__label">Карта присадки и сборки</div>
            <button class="btn btn--sm" @click="printMaps">Печать / PDF</button>
          </div>
          <div class="wb__assembly-plan">
            <span>Петли: <b>{{ (calc.hardware_plan?.hinges ?? 0) }}</b></span>
            <span>Крепёж: <b>{{ calc.hardware_plan?.fasteners ?? 0 }}</b></span>
            <span>Саморезы: <b>{{ calc.hardware_plan?.screws ?? 0 }}</b></span>
            <span>Отверстия опор: <b>{{ calc.hardware_plan?.leg_holes ?? 0 }}</b></span>
            <span>Полкодержатели: <b>{{ (calc.hardware_plan?.shelf_pins ?? 0) }}</b></span>
            <span>Направляющие: <b>{{ (calc.hardware_plan?.slide_mounts ?? 0) }}</b></span>
            <span>Ручки: <b>{{ (calc.hardware_plan?.handles ?? 0) }}</b></span>
            <span>Газовые патроны: <b>{{ (calc.hardware_plan?.gas_struts ?? 0) ?? 0 }}</b></span>
            <span v-if="(calc.hardware_plan?.requires_pattern ?? 0)" class="is-warn">
              По шаблону: <b>{{ (calc.hardware_plan?.requires_pattern ?? 0) }}</b>
            </span>
          </div>
          <div class="wb__chips wb__chips--wrap">
            <button
              v-for="k in opKinds" :key="k.id"
              class="chip"
              :class="{ 'chip--off': hiddenKinds[k.id] }"
              @click="toggleKind(k.id)"
            >{{ k.label }} · {{ k.count }}</button>
          </div>

          <div v-if="calc.hardware_plan?.joints?.length" class="wb__group">
            <div class="wb__label">Соединения</div>
            <ul class="wb__joints">
              <li v-for="j in calc.hardware_plan.joints" :key="j.joint">
                <span>{{ j.joint }}</span>
                <b>{{ j.fastener }}</b>
                <span class="dim">×{{ j.count }}</span>
              </li>
            </ul>
            <div class="wb__row wb__row--2">
              <label class="field"><span class="field__label">Корпус</span>
                <select class="select" :value="params.connectionOverrides?.carcass || 'auto'" @change="onConnection('carcass', $event)">
                  <option value="auto">Как выбрано</option>
                  <option v-for="f in fastenerOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
              </label>
              <label class="field"><span class="field__label">Перегородки</span>
                <select class="select" :value="params.connectionOverrides?.divider || 'auto'" @change="onConnection('divider', $event)">
                  <option value="auto">Как выбрано</option>
                  <option v-for="f in fastenerOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
              </label>
            </div>
          </div>

          <div v-if="calc.assembly?.length" class="wb__group">
            <div class="wb__assembly-steps-head">
              <div class="wb__label">Порядок сборки</div>
              <span class="dim">{{ assemblyProgress }}%</span>
            </div>
            <div class="wb__progress"><i :style="{ width: assemblyProgress + '%' }"></i></div>
            <ol class="wb__steps">
              <li
                v-for="(step, i) in calc.assembly"
                :key="i"
                :class="{ 'is-done': assemblyDone.has(i) }"
                @click="toggleAssemblyStep(inst.id, i)"
              >
                <span class="wb__step-check">{{ assemblyDone.has(i) ? '✓' : '' }}</span>
                <span>{{ step }}</span>
              </li>
            </ol>
          </div>

          <div v-for="g in opGroups" :key="g.part" class="wb__map">
            <div class="wb__map-head">
              <b>{{ g.part }}</b>
              <span v-if="g.w && g.h">{{ g.w }} × {{ g.h }} мм</span>
              <span class="dim">{{ g.ops.length }} отв.</span>
            </div>
            <DrillingMap
              v-if="g.w && g.h"
              :part="g.part" :w="g.w" :h="g.h"
              :operations="g.ops" :edges="g.edges" :front="g.front"
            />
            <ul class="wb__ops">
              <li v-for="o in g.ops" :key="o.id">
                <span class="wb__op-kind">{{ o.kind }}</span>
                <span>{{ o.hardware }}</span>
                <b>Ø{{ o.dia }}×{{ o.depth }}</b>
                <span class="dim">{{ o.face }} · x{{ o.x }} y{{ o.y }}</span>
                <span v-if="o.requires_pattern" class="wb__draft">шаблон</span>
              </li>
            </ul>
          </div>
          <p v-if="!opGroups.length" class="dim wb__note">
            Нет отверстий по выбранным фильтрам.
          </p>
        </template>
        </div>
</template>
