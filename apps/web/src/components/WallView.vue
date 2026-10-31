<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { outlinePoints, pointInPoly, roomWalls, type WallSeg } from '../render25d/room'
import {
  notify, pushHistory, select, selectOpening, selectWall, state, ui,
  moveWallItem,
  updateWallItem,
} from '../state/project'
import type { Prop } from '../render25d/types'

interface WallFace {
  key: string
  wall: WallSeg
  side: 1 | -1
  label: string
  /** точка на плоскости стены, от которой считается s */
  origin: { x: number; y: number }
  nx: number
  ny: number
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const active = ref(0)
let ctx: CanvasRenderingContext2D | null = null
let w = 0
let h = 0
let dpr = 1
let ro: ResizeObserver | null = null
let raf = 0
let hits: {
  kind: 'instance' | 'opening' | 'wallitem'
  id: string
  x0: number
  x1: number
  z0: number
  z1: number
}[] = []

const walls = computed(() => buildFaces())
const wall = computed<WallFace | null>(() => walls.value[active.value] ?? null)
const scale = ref(1)
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
let lastView = { sc: 1, ox: 0, oy: 0, baseSc: 1, baseOx: 0, baseOy: 0 }
let panPointer: { id: number; x: number; y: number; moved: boolean } | null = null
// Перетаскивание розетки/полки/зеркала по развёртке.
let itemDrag: {
  id: string; pointerId: number
  w: number; h: number; offS: number; offZ: number
} | null = null
// пинч двумя пальцами (телефон)
const pointers = new Map<number, { x: number; y: number }>()
let pinch: {
  dist: number
  zoom: number
  s: number
  z: number
  baseSc: number
  baseOx: number
  baseOy: number
} | null = null
let pinched = false

function canvasMid(): { mx: number; my: number; dist: number } | null {
  if (pointers.size < 2) return null
  const c = canvasEl.value
  if (!c) return null
  const r = c.getBoundingClientRect()
  const [a, b] = [...pointers.values()]
  return {
    mx: (a.x + b.x) / 2 - r.left,
    my: (a.y + b.y) / 2 - r.top,
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
  }
}
const pad = { left: 42, right: 26, top: 54, bottom: 48 }

function buildFaces(): WallFace[] {
  const room = state.project.room
  const outline = outlinePoints(room)
  const out: WallFace[] = []
  for (const w of roomWalls(room)) {
    const sides: (1 | -1)[] = w.outer ? [1] : [1, -1]
    for (const side of sides) {
      const nx = w.nx * side
      const ny = w.ny * side
      const ox = side === 1 ? w.a.x : w.a.x - w.nx * w.t
      const oy = side === 1 ? w.a.y : w.a.y - w.ny * w.t
      // с этой стороны должна быть комната
      if (!w.outer && !pointInPoly(ox + nx * 50, oy + ny * 50, outline)) continue
      out.push({
        key: `${w.index}:${side}`,
        wall: w, side, origin: { x: ox, y: oy }, nx, ny,
        label: w.outer
          ? `Стена ${w.index + 1}`
          : `Перегородка ${w.index + 1} ${side === 1 ? 'A' : 'B'}`,
      })
    }
  }
  return out
}

function vy(face: WallFace, p: { x: number; y: number }): number {
  const s = (p.x - face.wall.a.x) * face.wall.dx +
    (p.y - face.wall.a.y) * face.wall.dy
  return face.side === 1 ? s : face.wall.len - s
}

function vrect(face: WallFace, corners: { x: number; y: number }[]) {
  const ss = corners.map((p) => vy(face, p))
  const x0 = Math.min(...ss)
  const x1 = Math.max(...ss)
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1) }
}

function plane(face: WallFace, p: { x: number; y: number }): number {
  return (p.x - face.origin.x) * face.nx + (p.y - face.origin.y) * face.ny
}

function totalZ(inst: (typeof state.project.instances)[number]): [number, number] {
  const p = inst.params
  const floor = (p.mount || 'floor') !== 'wall'
  const z = Number(inst.z) || 0
  const H = Number(p.H) || 720
  if (!floor) return [z, z + H]
  const plinth = Math.max(0, Number(p.plinthH) || 0)
  const top = Math.max(0, Number(p.worktopT) || 0)
  return [z, z + plinth + H + top]
}

