/**
 * Клиентские инструменты ИИ: камера, вид, проверка, смета, проекты, панели.
 * Серверные операции (комната, мебель, материалы) идут через
 * /api/projects/{id}/preview и /actions — здесь только UI/чтение/проекты.
 */
import type { BabylonRenderer } from '../render3d/babylonScene'
import {
  apiCreateVersion,
  apiDeleteProject,
  apiListProjects,
  apiListVersions,
  apiProjectLayout,
  apiPutProject,
  apiQuickStart,
  apiRestoreVersion,
  type QuickStartInput,
} from '../api'
import {
  closeDetail,
  closeObjectModal,
  derived,
  ensureSolved,
  flushSave,
  openDetail,
  openObjectModal,
  openProject,
  partSelection,
  redo,
  select,
  selectAll,
  selectOpening,
  selectPart,
  selectProp,
  selectWall,
  setPresentation,
  setViewMode,
  setWallMode,
  state,
  toggleDoors,
  toggleDrawers,
  ui,
  undo,
} from '../state/project'
import { defaultProject } from '../state/defaults'
import { moduleInfo } from '../module/info'
import { partUid, resolveObjectMaterial } from '../material/vars'

export type AiToolResult = {
  ok: boolean
  result?: unknown
  error?: string
  /** Панель должна открыть этот проект. */
  switchTo?: string
  /** Перенести текущий диалог в новый проект (create/quickstart). */
  switchCopy?: boolean
  /** Готовые серверные операции, которые панель добавит в пакет. */
  stage?: Record<string, unknown>[]
}

type Args = Record<string, unknown>

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

async function waitObjects(id: string) {
  ensureSolved(id)
  for (let i = 0; i < 24; i++) {
    const objs = derived[id]?.objects
    if (objs?.length) return objs
    await new Promise((r) => setTimeout(r, 250))
  }
  return derived[id]?.objects
}

export const CLIENT_TOOLS = [
  { name: 'validate', description: 'Проверить проект: ошибки/предупреждения с подсказками.' },
  { name: 'get_quote', description: 'Смета: итог и стоимость по модулям.' },
  { name: 'get_parts', description: 'Деталировка модуля по id или выделенному.' },
  { name: 'project_list', description: 'Список проектов пользователя.' },
  { name: 'project_open', description: 'Открыть проект по id.' },
  { name: 'project_create', description: 'Создать пустой проект и открыть.' },
  { name: 'project_quickstart', description: 'Проект под ключ: комната + сценарий.' },
  { name: 'project_delete', description: 'Удалить проект (кроме текущего).' },
  { name: 'set_part_material', description: 'Материал отдельной детали модуля.' },
  { name: 'reset_part_material', description: 'Сбросить материал детали.' },
  { name: 'version_create', description: 'Сохранить версию проекта.' },
  { name: 'version_list', description: 'Список версий проекта.' },
  { name: 'version_restore', description: 'Откатить проект к версии.' },
  {
    name: 'camera_set',
    description: 'Поставить камеру: alpha/beta (град), радиус, цель (метры).',
  },
  { name: 'camera_focus', description: 'Сфокусировать на выделенном/модуле/комнате.' },
  { name: 'selection_set', description: 'Выделить модуль/деталь/стену/проём/декор.' },
  { name: 'select_all', description: 'Выделить все модули.' },
  { name: 'toggle_part', description: 'Открыть/закрыть створки или ящики.' },
  { name: 'view_mode', description: 'Режим отрисовки: realistic/schematic/blueprint.' },
  { name: 'walls_mode', description: 'Стены: cutaway или all.' },
  { name: 'dims_set', description: 'Размеры: внутри, снаружи, все зазоры.' },
  { name: 'ui_panel', description: 'Открыть/закрыть панель интерфейса.' },
  { name: 'undo', description: 'Отменить последнее действие.' },
  { name: 'redo', description: 'Вернуть отменённое.' },
  { name: 'save', description: 'Сохранить проект.' },
  { name: 'export_file', description: 'Скачать КП/раскрой/детали/спецификацию.' },
  { name: 'scene_screenshot', description: 'Снимок 3D-канваса (JPEG data URL).' },
]

export function isClientTool(name: string): boolean {
  return CLIENT_TOOLS.some((t) => t.name === name)
}

export async function createEmptyProject(name: string): Promise<string> {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await apiPutProject(id, projectDoc(name))
  return id
}

