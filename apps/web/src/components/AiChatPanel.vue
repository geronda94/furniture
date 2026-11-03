<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  apiAiChat,
  apiAiStatus,
  apiAnalyzePlan,
  apiApplyActions,
  apiPreviewProject,
  type AiChatMessage,
  type AiStatus,
  type ImportedPlan,
} from '../api'
import {
  flushSave,
  notify,
  openProject,
  partSelection,
  pushHistory,
  selectQuiet,
  state,
  ui,
  undo,
} from '../state/project'
import { createEmptyProject, isClientTool } from '../ai/tools'

type Bridge = {
  context: () => Record<string, unknown>
  tools: { name: string }[]
  run: (name: string, args: Record<string, unknown>) =>
    Promise<{ ok: boolean; result?: unknown; error?: string;
      switchTo?: string; switchCopy?: boolean;
      stage?: Record<string, unknown>[] }>
}

type Bubble = {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  tools?: string[]
  image?: string
  error?: boolean
}

const status = ref<AiStatus | null>(null)
const configured = ref(true)
const setupHint = ref('')
const bubbles = ref<Bubble[]>([])
const apiMessages = ref<AiChatMessage[]>([])
const input = ref('')
const busy = ref(false)
const error = ref('')
const preview = ref<Record<string, any> | null>(null)
const pending = ref<Record<string, unknown>[]>([])
const plan = ref<ImportedPlan | null>(null)
const planBusy = ref(false)
const planError = ref('')
const planInput = ref<HTMLInputElement | null>(null)
let seq = 0
let restoring = false

const storageKey = (): string => `furniture.ai.chat.${state.projectId}`

function persist(): void {
  if (restoring) return
  try {
    const plain = bubbles.value.map((b) => ({
      id: b.id, role: b.role, text: b.text, tools: b.tools,
      error: b.error,
    }))
    localStorage.setItem(storageKey(), JSON.stringify({
      bubbles: plain,
      apiMessages: apiMessages.value,
    }))
  } catch { /* переполнение/приватный режим — не критично */ }
}

function restore(): void {
  restoring = true
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) {
      bubbles.value = []
      apiMessages.value = []
      return
    }
    const data = JSON.parse(raw) as {
      bubbles?: Bubble[]
      apiMessages?: AiChatMessage[]
    }
    bubbles.value = (data.bubbles || []).map((b) => ({ ...b }))
    apiMessages.value = data.apiMessages || []
    seq = bubbles.value.reduce((m, b) => Math.max(m, b.id), 0)
  } catch {
    bubbles.value = []
    apiMessages.value = []
  } finally {
    restoring = false
  }
}

function newDialog(): void {
  bubbles.value = []
  apiMessages.value = []
  preview.value = null
  pending.value = []
  error.value = ''
  try { localStorage.removeItem(storageKey()) } catch { /* ignore */ }
}

watch([bubbles, apiMessages], persist, { deep: true })
watch(() => state.projectId, () => restore())

const bridge = (): Bridge | undefined =>
  (window as unknown as { __furnitureAI?: Bridge }).__furnitureAI

const planApplyActions = computed<Record<string, unknown>[]>(() => {
  const p = plan.value?.plan
  if (!p?.room || p.needs_dimensions) return []
  const actions: Record<string, unknown>[] = [{
    op: 'resize_room',
    w: p.room.w, d: p.room.d, h: p.room.h,
    wallT: p.room.wallT, outline: p.room.outline,
  }]
  for (const part of p.partitions || []) {
    actions.push({ op: 'add_partition', a: part.a, b: part.b,
      wallT: part.wallT })
  }
  for (const o of p.openings || []) {
    actions.push({
      op: 'add_opening', kind: o.kind, wall: o.wall,
      x: o.x, w: o.w, z0: o.z0, z1: o.z1,
    })
  }
  return actions
})