function instFaces(inst: (typeof state.project.instances)[number]) {
  const p = inst.params
  const W = Number(p.W) || 0
  const D = Number(p.D) || 0
  const a = ((Number(inst.rot) || 0) * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  const pts = [
    [0, 0], [W, 0], [W, D], [0, D],
  ].map(([lx, ly]) => ({
    x: Number(inst.x) + lx * cs - ly * sn,
    y: Number(inst.y) + lx * sn + ly * cs,
  }))
  return { pts, W, D }
}

function propCorners(pr: Prop) {
  const a = ((Number(pr.rot) || 0) * Math.PI) / 180
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  const pts = [
    [-pr.w / 2, -pr.d / 2], [pr.w / 2, -pr.d / 2],
    [pr.w / 2, pr.d / 2], [-pr.w / 2, pr.d / 2],
  ].map(([lx, ly]) => ({
    x: Number(pr.x) + lx * cs - ly * sn,
    y: Number(pr.y) + lx * sn + ly * cs,
  }))
  return pts
}

function nearWall(face: WallFace, pts: { x: number; y: number }[], max = 720): boolean {
  const vals = pts.map((p) => plane(face, p))
  return Math.min(...vals) >= -2 && Math.max(...vals) <= max
}

function draw() {
  const c = canvasEl.value
  const face = wall.value
  if (!c || !face) return
  ctx = c.getContext('2d')
  if (!ctx) return
  const room = state.project.room
  const roomH = Number(room.h) || 2700
  const len = face.wall.len
  const scaleX = (w - pad.left - pad.right) / Math.max(1, len)
  const scaleY = (h - pad.top - pad.bottom) / Math.max(1, roomH)
  let baseSc = Math.min(scaleX, scaleY)
  // Длинная стена на телефоне: по ширине она становится нечитаемо мелкой.
  // Поднимаем масштаб до ~45% высоты и даём панорамировать.
  if (w < 700 && len / Math.max(1, roomH) > 2.5) {
    baseSc = Math.min(scaleY, Math.max(baseSc, (h * 0.62) / roomH))
  }
  const sc = baseSc * zoom.value
  scale.value = sc
  const baseOx = pad.left + (w - pad.left - pad.right - len * baseSc) / 2
  const availH = h - pad.top - pad.bottom
  const baseOy = pad.top + (availH + roomH * baseSc) / 2
  const ox = baseOx + pan.value.x
  const oy = baseOy + pan.value.y
  lastView = { sc, ox, oy, baseSc, baseOx, baseOy }
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__wallView = {
      w, h, zoom: zoom.value, pan: { ...pan.value }, ...lastView,
    }
  }
  const X = (s: number) => ox + s * sc
  const Y = (z: number) => oy - z * sc
  const rect = (x0: number, x1: number, z0: number, z1: number) => {
    const a = X(Math.min(x0, x1))
    const b = X(Math.max(x0, x1))
    const c0 = Y(Math.max(z0, z1))
    const d = Y(Math.min(z0, z1))
    ctx!.beginPath()
    ctx!.rect(a, c0, Math.max(1, b - a), Math.max(1, d - c0))
  }

  hits = []
  ctx.clearRect(0, 0, w, h)
  // фон
  const bg = ctx.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, '#161a1e')
  bg.addColorStop(1, '#0f1215')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // стена
  ctx.fillStyle = '#d8d5ce'
  rect(0, len, 0, roomH)
  ctx.fill()
  ctx.strokeStyle = '#9a978f'
  ctx.lineWidth = 1.2
  ctx.stroke()

  // сетка 500 мм
  ctx.save()
  ctx.strokeStyle = 'rgba(40,44,48,0.10)'
  ctx.lineWidth = 0.7
  for (let s = 0; s <= len; s += 500) {
    ctx.beginPath(); ctx.moveTo(X(s), Y(0)); ctx.lineTo(X(s), Y(roomH)); ctx.stroke()
  }
  for (let z = 0; z <= roomH; z += 500) {
    ctx.beginPath(); ctx.moveTo(X(0), Y(z)); ctx.lineTo(X(len), Y(z)); ctx.stroke()
  }
  ctx.restore()

  // проёмы
  for (const o of room.openings ?? []) {
    if (Number(o.wall) !== face.wall.index) continue
    const s0 = Number(o.x) || 0
    const s1 = s0 + (Number(o.w) || 0)
    const z0 = Number(o.z0) || 0
    const z1 = Number(o.z1) || 0
    const v0 = vy(face, {
      x: face.wall.a.x + face.wall.dx * s0,
      y: face.wall.a.y + face.wall.dy * s0,
    })
    const v1 = vy(face, {
      x: face.wall.a.x + face.wall.dx * s1,
      y: face.wall.a.y + face.wall.dy * s1,
    })
    const kind = o.kind || 'door'
    ctx.fillStyle = kind === 'window' ? 'rgba(142,198,220,0.55)' : '#2c333a'
    rect(v0, v1, z0, z1)
    ctx.fill()
    ctx.strokeStyle = kind === 'window' ? '#8ec6dc' : '#7f8993'
    ctx.lineWidth = 2
    ctx.stroke()
    if (kind === 'window') {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(X(v0), Y((z0 + z1) / 2))
      ctx.lineTo(X(v1), Y((z0 + z1) / 2))
      ctx.stroke()
    } else {
      // полотно двери
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.beginPath()
      ctx.moveTo(X(v0 + 35), Y(z0 + 60))
      ctx.lineTo(X(v0 + 35), Y(z1 - 35))
      ctx.stroke()
    }
    ctx.fillStyle = '#1c2126'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${o.id || ''} · ${Math.round(s1 - s0)}×${Math.round(z1 - z0)}`,
      X((v0 + v1) / 2), Y(z1) - 5)
    hits.push({ kind: 'opening', id: String(o.id || ''), x0: Math.min(v0, v1), x1: Math.max(v0, v1), z0, z1 })
  }

  // настенные предметы
  for (const it of room.wallItems ?? []) {
    if (Number(it.wall) !== face.wall.index) continue
    const s0 = Number(it.x) || 0
    const s1 = s0 + (Number(it.w) || 0)
    const z0 = Number(it.z) || 0
    const z1 = z0 + (Number(it.h) || 0)
    const v0 = vy(face, { x: face.wall.a.x + face.wall.dx * s0, y: face.wall.a.y + face.wall.dy * s0 })
    const v1 = vy(face, { x: face.wall.a.x + face.wall.dx * s1, y: face.wall.a.y + face.wall.dy * s1 })
    ctx.fillStyle = it.kind === 'socket' ? '#3a4046' : '#b9c2c8'
    rect(v0, v1, z0, z1)
    ctx.fill()
    ctx.strokeStyle = '#2d3338'
    ctx.lineWidth = 1
    ctx.stroke()
    hits.push({ kind: 'wallitem', id: String(it.id || ''), x0: Math.min(v0, v1), x1: Math.max(v0, v1), z0, z1 })
  }

  // модули, прижатые к этой грани
  const mods: { inst: (typeof state.project.instances)[number]; v0: number; v1: number; z0: number; z1: number; depth: number }[] = []
  for (const inst of state.project.instances) {
    const { pts } = instFaces(inst)
    if (!nearWall(face, pts)) continue
    const r = vrect(face, pts)
    const [z0, z1] = totalZ(inst)
    mods.push({ inst, v0: r.x0, v1: r.x1, z0, z1, depth: Number(inst.params.D) || 0 })
  }
  mods.sort((a, b) => a.depth - b.depth)
  for (const m of mods) {
    const p = m.inst.params
    const floor = (p.mount || 'floor') !== 'wall'
    const plinth = floor ? Math.max(0, Number(p.plinthH) || 0) : 0
    const top = floor ? Math.max(0, Number(p.worktopT) || 0) : 0
    const body0 = m.z0 + plinth
    const body1 = m.z1 - top
    const facade = state.project.materials.facade?.color || '#3b434b'
    const corpus = state.project.materials.corpus?.color || '#d0b48c'
    ctx.fillStyle = facade
    rect(m.v0, m.v1, body0, body1)
    ctx.fill()
    ctx.strokeStyle = 'rgba(15,18,21,0.75)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    if (plinth > 0) {
      ctx.fillStyle = '#1c1f22'
      rect(m.v0, m.v1, m.z0, body0)
      ctx.fill()
    }
    if (top > 0) {
      ctx.fillStyle = state.project.materials.worktop?.color || '#24282c'
      rect(m.v0, m.v1, body1, m.z1)
      ctx.fill()
    }
    // двери/ящики схематично
    const doors = Math.max(0, Number(p.doors) || 0)
    const drawers = Math.max(0, Number(p.drawers) || 0)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1
    if (doors > 0) {
      for (let i = 1; i < doors; i++) {
        const s = m.v0 + (m.v1 - m.v0) * (i / doors)
        ctx.beginPath(); ctx.moveTo(X(s), Y(body0)); ctx.lineTo(X(s), Y(body1)); ctx.stroke()
      }
    }
    if (drawers > 0) {
      for (let i = 1; i < drawers; i++) {
        const z = body0 + (body1 - body0) * (i / drawers)
        ctx.beginPath(); ctx.moveTo(X(m.v0), Y(z)); ctx.lineTo(X(m.v1), Y(z)); ctx.stroke()
      }
    }
    ctx.restore()
    ctx.fillStyle = '#11161a'
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(m.inst.name || m.inst.id, X((m.v0 + m.v1) / 2), Y(m.z1) - 6)
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(20,25,30,0.7)'
    ctx.fillText(`${Math.round(m.v1 - m.v0)}×${Math.round(m.z1 - m.z0)}`, X((m.v0 + m.v1) / 2), Y(m.z0) + 12)
    hits.push({ kind: 'instance', id: m.inst.id, x0: m.v0, x1: m.v1, z0: m.z0, z1: m.z1 })
  }

  // декор у стены
  for (const pr of state.project.props ?? []) {
    const pts = propCorners(pr)
    if (!nearWall(face, pts, 900)) continue
    const r = vrect(face, pts)
    const z0 = Number(pr.z) || 0
    const z1 = z0 + (Number(pr.h) || 0)
    ctx.save()
    ctx.globalAlpha = 0.72
    ctx.fillStyle = pr.color || '#8b8f95'
    rect(r.x0, r.x1, z0, z1)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(20,25,30,0.6)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = 'rgba(20,25,30,0.75)'
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(pr.name, X((r.x0 + r.x1) / 2), Y(z0) - 4)
    ctx.restore()
  }

  // размеры стены
  ctx.strokeStyle = '#e0a33e'
  ctx.fillStyle = '#e0a33e'
  ctx.lineWidth = 1.5
  const dimY = Y(roomH) - 18
  ctx.beginPath(); ctx.moveTo(X(0), dimY); ctx.lineTo(X(len), dimY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(X(0), dimY - 5); ctx.lineTo(X(0), dimY + 5); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(X(len), dimY - 5); ctx.lineTo(X(len), dimY + 5); ctx.stroke()
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${Math.round(len)} мм`, X(len / 2), dimY - 7)
  ctx.save()
  ctx.translate(X(0) - 12, Y(roomH / 2))
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(`${Math.round(roomH)} мм`, 0, 0)
  ctx.restore()

  // пол и потолок — жирные линии
  ctx.strokeStyle = 'rgba(24,28,32,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(len), Y(0)); ctx.stroke()
  ctx.strokeStyle = 'rgba(24,28,32,0.28)'
  ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.moveTo(X(0), Y(roomH)); ctx.lineTo(X(len), Y(roomH)); ctx.stroke()

  /** Размерная линия с засечками и подписью на подложке. */
  const dim = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    label: string,
    vertical = false,
  ): void => {
    ctx.save()
    ctx.strokeStyle = '#ffb347'
    ctx.fillStyle = '#ffb347'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    if (vertical) {
      ctx.beginPath(); ctx.moveTo(a.x - 5, a.y); ctx.lineTo(a.x + 5, a.y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(b.x - 5, b.y); ctx.lineTo(b.x + 5, b.y); ctx.stroke()
    } else {
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 5); ctx.lineTo(a.x, a.y + 5); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(b.x, b.y - 5); ctx.lineTo(b.x, b.y + 5); ctx.stroke()
    }
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    const tw = ctx.measureText(label).width
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    if (vertical) {
      ctx.save()
      ctx.translate(cx - 12, cy)
      ctx.rotate(-Math.PI / 2)
      ctx.fillStyle = 'rgba(12,15,18,0.82)'
      ctx.fillRect(-tw / 2 - 4, -8, tw + 8, 15)
      ctx.fillStyle = '#ffe2ad'
      ctx.fillText(label, 0, 4)
      ctx.restore()
    } else {
      ctx.fillStyle = 'rgba(12,15,18,0.82)'
      ctx.fillRect(cx - tw / 2 - 4, cy - 8, tw + 8, 15)
      ctx.fillStyle = '#ffe2ad'
      ctx.fillText(label, cx, cy + 4)
    }
    ctx.restore()
  }

  // размеры выбранного модуля (по фактическому габариту)
  const selHit = hits.find(
    (h) => h.kind === 'instance' && h.id === state.selection,
  )
  if (selHit) {
    const wmm = Math.round(selHit.x1 - selHit.x0)
    const hmm = Math.round(selHit.z1 - selHit.z0)
    const yDim = Y(selHit.z0) + 16
    dim(
      { x: X(selHit.x0), y: yDim },
      { x: X(selHit.x1), y: yDim },
      `${wmm} мм`,
    )
    ctx.strokeStyle = 'rgba(255,179,71,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(X(selHit.x0), Y(selHit.z0))
    ctx.lineTo(X(selHit.x0), yDim)
    ctx.moveTo(X(selHit.x1), Y(selHit.z0))
    ctx.lineTo(X(selHit.x1), yDim)
    ctx.stroke()
    dim(
      { x: X(selHit.x1) + 16, y: Y(selHit.z0) },
      { x: X(selHit.x1) + 16, y: Y(selHit.z1) },
      `${hmm} мм`,
      true,
    )
  }

  // выбранный модуль
  const sel = state.selection
  const hitSel = hits.find((x) => x.kind === 'instance' && x.id === sel)
  if (hitSel) {
    ctx.strokeStyle = '#e0a33e'
    ctx.lineWidth = 2.5
    rect(hitSel.x0, hitSel.x1, hitSel.z0, hitSel.z1)
    ctx.stroke()
  }
}