function projectDoc(name: string): Record<string, unknown> {
  const doc = defaultProject() as unknown as Record<string, any>
  doc.name = name.trim() || 'Новый проект'
  doc.instances = []
  doc.folders = []
  doc.props = []
  doc.zones = []
  doc.views = []
  doc.materials = {}
  doc.room.w = 3600
  doc.room.d = 2800
  doc.room.h = 2700
  doc.room.wallT = 100
  doc.room.openings = []
  doc.room.wallItems = []
  doc.room.partitions = []
  doc.room.outline = [[0, 0], [3600, 0], [3600, 2800], [0, 2800]]
  return doc
}

async function downloadFile(format: string): Promise<string> {
  const pid = state.projectId
  const url = format === 'quote' || format === 'pdf'
    ? `/api/projects/${pid}/quote.pdf`
    : `/api/projects/${pid}/export/${format}`
  const r = await fetch(url, { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/)
  const name = m
    ? decodeURIComponent(m[1])
    : `${state.project.name || 'project'}.${format === 'quote' ? 'pdf' : format}`
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(u), 1500)
  return name
}

export async function runAiTool(
  name: string,
  args: Args,
  renderer: BabylonRenderer,
): Promise<AiToolResult> {
  try {
    switch (name) {
      case 'camera_set': {
        renderer.cancelCameraTween()
        const a = num(args.alpha)
        const b = num(args.beta)
        const r = num(args.radius)
        if (a != null) renderer.orbit.alpha = (a * Math.PI) / 180
        if (b != null) {
          renderer.orbit.beta = Math.min(Math.PI - 0.01, Math.max(0.01, (b * Math.PI) / 180))
        }
        if (r != null) renderer.orbit.radius = Math.max(0.2, r)
        const t = args.target
        if (Array.isArray(t) && t.length === 3) {
          const [x, y, z] = t.map(num)
          if (x != null && y != null && z != null) renderer.orbit.target.set(x, y, z)
        }
        return { ok: true, result: renderer.cameraState() }
      }
      case 'camera_focus': {
        const view = (['iso', 'front', 'side', 'top'].includes(String(args.view))
          ? String(args.view)
          : 'front') as 'iso' | 'front' | 'side' | 'top'
        if (args.target === 'room') {
          renderer.fit('room', state.project.room)
        } else {
          const id = typeof args.id === 'string' ? args.id : state.selection
          if (!id) renderer.fit('room', state.project.room)
          else renderer.focusInstance(id, view, 1, 1)
        }
        return { ok: true, result: renderer.cameraState() }
      }
      case 'selection_set': {
        const kind = String(args.kind)
        const id = str(args.id)
        if (kind === 'module' && id) select(id)
        else if (kind === 'part' && id && num(args.part) != null) {
          selectPart(id, Number(args.part), false)
        } else if (kind === 'wall' && id) {
          selectWall(Number(id))
        } else if (kind === 'opening' && id) {
          selectOpening(id)
        } else if (kind === 'prop' && id) {
          selectProp(id)
        } else {
          return { ok: false, error: 'selection_set: нужен id/part' }
        }
        return { ok: true, result: { selection: state.selection, part: partSelection.part } }
      }
      case 'select_all': {
        selectAll()
        return { ok: true, result: { selected: state.selected.length } }
      }
      case 'toggle_part': {
        const id = str(args.id)
        if (!id) return { ok: false, error: 'toggle_part: нужен id' }
        if (args.kind === 'drawer') toggleDrawers(id)
        else toggleDoors(id)
        return { ok: true, result: { id, kind: args.kind || 'door' } }
      }
      case 'view_mode': {
        const mode = String(args.mode)
        if (!['realistic', 'schematic', 'blueprint'].includes(mode)) {
          return { ok: false, error: 'view_mode: неизвестный режим' }
        }
        setViewMode(mode as Parameters<typeof setViewMode>[0])
        renderer.setQuality(mode as Parameters<BabylonRenderer['setQuality']>[0])
        return { ok: true, result: { viewMode: state.viewMode } }
      }
      case 'walls_mode': {
        const mode = String(args.mode)
        if (mode !== 'cutaway' && mode !== 'all') {
          return { ok: false, error: 'walls_mode: cutaway|all' }
        }
        setWallMode(mode)
        renderer.setWallMode(mode)
        return { ok: true, result: { wallMode: state.wallMode } }
      }
      case 'dims_set': {
        if (typeof args.inside === 'boolean') ui.dims3d = args.inside
        if (typeof args.outside === 'boolean') ui.dimsOuter = args.outside
        if (typeof args.gaps === 'boolean') ui.dimsAll = args.gaps
        return {
          ok: true,
          result: { inside: ui.dims3d, outside: ui.dimsOuter, gaps: ui.dimsAll },
        }
      }
      case 'ui_panel': {
        const panel = String(args.panel)
        const open = args.open !== false
        const id = str(args.id) || state.selection
        switch (panel) {
          case 'object':
            if (open) {
              if (id) select(id)
              openObjectModal('quick')
            } else closeObjectModal()
            break
          case 'workbench':
            if (open && id) openDetail(id)
            else if (!open) closeDetail()
            break
          case 'layout': ui.layoutOpen = open; break
          case 'add': ui.addOpen = open; break
          case 'result': ui.resultOpen = open; break
          case 'quote': ui.quoteOpen = open; break
          case 'versions': ui.versionsOpen = open; break
          case 'settings': ui.settingsOpen = open; break
          case 'plan':
            ui.renderMode = open ? 'draft' : '3d'
            if (open) ui.draftTab = 'plan'
            break
          case 'draft':
            ui.renderMode = open ? 'draft' : '3d'
            if (open) ui.draftTab = 'walls'
            break
          case 'presentation': setPresentation(open); break
          case 'ai': ui.aiOpen = open; break
          default:
            return { ok: false, error: `ui_panel: неизвестная панель «${panel}»` }
        }
        return {
          ok: true,
          result: {
            panel, open, renderMode: ui.renderMode, draftTab: ui.draftTab,
          },
        }
      }
      case 'validate': {
        if (!(await flushSave(true))) {
          return { ok: false, error: 'не удалось сохранить проект перед проверкой' }
        }
        const r = await apiProjectLayout(state.projectId)
        return {
          ok: true,
          result: {
            errors: r.errors,
            warnings: r.warnings,
            issues: (r.issues || []).slice(0, 20).map((i) => ({
              code: i.code, level: i.level, message: i.message,
              instance: i.instance, prop: i.prop,
              fix: (i as { fix?: string }).fix,
              auto_fixable: (i as { auto_fixable?: boolean }).auto_fixable,
            })),
          },
        }
      }
      case 'get_quote': {
        const totals: Record<string, number> = {}
        const rows = state.project.instances.map((inst) => {
          const cost = derived[inst.id]?.cost
          const total = Number(
            (cost as { total_with_vat?: number; total?: number } | undefined)
              ?.total_with_vat
            ?? (cost as { total?: number } | undefined)?.total
            ?? 0,
          )
          const cur = String((cost as { currency?: string } | undefined)?.currency || '')
          if (cur) totals[cur] = (totals[cur] || 0) + total
          return { id: inst.id, name: inst.name, cost: total, currency: cur }
        })
        return {
          ok: true,
          result: {
            totals,
            modules: rows,
            missing: rows.filter((x) => !x.currency).length,
            currency: state.project.market || '',
          },
        }
      }
      case 'set_part_material': {
        const id = str(args.id) || state.selection
        const part = num(args.part)
        if (!id || part == null) {
          return { ok: false, error: 'set_part_material: нужен id и part' }
        }
        const inst = state.project.instances.find((i) => i.id === id)
        const objects = await waitObjects(id)
        const obj = objects?.[part]
        if (!inst || !obj) {
          return { ok: false, error: 'деталь не найдена: проверьте id/part' }
        }
        const cur = resolveObjectMaterial(
          state.project.materials,
          state.project.materialVars,
          inst,
          obj,
          part,
        )
        const material = {
          ...cur,
          ...((args.patch as Record<string, unknown> | undefined) || {}),
        }
        return {
          ok: true,
          result: { uid: partUid(obj), name: obj.name, material },
          stage: [{
            op: 'set_part_override', id, uid: partUid(obj), material,
          }],
        }
      }
      case 'reset_part_material': {
        const id = str(args.id) || state.selection
        const part = num(args.part)
        if (!id || part == null) {
          return { ok: false, error: 'reset_part_material: нужен id и part' }
        }
        const objects = await waitObjects(id)
        const obj = objects?.[part]
        if (!obj) {
          return { ok: false, error: 'деталь не найдена: проверьте id/part' }
        }
        return {
          ok: true,
          result: { uid: partUid(obj), name: obj.name, reset: true },
          stage: [{ op: 'reset_part_override', id, uid: partUid(obj) }],
        }
      }
      case 'get_parts': {
        const id = str(args.id) || state.selection
        if (!id) return { ok: false, error: 'get_parts: нужен id или выделенный модуль' }
        const inst = state.project.instances.find((i) => i.id === id)
        const objects = await waitObjects(id)
        if (!inst || !objects?.length) {
          return { ok: false, error: 'модуль ещё не рассчитан' }
        }
        const info = moduleInfo(inst, objects)
        if (!info) return { ok: false, error: 'у модуля нет деталей' }
        return {
          ok: true,
          result: {
            id, name: inst.name,
            params: inst.params,
            elements: info.elements.slice(0, 60).map((el) => ({
              title: el.title, kind: el.kind,
              w: el.w, d: el.d, h: el.h,
            })),
            total: info.elements.length,
          },
        }
      }
      case 'project_list': {
        const rows = await apiListProjects()
        return { ok: true, result: { projects: rows.slice(0, 40) } }
      }
      case 'project_open': {
        const id = str(args.id)
        if (!id) return { ok: false, error: 'project_open: нужен id' }
        return {
          ok: true,
          switchTo: id,
          switchCopy: false,
          result: { projectId: id },
        }
      }
      case 'project_create': {
        const name = str(args.name) || 'Новый проект'
        const id = await createEmptyProject(name)
        return {
          ok: true,
          switchTo: id,
          result: { projectId: id, name, created: true },
        }
      }
      case 'project_quickstart': {
        const input = {
          ...(args as unknown as QuickStartInput),
          kind: (args.kind as QuickStartInput['kind']) || 'kitchen',
          wall: Number(args.wall ?? 0),
          openings: Array.isArray(args.openings) ? args.openings : [],
          sockets: Array.isArray(args.sockets) ? args.sockets : [],
        } as QuickStartInput
        const r = await apiQuickStart(input)
        return {
          ok: true,
          switchTo: r.id,
          result: {
            projectId: r.id, name: input.name,
            errors: r.errors, warnings: r.warnings,
            instances: Array.isArray((r.project as { instances?: unknown[] }).instances)
              ? (r.project as { instances: unknown[] }).instances.length : 0,
          },
        }
      }
      case 'project_delete': {
        const id = str(args.id)
        if (!id) return { ok: false, error: 'project_delete: нужен id' }
        if (id === state.projectId) {
          return { ok: false, error: 'нельзя удалить текущий проект — сначала откройте другой' }
        }
        if (args.confirm !== true) {
          return { ok: false, error: 'удаление проекта нужно подтвердить (confirm=true)' }
        }
        await apiDeleteProject(id)
        return { ok: true, result: { id, deleted: true } }
      }
      case 'version_create': {
        if (!(await flushSave(true))) {
          return { ok: false, error: 'не удалось сохранить проект перед версией' }
        }
        const v = await apiCreateVersion(state.projectId, str(args.name) || undefined)
        return { ok: true, result: v }
      }
      case 'version_list': {
        const rows = await apiListVersions(state.projectId)
        return { ok: true, result: { versions: rows.slice(0, 30) } }
      }
      case 'version_restore': {
        const id = str(args.id)
        if (!id) return { ok: false, error: 'version_restore: нужен id' }
        await apiRestoreVersion(state.projectId, id)
        await openProject(state.projectId, true, false, true)
        return { ok: true, result: { id, restored: true } }
      }
      case 'undo': {
        undo()
        await flushSave(true)
        return { ok: true, result: { instances: state.project.instances.length } }
      }
      case 'redo': {
        redo()
        await flushSave(true)
        return { ok: true, result: { instances: state.project.instances.length } }
      }
      case 'save': {
        const ok = await flushSave(true)
        return ok
          ? { ok: true, result: { saved: true } }
          : { ok: false, error: 'проект не сохранился' }
      }
      case 'export_file': {
        const format = str(args.format) || 'quote'
        if (!['quote', 'pdf', 'svg', 'dxf', 'xlsx'].includes(format)) {
          return { ok: false, error: 'export_file: quote|svg|dxf|xlsx' }
        }
        const file = await downloadFile(format)
        return { ok: true, result: { downloaded: file } }
      }
      case 'scene_screenshot': {
        const w = num(args.max_width)
        const data = renderer.snapshot(w != null ? Math.max(320, Math.min(1600, w)) : 960)
        if (!data) return { ok: false, error: 'scene_screenshot: пустой канвас' }
        return { ok: true, result: data }
      }
      default:
        return {
          ok: false,
          error: `серверный инструмент «${name}»: используйте /api/projects/{id}/preview`,
        }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