const planSummary = computed(() => {
  const p = plan.value
  if (!p) return ''
  const room = p.plan?.room
  const bits = [
    p.kind.toUpperCase(),
    room ? `${Math.round(room.w)}×${Math.round(room.d)} мм`
      : 'размеры не распознаны',
  ]
  if (p.plan?.openings?.length) bits.push(`проёмов ${p.plan.openings.length}`)
  if (p.plan?.partitions?.length) {
    bits.push(`перегородок ${p.plan.partitions.length}`)
  }
  if (p.plan?.confidence) {
    bits.push(`уверенность ${Math.round(p.plan.confidence * 100)}%`)
  }
  return bits.join(' · ')
})

const planCurrentHint = computed(() => (
  state.project.instances.length
    ? 'В проекте есть мебель — применяйте план в новый проект.'
    : ''
))

const planNotes = computed(() => {
  const p = plan.value
  if (!p) return ''
  const notes = [...(p.plan?.notes || []), ...(p.notes || [])]
    .filter((x, i, a) => x && a.indexOf(x) === i)
  if (p.plan?.needs_dimensions && p.plan.questions?.length) {
    notes.unshift('Нужны размеры: ' + p.plan.questions.join('; '))
  }
  return notes.slice(0, 3).join(' · ')
})

function withPlan<T extends Record<string, unknown>>(ctx: T): T {
  if (plan.value?.plan) ctx.plan = plan.value.plan
  return ctx
}

async function onPlanFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  planBusy.value = true
  planError.value = ''
  try {
    const res = await apiAnalyzePlan(state.projectId, file)
    plan.value = res
    add('tool', `Файл: ${res.filename}`,
      res.preview ? { image: res.preview } : {})
    add('system', planSummary.value)
  } catch (e) {
    planError.value = e instanceof Error ? e.message : String(e)
  } finally {
    planBusy.value = false
  }
}

async function applyPlan(): Promise<void> {
  const actions = planApplyActions.value
  if (!actions.length) {
    planError.value = 'Комната не распознана — укажите размеры текстом'
    return
  }
  planError.value = ''
  await showPreview(actions)
}

