<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { derived, openObjectModal, select, state, ui } from '../state/project'
import {
  apiProjectCutting, apiProjectLayout, type LayoutIssue, type ProjectCutting,
} from '../api'

const emit = defineEmits<{ (e: 'close'): void }>()

const cutting = ref<ProjectCutting | null>(null)
const cuttingError = ref('')
const cuttingBusy = ref(true)
const issues = ref<LayoutIssue[]>([])
onMounted(async () => {
  try {
    const lay = await apiProjectLayout(state.projectId)
    issues.value = lay.issues ?? []
  } catch {
    issues.value = []
  }
  try {
    cutting.value = await apiProjectCutting(state.projectId)
  } catch (e) {
    cuttingError.value = e instanceof Error ? e.message : String(e)
  } finally {
    cuttingBusy.value = false
  }
})

/** Готовность к производству: что есть, чего не хватает. */
const readiness = computed(() => {
  const errs = issues.value.filter((i) => i.level === 'error')
  const std = issues.value.filter((i) => i.code.startsWith('std-') &&
    i.level !== 'error')
  const solved = state.project.instances.length > 0 &&
    state.project.instances.every((i) => (derived[i.id]?.bom?.length ?? 0) > 0)
  const holes = totals.value.holes > 0
  const hardware = totals.value.hinges + totals.value.handles +
    totals.value.fasteners > 0
  const cut = !!cutting.value && cutting.value.totals.sheets > 0
  return [
    { id: 'layout', label: 'Расстановка', ok: errs.length === 0,
      detail: errs.length ? `${errs.length} ошибок` : 'ок' },
    { id: 'solve', label: 'Расчёт', ok: solved,
      detail: solved ? 'все модули' : 'не всё рассчитано' },
    { id: 'cut', label: 'Раскрой', ok: cut,
      detail: cutting.value ? `${cutting.value.totals.sheets} листов` : 'считается' },
    { id: 'drill', label: 'Присадка', ok: holes,
      detail: `${totals.value.holes} отверстий` },
    { id: 'hw', label: 'Фурнитура', ok: hardware,
      detail: hardware ? 'есть' : 'нет' },
    { id: 'std', label: 'ГОСТ/EN', ok: std.length === 0,
      detail: std.length ? `${std.length} предупр.` : 'ок' },
  ]
})
const allReady = computed(() => readiness.value.every((r) => r.ok))

type Row = {
  id: string
  name: string
  parts: number
  sheets: number
  kpd: number
  holes: number
  cost: number
}

const rows = computed<Row[]>(() => state.project.instances.map((inst) => {
  const d = derived[inst.id]
  const hw = d?.hardware_plan
  return {
    id: inst.id,
    name: inst.name || inst.id,
    parts: d?.totals.pieces ?? 0,
    sheets: d?.totals.sheets ?? 0,
    kpd: d?.totals.kpd ?? 0,
    holes: (d?.operations?.length ?? 0) +
      (hw?.hinges ?? 0) + (hw?.shelf_pins ?? 0),
    cost: d?.cost?.total_with_vat ?? d?.cost?.subtotal ?? 0,
  }
}))

const totals = computed(() => {
  const acc = {
    parts: 0, sheets: 0, holes: 0, cost: 0,
    hinges: 0, handles: 0, fasteners: 0, screws: 0,
    shelfPins: 0, slides: 0, gasStruts: 0, legHoles: 0,
    pattern: 0,
  }
  for (const inst of state.project.instances) {
    const d = derived[inst.id]
    if (!d) continue
    const hw = d.hardware_plan
    acc.parts += d.totals.pieces
    acc.sheets += d.totals.sheets
    acc.holes += (d.operations?.length ?? 0) + (hw?.hinges ?? 0) +
      (hw?.shelf_pins ?? 0)
    acc.cost += d.cost?.total_with_vat ?? d.cost?.subtotal ?? 0
    acc.hinges += hw?.hinges ?? 0
    acc.handles += hw?.handles ?? 0
    acc.fasteners += hw?.fasteners ?? hw?.confirmats ?? 0
    acc.screws += hw?.screws ?? 0
    acc.shelfPins += hw?.shelf_pins ?? 0
    acc.slides += hw?.slide_mounts ?? 0
    acc.gasStruts += hw?.gas_struts ?? 0
    acc.legHoles += hw?.leg_holes ?? 0
    acc.pattern += hw?.requires_pattern ?? 0
  }
  const sheetSum = rows.value.reduce((s, r) => s + r.sheets, 0)
  const kpdPerModule = sheetSum
    ? Math.round(rows.value.reduce((s, r) => s + r.kpd * r.sheets, 0) / sheetSum)
    : 0
  const kpd = cutting.value ? cutting.value.totals.kpd : kpdPerModule
  if (cutting.value) {
    acc.sheets = cutting.value.totals.sheets
  }
  return { ...acc, kpd }
})