function resize() {
  const c = canvasEl.value
  if (!c) return
  // Размер берём у самого canvas: контейнер может менять высоту (мобильная
  // шапка/панель), а inline-размер рассинхронизируется с backing store.
  const r = c.getBoundingClientRect()
  if (!r.width || !r.height) return
  dpr = Math.min(2, window.devicePixelRatio || 1)
  w = Math.max(1, Math.round(r.width))
  h = Math.max(1, Math.round(r.height))
  const bw = Math.round(w * dpr)
  const bh = Math.round(h * dpr)
  if (c.width !== bw) c.width = bw
  if (c.height !== bh) c.height = bh
  const g = c.getContext('2d')
  if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0)
  draw()
}

function schedule() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    draw()
  })
}

function pick(e: PointerEvent) {
  const c = canvasEl.value
  const face = wall.value
  if (!c || !face) return
  const r = c.getBoundingClientRect()
  const px = e.clientX - r.left
  const py = e.clientY - r.top
  const { sc, ox, oy } = lastView
  const s = (px - ox) / sc
  const z = (oy - py) / sc
  const hit = hits.find((x) => s >= x.x0 && s <= x.x1 && z >= x.z0 && z <= x.z1)
  if (!hit) return
  if (hit.kind === 'instance') select(hit.id)
  else if (hit.kind === 'opening') selectOpening(hit.id)
  else if (hit.kind === 'wallitem') selectWall(face.wall.index)
  schedule()
}

