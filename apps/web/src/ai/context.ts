/**
 * Компактный снимок сцены для ИИ: камера, выделение, комната, объекты,
 * ошибки. Без тяжёлого `derived` целиком — только то, что нужно модели.
 */
import type { BabylonRenderer } from '../render3d/babylonScene'
import { state, derived, partSelection, layoutState, ui } from '../state/project'
import { moduleInfo, relationsFor } from '../module/info'
import { roomWalls } from '../render25d/room'
import { outerDims } from '../dims/outer'

export type AiCameraState = ReturnType<BabylonRenderer['cameraState']>

export type AiSelection =
  | { kind: 'none' }
  | {
      kind: 'module'
      id: string
      name: string
      params: Record<string, unknown>
      materials?: Record<string, unknown>
      corpus?: { W: number; H: number; D: number }
      world: { x: number; y: number; z: number; rot: number }
      gaps: { label: string; gap: number; hint: string }[]
    }
  | {
      kind: 'part'
      module: { id: string; name: string }
      part: {
        index: number
        title: string
        kind: string
        size: { w: number; d: number; h: number }
        position: { x: number; y: number; z: number }
        relations: unknown
      }
    }
  | { kind: 'wall'; index: number; len: number; outer: boolean }
  | { kind: 'opening'; id: string; opening: Record<string, unknown> }
  | { kind: 'prop'; prop: Record<string, unknown> }
  | { kind: 'room'; node: string }

export type AiSceneContext = {
  schema: 'furniture/ai-context@1'
  app: {
    projectId: string
    projectName: string
    revision: number
    renderMode: string
    viewMode: string
    wallMode: string
    dims: { inside: boolean; outside: boolean; gaps: boolean }
    presentation: boolean
    master: boolean
    objectModal: string
  }
  camera: AiCameraState
  selection: AiSelection
  room: {
    w: number
    d: number
    h: number
    wallT: number
    outline: number
    outlinePoints: [number, number][]
    partitions: { a: number[]; b: number[]; wallT?: number }[]
    walls: { index: number; len: number; outer: boolean }[]
    openings: { id: string; kind: string; wall: number; x: number; w: number; z0: number; z1: number; hinge?: string; angle?: number }[]
    wallItems: { id: string; kind: string; wall: number; x: number; z: number; w: number; h: number; depth?: number }[]
  }
  project: {
    instances: {
      id: string
      name: string
      x: number
      y: number
      z: number
      rot: number
      W: number
      H: number
      D: number
      mount: string
      corpus?: { W: number; H: number; D: number }
    }[]
    props: { id: string; name: string; type: string; x: number; y: number; z: number; w: number; d: number; h: number; rot: number }[]
    folders: { id: string; name: string; count: number }[]
    globals: Record<string, unknown>
    zones: string[]
    counts: { instances: number; props: number }
    cost: { totals: Record<string, number>; solved: number; missing: number }
    truncated: boolean
  }
  issues: {
    errors: number
    warnings: number
    items: {
      code: string
      level: string
      message: string
      instance?: string | null
      prop?: string | null
      fix?: string
      auto_fixable?: boolean
    }[]
  }
}

function selectionContext(): AiSelection {
  if (partSelection.instanceId && partSelection.part != null) {
    const inst = state.project.instances.find((i) => i.id === partSelection.instanceId)
    const d = inst ? derived[inst.id] : null
    const info = inst && d ? moduleInfo(inst, d.objects) : null
    const el = info?.elements[partSelection.part]
    if (inst && el) {
      return {
        kind: 'part',
        module: { id: inst.id, name: inst.name || inst.id },
        part: {
          index: partSelection.part,
          title: el.title,
          kind: el.kind,
          size: { w: el.w, d: el.d, h: el.h },
          position: { x: el.x, y: el.y, z: el.z },
          relations: relationsFor(info!, partSelection.part),
        },
      }
    }
  }
  if (state.wallIndex != null) {
    const w = roomWalls(state.project.room).find(
      (x) => x.index === state.wallIndex,
    )
    return {
      kind: 'wall',
      index: state.wallIndex,
      len: Math.round(w?.len ?? 0),
      outer: !!w?.outer,
    }
  }
  if (state.openingId) {
    const o = (state.project.room.openings ?? []).find((x) => x.id === state.openingId)
    return { kind: 'opening', id: state.openingId, opening: (o ?? {}) as Record<string, unknown> }
  }
  if (state.propId) {
    const pr = (state.project.props ?? []).find((x) => x.id === state.propId)
    return { kind: 'prop', prop: (pr ?? {}) as Record<string, unknown> }
  }
  if (state.selection) {
    const inst = state.project.instances.find((i) => i.id === state.selection)
    if (inst) {
      return {
        kind: 'module',
        id: inst.id,
        name: inst.name || inst.id,
        params: inst.params as unknown as Record<string, unknown>,
        materials: inst.materials as unknown as Record<string, unknown> | undefined,
        corpus: derived[inst.id]?.corpus,
        world: { x: inst.x, y: inst.y, z: inst.z || 0, rot: inst.rot },
        gaps: outerDims(
          inst, state.project.instances, derived, state.project.room,
        )
          .filter((g) => Number.isFinite(g.gap) && g.gap > 2)
          .map((g) => ({
            label: g.label,
            gap: Math.round(g.gap),
            hint: g.hint,
          })),
      }
    }
  }
  if (state.roomSelected) return { kind: 'room', node: state.roomNode }
  return { kind: 'none' }
}

