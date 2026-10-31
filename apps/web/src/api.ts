import type { Materials, SceneObject } from './render25d/types'

export interface EdgeSide {
  thickness: number
  type: string
  label: string
  color: string
  price_key: string
  front: boolean
  side_label: string
  length_m: number
}

export interface BomRow {
  name: string
  qty: number
  w: number
  h: number
  saw_w: number
  saw_h: number
  material: string
  edge: string
  edges?: Record<string, EdgeSide>
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

export interface HandleInfo {
  id: string
  name: string
  brand: string
  price: number
  centers: number
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
  locale?: string
  symbol?: string
  market?: string
  market_name?: string
  shop?: string
  shop_name?: string
  supplier?: string
  supplier_name?: string
  vat_percent?: number
  vat?: number
  total_with_vat?: number
  source?: string
  updated?: string
  draft?: boolean
  lines: CostLine[]
  subtotal: number
  markup_percent: number
  markup: number
  partner_percent: number
  partner: number
  total: number
}

export interface AssemblyOperation {
  id: string
  part: string
  part_kind?: string
  face: string
  basis?: string
  x: number
  y: number
  dia: number
  depth: number
  kind: string
  hardware: string
  hardware_id?: string
  unit?: string
  section: number
  qty: number
  visibility: 'hidden' | 'visible'
  requires_pattern: boolean
  note: string
  coord: string
}

export interface HardwarePlan {
  hinge_model: string
  hinge_id?: string
  handle_model: string
  handle_id?: string
  runner_model: string
  runner_id?: string
  runner_template?: boolean
  fastener_model?: string
  fastener_id?: string
  shelf_support_model?: string
  shelf_support_id?: string
  gas_strut_model?: string
  gas_strut_id?: string
  hinges: number
  hinge_plates: number
  handles: number
  handle_holes?: number
  confirmats: number
  fasteners?: number
  screws?: number
  leg_holes?: number
  joints?: {
    joint: string
    class: string
    fastener: string
    fastener_id: string
    count: number
  }[]
  shelf_pins: number
  system32_holes: number
  slide_mounts: number
  slide_box_holes?: number
  gas_struts?: number
  visible_fasteners?: number
  requires_pattern: number
  edge_types?: Record<string, { id: string; name: string; thickness: number; color: string }>
}

export interface EdgePlanRow {
  part: string
  qty: number
  material: string
  w: number
  h: number
  front: string
  summary: string
  sides: Record<string, EdgeSide>
}

export interface ShelfPosition {
  section: number
  z_from_floor: number
  t: number
  w: number
  d: number
  to_shelf_above: number | null
  from_shelf_below: number | null
}

export interface SolveResponse {
  schema: string
  product: string
  corpus: { W: number; H: number; D: number }
  objects: SceneObject[]
  bom: BomRow[]
  drilling: unknown[]
  operations?: AssemblyOperation[]
  hardware_plan?: HardwarePlan
  edge_plan?: EdgePlanRow[]
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
  shelves?: ShelfPosition[]
  edges_by_type?: Record<string, number>
  assembly?: string[]
  edges_m?: Record<string, number>
  cutouts?: unknown[]
  sheet?: { w: number; h: number; trim: number; kerf: number }
  dims: {
    outer: { W: number; H: number; H_total?: number; D: number }
    plinth_h?: number
    worktop_t?: number
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
  /** производитель/бренд декора */
  brand?: string
  /** код декора у производителя */
  code?: string
  /** коллекция/серия */
  collection?: string
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

export interface HardwareCatalog {
  drawer_runners: RunnerInfo[]
  hinges: { id: string; name: string; brand: string }[]
  handles: HandleInfo[]
  fasteners: { id: string; name: string; kind: string; face_dia: number; pilot_dia: number; note: string }[]
  shelf_supports: { id: string; name: string; kind: string; per_side: number; note: string }[]
  gas_struts: { id: string; name: string; brand: string; force_n: number; door_weight_max: number; note: string }[]
  legs: {
    id: string
    name: string
    kind: string
    plate: number
    hole_dia: number
    depth: number
    holes: { dx: number; dy: number }[]
    template: boolean
    note: string
  }[]
  edge_types: { id: string; name: string; thickness: number; color: string; note: string }[]
}

let catalogCache: HardwareCatalog | null = null

export async function apiHardwareCatalog(): Promise<HardwareCatalog> {
  if (catalogCache) return catalogCache
  const r = await fetch('/api/hardware')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  catalogCache = (await r.json()) as HardwareCatalog
  return catalogCache
}

export async function apiHardware(): Promise<RunnerInfo[]> {
  if (hardwareCache) return hardwareCache
  const data = await apiHardwareCatalog()
  hardwareCache = data.drawer_runners
  return hardwareCache
}

export interface PricingMarket {
  id: string
  name: string
  currency: string
  locale: string
  symbol: string
  vat_percent: number
  source: string
}

export interface PricingShop {
  id: string
  name: string
  market: string
  sheet: { w?: number; h?: number; trim?: number; kerf?: number }
  note: string
}

export interface PricingSupplier {
  id: string
  name: string
  brands: string[]
  note: string
}

export interface PricingOptions {
  markets: PricingMarket[]
  shops: PricingShop[]
  suppliers: PricingSupplier[]
  default: { market: string; shop: string; supplier: string }
  active?: CostInfo
}

let pricingCache: PricingOptions | null = null

export async function apiPricingOptions(force = false): Promise<PricingOptions> {
  if (pricingCache && !force) return pricingCache
  const r = await fetch('/api/pricing/options')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  pricingCache = (await r.json()) as PricingOptions
  return pricingCache
}

export async function apiHandles(): Promise<HandleInfo[]> {
  const r = await fetch('/api/hardware')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { handles?: HandleInfo[] }
  return data.handles ?? []
}

export async function apiSolve(
  product: unknown,
  opts: { market?: string; shop?: string; supplier?: string } = {},
): Promise<SolveResponse> {
  const r = await fetch('/api/solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ product, ...opts }),
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

export interface BatchSolveItem {
  index: number
  id?: string
  result?: SolveResponse
  error?: string
}

/** Посчитать несколько модулей одним запросом (комната/папка). */
export async function apiSolveBatch(
  products: unknown[],
  opts: { market?: string; shop?: string; supplier?: string } = {},
): Promise<BatchSolveItem[]> {
  const r = await fetch('/api/solve/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ products, ...opts }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { results?: BatchSolveItem[] }
  return data.results ?? []
}

export async function apiGetProject(id: string): Promise<unknown> {
  const r = await fetch(`/api/projects/${id}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export interface AuthUser {
  id: string
  name: string
  email?: string
  role: 'user' | 'guest' | string
  demo: boolean
}

export interface AuthResult {
  user: AuthUser
  project_id?: string
}

export interface ProjectRow {
  id: string
  name: string
  updated: string
  public?: boolean
}

export async function apiMe(): Promise<AuthUser | null> {
  const r = await fetch('/api/auth/me')
  if (!r.ok) return null
  const data = (await r.json()) as { user?: AuthUser | null }
  return data.user ?? null
}

async function authPost(path: string, body?: unknown): Promise<AuthResult> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
  return (await r.json()) as AuthResult
}

export async function apiLogin(email: string, password: string): Promise<AuthResult> {
  return authPost('/api/auth/login', { email, password })
}

export async function apiRegister(
  email: string, password: string, name: string,
): Promise<AuthResult> {
  return authPost('/api/auth/register', { email, password, name })
}

export async function apiDemo(): Promise<AuthResult> {
  return authPost('/api/auth/demo')
}

export async function apiLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

export async function apiDeleteProject(id: string): Promise<void> {
  const r = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
}

export async function apiListProjects(): Promise<ProjectRow[]> {
  const r = await fetch('/api/projects')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { projects: ProjectRow[] }
  return data.projects ?? []
}

export async function apiValidateProject(
  doc: unknown,
): Promise<LayoutReport> {
  const r = await fetch('/api/projects/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function apiPutProject(
  id: string,
  doc: unknown,
  keepalive = false,
): Promise<void> {
  const r = await fetch(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
    keepalive,
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
}

export interface ProjectVersion {
  id: string
  name: string
  created: string
  instances: number
}

export interface ProjectVersionDoc {
  id: string
  name: string
  created: string
  doc: unknown
}

export async function apiListVersions(pid: string): Promise<ProjectVersion[]> {
  const r = await fetch(`/api/projects/${pid}/versions`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { versions: ProjectVersion[] }
  return data.versions ?? []
}

export async function apiCreateVersion(
  pid: string,
  name?: string,
): Promise<ProjectVersion> {
  const r = await fetch(`/api/projects/${pid}/versions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
  const data = (await r.json()) as { version: ProjectVersion }
  return data.version
}

export async function apiGetVersion(
  pid: string,
  vid: string,
): Promise<ProjectVersionDoc> {
  const r = await fetch(`/api/projects/${pid}/versions/${vid}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function apiRestoreVersion(
  pid: string,
  vid: string,
): Promise<{ project: unknown }> {
  const r = await fetch(`/api/projects/${pid}/versions/${vid}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backup: true }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
  return r.json()
}

export async function apiDeleteVersion(pid: string, vid: string): Promise<void> {
  const r = await fetch(`/api/projects/${pid}/versions/${vid}`, {
    method: 'DELETE',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export interface LayoutIssue {
  code: string
  level: 'error' | 'warn' | string
  instance: string
  /** id декоративного объекта (если ошибка про декор) */
  prop?: string | null
  name: string
  message: string
  /** что сделать человеку (короткая подсказка с сервера) */
  fix?: string
  /** можно ли исправить автоматически (уплотнение/прижатие) */
  auto_fixable?: boolean
}

export interface LayoutReport {
  ok: boolean
  errors: number
  warnings: number
  issues: LayoutIssue[]
}

export async function apiProjectLayout(id: string): Promise<LayoutReport> {
  const r = await fetch(`/api/projects/${id}/layout`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function apiNormalizeLayout(
  id: string,
  commit = true,
): Promise<LayoutReport & {
  changes: { instance?: string; prop?: string; message: string }[]
  instances?: { id: string; x: number; y: number; rot: number }[]
  props?: { id: string; x: number; y: number }[]
  committed?: boolean
}> {
  const r = await fetch(`/api/projects/${id}/layout/normalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit, closeGaps: true }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export interface QuickStartInput {
  name: string
  room: {
    w: number; d: number; h: number; wallT: number
    shape?: 'rect' | 'l'; cutW?: number; cutD?: number
  }
  kind: 'kitchen' | 'wardrobe' | 'storage'
  wall: number
  openings: { kind: 'window' | 'door'; wall: number; x: number; w: number;
    z0?: number; z1?: number }[]
  sockets: { kind: 'socket' | 'switch'; wall: number; x: number; z: number }[]
  height?: number
}

/** Быстрый старт: комната + сценарий → новый проект. */
export async function apiQuickStart(
  input: QuickStartInput,
): Promise<{
  id: string
  project: Record<string, unknown>
  errors: number
  warnings: number
  issues: { level: string; code: string; message: string }[]
}> {
  const r = await fetch('/api/quickstart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detail = (data as { detail?: unknown }).detail
    if (detail && typeof detail === 'object') {
      const d = detail as { message?: string; issues?: unknown[] }
      throw new Error(
        `${d.message || 'Ошибка быстрого старта'}${
          d.issues ? `: ${d.issues.length} замечаний` : ''}`)
    }
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${r.status}`)
  }
  return data as {
    id: string
    project: Record<string, unknown>
    errors: number
    warnings: number
    issues: { level: string; code: string; message: string }[]
  }
}

export interface CuttingSheet {
  material: string
  count: number
  overflow: string[]
  placements: { name: string; x: number; y: number; w: number; h: number; rot: boolean }[]
}

export interface ProjectCutting {
  ok: boolean
  errors: string[]
  sheets: CuttingSheet[]
  totals: { sheets: number; pieces: number; kpd: number; materials: string[] }
  sheet: { w: number; h: number; trim: number; kerf: number }
}

/** Раскрой всего проекта: одна укладка на все модули. */
export async function apiProjectCutting(pid: string): Promise<ProjectCutting> {
  const r = await fetch(`/api/projects/${pid}/cutting`, { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<ProjectCutting>
}
