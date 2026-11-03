import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { DecorType } from '../../state/decorCatalog'
import type { PropBuildContext } from './context'

export interface PropBuildArgs {
  ctx: PropBuildContext
  root: TransformNode
  w: number
  d: number
  h: number
  /** основной цвет */
  c: string
  /** акцент (обивка/декор) */
  a: string
  /** затемнённый основной */
  dark: string
}

export type PropBuilder = (args: PropBuildArgs) => void

function buildBed({ ctx, root, w, d, h, c, a }: PropBuildArgs): void {
  const { add, soft, legs, wood, fabric, metal, shade } = ctx
  const frame = wood(c)
  legs(root, 'bed-leg', w, d, 110, 90, metal(shade(c, 0.62)), 56)
  add(root, 'bed-rail', w, 210, d, 0, 0, 215, frame)
  add(root, 'bed-mattress', w - 50, 210, d - 70, 0, 0, 425, fabric(a))
  soft(root, 'bed-duvet', w - 40, 66, d * 0.6, 0, -d * 0.12, 500,
    fabric(shade(a, 1.04)))
  add(root, 'bed-duvet-edge', w - 40, 20, 110, 0, -d * 0.37, 515,
    fabric(shade(a, 1.1)))
  add(root, 'bed-head', w, 900, 70, 0, d / 2 - 35, 450, frame)
  add(root, 'bed-head-pad', w - 110, 570, 34, 0, d / 2 - 82, 470,
    fabric(a))
  soft(root, 'bed-pillow-l', w * 0.34, 120, d * 0.18,
    -w * 0.21, d / 2 - 300, 545, fabric('#f1ede5'))
  soft(root, 'bed-pillow-r', w * 0.34, 120, d * 0.18,
    w * 0.21, d / 2 - 300, 545, fabric('#f1ede5'))
  add(root, 'bed-throw', w * 0.8, 34, d * 0.24, 0, -d * 0.3, 530,
    fabric(shade(c, 0.82)))
}

function buildSofaLike(args: PropBuildArgs, n: number): void {
  const { ctx, root, w, d, h, c, a, dark } = args
  const { add, cyl, soft, legs, fabric, metal, shade } = ctx
  const arm = Math.max(95, w * 0.085)
  const innerW = w - arm * 2 - 50
  const cw = (innerW - (n - 1) * 16) / n
  legs(root, 'sofa-leg', w, d, 100, 95, metal(dark), 42)
  add(root, 'sofa-frame', w - 50, 170, d - 50, 0, 0, 185, fabric(c))
  for (let i = 0; i < n; i++) {
    soft(root, `seat-${i}`, cw, 128, d * 0.68,
      -innerW / 2 + cw / 2 + i * (cw + 16), -d * 0.08, 334,
      fabric(a))
  }
  add(root, 'sofa-back', w, h * 0.56, 120, 0, d / 2 - 60, h * 0.6,
    fabric(c))
  for (let i = 0; i < n; i++) {
    soft(root, `back-${i}`, cw, h * 0.38, 110,
      -innerW / 2 + cw / 2 + i * (cw + 16), d / 2 - 130,
      h * 0.57, fabric(shade(a, 1.03)))
  }
  for (const [i, sx] of [[0, -1], [1, 1]] as const) {
    add(root, `arm-${i}`, arm, h * 0.56, d,
      sx * (w / 2 - arm / 2), 0, h * 0.37, fabric(c))
    const top = cyl(root, `arm-top-${i}`, arm, d,
      sx * (w / 2 - arm / 2), 0, h * 0.65, fabric(c))
    top.rotation.x = Math.PI / 2
  }
  const throwPillow = soft(root, 'sofa-pillow', w * 0.2, h * 0.2, 90,
    -w * 0.26, -d * 0.12, h * 0.5, fabric(shade(a, 1.08)))
  throwPillow.rotation.y = 0.45
}

