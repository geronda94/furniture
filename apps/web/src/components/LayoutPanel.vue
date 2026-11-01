<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiNormalizeLayout, apiProjectLayout, type LayoutIssue } from '../api'
import {
  flushSave, focusObject, focusProp, pushHistory, selectQuiet, state, ui,
  setInstancePosition, updateInstanceParams, toggleDoors, toggleDrawers,
} from '../state/project'

const emit = defineEmits<{ (e: 'close'): void }>()
const issues = ref<LayoutIssue[]>([])
const errors = ref(0)
const warnings = ref(0)
const busy = ref(false)
const error = ref('')
const done = ref('')
/** Отметки для «исправить выбранные». */
const checked = ref<boolean[]>([])
const pickedCount = computed(() => checked.value.filter(Boolean).length)

const MANUAL_FIXES = new Set([
  'std-wall-height', 'std-wall-gap', 'std-wall-top', 'std-plinth', 'plinth',
  'std-door-width', 'std-drawer-width', 'std-shelf-span',
  'std-base-height', 'std-base-depth', 'std-wall-depth', 'std-worktop-height',
  'below-floor', 'above-ceiling', 'outside', 'in-wall',
  'door-swing-instance', 'door-swing-clash', 'door-swing-wall',
  'door-swing-opening', 'drawer-instance', 'drawer-wall',
])

const errorsList = computed(() => issues.value.filter((i) => i.level === 'error'))
const warnsList = computed(() => issues.value.filter((i) => i.level !== 'error'))
const codeLabel: Record<string, string> = {
  'in-wall': 'в стене',
  outside: 'вне комнаты',
  opening: 'перекрыт проём',
  'opening-sweep': 'зона открывания',
  'opening-overlap': 'проёмы пересекаются',
  overlap: 'пересечение',
  gap: 'зазор',
  'front-to-wall': 'фасад в стену',
  plinth: 'цоколь',
  'below-floor': 'под полом',
  'above-ceiling': 'выше потолка',
  'prop-in-wall': 'декор в стене',
  'prop-outside': 'декор вне комнаты',
  'prop-overlap': 'декор × мебель',
  'prop-prop': 'декор × декор',
  'prop-opening': 'декор в проёме',
  'door-swing-wall': 'дверь в стену',
  'door-swing-opening': 'дверь в проём',
  'door-swing-instance': 'дверь × мебель',
  'door-swing-prop': 'дверь × декор',
  'door-swing-clash': 'двери сталкиваются',
  'drawer-wall': 'ящик в стену',
  'drawer-instance': 'ящик × мебель',
  'drawer-prop': 'ящик × декор',
  wallitem: 'предмет на стене',
  'wallitem-opening': 'предмет в проёме',
  'wallitem-wallitem': 'предметы на стене',
  'wallitem-outside': 'предмет вне стены',
  'row-gap-wall': 'щель у стены',
  'sink-corner': 'мойка/варочная у стены',
  'socket-over-cutout': 'розетка над мойкой/варочной',
  'cabinet-window': 'шкаф на окне',
  'cabinet-window-gap': 'шкаф близко к окну',
  // ГОСТ/EN: эргономика и безопасность (docs/29)
  'std-worktop-height': 'высота столешницы по ГОСТ',
  'std-base-height': 'высота корпуса по ГОСТ',
  'std-base-depth': 'глубина корпуса по ГОСТ',
  'std-plinth': 'цоколь по ГОСТ',
  'std-wall-height': 'высота навесных по ГОСТ',
  'std-wall-top': 'верх навесных',
  'std-wall-depth': 'глубина навесных по ГОСТ',
  'std-wall-gap': 'зазор над столешницей',
  'std-tip-over': 'защита от опрокидывания',
  'std-door-width': 'ширина створки',
  'std-drawer-width': 'ширина фасада ящика',
  'std-shelf-span': 'пролёт полки',
  'std-bed-size': 'размер кровати по ГОСТ',
  'std-seat-depth': 'глубина дивана/кресла',
  'std-seat-width': 'ширина места',
  'std-chair-height': 'высота стула',
  'std-table-height': 'высота стола по ГОСТ',
}

