<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  apiAiChat,
  apiAiStatus,
  apiApplyActions,
  apiPreviewProject,
  type AiChatMessage,
  type AiStatus,
} from '../api'
import {
  flushSave,
  notify,
  openProject,
  partSelection,
  pushHistory,
  state,
  ui,
  undo,
} from '../state/project'

type Bridge = {
  context: () => Record<string, unknown>
  tools: { name: string }[]
  run: (name: string, args: Record<string, unknown>) =>
    Promise<{ ok: boolean; result?: unknown; error?: string }>
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
let seq = 0

const bridge = (): Bridge | undefined =>
  (window as unknown as { __furnitureAI?: Bridge }).__furnitureAI

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
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

const CLIENT = new Set([
  'camera_set', 'camera_focus', 'selection_set', 'view_mode',
  'walls_mode', 'dims_set', 'scene_screenshot',
])

function serverActions(
  name: string,
  args: Record<string, any>,
): { actions?: Record<string, unknown>[]; error?: string } {
  switch (name) {
    case 'add_module':
      return { actions: [{ op: 'add_instance', ...args }] }
    case 'update_module':
      return { actions: [{ op: 'update_instance', ...args }] }
    case 'delete_module':
      return { actions: [{ op: 'delete_instance', id: args.id }] }
    case 'add_opening':
      return { actions: [{ op: 'add_opening', ...args }] }
    case 'set_room':
      return { actions: [{ op: 'set_room', patch: args.patch || {} }] }
    case 'set_globals':
      return { actions: [{ op: 'set_globals', patch: args.patch || {} }] }
    case 'preview_actions':
      return {
        actions: Array.isArray(args.actions)
          ? args.actions as Record<string, unknown>[]
          : [],
      }
    case 'normalize_layout':
    case 'validate':
      return { error: 'Это действие пока доступно в панели расстановки' }
    default:
      return { error: `Инструмент «${name}» пока не реализован` }
  }
}

async function runLoop(api: Bridge): Promise<void> {
  let ctx = api.context()
  const staged: Record<string, unknown>[] = []
  for (let round = 0; round < 4; round++) {
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
      let result: Record<string, unknown>
      if (CLIENT.has(name)) {
        const r = await api.run(name, args)
        if (name === 'scene_screenshot' && r.ok && typeof r.result === 'string') {
          add('tool', 'Снимок сцены', { image: r.result })
          result = { ok: true, screenshot: 'прикреплён' }
        } else {
          result = r.ok
            ? { ok: true, result: r.result }
            : { ok: false, error: r.error }
        }
        add('tool', `${name}${r.ok ? '' : ': ошибка'}`)
      } else {
        const mapped = serverActions(name, args)
        if (mapped.error) {
          result = { ok: false, error: mapped.error }
          add('tool', `${name}: ${mapped.error}`, { error: true })
        } else {
          staged.push(...(mapped.actions || []))
          result = { ok: true, staged: true, actions: mapped.actions?.length ?? 0 }
          add('tool', `${name}: подготовлено`)
        }
      }
      apiMessages.value.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result),
      })
    }
    ctx = api.context()
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
  const pv = await apiPreviewProject(pid, actions)
  preview.value = pv
}

function previewText(pv: Record<string, any>): string {
  const ch = pv.changes || {}
  const inst = ch.instances || {}
  const props = ch.props || {}
  const parts = [
    `+${inst.added?.length || 0} модулей`,
    `−${inst.removed?.length || 0}`,
    `изменено ${inst.updated?.length || 0}`,
  ]
  if (props.added?.length || props.removed?.length || props.updated?.length) {
    parts.push('декор меняется')
  }
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
    await apiApplyActions(pid, pending.value, true)
    await openProject(pid, true, false, true)
    add('system', 'Применено. Одно действие — один шаг истории.')
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
      <button class="ai-x" title="Закрыть" @click="ui.aiOpen = false">×</button>
    </header>
    <div class="ai-context" :title="'Контекст: камера, выделение, комната, объекты, ошибки'">
      Вижу: {{ contextLabel }} · {{ state.project.name }}
    </div>

    <div class="ai-log">
      <div v-if="!bubbles.length" class="ai-empty">
        <p>Опишите, что сделать. Я вижу камеру, выделение и проект.</p>
        <div class="ai-chips">
          <button @click="quick('Расширь выделенный модуль на 10 см')">Шире на 10 см</button>
          <button @click="quick('Заполни зазор выделенного модуля до стены')">Заполнить зазор</button>
          <button @click="quick('Добавь рядом модуль 600')">Добавить модуль</button>
          <button @click="quick('Поменяй фасад выделенного модуля на МДФ')">Фасад на МДФ</button>
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

    <p v-if="!configured" class="ai-hint">
      ИИ не настроен. Добавьте <code>DEEPSEEK_API_KEY</code> в <code>.env</code>
      и перезапустите <code>api</code>. Модель: <code>deepseek-chat</code>.
    </p>
    <p v-else-if="setupHint" class="ai-hint">{{ setupHint }}</p>
    <p v-if="error" class="ai-error">{{ error }}</p>

    <form class="ai-form" @submit.prevent="send">
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
.ai-x { border: 0; background: none; color: #9aa4b0; font-size: 20px; cursor: pointer; }
.ai-context {
  padding: 6px 12px;
  font-size: 10px;
  color: #8d98a5;
  border-bottom: 1px solid #22272e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