const currency = computed(() =>
  state.project.instances
    .map((i) => derived[i.id]?.cost?.symbol)
    .find(Boolean) || '')

const money = (v: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) +
  ' ' + currency.value

const ready = computed(() => totals.value.parts > 0)

function openModule(id: string): void {
  select(id)
  openObjectModal('full')
  emit('close')
}

function openQuote(): void {
  ui.quoteOpen = true
  emit('close')
}

function downloadCsv(name: string, rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const t = String(v ?? '')
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const text = '\ufeff' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1200)
}

function csvHoles(): void {
  const rows: (string | number)[][] = [[
    'Модуль', 'Деталь', 'Операция', 'Фурнитура', 'Пласть',
    'X, мм', 'Y, мм', 'Ø, мм', 'Глубина, мм', 'Кол-во', 'Шаблон',
  ]]
  for (const inst of state.project.instances) {
    const d = derived[inst.id]
    for (const o of d?.operations ?? []) {
      rows.push([inst.name || inst.id, o.part, o.kind, o.hardware, o.face,
        o.x, o.y, o.dia, o.depth, o.qty, o.requires_pattern ? 'да' : ''])
    }
  }
  downloadCsv(`${state.project.name || 'project'}-отверстия.csv`, rows)
}

function csvParts(): void {
  const rows: (string | number)[][] = [[
    'Модуль', 'Деталь', 'Кол-во', 'Размер, мм', 'Пильный, мм',
    'Материал', 'Кромка',
  ]]
  for (const inst of state.project.instances) {
    for (const b of derived[inst.id]?.bom ?? []) {
      rows.push([inst.name || inst.id, b.name, b.qty,
        `${b.w}×${b.h}`, `${b.saw_w}×${b.saw_h}`, b.material, b.edge])
    }
  }
  downloadCsv(`${state.project.name || 'project'}-детали.csv`, rows)
}

function csvCutting(): void {
  const rows: (string | number)[][] = [[
    'Модуль', 'Материал', 'Лист', 'Деталь', 'X, мм', 'Y, мм',
    'Ширина, мм', 'Высота, мм', 'Поворот',
  ]]
  if (cutting.value) {
    for (const sheet of cutting.value.sheets) {
      sheet.placements.forEach((p, pi) => {
        rows.push(['проект', sheet.material, pi + 1,
          p.name, p.x, p.y, p.w, p.h, p.rot ? 'да' : ''])
      })
    }
  } else {
    for (const inst of state.project.instances) {
      const d = derived[inst.id]
      ;(d?.sheets ?? []).forEach((sheet, si) => {
        for (const p of sheet.placements ?? []) {
          rows.push([inst.name || inst.id, sheet.material, si + 1, p.name,
            p.x, p.y, p.w, p.h, p.rot ? 'да' : ''])
        }
      })
    }
  }
  downloadCsv(`${state.project.name || 'project'}-раскрой.csv`, rows)
}

function csvHardware(): void {
  const rows: (string | number)[][] = [['Модуль', 'Фурнитура', 'Кол-во']]
  for (const inst of state.project.instances) {
    const d = derived[inst.id]
    const acc = new Map<string, number>()
    for (const o of d?.operations ?? []) {
      if (!o.hardware) continue
      const key = `${o.hardware} (${o.kind})`
      acc.set(key, (acc.get(key) ?? 0) + (o.qty || 1))
    }
    for (const [name, qty] of acc) {
      rows.push([inst.name || inst.id, name, qty])
    }
  }
  downloadCsv(`${state.project.name || 'project'}-фурнитура.csv`, rows)
}