export function buildSofa(args: PropBuildArgs): void {
  buildSofaLike(args, 3)
}

export function buildArmchair(args: PropBuildArgs): void {
  buildSofaLike(args, 1)
}

function buildChair({ ctx, root, w, d, h, c, a, dark }: PropBuildArgs): void {
  const { add, legs, wood } = ctx
  legs(root, 'chair-leg', w, d, h * 0.46, 52, wood(a), 34)
  add(root, 'chair-seat', w, 52, d, 0, 0, h * 0.48, wood(c))
  add(root, 'chair-seat-edge', w - 30, 18, d - 30, 0, 0, h * 0.455,
    wood(dark))
  for (const [i, sx] of [[0, -1], [1, 1]] as const) {
    add(root, `chair-stile-${i}`, 46, h * 0.5, 40,
      sx * (w / 2 - 45), d / 2 - 35, h * 0.73, wood(c))
  }
  add(root, 'chair-rail', w - 70, 70, 32, 0, d / 2 - 35, h * 0.97,
    wood(c))
  for (const [i, z] of [[0, h * 0.64], [1, h * 0.8]] as const) {
    add(root, `chair-slat-${i}`, w - 110, 46, 24, 0, d / 2 - 35, z,
      wood(c))
  }
}

function buildDresser({ ctx, root, w, d, h, c, a, dark }: PropBuildArgs): void {
  const { add, legs, wood, metal, shade } = ctx
  const legH = 70
  const bodyTop = h - 34
  const bodyH = bodyTop - legH
  const dw = w - 90
  const dh = (bodyH - 70) / 3
  legs(root, 'dresser-leg', w, d, legH, 58, metal(dark), 40)
  add(root, 'dresser-body', w, bodyH, d, 0, 0,
    legH + bodyH / 2, wood(c))
  add(root, 'dresser-top', w + 26, 34, d + 18, 0, 0, h - 17,
    wood(shade(c, 1.04)))
  for (let i = 0; i < 3; i++) {
    const z = legH + 22 + dh / 2 + i * (dh + 14)
    add(root, `drawer-${i}`, dw, dh, 18, 0, -d / 2 - 9, z,
      wood(a))
    add(root, `handle-${i}`, Math.min(220, dw * 0.3), 16, 22,
      0, -d / 2 - 26, z + dh * 0.2, metal('#b6bdc1'))
  }
}

function buildCoffeeTable({ ctx, root, w, d, h, c, a, dark }: PropBuildArgs): void {
  const { add, legs, wood, metal, paint, shade } = ctx
  const topH = h
  add(root, 'table-top', w, 48, d, 0, 0, topH - 24, wood(c))
  add(root, 'table-edge', w - 24, 18, d - 24, 0, 0, topH - 55,
    wood(dark))
  legs(root, 'table-leg', w, d, topH - 48, 78, wood(c), 46)
  add(root, 'table-shelf', w - 170, 20, d - 120, 0, 0, h * 0.34,
    wood(shade(c, 0.9)))
  add(root, 'table-book', w * 0.18, 26, d * 0.24, -w * 0.2, 0,
    h + 13, paint(a))
  add(root, 'table-tray', w * 0.26, 14, d * 0.3, w * 0.18, 0,
    h + 7, metal(dark))
}

function buildTv({ ctx, root, w, h }: PropBuildArgs): void {
  const { add, paint, metal, screen } = ctx
  add(root, 'tv-frame', w, h * 0.76, 55, 0, 0, h * 0.58,
    paint('#26292d'))
  add(root, 'tv-screen', w - 34, h * 0.76 - 34, 14, 0, -32,
    h * 0.58, screen())
  add(root, 'tv-neck', 90, h * 0.2, 60, 0, 0, h * 0.15,
    metal('#2c3034'))
  add(root, 'tv-foot', Math.max(420, w * 0.34), 26, 260, 0, 0, 13,
    metal('#2c3034'))
  add(root, 'tv-bar', w * 0.5, 22, 40, 0, -10, 8, paint('#17191c'))
}

