import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder'

export const MM = 0.001

export function matColor(hex: string): Color3 {
  try {
    return Color3.FromHexString(hex)
  } catch {
    return new Color3(0.6, 0.6, 0.6)
  }
}

export function shadeColor(hex: string, k: number): string {
  const c = matColor(hex)
  return new Color3(
    Math.min(1, c.r * k),
    Math.min(1, c.g * k),
    Math.min(1, c.b * k),
  ).toHexString()
}

export interface Paint {
  color: string
  alpha?: number
  spec?: number
  glow?: number
}

export interface PropBuildContext {
  scene: Scene
  shade: (hex: string, k: number) => string
  paint: (color: string) => Paint
  fabric: (color: string) => Paint
  wood: (color: string) => Paint
  ceramic: (color: string) => Paint
  metal: (color?: string) => Paint
  glass: (color?: string) => Paint
  screen: (color?: string) => Paint
  add: (
    parent: TransformNode, name: string,
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ) => Mesh
  cyl: (
    parent: TransformNode, name: string,
    diameter: number, height: number,
    x: number, y: number, z: number,
    p: Paint | string, top?: number,
  ) => Mesh
  ball: (
    parent: TransformNode, name: string,
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ) => Mesh
  soft: (
    parent: TransformNode, name: string,
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ) => Mesh
  ring: (
    parent: TransformNode, name: string,
    diameter: number, thickness: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ) => Mesh
  legs: (
    parent: TransformNode, name: string,
    w: number, d: number, height: number, inset: number,
    p: Paint | string, dia?: number,
  ) => void
}

/** Общий контекст построения декора: сцена + кэш материалов + примитивы. */
export function createPropContext(
  scene: Scene,
  matCache: Map<string, StandardMaterial>,
): PropBuildContext {
  const material = (
    color: string, alpha = 1, spec = 0.06, glow = 0.05,
  ): StandardMaterial => {
    const key = `${color}|${alpha}|${spec}|${glow}`
    let m = matCache.get(key)
    if (m) return m
    m = new StandardMaterial(`prop:${key}`, scene)
    m.diffuseColor = matColor(color)
    m.emissiveColor = matColor(color).scale(glow)
    m.specularColor = new Color3(spec, spec, spec)
    m.specularPower = 64
    m.alpha = alpha
    if (alpha < 1) {
      m.transparencyMode = 2
      m.needDepthPrePass = true
      m.backFaceCulling = false
    }
    matCache.set(key, m)
    return m
  }

  const apply = (m: Mesh, p: Paint | string): Mesh => {
    const q: Paint = typeof p === 'string' ? { color: p } : p
    m.material = material(q.color, q.alpha ?? 1, q.spec ?? 0.06,
      q.glow ?? 0.05)
    m.isPickable = false
    m.receiveShadows = true
    return m
  }

  const add = (
    parent: TransformNode, name: string,
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ): Mesh => {
    const m = CreateBox(name, {
      width: sx * MM, height: sy * MM, depth: sz * MM,
    }, scene)
    m.parent = parent
    m.position.set(x * MM, z * MM, y * MM)
    return apply(m, p)
  }

  const cyl = (
    parent: TransformNode, name: string,
    diameter: number, height: number,
    x: number, y: number, z: number,
    p: Paint | string, top = diameter,
  ): Mesh => {
    const m = CreateCylinder(name, {
      diameterBottom: diameter * MM,
      diameterTop: top * MM,
      height: height * MM,
      tessellation: 28,
    }, scene)
    m.parent = parent
    m.position.set(x * MM, z * MM, y * MM)
    return apply(m, p)
  }

  const ball = (
    parent: TransformNode, name: string,
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ): Mesh => {
    const m = CreateSphere(name, { diameter: 1, segments: 14 }, scene)
    m.parent = parent
    m.scaling.set(sx * MM, sy * MM, sz * MM)
    m.position.set(x * MM, z * MM, y * MM)
    return apply(m, p)
  }

  /** Мягкая подушка: капсула, растянутая по ширине/глубине. */
  const soft = (
    parent: TransformNode, name: string,
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ): Mesh => {
    const m = CreateCapsule(name, {
      radius: 0.5, height: 0.5, tessellation: 16, subdivisions: 6,
    }, scene)
    m.parent = parent
    m.rotation.z = Math.PI / 2
    m.scaling.set(sz * MM, (sx * MM) / 1.5, sy * MM)
    m.position.set(x * MM, z * MM, y * MM)
    return apply(m, p)
  }

  const ring = (
    parent: TransformNode, name: string,
    diameter: number, thickness: number,
    x: number, y: number, z: number,
    p: Paint | string,
  ): Mesh => {
    const m = CreateTorus(name, {
      diameter: diameter * MM,
      thickness: thickness * MM,
      tessellation: 28,
    }, scene)
    m.parent = parent
    m.position.set(x * MM, z * MM, y * MM)
    return apply(m, p)
  }

  const legs = (
    parent: TransformNode, name: string,
    w: number, d: number, height: number, inset: number,
    p: Paint | string, dia = 44,
  ): void => {
    for (const [i, sx, sy] of [
      [0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1],
    ] as const) {
      cyl(parent, `${name}-${i}`, dia, height,
        sx * (w / 2 - inset), sy * (d / 2 - inset), height / 2, p)
    }
  }

  return {
    scene,
    shade: shadeColor,
    paint: (color) => ({ color }),
    fabric: (color) => ({ color, spec: 0.02, glow: 0.04 }),
    wood: (color) => ({ color, spec: 0.14, glow: 0.03 }),
    ceramic: (color) => ({ color, spec: 0.34, glow: 0.04 }),
    metal: (color = '#9aa1a6') => ({ color, spec: 0.55, glow: 0.02 }),
    glass: (color = '#cfe4ea') => ({
      color, alpha: 0.2, spec: 0.75, glow: 0.03,
    }),
    screen: (color = '#0b0d10') => ({ color, spec: 0.5, glow: 0.18 }),
    add,
    cyl,
    ball,
    soft,
    ring,
    legs,
  }
}
