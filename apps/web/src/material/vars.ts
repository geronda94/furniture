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

/**
 * Материал детали: базовый по роли → глобальные переменные (all, затем
 * floor/wall) → переопределение материала модуля.
 */
export function resolveObjectMaterial(
  materials: Materials,
  vars: MaterialVariable[],
  inst: Pick<Instance, 'materials' | 'params'>,
  o: SceneObject,
): Material {
  const part = objectPart(o)
  const role = o.role || PART_ROLE[part]
  let mat = materials[role] ?? materials.corpus
  const mount = inst.params.mount === 'wall' ? 'wall' : 'floor'
  for (const scope of ['all', mount] as const) {
    for (const v of vars) {
      if (!v.enabled || v.scope !== scope || !v.parts.includes(part)) continue
      if (v.material) mat = v.material
    }
  }
  if (inst.materials?.[role]) mat = inst.materials[role]
  return mat
}