function zoomAt(factor: number, cx: number, cy: number): void {
  const c = canvasEl.value
  if (!c) return
  const r = c.getBoundingClientRect()
  const mx = cx - r.left
  const my = cy - r.top
  const old = lastView
  const nextZoom = Math.min(5, Math.max(0.45, zoom.value * factor))
  if (Math.abs(nextZoom - zoom.value) < 1e-4) return
  const ns = old.baseSc * nextZoom
  const s = (mx - old.ox) / old.sc
  const z = (old.oy - my) / old.sc
  zoom.value = nextZoom
  pan.value = {
    x: mx - s * ns - old.baseOx,
    y: my + z * ns - old.baseOy,
  }
  schedule()
}

function zoomBy(factor: number): void {
  const c = canvasEl.value
  if (!c) return
  const r = c.getBoundingClientRect()
  zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2)
}

function resetView(): void {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  schedule()
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}

/** Печать/PDF: та же развёртка в 2× без выделения, лист A3 альбомный. */
function printWall(): void {
  const face = wall.value
  const c = canvasEl.value
  if (!face || !c || !w || !h) return
  const out = document.createElement('canvas')
  const ratio = 2
  out.width = Math.round(w * ratio)
  out.height = Math.round(h * ratio)
  const g = out.getContext('2d')
  if (!g) return
  // draw() рисует в общие ctx/w/h: подменяем их на время снимка,
  // чтобы не плодить второй рендерер и не расходиться с экраном.
  const saved = {
    ctx, w, h,
    zoom: zoom.value,
    pan: { ...pan.value },
    selection: state.selection,
  }
  ctx = g
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  state.selection = null
  draw()
  const image = out.toDataURL('image/png')
  ctx = saved.ctx
  w = saved.w
  h = saved.h
  zoom.value = saved.zoom
  pan.value = saved.pan
  state.selection = saved.selection
  schedule()

  const title = `Стены · ${face.label}`
  const roomH = Math.round(Number(state.project.room.h) || 2700)
  const win = window.open('', '_blank', 'width=1200,height=800')
  if (!win) {
    notify('Разрешите всплывающие окна для печати', null, 'error')
    return
  }
  win.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A3 landscape; margin: 12mm; }
  body { margin: 0; font: 14px/1.4 system-ui, -apple-system, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 10px; color: #555; font-size: 12px; }
  img { width: 100%; height: auto; display: block; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>Длина ${Math.round(face.wall.len)} мм · высота ${roomH} мм · ${new Date().toLocaleDateString('ru-RU')}</p>
<img src="${image}" alt="Развёртка стены" onload="window.print()">
</body></html>`)
  win.document.close()
}


/** Векторная развёртка стены: SVG для CAD/иллюстратора, без растра. */
function buildWallSvg(face: WallFace, roomH: number, len: number): string {
  const room = state.project.room
  const pad = 90
  const W = Math.ceil(len + pad * 2)
  const H = Math.ceil(roomH + pad * 2)
  const X = (v: number) => pad + v
  const Y = (z: number) => pad + roomH - z
  const out: string[] = []
  const rect = (
    x0: number, x1: number, z0: number, z1: number,
    fill: string, stroke = '', sw = 1.2,
  ) => {
    const x = Math.min(X(x0), X(x1))
    const y = Math.min(Y(z0), Y(z1))
    out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}"` +
      ` width="${Math.abs(x1 - x0).toFixed(1)}"` +
      ` height="${Math.abs(z1 - z0).toFixed(1)}" fill="${fill}"` +
      (stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : '') + '/>')
  }
  const line = (x0: number, y0: number, x1: number, y1: number,
    stroke: string, sw = 1) => {
    out.push(`<line x1="${X(x0).toFixed(1)}" y1="${Y(y0).toFixed(1)}"` +
      ` x2="${X(x1).toFixed(1)}" y2="${Y(y1).toFixed(1)}"` +
      ` stroke="${stroke}" stroke-width="${sw}"/>`)
  }
  const text = (x: number, y: number, value: string, size = 10,
    color = '#1a1f24', anchor = 'middle', weight = 400) => {
    out.push(`<text x="${X(x).toFixed(1)}" y="${Y(y).toFixed(1)}"` +
      ` font-family="system-ui, -apple-system, sans-serif"` +
      ` font-size="${size}" font-weight="${weight}" fill="${color}"` +
      ` text-anchor="${anchor}">${escapeHtml(value)}</text>`)
  }

  const facade = state.project.materials.facade?.color || '#3b434b'
  const corpus = state.project.materials.corpus?.color || '#d0b48c'
  const worktop = state.project.materials.worktop?.color || '#24282c'

  // фон и стена
  out.push(`<rect width="${W}" height="${H}" fill="#f7f6f2"/>`)
  rect(0, len, 0, roomH, '#efece5', '#9a978f', 1.4)

  // сетка 500 мм
  for (let v = 0; v <= len; v += 500) {
    line(v, 0, v, roomH, 'rgba(40,44,48,0.10)', 0.8)
  }
  for (let z = 0; z <= roomH; z += 500) {
    line(0, z, len, z, 'rgba(40,44,48,0.10)', 0.8)
  }

  // проёмы
  for (const o of room.openings ?? []) {
    if (Number(o.wall) !== face.wall.index) continue
    const s0 = Number(o.x) || 0
    const s1 = s0 + (Number(o.w) || 0)
    const z0 = Number(o.z0) || 0
    const z1 = Number(o.z1) || 0
    const v0 = vy(face, {
      x: face.wall.a.x + face.wall.dx * s0,
      y: face.wall.a.y + face.wall.dy * s0,
    })
    const v1 = vy(face, {
      x: face.wall.a.x + face.wall.dx * s1,
      y: face.wall.a.y + face.wall.dy * s1,
    })
    const kind = o.kind || 'door'
    rect(v0, v1, z0, z1, kind === 'window' ? '#cfe6ef' : '#5a626a',
      kind === 'window' ? '#6fa9c0' : '#3a4148', 1.2)
    text((v0 + v1) / 2, z1 - 20,
      `${o.id || ''} · ${Math.round(s1 - s0)}×${Math.round(z1 - z0)}`, 9)
  }

  // настенные предметы
  for (const it of room.wallItems ?? []) {
    if (Number(it.wall) !== face.wall.index) continue
    const s0 = Number(it.x) || 0
    const s1 = s0 + (Number(it.w) || 0)
    const z0 = Number(it.z) || 0
    const z1 = z0 + (Number(it.h) || 0)
    const v0 = vy(face, {
      x: face.wall.a.x + face.wall.dx * s0,
      y: face.wall.a.y + face.wall.dy * s0,
    })
    const v1 = vy(face, {
      x: face.wall.a.x + face.wall.dx * s1,
      y: face.wall.a.y + face.wall.dy * s1,
    })
    rect(v0, v1, z0, z1, it.kind === 'socket' ? '#3a4046' : '#b9c2c8',
      '#2d3338', 0.8)
  }

  // модули у стены
  const mods: {
    inst: (typeof state.project.instances)[number]
    v0: number; v1: number; z0: number; z1: number; depth: number
  }[] = []
  for (const inst of state.project.instances) {
    const { pts } = instFaces(inst)
    if (!nearWall(face, pts)) continue
    const r = vrect(face, pts)
    const [z0, z1] = totalZ(inst)
    mods.push({
      inst, v0: r.x0, v1: r.x1, z0, z1,
      depth: Number(inst.params.D) || 0,
    })
  }
  mods.sort((a, b) => a.depth - b.depth)
  for (const m of mods) {
    const p = m.inst.params
    const floor = (p.mount || 'floor') !== 'wall'
    const plinth = floor ? Math.max(0, Number(p.plinthH) || 0) : 0
    const top = floor ? Math.max(0, Number(p.worktopT) || 0) : 0
    const body0 = m.z0 + plinth
    const body1 = m.z1 - top
    rect(m.v0, m.v1, body0, body1, facade, 'rgba(15,18,21,0.75)', 1.4)
    if (plinth > 0) rect(m.v0, m.v1, m.z0, body0, '#1c1f22')
    if (top > 0) rect(m.v0, m.v1, body1, m.z1, worktop)
    const doors = Math.max(0, Number(p.doors) || 0)
    const drawers = Math.max(0, Number(p.drawers) || 0)
    for (let i = 1; i < doors; i++) {
      const v = m.v0 + (m.v1 - m.v0) * (i / doors)
      line(v, body0, v, body1, 'rgba(255,255,255,0.35)', 0.9)
    }
    for (let i = 1; i < drawers; i++) {
      const z = body0 + (body1 - body0) * (i / drawers)
      line(m.v0, z, m.v1, z, 'rgba(255,255,255,0.35)', 0.9)
    }
    text((m.v0 + m.v1) / 2, m.z1 - 8, m.inst.name || m.inst.id, 10,
      '#11161a', 'middle', 600)
    text((m.v0 + m.v1) / 2, m.z0 + 18,
      `${Math.round(m.v1 - m.v0)}×${Math.round(m.z1 - m.z0)}`, 9,
      'rgba(20,25,30,0.7)')
  }

  // декор
  for (const pr of state.project.props ?? []) {
    const pts = propCorners(pr)
    if (!nearWall(face, pts, 900)) continue
    const r = vrect(face, pts)
    const z0 = Number(pr.z) || 0
    const z1 = z0 + (Number(pr.h) || 0)
    rect(r.x0, r.x1, z0, z1, pr.color || '#8b8f95', 'rgba(20,25,30,0.6)', 0.9)
    text((r.x0 + r.x1) / 2, z0 - 6, pr.name, 9, 'rgba(20,25,30,0.8)')
  }

  // размеры: длина стены и высота
  const dimY = -28
  line(0, dimY, len, dimY, '#c2861f', 1.4)
  line(0, dimY - 6, 0, dimY + 6, '#c2861f', 1.4)
  line(len, dimY - 6, len, dimY + 6, '#c2861f', 1.4)
  text(len / 2, dimY + 14, `${Math.round(len)} мм`, 11, '#8a5f14')

  out.push(`<text x="${pad - 26}" y="${(pad + roomH / 2).toFixed(1)}"` +
    ` font-family="system-ui" font-size="11" fill="#8a5f14"` +
    ` text-anchor="middle" transform="rotate(-90 ${pad - 26} ${pad + roomH / 2})">` +
    `${Math.round(roomH)} мм</text>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"` +
    ` viewBox="0 0 ${W} ${H}">` +
    `<title>${escapeHtml(`Стена · ${face.label}`)}</title>` +
    out.join('') + '</svg>'
}

