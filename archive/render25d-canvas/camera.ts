import { add, clamp, cross, dot, mul, norm, sub } from './math'
import type { Camera, Vec3 } from './types'

export interface Basis {
  r: Vec3
  u: Vec3
  f: Vec3
}

/** Ортографическая/перспективная камера: yaw вокруг Z, pitch от горизонта. */
export function basis(cam: Camera): Basis {
  const yaw = (cam.yaw * Math.PI) / 180
  const pitch = (cam.pitch * Math.PI) / 180
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)

  // направление от цели к глазу (глаз на -Y при yaw=0)
  const eye: Vec3 = [Math.sin(yaw) * cp, -Math.cos(yaw) * cp, sp]
  const f: Vec3 = [-eye[0], -eye[1], -eye[2]]

  // у плана (pitch≈90°) мировая Z параллельна взгляду — берём Y как up
  const worldUp: Vec3 = Math.abs(sp) > 0.999 ? [0, 1, 0] : [0, 0, 1]
  const r = norm(cross(f, worldUp))
  const u = cross(r, f)
  return { r, u, f }
}

export function focalPx(cam: Camera, h: number): number {
  return h / 2 / Math.tan(((cam.fov ?? 45) * Math.PI) / 360)
}

export interface Projected {
  x: number
  y: number
  d: number
}

export interface Projector extends Basis {
  w: number
  h: number
  zoom: number
  eye?: Vec3
  focal?: number
  point: (p: Vec3) => Projected
}

export function makeProjector(cam: Camera, w: number, h: number): Projector {
  const b = basis(cam)
  const cx = w / 2
  const cy = h / 2
  const [tx, ty, tz] = cam.target
  const { r, u, f } = b

  if (cam.projection === 'persp') {
    const focal = focalPx(cam, h)
    const dist = cam.distance ?? 6000
    const eye: Vec3 = [tx - f[0] * dist, ty - f[1] * dist, tz - f[2] * dist]

    const point = (p: Vec3): Projected => {
      const vx = p[0] - eye[0]
      const vy = p[1] - eye[1]
      const vz = p[2] - eye[2]
      const z = vx * f[0] + vy * f[1] + vz * f[2]
      const zz = Math.max(z, 1)
      return {
        x: cx + ((vx * r[0] + vy * r[1] + vz * r[2]) / zz) * focal,
        y: cy - ((vx * u[0] + vy * u[1] + vz * u[2]) / zz) * focal,
        d: z,
      }
    }
    return { ...b, w, h, zoom: cam.zoom, eye, focal, point }
  }

  const point = (p: Vec3): Projected => {
    const dx = p[0] - tx
    const dy = p[1] - ty
    const dz = p[2] - tz
    return {
      x: cx + (dx * r[0] + dy * r[1] + dz * r[2]) * cam.zoom,
      y: cy - (dx * u[0] + dy * u[1] + dz * u[2]) * cam.zoom,
      d: dx * f[0] + dy * f[1] + dz * f[2],
    }
  }

  return { ...b, w, h, zoom: cam.zoom, point }
}

/** Точка на полу z=0 под экранной координатой. */
export function screenToFloor(
  px: number,
  py: number,
  cam: Camera,
  w: number,
  h: number,
): Vec3 {
  const { r, u, f } = basis(cam)
  const [tx, ty, tz] = cam.target

  if (cam.projection === 'persp') {
    const focal = focalPx(cam, h)
    const dist = cam.distance ?? 6000
    const eye: Vec3 = [tx - f[0] * dist, ty - f[1] * dist, tz - f[2] * dist]
    const dx = (px - w / 2) / focal
    const dy = -(py - h / 2) / focal
    const dir = add(add(mul(r, dx), mul(u, dy)), f)
    if (Math.abs(dir[2]) < 1e-5) return [tx, ty, 0]
    const t = -eye[2] / dir[2]
    if (!Number.isFinite(t) || t <= 0) return [tx, ty, 0]
    return add(eye, mul(dir, t))
  }

  const sx = (px - w / 2) / cam.zoom
  const sy = -(py - h / 2) / cam.zoom
  const denom = f[2]
  if (Math.abs(denom) < 1e-6) return [tx, ty, 0]
  const k = -(tz + r[2] * sx + u[2] * sy) / denom
  return [
    tx + r[0] * sx + u[0] * sy + f[0] * k,
    ty + r[1] * sx + u[1] * sy + f[1] * k,
    0,
  ]
}

/** Точка на плоскости цели (стабильна для зума к курсору). */
export function screenToTargetPlane(
  px: number,
  py: number,
  cam: Camera,
  w: number,
  h: number,
): Vec3 {
  const { r, u, f } = basis(cam)
  const [tx, ty, tz] = cam.target

  if (cam.projection === 'persp') {
    const focal = focalPx(cam, h)
    const dx = (px - w / 2) / focal
    const dy = -(py - h / 2) / focal
    const dir = add(add(mul(r, dx), mul(u, dy)), f)
    const dist = cam.distance ?? 6000
    const s = dist / (dot(dir, f) || 1)
    const eye = sub(cam.target, mul(f, dist))
    return add(eye, mul(dir, s))
  }

  const sx = (px - w / 2) / cam.zoom
  const sy = -(py - h / 2) / cam.zoom
  return [
    tx + r[0] * sx + u[0] * sy,
    ty + r[1] * sx + u[1] * sy,
    tz + r[2] * sx + u[2] * sy,
  ]
}

/** Подобрать zoom (орто) или distance (перспектива) так, чтобы точки влезли. */
export function fitCamera(
  cam: Camera,
  points: Vec3[],
  w: number,
  h: number,
  pad = 0.14,
): Camera {
  if (!points.length || w < 2 || h < 2) return cam
  const { r, u } = basis(cam)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let wMin: Vec3 = [Infinity, Infinity, Infinity]
  let wMax: Vec3 = [-Infinity, -Infinity, -Infinity]

  for (const p of points) {
    const x = dot(p, r)
    const y = dot(p, u)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    for (let k = 0; k < 3; k++) {
      if (p[k] < wMin[k]) wMin[k] = p[k]
      if (p[k] > wMax[k]) wMax[k] = p[k]
    }
  }

  if (cam.projection === 'persp') {
    const center: Vec3 = [
      (wMin[0] + wMax[0]) / 2,
      (wMin[1] + wMax[1]) / 2,
      (wMin[2] + wMax[2]) / 2,
    ]
    let radius = 1
    for (const p of points) {
      radius = Math.max(radius, Math.hypot(
        p[0] - center[0],
        p[1] - center[1],
        p[2] - center[2],
      ))
    }
    const fov = ((cam.fov ?? 45) * Math.PI) / 180
    const focal = h / 2 / Math.tan(fov / 2)
    const halfH = Math.atan(w / 2 / focal)
    const half = Math.min(fov / 2, halfH)
    const distance = clamp(
      (radius * (1 + pad)) / Math.max(0.05, Math.sin(half)),
      100,
      1e7,
    )
    return { ...cam, target: center, distance }
  }

  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const zoom = clamp(
    Math.min((w * (1 - pad)) / spanX, (h * (1 - pad)) / spanY),
    0.01,
    3,
  )

  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const target = add(mul(r, midX), mul(u, midY))

  return { ...cam, zoom, target }
}