function buildRug({ ctx, root, w, d, c, a }: PropBuildArgs): void {
  const { add, fabric, shade } = ctx
  add(root, 'rug-base', w, 10, d, 0, 0, 5, fabric(c))
  add(root, 'rug-field', w - 130, 4, d - 130, 0, 0, 11,
    fabric(shade(c, 1.12)))
  add(root, 'rug-line', w - 240, 3, d - 240, 0, 0, 13,
    fabric(shade(c, 0.86)))
  for (const [i, sx, sz] of [
    [0, 0, -1], [1, 0, 1], [2, -1, 0], [3, 1, 0],
  ] as const) {
    if (sx === 0) {
      add(root, `rug-border-${i}`, w, 12, 50, 0,
        sz * (d / 2 - 25), 6, fabric(a))
    } else {
      add(root, `rug-border-${i}`, 50, 12, d - 100,
        sx * (w / 2 - 25), 0, 6, fabric(a))
    }
  }
}

function buildBathtub({ ctx, root, w, d, h, a }: PropBuildArgs): void {
  const { add, cyl, ceramic, metal, glass } = ctx
  const shell = ceramic(a)
  const inner = ceramic('#f8fbfb')
  add(root, 'tub-bottom', w - 160, 80, d - 160, 0, 0, 40, inner)
  add(root, 'tub-front', w, h, 80, 0, -d / 2 + 40, h / 2, shell)
  add(root, 'tub-back', w, h, 80, 0, d / 2 - 40, h / 2, shell)
  add(root, 'tub-left', 80, h, d - 160, -w / 2 + 40, 0, h / 2,
    shell)
  add(root, 'tub-right', 80, h, d - 160, w / 2 - 40, 0, h / 2,
    shell)
  add(root, 'tub-rim-front', w + 16, 32, 100, 0, -d / 2 + 40,
    h + 16, inner)
  add(root, 'tub-rim-back', w + 16, 32, 100, 0, d / 2 - 40,
    h + 16, inner)
  add(root, 'tub-rim-left', 100, 32, d - 160, -w / 2 + 40, 0,
    h + 16, inner)
  add(root, 'tub-rim-right', 100, 32, d - 160, w / 2 - 40, 0,
    h + 16, inner)
  add(root, 'tub-water', w - 220, 18, d - 220, 0, 0, h * 0.7,
    glass('#d7ecf2'))
  cyl(root, 'tub-drain', 70, 8, w * 0.3, 0, 84, metal('#5f676c'))
  cyl(root, 'tub-faucet', 34, 240, -w * 0.34, d / 2 - 90, h + 120,
    metal())
  add(root, 'tub-spout', 34, 34, 160, -w * 0.34, d / 2 - 170,
    h + 210, metal())
}

function buildToilet({ ctx, root, w, d, h, a }: PropBuildArgs): void {
  const { add, cyl, ball, ring, ceramic, metal } = ctx
  const china = ceramic(a)
  cyl(root, 'toilet-pedestal', w * 0.52, h * 0.34, 0, -d * 0.02,
    h * 0.17, china, w * 0.68)
  ball(root, 'toilet-bowl', w * 0.8, h * 0.28, d * 0.52, 0,
    -d * 0.1, h * 0.44, china)
  const seat = ring(root, 'toilet-seat', w * 0.78, 26, 0, -d * 0.1,
    h * 0.59, ceramic('#f8f8f5'))
  seat.scaling.z = Math.max(1, (d * 0.56) / (w * 0.78))
  ball(root, 'toilet-lid', w * 0.72, 22, d * 0.5, 0, -d * 0.1,
    h * 0.61, ceramic('#f5f5f2'))
  add(root, 'toilet-tank', w * 0.74, h * 0.44, 190, 0, d / 2 - 95,
    h * 0.68, china)
  add(root, 'toilet-tank-lid', w * 0.8, 26, 200, 0, d / 2 - 95,
    h * 0.91, china)
  cyl(root, 'toilet-button', 46, 10, 0, d / 2 - 95, h * 0.93,
    metal())
}

