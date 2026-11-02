/**
 * Клиентские инструменты ИИ: камера, выделение, вид, размеры, снимок.
 * Серверные операции (добавить/изменить модуль и т.п.) идут через
 * /api/projects/{id}/preview и /actions — здесь только UI/камера.
 */
import type { BabylonRenderer } from '../render3d/babylonScene'
import {
  partSelection,
  select,
  selectOpening,
  selectPart,
  selectProp,
  selectWall,
  setViewMode,
  setWallMode,
  state,
  ui,
} from '../state/project'

export type AiToolResult = {
  ok: boolean
  result?: unknown
  error?: string
}

type Args = Record<string, unknown>

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export const CLIENT_TOOLS = [
  {
    name: 'camera_set',
    description: 'Поставить камеру: alpha/beta (град), радиус, цель (метры).',
    schema: {
      type: 'object',
      properties: {
        alpha: { type: 'number' },
        beta: { type: 'number' },
        radius: { type: 'number' },
        target: { type: 'array', items: { type: 'number' } },
      },
    },
  },
  {
    name: 'camera_focus',
    description: 'Сфокусировать на выделенном/модуле/комнате.',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['selected', 'room'] },
        id: { type: 'string' },
        view: { type: 'string', enum: ['iso', 'front', 'side', 'top'] },
      },
    },
  },
  {
    name: 'selection_set',
    description: 'Выделить модуль/деталь/стену/проём/декор.',
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['module', 'part', 'wall', 'opening', 'prop'] },
        id: { type: 'string' },
        part: { type: 'number' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'view_mode',
    description: 'Режим отрисовки: realistic/schematic/blueprint.',
    schema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['realistic', 'schematic', 'blueprint'] } },
      required: ['mode'],
    },
  },
  {
    name: 'walls_mode',
    description: 'Стены: cutaway (срез) или all (все).',
    schema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['cutaway', 'all'] } },
      required: ['mode'],
    },
  },
  {
    name: 'dims_set',
    description: 'Размеры: внутри, снаружи, все зазоры.',
    schema: {
      type: 'object',
      properties: { inside: { type: 'boolean' }, outside: { type: 'boolean' }, gaps: { type: 'boolean' } },
    },
  },
  {
    name: 'scene_screenshot',
    description: 'Снимок 3D-канваса (JPEG data URL).',
    schema: {
      type: 'object',
      properties: { max_width: { type: 'number' } },
    },
  },
]

export function isClientTool(name: string): boolean {
  return CLIENT_TOOLS.some((t) => t.name === name)
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
          if (!id) {
            renderer.fit('room', state.project.room)
          } else {
            renderer.focusInstance(id, view, 1, 1)
          }
        }
        return { ok: true, result: renderer.cameraState() }
      }
      case 'selection_set': {
        const kind = String(args.kind)
        const id = typeof args.id === 'string' ? args.id : ''
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
