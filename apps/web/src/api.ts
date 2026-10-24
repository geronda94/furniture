import type { Materials, SceneObject } from './render25d/types'

export interface BomRow {
  name: string
  qty: number
  w: number
  h: number
  saw_w: number
  saw_h: number
  material: string
  edge: string
  grain: string
  front: string
}

export interface RunnerInfo {
  id: string
  name: string
  brand: string
  type: string
  side_gap: number
  lengths: number[]
  box_height: number
  note: string
}

export interface DrawerDims {
  id: number
  box_w: number
  box_h: number
  box_len: number
  inner_w?: number
  inner_h?: number
  inner_len?: number
  front_w: number
  front_h: number
  front_t?: number
  panel_w?: number
  panel_h?: number
  panel_t?: number
  side_gap?: number
  side_extra?: number
  side_h?: number
  runner_note?: string
}

export interface CostLine {
  key: string
  label: string
  qty: number
  unit: string
  unit_price: number
  total: number
}

export interface CostInfo {
  currency: string
  lines: CostLine[]
  subtotal: number
  markup_percent: number
  markup: number
  partner_percent: number
  partner: number
  total: number
}

export interface SolveResponse {
  schema: string
  product: string
  corpus: { W: number; H: number; D: number }
  objects: SceneObject[]
  bom: BomRow[]
  drilling: unknown[]
  sheets: {
    material: string
    count: number
    overflow: string[]
    placements?: { name: string; x: number; y: number; w: number; h: number; rot: boolean }[]
  }[]
  totals: { positions: number; pieces: number; sheets: number; kpd: number }
  validation: { errors: string[]; warnings: string[] }
  materials: Materials
  hardware: RunnerInfo & { runners_all: RunnerInfo[] }
  drawers: DrawerDims[]
  assembly?: string[]
  edges_m?: Record<string, number>
  cutouts?: unknown[]
  sheet?: { w: number; h: number; trim: number; kerf: number }
  dims: {
    outer: { W: number; H: number; D: number }
    inner: { W: number; H: number; D: number }
    t: number
    t_back: number
  }
  cost?: CostInfo
}

export interface CatalogMaterial {
  id: string
  name: string
  color: string
  accent?: string
  pattern?: 'solid' | 'wood' | 'stone' | 'metal'
  texScale?: number
  price_m2?: number
  texture_url?: string
}

export interface MaterialCategory {
  id: string
  name: string
  items: CatalogMaterial[]
}

let materialsCache: MaterialCategory[] | null = null

export async function apiMaterials(): Promise<MaterialCategory[]> {
  if (materialsCache) return materialsCache
  const r = await fetch('/api/materials')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { categories: MaterialCategory[] }
  materialsCache = data.categories ?? []
  return materialsCache
}

let hardwareCache: RunnerInfo[] | null = null

export async function apiHardware(): Promise<RunnerInfo[]> {
  if (hardwareCache) return hardwareCache
  const r = await fetch('/api/hardware')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { drawer_runners: RunnerInfo[] }
  hardwareCache = data.drawer_runners
  return hardwareCache
}

export async function apiSolve(product: unknown): Promise<SolveResponse> {
  const r = await fetch('/api/solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ product }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    let detail = text
    try {
      detail = JSON.parse(text).detail ?? text
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${r.status}`)
  }
  return r.json()
}

export async function apiGetProject(id: string): Promise<unknown> {
  const r = await fetch(`/api/projects/${id}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export interface ProjectRow {
  id: string
  name: string
  updated: string
}

export async function apiListProjects(): Promise<ProjectRow[]> {
  const r = await fetch('/api/projects')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { projects: ProjectRow[] }
  return data.projects ?? []
}

export async function apiPutProject(id: string, doc: unknown): Promise<void> {
  const r = await fetch(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
}