/** Скачать развёртку как SVG (мм, 1 единица = 1 мм). */
function exportSvg(): void {
  const face = wall.value
  if (!face) return
  const roomH = Number(state.project.room.h) || 2700
  const svg = buildWallSvg(face, roomH, face.wall.len)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `стена-${face.wall.index + 1}.svg`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  zoomAt(e.deltaY < 0 ? 1.14 : 0.88, e.clientX, e.clientY)
}

function down(e: PointerEvent): void {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  if (pointers.size === 2) {
    const mid = canvasMid()
    if (mid) {
      const { sc, ox, oy, baseSc, baseOx, baseOy } = lastView
      pinch = {
        dist: mid.dist,
        zoom: zoom.value,
        s: (mid.mx - ox) / sc,
        z: (oy - mid.my) / sc,
        baseSc, baseOx, baseOy,
      }
      pinched = true
    }
    panPointer = null
    return
  }
  // Тянем настенный предмет (розетка, выключатель, полка, зеркало).
  const c = canvasEl.value
  const face = wall.value
  if (c && face && pointers.size === 1) {
    const r = c.getBoundingClientRect()
    const { sc, ox, oy } = lastView
    const s0 = (e.clientX - r.left - ox) / sc
    const z0 = (oy - (e.clientY - r.top)) / sc
    const hit = hits.find((h) => h.kind === 'wallitem' &&
      s0 >= h.x0 && s0 <= h.x1 && z0 >= h.z0 && z0 <= h.z1)
    if (hit) {
      pushHistory('Перемещение на стене')
      itemDrag = {
        id: hit.id, pointerId: e.pointerId,
        w: hit.x1 - hit.x0, h: hit.z1 - hit.z0,
        offS: s0 - hit.x0, offZ: z0 - hit.z0,
      }
      panPointer = null
      return
    }
  }
  panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
}