function buildVanity({ ctx, root, w, d, h, c, a }: PropBuildArgs): void {
  const { add, cyl, wood, ceramic, metal, shade } = ctx
  const legH = 60
  const bodyH = h - 120
  add(root, 'vanity-plinth', w - 20, legH, d - 20, 0, 0, legH / 2,
    wood(shade(c, 0.62)))
  add(root, 'vanity-body', w, bodyH, d, 0, 0, legH + bodyH / 2,
    wood(c))
  add(root, 'vanity-top', w + 30, 60, d + 20, 0, 0, h - 30,
    ceramic(a))
  for (const [i, sx] of [[0, -1], [1, 1]] as const) {
    add(root, `vanity-door-${i}`, w / 2 - 12, bodyH - 40, 18,
      sx * w / 4, -d / 2 - 9, legH + bodyH / 2,
      wood(shade(c, 1.06)))
    add(root, `vanity-handle-${i}`, 18, bodyH * 0.2, 24, sx * 42,
      -d / 2 - 26, legH + bodyH * 0.72, metal())
  }
  cyl(root, 'vanity-basin', Math.min(w * 0.4, d * 0.5), 120, 0, 0,
    h + 60, ceramic('#fbfcfc'))
  cyl(root, 'vanity-basin-in', Math.min(w * 0.33, d * 0.42), 18, 0,
    0, h + 115, ceramic('#e8eff0'))
  cyl(root, 'vanity-faucet', 30, 230, 0, d * 0.22, h + 115, metal())
  add(root, 'vanity-spout', 30, 30, 150, 0, d * 0.22 - 75, h + 215,
    metal())
}

function buildShower({ ctx, root, w, d, h, a }: PropBuildArgs): void {
  const { add, cyl, ceramic, metal, glass } = ctx
  add(root, 'shower-tray', w, 70, d, 0, 0, 35, ceramic(a))
  add(root, 'shower-floor', w - 90, 16, d - 90, 0, 0, 72,
    ceramic('#eef4f5'))
  cyl(root, 'shower-drain', 70, 6, w * 0.3, -d * 0.3, 80,
    metal('#5f686d'))
  add(root, 'shower-glass-front', w - 70, h * 0.76, 18, 0,
    -d / 2 + 9, h * 0.44, glass())
  add(root, 'shower-glass-side', 18, h * 0.76, d - 70, -w / 2 + 9,
    0, h * 0.44, glass())
  add(root, 'shower-post-l', 30, h * 0.76, 30, -w / 2 + 15,
    -d / 2 + 15, h * 0.44, metal())
  add(root, 'shower-post-r', 30, h * 0.76, 30, w / 2 - 15,
    -d / 2 + 15, h * 0.44, metal())
  add(root, 'shower-rail', w - 40, 26, 26, 0, -d / 2 + 20,
    h * 0.82, metal())
  add(root, 'shower-rail-side', 26, 26, d - 40, -w / 2 + 20, 0,
    h * 0.82, metal())
  cyl(root, 'shower-column', 38, h * 0.62, w / 2 - 80, d / 2 - 80,
    h * 0.44, metal())
  cyl(root, 'shower-head', 180, 20, w / 2 - 80, d / 2 - 80,
    h * 0.78, metal('#70787d'))
  add(root, 'shower-handle', 20, 190, 24, w * 0.32, -d / 2 - 10,
    h * 0.4, metal())
}