async function applyPlanAsNewProject(): Promise<void> {
  const p = plan.value
  if (!p) return
  const actions = planApplyActions.value
  if (!actions.length) {
    planError.value = 'Комната не распознана — укажите размеры текстом'
    return
  }
  planError.value = ''
  busy.value = true
  try {
    const name = `${p.filename.replace(/\.[^.]+$/, '') || 'План'} — проект`
    const id = await createEmptyProject(name)
    await switchProject(id, name, true)
    await showPreview(actions)
  } catch (e) {
    planError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function askPlan(): void {
  input.value = 'Расставь мебель по прикреплённому плану, комнату не меняй.'
}

function clearPlan(): void {
  plan.value = null
  planError.value = ''
}

const contextLabel = computed(() => {
  if (partSelection.instanceId && partSelection.part != null) {
    const inst = state.project.instances.find((i) => i.id === partSelection.instanceId)
    return `${inst?.name || 'модуль'} · деталь #${partSelection.part + 1}`
  }
  if (state.selection) {
    const inst = state.project.instances.find((i) => i.id === state.selection)
    return inst?.name || state.selection
  }
  if (state.wallIndex != null) return `стена ${state.wallIndex + 1}`
  if (state.propId) return 'декор'
  return 'вся сцена'
})

function add(role: Bubble['role'], text: string, extra: Partial<Bubble> = {}): void {
  bubbles.value.push({ id: ++seq, role, text, ...extra })
}

onMounted(async () => {
  restore()
  try {
    status.value = await apiAiStatus()
    configured.value = status.value.configured
  } catch {
    configured.value = false
  }
})

function quick(text: string): void {
  input.value = text
}

async function send(): Promise<void> {
  const text = input.value.trim()
  if (!text || busy.value) return
  if (!configured.value) {
    setupHint.value = 'ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env и перезапустите API'
    return
  }
  const api = bridge()
  if (!api) {
    error.value = '3D-сцена ещё не готова, попробуйте через секунду'
    return
  }
  input.value = ''
  error.value = ''
  add('user', text)
  apiMessages.value.push({ role: 'user', content: text })
  busy.value = true
  try {
    await runLoop(api)
    // Предпросмотр с ошибками: даём модели шанс исправить пакет сам.
    for (let attempt = 0; attempt < 2; attempt++) {
      const pv = preview.value
      if (!pv || Number(pv.errors || 0) <= 0) break
      if (!(await repairPreview(api, pv))) break
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function repairPreview(
  api: Bridge,
  pv: Record<string, any>,
): Promise<boolean> {
  const issues = (pv.issues || [])
    .filter((i: { level?: string }) => i.level === 'error')
    .slice(0, 6)
  const text = issues.length
    ? issues.map((i: { code?: string; message?: string; fix?: string }) =>
      `${i.code || 'error'}: ${i.message || ''}${i.fix ? ` — ${i.fix}` : ''}`)
      .join('\n')
    : 'пакет не прошёл проверку'
  add('system', 'Предпросмотр с ошибками — исправляю автоматически.')
  add('tool', text, { error: true })
  apiMessages.value.push({
    role: 'user',
    content: 'Предпросмотр вернул ошибки:\n' + text +
      '\nВерни ПОЛНЫЙ исправленный пакет действий заново (все нужные операции, '
      + 'не только изменённые). Не задавай вопросов — исправь сам: подбери '
      + 'позицию/размер, убери лишнее или используй свободное место из '
      + 'подсказки.',
  })
  preview.value = null
  pending.value = []
  await runLoop(api)
  return true
}

function needConfirm(args: Record<string, any>): string | null {
  return args.confirm === true
    ? null
    : 'удаление нужно подтвердить: попросите человека и повторите с confirm=true'
}

function serverActions(
  name: string,
  args: Record<string, any>,
): { actions?: Record<string, unknown>[]; error?: string } {
  switch (name) {
    case 'add_module':
      return { actions: [{ op: 'add_instance', ...args }] }
    case 'update_module':
      return { actions: [{ op: 'update_instance', ...args }] }
    case 'add_row':
      return { actions: [{ op: 'add_row', ...args }] }
    case 'fit_module':
      return { actions: [{ op: 'fit_module', ...args }] }
    case 'duplicate_module':
      return { actions: [{ op: 'duplicate_instance', ...args }] }
    case 'delete_module': {
      const no = needConfirm(args)
      if (no) return { error: no }
      return { actions: [{ op: 'delete_instance', id: args.id }] }
    }
    case 'add_opening':
      return { actions: [{ op: 'add_opening', ...args }] }
    case 'update_opening':
      return { actions: [{ op: 'update_opening', id: args.id, patch: args.patch || {} }] }
    case 'delete_opening': {
      const no = needConfirm(args)
      if (no) return { error: no }
      return { actions: [{ op: 'delete_opening', id: args.id }] }
    }
    case 'resize_room':
      return { actions: [{ op: 'resize_room', ...args }] }
    case 'set_room':
      return { actions: [{ op: 'set_room', patch: args.patch || {} }] }
    case 'add_partition':
      return { actions: [{ op: 'add_partition', ...args }] }
    case 'update_partition':
      return { actions: [{ op: 'update_partition', index: args.index, patch: args.patch || {} }] }
    case 'delete_partition':
      return { actions: [{ op: 'delete_partition', index: args.index }] }
    case 'add_wall_item':
      return { actions: [{ op: 'add_wall_item', ...args }] }
    case 'update_wall_item':
      return { actions: [{ op: 'update_wall_item', id: args.id, patch: args.patch || {} }] }
    case 'delete_wall_item': {
      const no = needConfirm(args)
      if (no) return { error: no }
      return { actions: [{ op: 'delete_wall_item', id: args.id }] }
    }
    case 'add_decor':
      return { actions: [{ op: 'add_decor', ...args }] }
    case 'update_decor':
      return { actions: [{ op: 'update_decor', id: args.id, patch: args.patch || {} }] }
    case 'delete_decor': {
      const no = needConfirm(args)
      if (no) return { error: no }
      return { actions: [{ op: 'delete_decor', id: args.id }] }
    }
    case 'set_globals':
      return { actions: [{ op: 'set_globals', patch: args.patch || {} }] }
    case 'set_materials':
      return { actions: [{ op: 'set_materials', materials: args.materials || {} }] }
    case 'set_module_material':
      return { actions: [{ op: 'set_instance_material', ...args }] }
    case 'normalize_layout':
      return {
        actions: [{
          op: 'normalize_layout',
          close_gaps: args.close_gaps !== false,
          fix_decor: args.fix_decor !== false,
        }],
      }
    case 'fix_issues':
      return { actions: [{ op: 'fix_issues', ...args }] }
    case 'add_folder':
      return { actions: [{ op: 'add_folder', ...args }] }
    case 'update_folder':
      return { actions: [{ op: 'update_folder', ...args }] }
    case 'delete_folder':
      return { actions: [{ op: 'delete_folder', id: args.id }] }
    case 'rename_project':
      return { actions: [{ op: 'rename_project', name: args.name }] }
    case 'preview_actions':
      return {
        actions: Array.isArray(args.actions)
          ? args.actions as Record<string, unknown>[]
          : [],
      }
    default:
      return { error: `Инструмент «${name}» пока не реализован` }
  }
}

const TOOL_LABEL: Record<string, string> = {
  add_module: 'Добавляю модуль',
  update_module: 'Меняю модуль',
  add_row: 'Ставлю ряд',
  fit_module: 'Подгоняю высоту',
  duplicate_module: 'Копирую модуль',
  delete_module: 'Удаляю модуль',
  add_opening: 'Добавляю проём',
  update_opening: 'Меняю проём',
  delete_opening: 'Удаляю проём',
  resize_room: 'Меняю комнату',
  set_room: 'Настраиваю комнату',
  add_partition: 'Добавляю перегородку',
  update_partition: 'Меняю перегородку',
  delete_partition: 'Удаляю перегородку',
  add_wall_item: 'Вешаю предмет на стену',
  update_wall_item: 'Меняю предмет на стене',
  delete_wall_item: 'Снимаю предмет со стены',
  add_decor: 'Добавляю декор',
  update_decor: 'Меняю декор',
  delete_decor: 'Удаляю декор',
  set_globals: 'Меняю общие параметры',
  set_materials: 'Меняю материалы',
  set_module_material: 'Меняю материал модуля',
  normalize_layout: 'Уплотняю расстановку',
  fix_issues: 'Исправляю ошибки',
  add_folder: 'Создаю папку',
  update_folder: 'Меняю папку',
  delete_folder: 'Удаляю папку',
  rename_project: 'Переименовываю проект',
  validate: 'Проверяю проект',
  get_quote: 'Считаю смету',
  get_parts: 'Смотрю деталировку',
  project_list: 'Смотрю проекты',
  project_open: 'Открываю проект',
  project_create: 'Создаю проект',
  project_quickstart: 'Создаю проект по сценарию',
  project_delete: 'Удаляю проект',
  undo: 'Отменяю',
  redo: 'Возвращаю',
  save: 'Сохраняю',
  export_file: 'Готовлю файл',
  set_part_material: 'Крашу деталь',
  reset_part_material: 'Сбрасываю материал детали',
  version_create: 'Сохраняю версию',
  version_list: 'Смотрю версии',
  version_restore: 'Откатываю версию',
  ui_panel: 'Открываю панель',
  toggle_part: 'Открываю фасады',
  select_all: 'Выделяю всё',
  camera_set: 'Ставлю камеру',
  camera_focus: 'Навожу камеру',
  selection_set: 'Выделяю объект',
  view_mode: 'Меняю вид',
  walls_mode: 'Меняю стены',
  dims_set: 'Настраиваю размеры',
  scene_screenshot: 'Делаю снимок',
}

async function switchProject(
  id: string, name: string, copy: boolean,
): Promise<void> {
  preview.value = null
  pending.value = []
  if (copy) {
    add('system', `Открыт проект «${name}».`)
    try {
      localStorage.setItem(`furniture.ai.chat.${id}`, JSON.stringify({
        bubbles: bubbles.value.map((b) => ({
          id: b.id, role: b.role, text: b.text, tools: b.tools, error: b.error,
        })),
        apiMessages: apiMessages.value,
      }))
    } catch { /* ignore */ }
    await openProject(id)
  } else {
    await openProject(id)
    add('system', `Открыт проект «${state.project.name}».`)
  }
}

async function runLoop(api: Bridge): Promise<void> {
  let ctx = withPlan(api.context())
  const staged: Record<string, unknown>[] = []
  let switchTo: string | null = null
  let switchCopy = true
  let switchName = ''
  for (let round = 0; round < 6; round++) {
    const reply = await apiAiChat(apiMessages.value, ctx)
    if (!reply.configured) {
      configured.value = false
      setupHint.value = reply.message || 'ИИ не настроен'
      return
    }
    const msg = reply.message_data
    if (!msg) return
    apiMessages.value.push({
      role: 'assistant',
      content: msg.content || '',
      tool_calls: msg.tool_calls,
    })
    if (msg.content?.trim()) add('assistant', msg.content.trim())
    if (!msg.tool_calls?.length) break
    for (const call of msg.tool_calls) {
      let args: Record<string, any> = {}
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      } catch {
        args = {}
      }
      const name = call.function.name
      const label = TOOL_LABEL[name] || name
      let result: Record<string, unknown>
      if (isClientTool(name)) {
        const r = await api.run(name, args)
        if (name === 'scene_screenshot' && r.ok && typeof r.result === 'string') {
          add('tool', 'Снимок сцены', { image: r.result })
          result = { ok: true, screenshot: 'прикреплён' }
        } else {
          result = r.ok
            ? { ok: true, result: r.result }
            : { ok: false, error: r.error }
        }
        let note = `${label}${r.ok ? '' : ': ошибка'}`
        if (r.ok && name === 'validate') {
          const v = r.result as { errors?: number; warnings?: number } | undefined
          note = `Проверка: ошибок ${v?.errors ?? 0}, предупреждений ${v?.warnings ?? 0}`
        } else if (r.ok && name === 'get_quote') {
          const q = r.result as { totals?: Record<string, number> } | undefined
          const t = Object.entries(q?.totals || {})
            .map(([cur, sum]) => `${Math.round(sum)} ${cur}`).join(', ')
          note = `Смета: ${t || 'нет расчёта'}`
        } else if (r.ok && name === 'get_parts') {
          const p = r.result as { total?: number } | undefined
          note = `Деталировка: ${p?.total ?? 0} деталей`
        }
        add('tool', note)
        if (r.ok && r.stage?.length) staged.push(...r.stage)
        if (r.switchTo) {
          switchTo = r.switchTo
          switchCopy = r.switchCopy !== false
          const res = r.result as { name?: string } | undefined
          switchName = res?.name || r.switchTo
        }
      } else {
        const mapped = serverActions(name, args)
        if (mapped.error) {
          result = { ok: false, error: mapped.error }
          add('tool', `${label}: ${mapped.error}`, { error: true })
        } else {
          staged.push(...(mapped.actions || []))
          result = { ok: true, staged: true, actions: mapped.actions?.length ?? 0 }
          add('tool', `${label}: подготовлено`)
        }
      }
      apiMessages.value.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result),
      })
    }
    if (switchTo) break
    ctx = withPlan(api.context())
  }
  if (switchTo) {
    if (staged.length) {
      add('system', 'Пакет отменён: проект сменился — повторите действия в новом проекте.',
        { error: true })
    }
    await switchProject(switchTo, switchName, switchCopy)
    return
  }
  if (staged.length > 12) {
    error.value = 'За один раз не больше 12 операций — разбейте на несколько шагов'
    return
  }
  if (staged.length) await showPreview(staged)
}

async function showPreview(actions: Record<string, unknown>[]): Promise<void> {
  pending.value = actions
  const saved = await flushSave(true)
  if (!saved) {
    error.value = 'Не удалось сохранить текущие правки перед предпросмотром'
    return
  }
  const pid = state.projectId
  try {
    preview.value = await apiPreviewProject(pid, actions)
  } catch (e) {
    // Атомарный отказ сервера — тоже показываем как ошибку пакета, чтобы
    // модель могла исправить его в следующем раунде.
    const message = e instanceof Error ? e.message : String(e)
    preview.value = {
      errors: 1,
      warnings: 0,
      issues: [{ code: 'preview', level: 'error', message }],
      changes: {},
      cost: { delta: 0, currency: '' },
    }
  }
}

function previewText(pv: Record<string, any>): string {
  const ch = pv.changes || {}
  const inst = ch.instances || {}
  const props = ch.props || {}
  const room = ch.room || {}
  const folders = ch.folders || {}
  const parts = [
    `+${inst.added?.length || 0} модулей`,
    `−${inst.removed?.length || 0}`,
    `изменено ${inst.updated?.length || 0}`,
  ]
  if (props.added?.length || props.removed?.length || props.updated?.length) {
    parts.push('декор')
  }
  const roomBits: string[] = []
  if ('outline' in room || 'w' in room || 'd' in room || 'h' in room) {
    roomBits.push('габариты')
  }
  if ('openings' in room) roomBits.push('проёмы')
  if ('partitions' in room) roomBits.push('перегородки')
  if ('wallItems' in room) roomBits.push('предметы на стенах')
  if (roomBits.length) parts.push(`комната: ${roomBits.join(', ')}`)
  if (folders.added?.length || folders.removed?.length) parts.push('папки')
  if (ch.project?.name) parts.push('название')
  const d = pv.cost?.delta ?? 0
  const cur = pv.cost?.currency || pv.cost?.after?.currency || ''
  return `${parts.join(' · ')}; смета ${d > 0 ? '+' : ''}${d} ${cur}; `
    + `ошибок ${pv.errors ?? 0}, предупреждений ${pv.warnings ?? 0}`
}

async function applyPreview(): Promise<void> {
  if (!preview.value || busy.value) return
  if ((preview.value.errors ?? 0) > 0) {
    error.value = 'Есть ошибки — исправьте их в панели расстановки'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const pid = state.projectId
    pushHistory('ИИ: пакет')
    const pv = preview.value
    const changed = [
      ...(pv?.changes?.instances?.added || []),
      ...(pv?.changes?.instances?.updated || []),
    ]
      .map((row: { id?: string }) => row.id)
      .filter((id): id is string => !!id)
    await apiApplyActions(pid, pending.value, true)
    await openProject(pid, true, false, true)
    if (changed.length) {
      const keep = changed.find((id) =>
        state.project.instances.some((i) => i.id === id))
      if (keep) selectQuiet(keep)
      add('system', `Применено. Изменено объектов: ${changed.length}. Выделен первый.`)
    } else {
      add('system', 'Применено. Одно действие — один шаг истории.')
    }
    notify('ИИ: изменения применены', 'undo')
    preview.value = null
    pending.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function cancelPreview(): void {
  preview.value = null
  pending.value = []
}

function undoLast(): void {
  undo()
  add('system', 'Отменено последнее действие')
}

function parseIssues(pv: Record<string, any>): string[] {
  return (pv.issues || [])
    .filter((i: { level?: string }) => i.level === 'error')
    .slice(0, 4)
    .map((i: { message?: string }) => i.message || '')
}
</script>

<template>
  <button
    v-if="!ui.aiOpen && !state.presentation"
    class="ai-launcher"
    title="ИИ-конструктор"
    @click="ui.aiOpen = true"
  >ИИ</button>

  <aside v-else-if="ui.aiOpen" class="ai-panel" aria-label="ИИ-конструктор">
    <header class="ai-head">
      <div>
        <b>ИИ-конструктор</b>
        <span class="ai-model">{{ status?.model || 'deepseek' }}</span>
      </div>
      <div class="ai-head-actions">
        <button class="ai-new" title="Новый диалог" @click="newDialog">＋</button>
        <button class="ai-x" title="Закрыть" @click="ui.aiOpen = false">×</button>
      </div>
    </header>
    <div class="ai-context" :title="'Контекст: камера, выделение, комната, объекты, ошибки'">
      Вижу: {{ contextLabel }} · {{ state.project.name }}
    </div>

    <div v-if="plan" class="ai-plan">
      <img v-if="plan.preview" class="ai-plan-shot" :src="plan.preview"
        :alt="plan.filename">
      <div class="ai-plan-body">
        <b>{{ plan.filename }}</b>
        <p>{{ planSummary }}</p>
        <p v-if="planNotes" class="ai-plan-notes">{{ planNotes }}</p>
        <p v-if="planError" class="ai-plan-error">{{ planError }}</p>
        <p v-if="planCurrentHint" class="ai-plan-notes">{{ planCurrentHint }}</p>
        <div class="ai-plan-actions">
          <button class="btn btn--primary btn--sm"
            :disabled="busy || !planApplyActions.length"
            @click="applyPlanAsNewProject">
            Новый проект по плану
          </button>
          <button class="btn btn--sm"
            :disabled="busy || !planApplyActions.length
              || state.project.instances.length > 0"
            @click="applyPlan">
            Применить в текущий
          </button>
          <button class="btn btn--sm" :disabled="busy || !configured"
            @click="askPlan">Расставить мебель</button>
          <button class="btn btn--ghost btn--sm" :disabled="busy"
            @click="clearPlan">Убрать</button>
        </div>
      </div>
    </div>

    <div class="ai-log">
      <div v-if="!bubbles.length" class="ai-empty">
        <p>Опишите, что сделать. Я вижу камеру, выделение и проект.</p>
        <div class="ai-chips">
          <button @click="quick('Создай проект: комната 4×3 м, окно 1.5 м и дверь 0.9 м')">Комната 4×3</button>
          <button @click="quick('Построй кухню вдоль свободной стены')">Кухня</button>
          <button @click="quick('Сделай шкаф до потолка шириной 2 метра')">Шкаф до потолка</button>
          <button @click="quick('Добавь ящики в выделенный модуль и поставь ручки')">Ящики и ручки</button>
          <button @click="quick('Проверь проект и исправь ошибки')">Проверить и исправить</button>
          <button @click="quick('Сколько стоит проект?')">Смета</button>
        </div>
      </div>
      <div v-for="b in bubbles" :key="b.id" class="ai-msg" :class="`is-${b.role}`">
        <div class="ai-text" :class="{ 'is-error': b.error }">{{ b.text }}</div>
        <img v-if="b.image" class="ai-shot" :src="b.image" alt="Снимок сцены" />
      </div>

      <div v-if="preview" class="ai-preview">
        <b>Предпросмотр</b>
        <p>{{ previewText(preview) }}</p>
        <ul v-if="parseIssues(preview).length" class="ai-issues">
          <li v-for="(m, i) in parseIssues(preview)" :key="i">{{ m }}</li>
        </ul>
        <div class="ai-preview-actions">
          <button class="btn btn--primary btn--sm" :disabled="busy || preview.errors > 0" @click="applyPreview">
            Применить
          </button>
          <button class="btn btn--sm" :disabled="busy" @click="cancelPreview">Отмена</button>
          <button class="btn btn--ghost btn--sm" :disabled="busy" @click="undoLast">Отменить последнее</button>
        </div>
      </div>
    </div>

    <p v-if="planBusy" class="ai-hint">Читаю план…</p>
    <p v-if="!configured" class="ai-hint">
      ИИ не настроен. Добавьте <code>DEEPSEEK_API_KEY</code> в <code>.env</code>
      и перезапустите <code>api</code>. Модель: <code>deepseek-chat</code>.
    </p>
    <p v-else-if="setupHint" class="ai-hint">{{ setupHint }}</p>
    <p v-if="error" class="ai-error">{{ error }}</p>

    <form class="ai-form" @submit.prevent="send">
      <button type="button" class="ai-attach" :disabled="busy || planBusy"
        title="Прикрепить план: PDF, PNG/JPG, DXF, SVG"
        @click="planInput?.click()">📎</button>
      <input ref="planInput" type="file" hidden
        accept=".pdf,.dxf,.svg,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
        @change="onPlanFile">
      <textarea
        v-model="input"
        rows="2"
        :disabled="busy || !configured"
        placeholder="Например: расширь выделенный модуль на 10 см до стены"
        @keydown.enter.exact.prevent="send"
      />
      <button class="btn btn--primary btn--sm" :disabled="busy || !input.trim() || !configured">
        {{ busy ? 'Думаю…' : 'Отправить' }}
      </button>
    </form>
  </aside>
</template>

<style scoped>
.ai-launcher {
  position: fixed;
  right: 18px;
  bottom: 52px;
  z-index: 60;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid #3a3f46;
  background: #ffbe55;
  color: #1b1305;
  font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
.ai-panel {
  position: fixed;
  right: 12px;
  top: 56px;
  bottom: 28px;
  width: min(380px, calc(100vw - 24px));
  z-index: 70;
  display: flex;
  flex-direction: column;
  background: #15181d;
  border: 1px solid #2c323a;
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  color: #e8ecf1;
  overflow: hidden;
}
.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #262c33;
  font-size: 13px;
}
.ai-model { margin-left: 8px; color: #8d98a5; font-size: 10px; }
.ai-head-actions { display: flex; align-items: center; gap: 2px; }
.ai-new, .ai-x { border: 0; background: none; color: #9aa4b0; font-size: 18px; cursor: pointer; }
.ai-x { font-size: 20px; }
.ai-context {
  padding: 6px 12px;
  font-size: 10px;
  color: #8d98a5;
  border-bottom: 1px solid #22272e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ai-plan {
  margin: 8px 12px 0;
  display: flex;
  gap: 8px;
  padding: 8px;
  border: 1px solid #3a424c;
  border-radius: 7px;
  background: #1a1f26;
}
.ai-plan-shot {
  width: 84px;
  height: 64px;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid #2c323a;
  flex: 0 0 auto;
}
.ai-plan-body { min-width: 0; font-size: 11px; }
.ai-plan-body b { display: block; color: #e8ecf1; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.ai-plan-body p { margin: 3px 0; color: #cfd7df; }
.ai-plan-notes { color: #9aa4b0; font-size: 10px; }
.ai-plan-error { color: #ff8d8d; }
.ai-plan-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.ai-attach {
  flex: 0 0 auto;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #343c46;
  background: #1c2128;
  color: #cfd7df;
  cursor: pointer;
}
.ai-log { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.ai-empty { color: #9aa4b0; font-size: 12px; }
.ai-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.ai-chips button {
  padding: 4px 7px; font-size: 10px; border-radius: 5px;
  border: 1px solid #39414b; background: #1c2128; color: #cfd7df; cursor: pointer;
}
.ai-msg { font-size: 12px; line-height: 1.45; }
.ai-msg.is-user .ai-text { color: #ffd28a; }
.ai-msg.is-tool .ai-text { color: #8d98a5; font-size: 10px; }
.ai-msg.is-system .ai-text { color: #7fe0c2; font-size: 11px; }
.ai-text { white-space: pre-wrap; }
.ai-text.is-error { color: #ff8d8d; }
.ai-shot { margin-top: 6px; width: 100%; border-radius: 5px; border: 1px solid #2c323a; }
.ai-preview {
  border: 1px solid #3a424c; border-radius: 7px; padding: 8px;
  background: #1a1f26; font-size: 11px;
}
.ai-preview p { margin: 5px 0; color: #cfd7df; }
.ai-issues { margin: 4px 0; padding-left: 16px; color: #ff8d8d; font-size: 10px; }
.ai-preview-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.ai-hint { margin: 0; padding: 8px 12px; font-size: 10px; color: #ffbe55; border-top: 1px solid #262c33; }
.ai-error { margin: 0; padding: 6px 12px; font-size: 10px; color: #ff8d8d; }
.ai-form { display: flex; gap: 6px; padding: 8px 12px 12px; border-top: 1px solid #262c33; }
.ai-form textarea {
  flex: 1; resize: none; padding: 7px 8px; border-radius: 6px;
  border: 1px solid #343c46; background: #101419; color: #e8ecf1;
  font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
}
@media (max-width: 900px) {
  .ai-panel { left: 8px; right: 8px; top: 8px; bottom: 64px; width: auto; }
  .ai-launcher { bottom: 74px; }
}
</style>