export function buildSceneContext(renderer: BabylonRenderer): AiSceneContext {
  const room = state.project.room
  const open = (room.openings ?? []).map((o) => ({
    id: o.id, kind: o.kind, wall: o.wall, x: o.x, w: o.w,
    z0: o.z0, z1: o.z1,
    hinge: (o as { hinge?: string }).hinge,
    angle: (o as { angle?: number }).angle,
  }))
  const wallItems = (room.wallItems ?? []).map((w) => ({
    id: w.id, kind: w.kind, wall: w.wall, x: w.x, z: w.z, w: w.w, h: w.h,
    depth: (w as { depth?: number }).depth,
  }))
  const walls = roomWalls(room).map((w) => ({
    index: w.index, len: Math.round(w.len), outer: w.outer,
  }))
  const partitions = (room.partitions ?? []).map((p) => ({
    a: p.a, b: p.b, wallT: p.wallT,
  }))
  const outlinePoints = (room.outline ?? []).map(
    (p) => [p[0], p[1]] as [number, number],
  )
  const costTotals: Record<string, number> = {}
  let solved = 0
  for (const inst of state.project.instances) {
    const c = derived[inst.id]?.cost as
      | { total_with_vat?: number; total?: number; currency?: string }
      | undefined
    if (!c?.currency) continue
    solved++
    const value = Number(c.total_with_vat ?? c.total ?? 0)
    costTotals[c.currency] = (costTotals[c.currency] || 0) + value
  }
  const maxRows = 80
  const instances = state.project.instances.slice(0, maxRows).map((i) => ({
    id: i.id,
    name: i.name || i.id,
    x: i.x,
    y: i.y,
    z: i.z || 0,
    rot: i.rot,
    W: i.params.W,
    H: i.params.H,
    D: i.params.D,
    mount: i.params.mount,
    corpus: derived[i.id]?.corpus,
  }))
  const props = (state.project.props ?? []).slice(0, maxRows).map((p) => ({
    id: p.id, name: p.name, type: p.type,
    x: p.x, y: p.y, z: p.z ?? 0, w: p.w, d: p.d, h: p.h, rot: p.rot ?? 0,
  }))
  const folders = (state.project.folders ?? []).map((f) => ({
    id: f.id, name: f.name, count: f.ids.length,
  }))
  return {
    schema: 'furniture/ai-context@1',
    app: {
      projectId: state.projectId,
      projectName: state.project.name,
      revision: state.rev,
      renderMode: ui.renderMode,
      viewMode: state.viewMode,
      wallMode: state.wallMode,
      dims: { inside: ui.dims3d, outside: ui.dimsOuter, gaps: ui.dimsAll },
      presentation: state.presentation,
      master: ui.master,
      objectModal: ui.object.mode,
    },
    camera: renderer.cameraState(),
    selection: selectionContext(),
    room: {
      w: room.w,
      d: room.d,
      h: room.h,
      wallT: room.wallT,
      outline: (room.outline ?? []).length,
      outlinePoints,
      partitions,
      walls,
      openings: open,
      wallItems,
    },
    project: {
      instances,
      props,
      folders,
      globals: state.project.globals as unknown as Record<string, unknown>,
      zones: state.project.zones ?? [],
      counts: {
        instances: state.project.instances.length,
        props: state.project.props?.length ?? 0,
      },
      cost: {
        totals: costTotals,
        solved,
        missing: state.project.instances.length - solved,
      },
      truncated:
        state.project.instances.length > maxRows ||
        (state.project.props?.length ?? 0) > maxRows,
    },
    issues: {
      errors: layoutState.errors,
      warnings: layoutState.warnings,
      items: layoutState.issues.slice(0, 20),
    },
  }
}