function move(e: PointerEvent): void {
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  if (pointers.size >= 2 && pinch) {
    const mid = canvasMid()
    if (!mid) return
    const target = Math.min(5, Math.max(0.45,
      pinch.zoom * (mid.dist / pinch.dist)))
    if (Math.abs(target - zoom.value) < 0.0005) return
    zoom.value = target
    const ns = pinch.baseSc * target
    pan.value = {
      x: mid.mx - pinch.s * ns - pinch.baseOx,
      y: mid.my + pinch.z * ns - pinch.baseOy,
    }
    schedule()
    return
  }
  if (itemDrag && itemDrag.pointerId === e.pointerId) {
    const c = canvasEl.value
    const face = wall.value
    if (!c || !face) return
    const r = c.getBoundingClientRect()
    const { sc, ox, oy } = lastView
    const s0 = (e.clientX - r.left - ox) / sc
    const z0 = (oy - (e.clientY - r.top)) / sc
    const maxX = Math.max(0, face.wall.len - itemDrag.w)
    const maxZ = Math.max(0, Number(state.project.room.h) - itemDrag.h)
    const x = Math.round(Math.min(maxX,
      Math.max(0, s0 - itemDrag.offS)))
    const z = Math.round(Math.min(maxZ, Math.max(0, z0 - itemDrag.offZ)))
    moveWallItem(itemDrag.id, x, z)
    schedule()
    return
  }
  if (!panPointer || panPointer.id !== e.pointerId) return
  const dx = e.clientX - panPointer.x
  const dy = e.clientY - panPointer.y
  if (Math.abs(dx) + Math.abs(dy) > 3) panPointer.moved = true
  if (!panPointer.moved) return
  pan.value = { x: pan.value.x + dx, y: pan.value.y + dy }
  panPointer.x = e.clientX
  panPointer.y = e.clientY
  schedule()
}

