import { add, cross, dot, len, mul, norm, sub } from './math'
import { basis, makeProjector } from './camera'
import { outlinePoints, roomWalls, triangulate, type WallSeg } from './room'
import type {
  Camera,
  Face,
  Material,
  Materials,
  Opening,
  PlacedObject,
  Pt,
  Room,
  Vec3,
  ViewStyle,
  WallIndex,
} from './types'
import type { Projector } from './camera'

const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
]

const FACES: readonly (readonly number[])[] = [
  [0, 1, 2, 3], // z-
  [4, 5, 6, 7], // z+
  [0, 1, 5, 4], // y-
  [3, 2, 6, 7], // y+
  [0, 3, 7, 4], // x-
  [1, 2, 6, 5], // x+
]

const FALLBACK: Material = {
  name: 'Материал',
  color: '#9aa1a8',
  pattern: 'solid',
}

const LIGHT = norm([-0.38, -0.62, 0.68])
const FILL = norm([0.62, 0.42, 0.36])

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  if (!Number.isFinite(n)) return [150, 150, 150]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function shade(color: string, k: number): string {
  const [r, g, b] = hexToRgb(color)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${c(r)},${c(g)},${c(b)})`
}

interface FaceInput {
  world: Vec3[]
  normal: Vec3
  material: Material
  kind: string
  objectId?: string
  part?: number
  alpha?: number
  /** общая UV-рамка для соседних граней (пол, стены) — убирает швы */
  uv?: { origin: Vec3; u: Vec3; v: Vec3 }
}

function makeFace(
  proj: Projector,
  input: FaceInput,
  style: ViewStyle,
): Face | null {
  const { world, normal, material, kind, objectId, part, alpha } = input

  const p0 = world[0]
  const p1 = world[1]
  const p3 = world[world.length - 1]

  const e1 = sub(p1, p0)
  const e2 = sub(p3, p0)
  const grainAxis = Math.abs(normal[2]) > 0.7 ? 0 : 2
  const useE1 = Math.abs(e1[grainAxis]) >= Math.abs(e2[grainAxis])
  const eU = useE1 ? e1 : e2
  const eV = useE1 ? e2 : e1

  let uLen = len(eU)
  let vLen = len(eV)
  let uvOrigin = p0
  let uvU = eU
  let uvV = eV
  if (input.uv) {
    uvOrigin = input.uv.origin
    uvU = input.uv.u
    uvV = input.uv.v
    uLen = len(uvU)
    vLen = len(uvV)
  }
  if (uLen < 0.001) uLen = 1
  if (vLen < 0.001) vLen = 1

  const pts: Pt[] = world.map((p) => {
    const q = proj.point(p)
    return { x: q.x, y: q.y }
  })

  let cx = 0
  let cy = 0
  let cz = 0
  for (const p of world) {
    cx += p[0]
    cy += p[1]
    cz += p[2]
  }
  const center: Vec3 = [
    cx / world.length,
    cy / world.length,
    cz / world.length,
  ]

  // перспектива: грань видна, если её нормаль смотрит на глаз
  if (proj.eye) {
    if (dot(normal, sub(proj.eye, center)) <= 1e-6) return null
  } else if (dot(normal, proj.f) >= -1e-6) {
    return null
  }

  const a = proj.point(p0)
  const b = proj.point(add(p0, eU))
  const c = proj.point(add(p0, eV))

  const key = Math.max(0, dot(normal, LIGHT))
  const fill = Math.max(0, dot(normal, FILL))
  const intensity =
    style === 'realistic'
      ? 0.7 + 0.24 * key + 0.06 * fill
      : 0.62 + 0.38 * key

  const projPts = pts.map((_, i) => proj.point(world[i]))
  return {
    pts,
    depth: proj.point(center).d,
    dmin: Math.min(...projPts.map((q) => q.d)),
    normal,
    p00: { x: a.x, y: a.y },
    p10: { x: b.x, y: b.y },
    p01: { x: c.x, y: c.y },
    uLen,
    vLen,
    uvOrigin,
    uvU,
    uvV,
    color: shade(material.color, intensity),
    material,
    kind,
    objectId,
    part,
    alpha,
  }
}

function boxCorners(
  obj: PlacedObject['object'],
  placement: PlacedObject['placement'],
  anim?: Record<string, number>,
): Vec3[] {
  const rot = (placement.rot * Math.PI) / 180
  const cs = Math.cos(rot)
  const sn = Math.sin(rot)
  return CORNERS.map(([ix, iy, iz]) => {
    let lx = obj.x + ix * obj.sx
    let ly = obj.y + iy * obj.sy
    const lz = obj.z + iz * obj.sz

    const openDeg = anim?.open ?? 0
    if (obj.kind === 'door' && obj.hinge && openDeg) {
      const a = ((obj.hinge === 'left' ? -openDeg : openDeg) * Math.PI) / 180
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const px = obj.hinge === 'left' ? obj.x : obj.x + obj.sx
      const py = obj.y
      const dx = lx - px
      const dy = ly - py
      lx = px + dx * ca - dy * sa
      ly = py + dx * sa + dy * ca
    }

    const slide = anim?.slide ?? 0
    if (
      (obj.kind === 'drawerfront' || obj.kind === 'drawerbox') &&
      slide
    ) {
      ly -= slide
    }

    return [
      placement.x + lx * cs - ly * sn,
      placement.y + lx * sn + ly * cs,
      lz + (placement.z ?? 0),
    ] as Vec3
  })
}

function quadNormal(world: Vec3[]): Vec3 {
  return norm(cross(sub(world[1], world[0]), sub(world[2], world[0])))
}

export interface SceneInput {
  objects: PlacedObject[]
  /** если не задана — рисуется только мебель (просмотр модуля) */
  room?: Room
  camera: Camera
  materials: Materials
  width: number
  height: number
  style: ViewStyle
  wallMode: 'cutaway' | 'low'
}

export interface ShadowSpec {
  id: string
  pts: Pt[]
}

export interface SceneResult {
  faces: Face[]
  projector: Projector
  shadows: ShadowSpec[]
}

export interface RoomPalette {
  floor: Material
  wall: Material
  reveal: Material
  glass: Material
  frame: Material
  door: Material
  handle: Material
  sky: Material
}

export const DEFAULT_ROOM: RoomPalette = {
  floor: {
    name: 'Пол',
    color: '#8b7a63',
    accent: '#6a5c49',
    pattern: 'wood',
    texScale: 1100,
  },
  wall: { name: 'Стена', color: '#d5d1c9', pattern: 'solid' },
  reveal: { name: 'Откос', color: '#c6c2ba', pattern: 'solid' },
  glass: { name: 'Стекло', color: '#a9c8d6', pattern: 'solid' },
  frame: { name: 'Рама', color: '#efeee9', pattern: 'solid' },
  door: {
    name: 'Дверь',
    color: '#c7b394',
    accent: '#a68c6a',
    pattern: 'wood',
    texScale: 900,
  },
  handle: { name: 'Ручка', color: '#3c3f43', pattern: 'metal' },
  sky: { name: 'Улица', color: '#b9d6e4', pattern: 'solid' },
}

export function roomPoints(room: Room): Vec3[] {
  const pts = outlinePoints(room)
  const base: Vec3[] = pts.map((p) => [p.x, p.y, 0])
  const top: Vec3[] = pts.map((p) => [p.x, p.y, room.h])
  return [...base, ...top]
}

export function wallLength(wall: number, room: Room): number {
  return roomWalls(room).find((w) => w.index === wall)?.len ?? 0
}

function wallPoint(
  seg: WallSeg,
  s: number,
  z: number,
  inset = 0,
): Vec3 {
  return [
    seg.a.x + seg.dx * s + seg.nx * inset,
    seg.a.y + seg.dy * s + seg.ny * inset,
    z,
  ]
}

function wallQuad(
  seg: WallSeg,
  s0: number,
  s1: number,
  z0: number,
  z1: number,
  inset = 0,
): Vec3[] {
  return [
    wallPoint(seg, s0, z0, inset),
    wallPoint(seg, s1, z0, inset),
    wallPoint(seg, s1, z1, inset),
    wallPoint(seg, s0, z1, inset),
  ]
}

function roomFaces(
  room: Room,
  wallMode: 'cutaway' | 'low',
  camera: Camera,
): FaceInput[] {
  const out: FaceInput[] = []
  const h = wallMode === 'low' ? Math.min(room.h, 1100) : room.h
  const wallT = Math.max(40, Math.min(300, room.wallT ?? 100))
  const mid = wallT / 2
  const p = DEFAULT_ROOM
  const pts = outlinePoints(room)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const floorUv = {
    origin: [minX, minY, 0] as Vec3,
    u: [Math.max(1, maxX - minX), 0, 0] as Vec3,
    v: [0, Math.max(1, maxY - minY), 0] as Vec3,
  }

  // пол — корректная триангуляция (в т.ч. для Г- и многоугольных комнат)
  for (const tri of triangulate(pts)) {
    out.push({
      world: [
        [tri[0].x, tri[0].y, 0],
        [tri[1].x, tri[1].y, 0],
        [tri[2].x, tri[2].y, 0],
      ],
      normal: [0, 0, 1],
      material: p.floor,
      kind: 'floor',
      uv: floorUv,
    })
  }

  const eyeDir = mul(basis(camera).f, -1)
  const walls = roomWalls(room)

  for (const seg of walls) {
    if (!seg.outer) {
      out.push(...partitionFaces(seg, room, h, wallT))
      continue
    }
    // в разрезе прячем только стены, обращённые к камере
    if (wallMode === 'cutaway') {
      const facing = seg.nx * eyeDir[0] + seg.ny * eyeDir[1]
      if (seg.outer && facing < -0.55) continue
    }
    const L = seg.len
    const n: Vec3 = [seg.nx, seg.ny, 0]
    const tangent: Vec3 = [seg.dx, seg.dy, 0]
    const wallUv = {
      origin: wallPoint(seg, 0, 0, 0),
      u: [seg.dx * L, seg.dy * L, 0] as Vec3,
      v: [0, 0, h] as Vec3,
    }
    const ops = (room.openings ?? [])
      .filter((o) => o.wall === seg.index)
      .sort((a, b) => a.x - b.x)

    const pushWall = (s0: number, s1: number, z0: number, z1: number) => {
      if (s1 - s0 < 0.5 || z1 - z0 < 0.5) return
      out.push({
        world: wallQuad(seg, s0, s1, z0, z1),
        normal: n,
        material: p.wall,
        kind: 'wall',
        uv: wallUv,
      })
    }

    let cursor = 0
    for (const o of ops) {
      const x0 = Math.max(0, Math.min(L, o.x))
      const x1 = Math.max(x0, Math.min(L, o.x + o.w))
      const z0 = Math.max(0, Math.min(h, o.z0))
      const z1 = Math.max(z0, Math.min(h, o.z1))
      pushWall(cursor, x0, 0, h)
      pushWall(x0, x1, 0, z0)
      pushWall(x0, x1, z1, h)

      const fw = Math.min(60, Math.max(20, (x1 - x0) * 0.08))
      // откосы
      out.push({
        world: [
          wallPoint(seg, x0, z0, 0),
          wallPoint(seg, x0, z0, -wallT),
          wallPoint(seg, x0, z1, -wallT),
          wallPoint(seg, x0, z1, 0),
        ],
        normal: tangent,
        material: p.reveal,
        kind: 'reveal',
      })
      out.push({
        world: [
          wallPoint(seg, x1, z0, 0),
          wallPoint(seg, x1, z0, -wallT),
          wallPoint(seg, x1, z1, -wallT),
          wallPoint(seg, x1, z1, 0),
        ],
        normal: [-tangent[0], -tangent[1], -tangent[2]],
        material: p.reveal,
        kind: 'reveal',
      })
      if (z0 > 0.5) {
        out.push({
          world: [
            wallPoint(seg, x0, z0, 0),
            wallPoint(seg, x1, z0, 0),
            wallPoint(seg, x1, z0, -wallT),
            wallPoint(seg, x0, z0, -wallT),
          ],
          normal: [0, 0, 1],
          material: p.reveal,
          kind: 'reveal',
        })
      }
      out.push({
        world: [
          wallPoint(seg, x0, z1, 0),
          wallPoint(seg, x1, z1, 0),
          wallPoint(seg, x1, z1, -wallT),
          wallPoint(seg, x0, z1, -wallT),
        ],
        normal: [0, 0, -1],
        material: p.reveal,
        kind: 'reveal',
      })

      if (o.kind === 'window') {
        out.push({
          world: wallQuad(seg, x0, x1, z0, z1, -wallT - 70),
          normal: n,
          material: p.sky,
          kind: 'sky',
        })
        out.push({
          world: wallQuad(seg, x0, x1, z0, z1, mid),
          normal: n,
          material: p.glass,
          kind: 'glass',
          alpha: 0.42,
        })
        for (const [a, b, c, d2] of [
          [x0, x0 + fw, z0, z1],
          [x1 - fw, x1, z0, z1],
          [x0, x1, z0, z0 + fw],
          [x0, x1, z1 - fw, z1],
        ] as const) {
          out.push({
            world: wallQuad(seg, a, b, c, d2, mid + 18),
            normal: n,
            material: p.frame,
            kind: 'frame',
          })
        }
        const sMid = (x0 + x1) / 2
        out.push({
          world: wallQuad(seg, sMid - 22, sMid + 22, z0, z1, mid + 18),
          normal: n,
          material: p.frame,
          kind: 'frame',
        })
      } else {
        if (o.open) {
          const leaf = doorLeaf(seg, o, x0, x1, z0, z1, mid)
          const ln = quadNormal(leaf)
          out.push({
            world: leaf,
            normal: ln,
            material: p.door,
            kind: 'doorleaf',
          })
          out.push({
            world: [...leaf].reverse(),
            normal: [-ln[0], -ln[1], -ln[2]],
            material: p.door,
            kind: 'doorleaf',
          })
        } else {
          out.push({
            world: wallQuad(seg, x0, x1, z0, z1, mid),
            normal: n,
            material: p.door,
            kind: 'doorleaf',
          })
        }
        for (const [a, b, c, d2] of [
          [x0, x0 + fw, z0, z1],
          [x1 - fw, x1, z0, z1],
          [x0, x1, z1 - fw, z1],
        ] as const) {
          out.push({
            world: wallQuad(seg, a, b, c, d2, mid + 16),
            normal: n,
            material: p.frame,
            kind: 'frame',
          })
        }
        if (!o.open) {
          const hz = (z0 + z1) / 2
          const h0 = o.hinge === 'right' ? x0 + 70 : x1 - 110
          out.push({
            world: wallQuad(seg, h0, h0 + 40, hz - 22, hz + 22,
              mid + 40),
            normal: n,
            material: p.handle,
            kind: 'handle',
          })
        }
      }
      cursor = Math.max(cursor, x1)
    }
    pushWall(cursor, L, 0, h)
    out.push({
      world: [
        wallPoint(seg, 0, h),
        wallPoint(seg, L, h),
        wallPoint(seg, L, h, -wallT),
        wallPoint(seg, 0, h, -wallT),
      ],
      normal: [0, 0, 1],
      material: p.wall,
      kind: 'walltop',
    })
  }

  return out
}

function doorLeaf(
  seg: WallSeg,
  o: { hinge?: 'left' | 'right'; angle?: number },
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  mid: number,
): Vec3[] {
  const right = o.hinge === 'right'
  const hx = right ? x1 : x0
  const w = Math.max(1, x1 - x0)
  const sign = right ? -1 : 1
  const ang = (Math.max(0, Math.min(120, o.angle ?? 80)) * Math.PI) / 180
  const freeS = hx + sign * w * Math.cos(ang)
  const freeI = mid + w * Math.sin(ang)
  return [
    wallPoint(seg, hx, z0, mid),
    wallPoint(seg, freeS, z0, freeI),
    wallPoint(seg, freeS, z1, freeI),
    wallPoint(seg, hx, z1, mid),
  ]
}

function partitionFaces(
  seg: WallSeg,
  room: Room,
  h: number,
  wallT: number,
): FaceInput[] {
  const out: FaceInput[] = []
  const p = DEFAULT_ROOM
  const L = seg.len
  const mid = wallT / 2
  const nA: Vec3 = [seg.nx, seg.ny, 0]
  const nB: Vec3 = [-seg.nx, -seg.ny, 0]
  const tangent: Vec3 = [seg.dx, seg.dy, 0]
  const ops = (room.openings ?? [])
    .filter((o) => o.wall === seg.index)
    .sort((a, b) => a.x - b.x)

  const faceRanges = (): [number, number, number, number][] => {
    const outR: [number, number, number, number][] = []
    let cursor = 0
    for (const o of ops) {
      const x0 = Math.max(0, Math.min(L, o.x))
      const x1 = Math.max(x0, Math.min(L, o.x + o.w))
      const z0 = Math.max(0, Math.min(h, o.z0))
      const z1 = Math.max(z0, Math.min(h, o.z1))
      if (x0 > cursor) outR.push([cursor, x0, 0, h])
      if (z0 > 0.5) outR.push([x0, x1, 0, z0])
      if (z1 < h - 0.5) outR.push([x0, x1, z1, h])
      cursor = Math.max(cursor, x1)
    }
    if (cursor < L) outR.push([cursor, L, 0, h])
    return outR
  }

  const ranges = faceRanges()
  for (const [s0, s1, z0, z1] of ranges) {
    out.push({
      world: wallQuad(seg, s0, s1, z0, z1, 0),
      normal: nA,
      material: p.wall,
      kind: 'wall',
      uv: {
        origin: wallPoint(seg, 0, 0, 0),
        u: [seg.dx * L, seg.dy * L, 0],
        v: [0, 0, h],
      },
    })
    out.push({
      world: wallQuad(seg, s0, s1, z0, z1, -wallT),
      normal: nB,
      material: p.wall,
      kind: 'wall',
      uv: {
        origin: wallPoint(seg, 0, 0, 0),
        u: [seg.dx * L, seg.dy * L, 0],
        v: [0, 0, h],
      },
    })
  }

  for (const o of ops) {
    const x0 = Math.max(0, Math.min(L, o.x))
    const x1 = Math.max(x0, Math.min(L, o.x + o.w))
    const z0 = Math.max(0, Math.min(h, o.z0))
    const z1 = Math.max(z0, Math.min(h, o.z1))
    // откосы проёма
    out.push({
      world: [
        wallPoint(seg, x0, z0, 0), wallPoint(seg, x0, z0, -wallT),
        wallPoint(seg, x0, z1, -wallT), wallPoint(seg, x0, z1, 0),
      ],
      normal: tangent, material: p.reveal, kind: 'reveal',
    })
    out.push({
      world: [
        wallPoint(seg, x1, z0, 0), wallPoint(seg, x1, z0, -wallT),
        wallPoint(seg, x1, z1, -wallT), wallPoint(seg, x1, z1, 0),
      ],
      normal: [-tangent[0], -tangent[1], -tangent[2]],
      material: p.reveal, kind: 'reveal',
    })
    if (z0 > 0.5) {
      out.push({
        world: [
          wallPoint(seg, x0, z0, 0), wallPoint(seg, x1, z0, 0),
          wallPoint(seg, x1, z0, -wallT), wallPoint(seg, x0, z0, -wallT),
        ],
        normal: [0, 0, 1], material: p.reveal, kind: 'reveal',
      })
    }
    out.push({
      world: [
        wallPoint(seg, x0, z1, 0), wallPoint(seg, x1, z1, 0),
        wallPoint(seg, x1, z1, -wallT), wallPoint(seg, x0, z1, -wallT),
      ],
      normal: [0, 0, -1], material: p.reveal, kind: 'reveal',
    })

    if (o.kind === 'window') {
      for (const [inset, normal] of [
        [mid, nA], [mid, nB],
      ] as const) {
        out.push({
          world: wallQuad(seg, x0, x1, z0, z1, inset),
          normal, material: p.glass, kind: 'glass', alpha: 0.42,
        })
      }
    } else {
      if (o.open) {
        const leaf = doorLeaf(seg, o, x0, x1, z0, z1, mid)
        const ln = quadNormal(leaf)
        out.push({ world: leaf, normal: ln, material: p.door, kind: 'doorleaf' })
        out.push({ world: [...leaf].reverse(),
          normal: [-ln[0], -ln[1], -ln[2]],
          material: p.door, kind: 'doorleaf' })
      } else {
        out.push({
          world: wallQuad(seg, x0, x1, z0, z1, mid),
          normal: nA, material: p.door, kind: 'doorleaf',
        })
        out.push({
          world: wallQuad(seg, x0, x1, z0, z1, mid),
          normal: nB, material: p.door, kind: 'doorleaf',
        })
      }
    }
  }

  out.push({
    world: [
      wallPoint(seg, 0, h, 0), wallPoint(seg, L, h, 0),
      wallPoint(seg, L, h, -wallT), wallPoint(seg, 0, h, -wallT),
    ],
    normal: [0, 0, 1], material: p.wall, kind: 'walltop',
  })
  return out
}

interface BoxInfo {
  corners: Vec3[]
  min: Vec3
  max: Vec3
  sx0: number
  sy0: number
  sx1: number
  sy1: number
  depth: number
}

/** Точка внутри ориентированного объёма другого модуля (с допуском, мм). */
function insideOther(
  c: Vec3,
  selfId: string,
  objects: PlacedObject[],
  eps = 0.6,
): boolean {
  for (const o of objects) {
    if (o.placement.id === selfId) continue
    const obj = o.object
    if (
      c[0] < o.placement.x - obj.sx - obj.sy ||
      c[0] > o.placement.x + obj.sx + obj.sy * 2
    ) {
      continue
    }
    const a = (-o.placement.rot * Math.PI) / 180
    const dx = c[0] - o.placement.x
    const dy = c[1] - o.placement.y
    const cs = Math.cos(a)
    const sn = Math.sin(a)
    const lx = dx * cs - dy * sn
    const ly = dx * sn + dy * cs
    if (
      lx > obj.x - eps &&
      lx < obj.x + obj.sx + eps &&
      ly > obj.y - eps &&
      ly < obj.y + obj.sy + eps &&
      c[2] > obj.z - eps &&
      c[2] < obj.z + obj.sz + eps
    ) {
      return true
    }
  }
  return false
}

function boxInfo(
  obj: PlacedObject,
  proj: Projector,
): BoxInfo {
  const corners = boxCorners(obj.object, obj.placement, obj.anim)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let sx0 = Infinity
  let sy0 = Infinity
  let sx1 = -Infinity
  let sy1 = -Infinity
  let depth = 0
  for (const p of corners) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k]
      if (p[k] > max[k]) max[k] = p[k]
    }
    const q = proj.point(p)
    if (q.x < sx0) sx0 = q.x
    if (q.x > sx1) sx1 = q.x
    if (q.y < sy0) sy0 = q.y
    if (q.y > sy1) sy1 = q.y
    depth += q.d / 8
  }
  return { corners, min, max, sx0, sy0, sx1, sy1, depth }
}

/** true — a позади b; false — a впереди b; null — не разделяются. */
function behind(a: BoxInfo, b: BoxInfo, f: Vec3): boolean | null {
  const eps = 0.05
  for (let k = 0; k < 3; k++) {
    if (a.max[k] <= b.min[k] + eps) return f[k] < 0
    if (b.max[k] <= a.min[k] + eps) return f[k] > 0
  }
  return null
}

/**
 * Порядок отрисовки коробок: топологическая сортировка по «кто за кем».
 * Это надёжнее сортировки по центроиду (полки не «просвечивают» сквозь дверь).
 * Для пересекающихся/неразделимых пар — откат к глубине центроида.
 */
function sortBoxes(infos: BoxInfo[], f: Vec3): number[] {
  const n = infos.length
  const adj: number[][] = Array.from({ length: n }, () => [])
  const indeg = new Array<number>(n).fill(0)
  const add = (i: number, j: number) => {
    adj[i].push(j)
    indeg[j]++
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = infos[i]
      const b = infos[j]
      // если на экране не пересекаются — порядок не важен
      if (
        a.sx1 < b.sx0 - 1 ||
        b.sx1 < a.sx0 - 1 ||
        a.sy1 < b.sy0 - 1 ||
        b.sy1 < a.sy0 - 1
      ) {
        continue
      }
      const r = behind(a, b, f)
      if (r === true) add(i, j)
      else if (r === false) add(j, i)
      else if (Math.abs(a.depth - b.depth) > 1e-3) {
        if (a.depth > b.depth) add(i, j)
        else add(j, i)
      }
    }
  }

  const order: number[] = []
  const queue: number[] = []
  const used = new Array<boolean>(n).fill(false)
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i)

  while (order.length < n) {
    if (!queue.length) {
      // цикл: продолжаем с самой дальней коробки
      let pick = -1
      for (let i = 0; i < n; i++) {
        if (used[i]) continue
        if (pick < 0 || infos[i].depth > infos[pick].depth) pick = i
      }
      if (pick < 0) break
      queue.push(pick)
    }
    const i = queue.shift() as number
    if (used[i]) continue
    used[i] = true
    order.push(i)
    for (const j of adj[i]) {
      if (indeg[j] > 0) indeg[j]--
      if (indeg[j] === 0) queue.push(j)
    }
  }
  return order
}

export function buildScene(input: SceneInput): SceneResult {
  const { objects, room, camera, materials, width, height, style } = input
  const proj = makeProjector(camera, width, height)

  const roomLike: Face[] = []
  if (room) {
    for (const rf of roomFaces(room, input.wallMode, camera)) {
      const f = makeFace(proj, rf, style)
      if (f) roomLike.push(f)
    }
  }
  roomLike.sort((a, b) => b.depth - a.depth)

  const boxFaces: Face[][] = []
  const infos: BoxInfo[] = []
  const moduleBoxes = new Map<string, BoxInfo>()
  const moduleParts = new Map<string, Face[]>()

  for (const placed of objects) {
    const mat = materials[placed.object.role] ?? materials.corpus ?? FALLBACK
    const info = boxInfo(placed, proj)
    infos.push(info)

    // габарит модуля = объединение габаритов его деталей
    const mid = placed.placement.id
    const mb = moduleBoxes.get(mid)
    if (!mb) {
      moduleBoxes.set(mid, {
        corners: info.corners,
        min: [...info.min] as Vec3,
        max: [...info.max] as Vec3,
        sx0: info.sx0,
        sy0: info.sy0,
        sx1: info.sx1,
        sy1: info.sy1,
        depth: info.depth,
      })
    } else {
      for (let k = 0; k < 3; k++) {
        if (info.min[k] < mb.min[k]) mb.min[k] = info.min[k]
        if (info.max[k] > mb.max[k]) mb.max[k] = info.max[k]
      }
      mb.sx0 = Math.min(mb.sx0, info.sx0)
      mb.sy0 = Math.min(mb.sy0, info.sy0)
      mb.sx1 = Math.max(mb.sx1, info.sx1)
      mb.sy1 = Math.max(mb.sy1, info.sy1)
      mb.depth = (mb.depth + info.depth) / 2
    }

    const local: Face[] = []
    const center: Vec3 = [
      info.corners.reduce((s, p) => s + p[0], 0) / 8,
      info.corners.reduce((s, p) => s + p[1], 0) / 8,
      info.corners.reduce((s, p) => s + p[2], 0) / 8,
    ]

    for (const idx of FACES) {
      const world = idx.map((i) => info.corners[i])
      let n = quadNormal(world)
      const faceCenter: Vec3 = [
        world.reduce((s, p) => s + p[0], 0) / 4,
        world.reduce((s, p) => s + p[1], 0) / 4,
        world.reduce((s, p) => s + p[2], 0) / 4,
      ]
      if (dot(n, sub(faceCenter, center)) < 0) n = mul(n, -1)

      // грань, целиком погружённая в соседний модуль (модули вплотную),
      // невидима: её перекрывает объём соседа
      if (
        objects.length > 1 &&
        insideOther(faceCenter, placed.placement.id, objects) &&
        world.every((p) => insideOther(p, placed.placement.id, objects))
      ) {
        continue
      }

      const f = makeFace(
        proj,
        {
          world,
          normal: n,
          material: mat,
          kind: placed.object.kind,
          objectId: placed.placement.id,
          part: placed.part,
        },
        style,
      )
      if (f) local.push(f)
    }
    boxFaces.push(local)
    const list = moduleParts.get(mid) ?? []
    list.push(...local)
    moduleParts.set(mid, list)
  }

  // Внутри модуля — два прохода: корпус/внутренности, затем фасады. Фасад
  // лежит на передней плоскости модуля и не может «просвечивать» через щели,
  // а перегородка не наезжает на закрытую дверь. Порядок самих модулей —
  // топологический, чтобы ближний модуль перекрывал дальний.
  const isFacade = (f: Face) =>
    f.kind === 'door' || f.kind === 'drawerfront'
  const byDepth = (a: Face, b: Face) => b.dmin - a.dmin || b.depth - a.depth

  const moduleOrder = [...moduleBoxes.keys()]
  const boxes = moduleOrder.map((id) => moduleBoxes.get(id) as BoxInfo)
  const order = sortBoxes(boxes, proj.f)

  const objectFaces: Face[] = []
  for (const oi of order) {
    const facesOf = moduleParts.get(moduleOrder[oi]) ?? []
    const inner = facesOf.filter((f) => !isFacade(f)).sort(byDepth)
    const facade = facesOf.filter(isFacade).sort(byDepth)
    objectFaces.push(...inner, ...facade)
  }

  const faces = [...roomLike, ...objectFaces]

  // Контактные тени: габарит каждого модуля на полу со сдвигом от света.
  const shadows: ShadowSpec[] = []
  const groups = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number; p: PlacedObject['placement'] }
  >()
  for (const { object, placement } of objects) {
    const g = groups.get(placement.id)
    if (!g) {
      groups.set(placement.id, {
        minX: object.x,
        maxX: object.x + object.sx,
        minY: object.y,
        maxY: object.y + object.sy,
        p: placement,
      })
    } else {
      g.minX = Math.min(g.minX, object.x)
      g.maxX = Math.max(g.maxX, object.x + object.sx)
      g.minY = Math.min(g.minY, object.y)
      g.maxY = Math.max(g.maxY, object.y + object.sy)
    }
  }
  for (const [id, g] of groups) {
    const rot = (g.p.rot * Math.PI) / 180
    const cs = Math.cos(rot)
    const sn = Math.sin(rot)
    const ox = 35
    const oy = 45
    const pts: Vec3[] = [
      [g.minX, g.minY, 0],
      [g.maxX, g.minY, 0],
      [g.maxX, g.maxY, 0],
      [g.minX, g.maxY, 0],
    ].map(([x, y, z]) => [
      g.p.x + x * cs - y * sn + ox,
      g.p.y + x * sn + y * cs + oy,
      z,
    ] as Vec3)
    shadows.push({
      id,
      pts: pts.map((p) => {
        const q = proj.point(p)
        return { x: q.x, y: q.y }
      }),
    })
  }

  return { faces, projector: proj, shadows }
}