function buildPlant({ ctx, root, w, d, h, c, a }: PropBuildArgs): void {
  const { cyl, ball, paint, ceramic, fabric, shade } = ctx
  cyl(root, 'plant-pot', w * 0.5, h * 0.22, 0, 0, h * 0.11,
    ceramic(a), w * 0.62)
  cyl(root, 'plant-rim', w * 0.66, h * 0.03, 0, 0, h * 0.225,
    ceramic(shade(a, 0.94)))
  cyl(root, 'plant-soil', w * 0.54, 14, 0, 0, h * 0.235,
    paint('#3a2c21'))
  cyl(root, 'plant-stem', 26, h * 0.32, 0, 0, h * 0.38,
    paint('#6b4e36'))
  const leaves = [
    [0, 0, 0.55, 0.62, 1.02, 0.0], [0.3, 0.08, 0.66, 0.5, 1.14, 0.5],
    [-0.28, 0.12, 0.68, 0.52, 0.92, -0.55],
    [0.16, -0.28, 0.72, 0.46, 1.2, 0.9],
    [-0.2, -0.2, 0.78, 0.45, 0.86, -0.9],
    [0.03, 0.02, 0.86, 0.42, 1.08, 0.25],
    [-0.1, 0.26, 0.9, 0.36, 0.96, -0.3],
  ] as const
  leaves.forEach(([fx, fy, fz, size, k, rz], i) => {
    const leaf = ball(root, `plant-leaf-${i}`, w * size, h * 0.12,
      w * size, fx * w, fy * d, fz * h, fabric(shade(c, k)))
    leaf.rotation.z = rz
    leaf.rotation.x = i % 2 ? 0.25 : -0.25
  })
}

function buildHood({ ctx, root, w, d, h, c }: PropBuildArgs): void {
  const { add, cyl, metal, paint, shade } = ctx
  add(root, 'hood-body', w, h * 0.22, d, 0, 0, h * 0.86,
    metal(shade(c, 1.03)))
  add(root, 'hood-canopy', w * 0.96, h * 0.18, d * 0.82, 0, -d * 0.04,
    h * 0.7, metal('#8f989e'))
  add(root, 'hood-chimney', w * 0.32, h * 0.62, d * 0.22, 0, d * 0.12,
    h * 0.31, metal('#9aa3a9'))
  add(root, 'hood-filter', w * 0.7, 18, d * 0.5, 0, -d * 0.06,
    h * 0.78, paint('#3c4247'))
  for (const [i, sx] of [[0, -1], [1, 1]] as const) {
    cyl(root, `hood-light-${i}`, 46, 10, sx * w * 0.28,
      -d * 0.12, h * 0.83, { color: '#ffe8b8', glow: 0.9 })
  }
}

function buildLamp({ ctx, root, w, h, a }: PropBuildArgs): void {
  const { cyl, metal } = ctx
  cyl(root, 'lamp-base', w * 0.56, 32, 0, 0, 16, metal('#3a3d40'))
  cyl(root, 'lamp-pole', 26, h * 0.78, 0, 0, h * 0.43,
    metal('#6f767b'))
  cyl(root, 'lamp-shade', w * 0.78, h * 0.17, 0, 0, h * 0.87,
    { color: a, spec: 0.05, glow: 0.35 }, w * 0.5)
  cyl(root, 'lamp-glow', w * 0.58, 8, 0, 0, h * 0.79,
    { color: '#ffe6b0', spec: 0.1, glow: 0.95 })
}

function buildFridge({ ctx, root, w, d, h, c }: PropBuildArgs): void {
  const { add, metal, paint, shade } = ctx
  add(root, 'fridge-plinth', w - 30, 50, d - 30, 0, 0, 25,
    metal('#24272a'))
  add(root, 'fridge-body', w, h - 50, d, 0, 0, 50 + (h - 50) / 2,
    metal(c))
  add(root, 'fridge-door-top', w - 16, (h - 50) * 0.3, 20, 0,
    -d / 2 - 10, h - 50 - (h - 50) * 0.16, metal(shade(c, 1.04)))
  add(root, 'fridge-door-bottom', w - 16, (h - 50) * 0.66, 20, 0,
    -d / 2 - 10, 50 + (h - 50) * 0.36, metal(shade(c, 1.02)))
  add(root, 'fridge-gap', w - 20, 10, 22, 0, -d / 2 - 11,
    h - 50 - (h - 50) * 0.32, paint('#1d2023'))
  for (const [i, z] of [
    [0, h - 50 - (h - 50) * 0.18], [1, 50 + (h - 50) * 0.62],
  ] as const) {
    add(root, `fridge-handle-${i}`, 28, (h - 50) * 0.16, 34,
      w / 2 - 80, -d / 2 - 32, z, metal('#c3c9cd'))
  }
}