function up(e: PointerEvent): void {
  pointers.delete(e.pointerId)
  if (itemDrag && itemDrag.pointerId === e.pointerId) {
    itemDrag = null
    schedule()
    return
  }
  if (pointers.size < 2) pinch = null
  if (pinched) {
    if (!pointers.size) pinched = false
    panPointer = null
    return
  }
  if (!panPointer || panPointer.id !== e.pointerId) return
  const moved = panPointer.moved
  panPointer = null
  if (!moved) pick(e)
}

function nextWall(d: number) {
  const n = walls.value.length
  if (!n) return
  active.value = (active.value + d + n) % n
  schedule()
}

watch(active, () => { zoom.value = 1; pan.value = { x: 0, y: 0 }; schedule() })
watch(walls, () => {
  if (active.value >= walls.value.length) active.value = 0
  schedule()
})
watch(() => state.rev, schedule)
watch(() => state.selection, schedule)
watch(() => state.project.room, schedule, { deep: true })
watch(() => state.project.instances, schedule, { deep: true })
watch(() => state.project.props, schedule, { deep: true })

onMounted(() => {
  resize()
  ro = new ResizeObserver(resize)
  if (canvasEl.value) ro.observe(canvasEl.value)
  nextTick(schedule)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
})
</script>

<template>
  <section class="view wallview">
    <header class="view__head">
      <div class="view__title-wrap">
        <span class="view__title">Стены · 2D</span>
        <span v-if="wall" class="view__mode-label">{{ wall.label }} · {{ Math.round(wall.wall.len) }} мм</span>
      </div>
      <div class="view__actions">
        <button v-if="!ui.master" class="tab" @click="nextWall(-1)" title="Предыдущая стена">←</button>
        <button v-if="!ui.master" class="tab" @click="nextWall(1)" title="Следующая стена">→</button>
        <button v-if="!ui.master" class="tab" @click="zoomBy(1.2)" title="Приблизить">＋</button>
        <button v-if="!ui.master" class="tab" @click="zoomBy(0.83)" title="Отдалить">−</button>
        <button class="tab" @click="resetView" title="Вписать стену">⌂</button>
        <button v-if="!ui.master" class="tab" @click="printWall" title="Печать или PDF (A3)">Печать</button>
        <button v-if="!ui.master" class="tab" @click="exportSvg" title="Скачать развёртку в SVG">SVG</button>
        <button class="tab" @click="ui.draftTab = 'plan'">План</button>
        <button class="tab" @click="ui.renderMode = '3d'">3D</button>
      </div>
    </header>
    <div class="wallview__tabs" role="tablist" aria-label="Стены">
      <button
        v-for="(f, i) in walls" :key="f.key"
        class="wallview__tab" :class="{ 'wallview__tab--on': i === active }"
        role="tab" :aria-selected="i === active"
        @click="active = i"
      >{{ f.label }}</button>
    </div>
    <div ref="rootEl" class="view__body wallview__body">
      <canvas
        ref="canvasEl"
        class="wallview__canvas"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @wheel.prevent="onWheel"
        @contextmenu.prevent
      ></canvas>
      <span class="view__hint wallview__hint">
        Колесо — зум · тянуть — панорама · тап — выбор · 2D без WebGL
      </span>
    </div>
  </section>
</template>