const exporting = ref('')
async function exportFile(fmt: 'svg' | 'dxf' | 'xlsx' | 'pdf'): Promise<void> {
  exporting.value = fmt
  try {
    const url = fmt === 'pdf'
      ? `/api/projects/${state.projectId}/quote.pdf`
      : `/api/projects/${state.projectId}/export/${fmt}`
    const r = await fetch(url, { method: 'POST' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    const cd = r.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename\*=UTF-8''([^;]+)/)
    const name = m
      ? decodeURIComponent(m[1])
      : `${state.project.name || 'project'}.${fmt}`
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500)
  } catch (e) {
    cuttingError.value = e instanceof Error ? e.message : String(e)
  } finally {
    exporting.value = ''
  }
}

function downloadJson(): void {
  const blob = new Blob(
    [JSON.stringify(state.project, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.project.name || 'project'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <section class="modal__win result" role="dialog" aria-modal="true"
      aria-label="Результат проекта">
      <header class="modal__head">
        <div>
          <b>Готовый проект</b>
          <span class="dim">детали, раскрой, присадка и фурнитура</span>
        </div>
        <button class="btn btn--ghost btn--sm" title="Закрыть" @click="emit('close')">×</button>
      </header>

      <div class="result__body">
        <div class="result__stats">
          <div class="stat"><div class="stat__k">модулей</div><div class="stat__v">{{ rows.length }}</div></div>
          <div class="stat"><div class="stat__k">деталей</div><div class="stat__v">{{ totals.parts }}</div></div>
          <div class="stat"><div class="stat__k">листов</div><div class="stat__v">{{ totals.sheets }}</div></div>
          <div class="stat"><div class="stat__k">КПД раскроя</div><div class="stat__v">{{ totals.kpd }}%</div></div>
          <div class="stat"><div class="stat__k">отверстий</div><div class="stat__v">{{ totals.holes }}</div></div>
          <div class="stat stat--money"><div class="stat__k">смета</div><div class="stat__v">{{ money(totals.cost) }}</div></div>
        </div>

        <div class="result__ready" :class="{ 'is-ready': allReady }">
          <b>{{ allReady ? 'Готов к производству' : 'Есть замечания' }}</b>
          <span v-for="r in readiness" :key="r.id" class="result__check"
            :class="{ 'is-bad': !r.ok }">
            {{ r.ok ? '✓' : '•' }} {{ r.label }}<small>{{ r.detail }}</small>
          </span>
        </div>

        <div class="result__grid">
          <div class="result__block">
            <div class="result__label">Фурнитура и крепёж</div>
            <ul class="result__list">
              <li><span>Петли</span><b>{{ totals.hinges }}</b></li>
              <li><span>Ручки</span><b>{{ totals.handles }}</b></li>
              <li><span>Крепёж корпуса</span><b>{{ totals.fasteners }}</b></li>
              <li v-if="totals.screws"><span>Саморезы</span><b>{{ totals.screws }}</b></li>
              <li><span>Полкодержатели</span><b>{{ totals.shelfPins }}</b></li>
              <li><span>Направляющие</span><b>{{ totals.slides }}</b></li>
              <li v-if="totals.gasStruts"><span>Газовые патроны</span><b>{{ totals.gasStruts }}</b></li>
              <li v-if="totals.legHoles"><span>Отверстия опор</span><b>{{ totals.legHoles }}</b></li>
              <li v-if="totals.pattern" class="is-warn">
                <span>По шаблону</span><b>{{ totals.pattern }}</b>
              </li>
            </ul>
          </div>
          <div class="result__block">
            <div class="result__label">Что внутри</div>
            <p v-if="cuttingBusy" class="dim result__note">
              Считаю общий раскрой проекта: детали всех модулей укладываются
              на листы вместе…
            </p>
            <p v-else-if="cutting" class="dim result__note">
              Общий раскрой проекта: {{ cutting.totals.sheets }} листов,
              КПД {{ cutting.totals.kpd }}% — детали всех модулей уложены
              вместе. По модулям было бы
              {{ rows.reduce((s, r) => s + r.sheets, 0) }} листов.
            </p>
            <p v-else-if="cuttingError" class="dim result__note">
              Раскрой проекта: {{ cuttingError }} (показан расчёт по модулям).
            </p>
            <p class="dim result__note">
              Каждый модуль: деталировка с размерами и кромкой, карта присадки
              (координаты X/Y, Ø, глубина), схема раскроя листов, состав
              фурнитуры и смета. Откройте модуль → «Детали» / «Сборка» /
              «Смета».
            </p>
            <div class="result__actions">
              <button class="btn btn--sm btn--primary" :disabled="!!exporting"
                @click="exportFile('pdf')">PDF КП</button>
              <button class="btn btn--sm" @click="openQuote">КП на экране</button>
              <button class="btn btn--sm" @click="csvHoles">Отверстия CSV</button>
              <button class="btn btn--sm" @click="csvParts">Детали CSV</button>
              <button class="btn btn--sm" @click="csvCutting">Раскрой CSV</button>
              <button class="btn btn--sm" @click="csvHardware">Фурнитура CSV</button>
              <button class="btn btn--sm" :disabled="!!exporting"
                @click="exportFile('xlsx')">XLSX</button>
              <button class="btn btn--sm" :disabled="!!exporting"
                @click="exportFile('dxf')">DXF деталей</button>
              <button class="btn btn--sm" :disabled="!!exporting"
                @click="exportFile('svg')">SVG раскроя</button>
              <button class="btn btn--sm" @click="downloadJson">JSON</button>
            </div>
          </div>
        </div>

        <div class="result__table-wrap">
          <table class="result__table">
            <thead>
              <tr>
                <th>Модуль</th><th>деталей</th><th>листов</th>
                <th>КПД</th><th>отверстий</th><th>смета</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id" @click="openModule(r.id)">
                <td>{{ r.name }}</td>
                <td>{{ r.parts }}</td>
                <td>{{ r.sheets }}</td>
                <td>{{ r.kpd }}%</td>
                <td>{{ r.holes }}</td>
                <td>{{ money(r.cost) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!ready" class="dim">
            Пока не рассчитано: нажмите «Сохранить» или подождите расчёт.
          </p>
        </div>
      </div>

      <footer class="modal__foot">
        <span class="dim">Проверка расстановки и ГОСТ/EN — в меню «Проверить».</span>
        <button class="btn" @click="emit('close')">Закрыть</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.result { width: min(980px, 96vw); max-height: 92vh; display: flex; flex-direction: column; }
.result__body { overflow: auto; padding: 14px 18px; display: grid; gap: 14px; }
.result__stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.result__stats .stat { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.result__stats .stat__k { font-size: 10px; color: var(--dim); }
.result__stats .stat__v { font-size: 18px; font-weight: 650; }
.result__stats .stat--money .stat__v { font-size: 15px; }
.result__ready { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(214,76,76,0.45);
  background: rgba(214,76,76,0.08); font-size: 12px; }
.result__ready.is-ready { border-color: rgba(80,170,110,0.5); background: rgba(80,170,110,0.10); }
.result__check { display: inline-flex; gap: 4px; align-items: baseline;
  padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); }
.result__check.is-bad { color: #ffb4b4; }
.result__check small { color: var(--dim); font-size: 10px; }
.result__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.result__block { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.result__label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); margin-bottom: 8px; }
.result__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.result__list li { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
.result__list b { font-variant-numeric: tabular-nums; }
.result__note { margin: 0 0 10px; font-size: 12px; line-height: 1.5; }
.result__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.result__table-wrap { border: 1px solid var(--line); border-radius: 12px; overflow: auto; }
.result__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.result__table th, .result__table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.result__table th { color: var(--dim); font-weight: 500; font-size: 10px; text-transform: uppercase; }
.result__table tbody tr { cursor: pointer; }
.result__table tbody tr:hover { background: rgba(255,255,255,0.03); }
.result__table td:not(:first-child), .result__table th:not(:first-child) { text-align: right; }
@media (max-width: 760px) {
  .result__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .result__grid { grid-template-columns: 1fr; }
}
</style>