function buildStove({ ctx, root, w, d, h, c }: PropBuildArgs): void {
  const { add, cyl, ball, ring, metal, paint, screen } = ctx
  add(root, 'stove-plinth', w - 20, 40, d - 20, 0, 0, 20,
    metal('#151719'))
  add(root, 'stove-body', w, h - 40, d, 0, 0, 40 + (h - 40) / 2,
    metal(c))
  add(root, 'stove-top', w, 26, d, 0, 0, h + 13, screen('#101214'))
  for (let i = 0; i < 4; i++) {
    const bx = (i % 2 ? 1 : -1) * w * 0.24
    const by = (i < 2 ? -1 : 1) * d * 0.24
    ring(root, `burner-${i}`, 128, 10, bx, by, h + 30,
      metal('#2c3033'))
    cyl(root, `burner-in-${i}`, 64, 6, bx, by, h + 27,
      paint('#191c1f'))
  }
  add(root, 'stove-door', w - 50, (h - 40) * 0.42, 18, 0,
    -d / 2 - 9, 40 + (h - 40) * 0.25, metal('#24282c'))
  add(root, 'stove-glass', w - 120, (h - 40) * 0.28, 6, 0,
    -d / 2 - 19, 40 + (h - 40) * 0.25, screen('#101214'))
  add(root, 'stove-handle', w - 100, 22, 22, 0, -d / 2 - 35,
    40 + (h - 40) * 0.45, metal('#c3c9cd'))
  for (let i = 0; i < 4; i++) {
    ball(root, `stove-knob-${i}`, 38, 38, 18, (i - 1.5) * w * 0.2,
      -d / 2 - 20, h * 0.72, metal('#c3c9cd'))
  }
}

function buildSink({ ctx, root, w, d, h, c, a }: PropBuildArgs): void {
  const { add, cyl, wood, ceramic, metal, paint } = ctx
  add(root, 'sink-body', w, h * 0.82, d, 0, 0, h * 0.41, wood(c))
  add(root, 'sink-top', w + 20, 44, d + 16, 0, 0, h * 0.82 + 22,
    ceramic(a))
  cyl(root, 'sink-basin', Math.min(w * 0.6, d * 0.62), 36, 0, 0,
    h * 0.86, metal('#c9d0d3'))
  cyl(root, 'sink-basin-in', Math.min(w * 0.52, d * 0.54), 12, 0,
    0, h * 0.88, paint('#8f999e'))
  cyl(root, 'sink-faucet', 30, 260, 0, d * 0.2, h * 0.9, metal())
  add(root, 'sink-spout', 30, 30, 140, 0, d * 0.2 - 70,
    h * 0.9 + 110, metal())
}

export const PROP_BUILDERS: Record<DecorType, PropBuilder> = {
  bed: buildBed,
  sofa: buildSofa,
  armchair: buildArmchair,
  chair: buildChair,
  'coffee-table': buildCoffeeTable,
  dresser: buildDresser,
  tv: buildTv,
  rug: buildRug,
  bathtub: buildBathtub,
  toilet: buildToilet,
  vanity: buildVanity,
  shower: buildShower,
  plant: buildPlant,
  hood: buildHood,
  lamp: buildLamp,
  fridge: buildFridge,
  stove: buildStove,
  sink: buildSink,
}
