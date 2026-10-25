import type {
  Materials,
  Material,
  MaterialPart,
  MaterialVariable,
  SceneObject,
} from '../render25d/types'
import type { Instance } from '../state/project'

/** Роль материала проекта для гранулярной части изделия. */
export const PART_ROLE: Record<MaterialPart, string> = {
  carcass: 'corpus',
  sides: 'corpus',
  shelf: 'corpus',
  divider: 'corpus',
  door: 'facade',
  drawerFront: 'facade',
  drawerBox: 'drawer',
  back: 'back',
  worktop: 'worktop',
  plinth: 'plinth',
  leg: 'leg',
}

export const PART_LABELS: Record<MaterialPart, string> = {
  carcass: 'Каркас',
  sides: 'Боковины',
  shelf: 'Полки',
  divider: 'Перегородки',
  door: 'Двери',
  drawerFront: 'Фасады ящиков',
  drawerBox: 'Ящики',
  back: 'Задняя стенка',
  worktop: 'Столешница',
  plinth: 'Цоколь',
  leg: 'Опоры',
}

export const PART_ORDER: MaterialPart[] = [
  'carcass', 'sides', 'shelf', 'divider', 'door', 'drawerFront',
  'drawerBox', 'back', 'worktop', 'plinth', 'leg',
]

/** Часть изделия для объекта сцены (с запасным определением по имени). */
export function objectPart(o: SceneObject): MaterialPart {
  const t = (o as SceneObject & { target?: string }).target
  if (t && t in PART_ROLE) return t as MaterialPart
  switch (o.kind) {
    case 'door': return 'door'
    case 'drawerfront': return 'drawerFront'
    case 'drawerbox': return 'drawerBox'
    case 'back': return 'back'
    case 'worktop': return 'worktop'
    case 'plinth': return 'plinth'
    case 'leg': return 'leg'
  }
  if (o.name === 'Полка') return 'shelf'
  if (o.name === 'Перегородка') return 'divider'
  if (o.name.startsWith('Боковина')) return 'sides'
  if (o.name.startsWith('Царга')) return 'carcass'
  return 'carcass'
}

/** Устойчивая группа одинаковых деталей: имя + секция + ящик. */
export function partGroupKey(o: SceneObject): string {
  return `${o.name}|${o.sec ?? 0}|${o.drawer_id ?? ''}`
}

/** Устойчивый ключ конкретной детали: группа + позиция (мм). */
export function partUid(o: SceneObject): string {
  return `${partGroupKey(o)}@${Math.round(o.x)}x${Math.round(o.z)}`
}

export interface MaterialResolution {
  material: Material
  source: 'part' | 'group' | 'module' | 'variable' | 'project'
  label: string
}

/**
 * Материал детали и источник: проект → переменные (all/mount, затем зона)
 * → материал модуля → материал группы деталей → конкретная деталь.
 */
export function resolveMaterial(
  materials: Materials,
  vars: MaterialVariable[],
  inst: Pick<
    Instance,
    'materials' | 'params' | 'zone' | 'partMaterials' |
    'partMaterialGroups' | 'partOverrides'
  >,
  o: SceneObject,
  partIndex?: number,
): MaterialResolution {
  const part = objectPart(o)
  const role = o.role || PART_ROLE[part]
  let mat = materials[role] ?? materials.corpus
  let source: MaterialResolution['source'] = 'project'
  let label = mat.name
  const mount = inst.params.mount === 'wall' ? 'wall' : 'floor'
  const zone = (inst.zone || '').trim()
  // 1) общие переменные, 2) переменные зоны (этаж/комната) — они сильнее.
  for (const zonePass of [false, true]) {
    for (const scope of ['all', mount] as const) {
      for (const v of vars) {
        if (!v.enabled || v.scope !== scope || !v.parts.includes(part)) continue
        const z = (v.zone || '').trim()
        if (zonePass && (!z || z !== zone)) continue
        if (!zonePass && z) continue
        if (v.material) {
          mat = v.material
          source = 'variable'
          label = v.name
        }
      }
    }
  }
  if (inst.materials?.[role]) {
    mat = inst.materials[role]
    source = 'module'
    label = 'материал модуля'
  }
  const group = inst.partMaterialGroups?.[partGroupKey(o)]
  if (group) {
    mat = group
    source = 'group'
    label = 'все такие детали'
  }
  if (partIndex != null && inst.partMaterials?.[partIndex]) {
    mat = inst.partMaterials[partIndex]
    source = 'part'
    label = 'эта деталь'
  }
  const exact = inst.partOverrides?.[partUid(o)]
  if (exact) {
    mat = exact
    source = 'part'
    label = 'эта деталь'
  }
  return { material: mat, source, label }
}

export function resolveObjectMaterial(
  materials: Materials,
  vars: MaterialVariable[],
  inst: Pick<
    Instance,
    'materials' | 'params' | 'zone' | 'partMaterials' |
    'partMaterialGroups' | 'partOverrides'
  >,
  o: SceneObject,
  partIndex?: number,
): Material {
  return resolveMaterial(materials, vars, inst, o, partIndex).material
}