async function load(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const r = await apiProjectLayout(state.projectId)
    issues.value = r.issues
    checked.value = r.issues.map(() => false)
    errors.value = r.errors
    warnings.value = r.warnings
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function showIssue(i: LayoutIssue): void {
  if (i.instance) {
    selectQuiet(i.instance)
    focusObject(i.instance, 'iso', 1)
    ui.layoutOpen = false
    return
  }
  const propId = i.prop
  if (propId) {
    focusProp(propId)
    ui.layoutOpen = false
  }
}

/** Ручные исправления по коду: реально меняют параметры/позицию. */
function applyManual(issue: LayoutIssue): boolean {
  const inst = issue.instance
    ? state.project.instances.find((i) => i.id === issue.instance)
    : null
  if (!inst) return false
  const p = inst.params
  switch (issue.code) {
    case 'std-wall-height':
    case 'std-wall-gap':
      return setInstancePosition(inst.id, { z: 1450 })
    case 'std-wall-top':
      return setInstancePosition(inst.id, {
        z: Math.max(0, Math.min(2150, state.project.room.h) - p.H),
      })
    case 'below-floor':
      return setInstancePosition(inst.id, { z: 0 })
    case 'above-ceiling':
      return setInstancePosition(inst.id, {
        z: Math.max(0, state.project.room.h - p.H),
      })
    case 'outside':
    case 'in-wall': {
      const swap = Math.abs(inst.rot % 180) === 90
      const w = swap ? p.D : p.W
      const d = swap ? p.W : p.D
      const x = Math.min(Math.max(inst.x, 0), Math.max(0, state.project.room.w - w))
      const y = Math.min(Math.max(inst.y, 0), Math.max(0, state.project.room.d - d))
      setInstancePosition(inst.id, { x })
      return setInstancePosition(inst.id, { y })
    }
    case 'std-plinth':
    case 'plinth':
      return updateInstanceParams(inst.id, { plinthH: 100 })
    case 'std-door-width':
      return updateInstanceParams(inst.id, {
        doors: Math.max(1, Math.min(6, Math.round(p.W / 500))),
      })
    case 'std-drawer-width':
      return updateInstanceParams(inst.id, {
        drawers: Math.max(1, Math.min(6, Math.round(p.W / 500))),
      })
    case 'std-shelf-span':
      return updateInstanceParams(inst.id, {
        dividers: Math.max(1, Math.ceil(p.W / 1100) - 1),
      })
    case 'std-base-height':
      return updateInstanceParams(inst.id, { H: 720 })
    case 'std-base-depth':
      return updateInstanceParams(inst.id, { D: 560 })
    case 'std-wall-depth':
      return updateInstanceParams(inst.id, { D: 320 })
    case 'std-worktop-height': {
      const target = 860 - (p.plinthH || 0) - (p.worktopT || 0)
      return updateInstanceParams(inst.id, { H: Math.max(200, Math.round(target)) })
    }
    case 'door-swing-instance':
    case 'door-swing-clash':
    case 'door-swing-wall':
    case 'door-swing-opening':
      if (inst.params.doors) toggleDoors(inst.id)
      return true
    case 'drawer-instance':
    case 'drawer-wall':
      if (inst.params.drawers) toggleDrawers(inst.id)
      return true
    default:
      return false
  }
}

function fixable(issue: LayoutIssue): boolean {
  return !!issue.auto_fixable || MANUAL_FIXES.has(issue.code)
}

async function afterManual(): Promise<void> {
  await flushSave(true)
  await load()
}

async function fixOne(issue: LayoutIssue): Promise<void> {
  if (issue.auto_fixable) {
    await fix()
    return
  }
  busy.value = true
  error.value = ''
  done.value = ''
  const ok = applyManual(issue)
  busy.value = false
  if (!ok) {
    done.value = 'Это исправление требует решения — проверьте вручную'
    return
  }
  done.value = 'Исправлено'
  await afterManual()
}

async function fixSelected(): Promise<void> {
  const list = issues.value.filter((_, n) => checked.value[n])
  if (!list.length) return
  busy.value = true
  error.value = ''
  done.value = ''
  let manual = 0
  let auto = false
  for (const issue of list) {
    if (issue.auto_fixable) {
      auto = true
      continue
    }
    if (applyManual(issue)) manual++
  }
  busy.value = false
  if (auto) {
    await fix()
    return
  }
  done.value = manual
    ? `Исправлено: ${manual}`
    : 'Выбранные пункты требуют решения — проверьте вручную'
  if (manual) await afterManual()
}

async function fix(): Promise<void> {
  busy.value = true
  error.value = ''
  done.value = ''
  try {
    // сначала фиксируем текущие правки, чтобы нормализация считалась по ним
    if (!(await flushSave(true))) {
      throw new Error('Не удалось сохранить проект перед нормализацией')
    }
    const r = await apiNormalizeLayout(state.projectId, true)
    const n = r.changes?.length ?? 0
    if (!r.committed) {
      issues.value = r.issues
      errors.value = r.errors
      warnings.value = r.warnings
      error.value = `Осталось конфликтов: ${r.errors}. Проект не сохранён`
      return
    }
    // Нормализация меняет позиции/повороты мебели и, если нужно, декор.
    pushHistory('Нормализация расстановки')
    for (const row of r.instances ?? []) {
      const inst = state.project.instances.find((i) => i.id === row.id)
      if (!inst) continue
      inst.x = row.x
      inst.y = row.y
      inst.rot = row.rot
    }
    for (const row of r.props ?? []) {
      const prop = state.project.props?.find((p) => p.id === row.id)
      if (!prop) continue
      prop.x = row.x
      prop.y = row.y
    }
    state.dirty = false
    state.saveState = 'saved'
    state.rev++
    issues.value = r.issues
    checked.value = r.issues.map(() => false)
    errors.value = r.errors
    warnings.value = r.warnings
    done.value = n ? `Исправлено изменений: ${n}` : 'Расстановка уже в порядке'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <Teleport to="body">
    <div class="modal" @click.self="emit('close')">
      <section class="modal__win layout-panel" role="dialog" aria-modal="true" aria-label="Расстановка мебели">
        <header class="modal__head">
          <span class="modal__title">Расстановка</span>
          <span class="modal__sub">
            {{ errors }} ошибок · {{ warnings }} предупреждений
          </span>
          <div class="modal__tools">
            <button class="btn btn--ghost btn--sm" title="Закрыть" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="layout-panel__body">
          <p class="dim layout-panel__lead">
            Проверяются стены и их толщина, двери и окна, пересечения модулей,
            зазоры в ряду и ориентация фасадов. «Уплотнить» прижимает корпуса
            к внутренним граням и закрывает случайные зазоры.
          </p>

          <p v-if="error" class="layout-panel__err">{{ error }}</p>
          <p v-if="done" class="layout-panel__ok">{{ done }}</p>

          <div v-if="issues.length" class="layout-panel__list">
            <div
              v-for="(i, n) in issues"
              :key="n"
              class="layout-panel__row"
              :class="[`is-${i.level}`, { 'is-link': !!(i.instance || i.prop) }]"
              :title="i.instance ? 'Показать модуль в 3D' : i.prop ? 'Показать декор в 3D' : ''"
              @click="showIssue(i)"
            >
              <label class="layout-panel__pick" @click.stop>
                <input v-model="checked[n]" type="checkbox" :aria-label="`Выбрать: ${i.message}`" />
              </label>
              <span class="layout-panel__tag">{{ codeLabel[i.code] || i.code }}</span>
              <b>{{ i.name || i.instance || i.prop }}</b>
              <span class="layout-panel__msg">{{ i.message }}<template v-if="i.fix"> <em class="layout-panel__fix">— {{ i.fix }}</em></template></span>
              <button
                v-if="fixable(i)"
                class="btn btn--ghost btn--sm layout-panel__btn"
                :title="i.auto_fixable ? 'Исправить автоматически: уплотнить и прижать' : 'Применить физическое исправление'"
                :disabled="busy"
                @click.stop="fixOne(i)"
              >Исправить</button>
              <span v-if="i.instance" class="layout-panel__go">→</span>
            </div>
          </div>
          <template v-else-if="!busy">
            <div class="layout-panel__checks">
              <span>стены и толщина</span>
              <span>двери и окна</span>
              <span>пересечения</span>
              <span>зазоры в ряду</span>
              <span>фасады в комнату</span>
            </div>
            <p class="layout-panel__ok">Ошибок расстановки нет.</p>
          </template>

          <div class="layout-panel__foot">
            <button class="btn btn--sm" :disabled="busy" @click="load">Проверить снова</button>
            <button
              class="btn btn--sm"
              :disabled="busy || !pickedCount"
              @click="fixSelected"
            >Исправить выбранные ({{ pickedCount }})</button>
            <button class="btn btn--primary btn--sm" :disabled="busy" @click="fix">
              {{ busy ? 'Работаем…' : 'Уплотнить и прижать' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
