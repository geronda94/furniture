/**
 * Геометрия ручек: бар/рейлинг/кнопка. Собирается из цилиндров и
 * привязывается к створке (родитель — меш фасада), поэтому ручка едет
 * вместе с дверью/ящиком.
 */
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'

const MM = 0.001

export type HandleHole = { x: number; y: number }
export type HandleHost = { sx: number; sy: number; sz: number }

type Args = {
  scene: Scene
  parent: Mesh
  key: string
  instanceId: string
  part: number
  host: HandleHost
  holes: HandleHole[]
  model: string
  material: StandardMaterial
  visible: boolean
}

export function buildHandleMeshes({
  scene,
  parent,
  key,
  instanceId,
  part,
  host,
  holes,
  model,
  material,
  visible,
}: Args): Mesh[] {
  if (!holes.length) return []
  const xs = holes.map((h) => h.x)
  const ys = holes.map((h) => h.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cx = ((minX + maxX) / 2 - host.sx / 2) * MM
  const cy = ((minY + maxY) / 2 - host.sz / 2) * MM
  const spanX = maxX - minX
  const spanY = maxY - minY
  const knob = model.startsWith('knob') || (spanX < 1 && spanY < 1)
  const vertical = spanY > spanX + 1
  const centers = Math.max(spanX, spanY, 0)
  const barLen = Math.max(96, centers + 24)
  const frontZ = (-host.sy / 2) * MM

  const make = (
    name: string,
    diameter: number,
    length: number,
    x: number,
    y: number,
    z: number,
    axis: 'x' | 'y' | 'z',
  ): Mesh => {
    const m = CreateCylinder(
      `${key}:${name}`,
      {
        diameter: diameter * MM,
        height: length * MM,
        tessellation: 20,
      },
      scene,
    )
    m.parent = parent
    m.position.set(x, y, z)
    if (axis === 'x') m.rotation.z = Math.PI / 2
    else if (axis === 'z') m.rotation.x = Math.PI / 2
    m.material = material
    m.isPickable = false
    m.metadata = { instanceId, part, hardware: true }
    m.setEnabled(visible)
    return m
  }

  if (knob) {
    return [
      make('handle-stem', 8, 16, cx, cy, frontZ - 8 * MM, 'z'),
      make('handle-knob', 30, 14, cx, cy, frontZ - 22 * MM, 'z'),
    ]
  }
  if (vertical) {
    const py = Math.min(barLen / 2 - 12, Math.max(12, centers / 2))
    return [
      make('handle-bar', 12, barLen, cx, cy, frontZ - 28 * MM, 'y'),
      make('handle-post-a', 8, 28, cx, cy - py * MM, frontZ - 14 * MM, 'z'),
      make('handle-post-b', 8, 28, cx, cy + py * MM, frontZ - 14 * MM, 'z'),
    ]
  }
  const px = Math.min(barLen / 2 - 12, Math.max(12, centers / 2))
  return [
    make('handle-bar', 12, barLen, cx, cy, frontZ - 28 * MM, 'x'),
    make('handle-post-a', 8, 28, cx - px * MM, cy, frontZ - 14 * MM, 'z'),
    make('handle-post-b', 8, 28, cx + px * MM, cy, frontZ - 14 * MM, 'z'),
  ]
}
