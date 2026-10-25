import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Material } from '@babylonjs/core/Materials/material'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import '@babylonjs/core/Rendering/edgesRenderer'
import '@babylonjs/core/Culling/ray'
import type { Instance } from '../state/project'
import { derived, partAnimValues, state, ui } from '../state/project'
import type { SolveResponse } from '../api'
import type {
  MaterialVariable,
  Materials,
  Opening,
  Room,
  SceneObject,
} from '../render25d/types'
import { resolveObjectMaterial } from '../material/vars'
import { outlinePoints, roomWalls, triangulate, type WallSeg } from '../render25d/room'

const MM = 0.001

const ROLE_MAT: Record<string, string> = {
  corpus: 'corpus', facade: 'facade', door: 'facade',
  drawerfront: 'facade', drawerbox: 'drawer', worktop: 'worktop',
  plinth: 'plinth', back: 'back', leg: 'leg',
}

interface PartMeta {
  instanceId: string
  part: number
  kind: string
  name: string
  role: string
  base: { x: number; y: number; z: number; sx: number; sy: number; sz: number }
  hinge?: 'left' | 'right'
  drawerId?: number
  pivot?: TransformNode
}

interface WallMeta {
  mesh: Mesh
  normal: { x: number; y: number }
  center: Vector3
  baseY: number
  baseH: number
  kind: string
}

type Vec = Vector3

function v3(x: number, z: number, y: number): Vector3 {
  return new Vector3(x * MM, z * MM, y * MM)
}

function matColor(hex: string): Color3 {
  try {
    return Color3.FromHexString(hex)
  } catch {
    return new Color3(0.6, 0.6, 0.6)
  }
}

export class BabylonRenderer {
  engine: Engine
  scene: Scene
  canvas: HTMLCanvasElement
  orbit: ArcRotateCamera
  walk: UniversalCamera
  shadow: ShadowGenerator
  private roomRoot: TransformNode
  private furniture: TransformNode
  private materials = new Map<string, StandardMaterial>()
  private textures = new Map<string, Texture>()
  private parts = new Map<string, Mesh>()
  private partMeta = new Map<string, PartMeta>()
  private walls: WallMeta[] = []
  private roomSig = ''
  private instSig = new Map<string, string>()
  private matsSig = ''
  private roots = new Map<string, TransformNode>()
  private mode: 'orbit' | 'first' | 'fly' = 'orbit'
  private wallMode: 'cutaway' | 'low' = 'cutaway'
  private selected = ''
  private quality: 'realistic' | 'schematic' = 'realistic'
  private wallDecor: Mesh[] = []
  private ceilingMesh: Mesh | null = null
  private roomH = 0
  private selectionBox: Mesh
  private selectedIds = new Set<string>()
  private selectedWall: number | null = null
  private selectedItem: string | null = null
  private selectedOpening: string | null = null
  private openingMeshes = new Map<string, Mesh[]>()
  private wallItemMeshes = new Map<string, Mesh>()
  private disposed = false
  private keys = new Set<string>()
  private savedCamera: {
    alpha: number
    beta: number
    radius: number
    target: [number, number, number]
    offset: [number, number]
    projection: 'persp' | 'ortho'
    mode: 'orbit' | 'first' | 'fly'
  } | null = null
  private objectId: string | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    })
    this.scene = new Scene(this.engine)
    this.scene.clearColor = new Color4(0.055, 0.066, 0.08, 1)
    this.scene.ambientColor = new Color3(0.35, 0.37, 0.4)
    this.scene.skipPointerMovePicking = true

    this.orbit = new ArcRotateCamera(
      'orbit',
      (-34 * Math.PI) / 180,
      (90 - 25) * (Math.PI / 180),
      5.2,
      new Vector3(1.8, 1.0, 1.4),
      this.scene,
    )
    this.orbit.lowerRadiusLimit = 0.25
    this.orbit.upperRadiusLimit = 40
    this.orbit.wheelDeltaPercentage = 0.01
    this.orbit.zoomToMouseLocation = true
    this.orbit.useNaturalPinchZoom = true
    this.orbit.panningSensibility = 480
    this.orbit.angularSensibilityX = 1200
    this.orbit.angularSensibilityY = 1200
    this.orbit.inertia = 0.82
    this.orbit.attachControl(canvas, true)

    // Мультитач: два пальца — панорама + плавный пинч-зум
    const pointers = (this.orbit.inputs.attached as unknown as Record<
      string,
      {
        pinchDeltaPercentage?: number
        pinchPrecision?: number
        multiTouchPanning?: boolean
        multiTouchPanAndZoom?: boolean
      }
    >).pointers
    if (pointers) {
      pointers.pinchDeltaPercentage = 0.008
      pointers.pinchPrecision = 2
      pointers.multiTouchPanning = true
      pointers.multiTouchPanAndZoom = true
    }

    this.walk = new UniversalCamera('walk', new Vector3(0, 1.6, -2), this.scene)
    this.walk.speed = 3.2
    this.walk.angularSensibility = 900
    this.walk.minZ = 0.02

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), this.scene)
    hemi.intensity = 0.98
    hemi.groundColor = new Color3(0.28, 0.29, 0.31)
    const dir = new DirectionalLight('dir', new Vector3(-0.55, -1, -0.7), this.scene)
    dir.position = new Vector3(4, 7, 5)
    dir.intensity = 0.72

    const fill = new DirectionalLight('fill', new Vector3(0.7, -0.35, 0.6), this.scene)
    fill.intensity = 0.3
    fill.specular = new Color3(0.15, 0.15, 0.15)

    this.shadow = new ShadowGenerator(512, dir)
    this.shadow.usePercentageCloserFiltering = true
    this.shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
    this.shadow.bias = 0.0015
    this.shadow.normalBias = 0.02
    this.shadow.darkness = 0.45
    const sm = this.shadow.getShadowMap()
    if (sm) sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE

    this.scene.imageProcessingConfiguration.contrast = 1.12
    this.scene.imageProcessingConfiguration.exposure = 1.05

    this.roomRoot = new TransformNode('room', this.scene)
    this.furniture = new TransformNode('furniture', this.scene)
    this.scene.activeCamera = this.orbit
    const selMat = new StandardMaterial('sel-mat', this.scene)
    selMat.wireframe = true
    selMat.emissiveColor = matColor('#e0a33e')
    selMat.disableLighting = true
    this.selectionBox = CreateBox('selection', { size: 1 }, this.scene)
    this.selectionBox.material = selMat
    this.selectionBox.isPickable = false
    this.selectionBox.setEnabled(false)

    this.setQuality('realistic')
    this.engine.runRenderLoop(() => {
      if (this.disposed) return
      this.tickAnim()
      this.updateWalls()
      if (this.projection === 'ortho') this.updateOrtho()
      this.scene.render()
    })
  }

  dispose(): void {
    this.disposed = true
    this.scene.dispose()
    this.engine.dispose()
  }

  resize(): void {
    this.engine.resize()
    this.applyProjection()
  }

  /** Пересобрать комнату (стены, пол, потолок, проёмы). */
  syncRoom(room: Room, materials: Materials): void {
    const sig = JSON.stringify({ room, mats: materials })
    if (sig === this.roomSig) return
    this.roomSig = sig
    this.roomRoot.getChildMeshes().forEach((m) => m.dispose())
    this.roomRoot.dispose()
    this.walls = []
    this.wallDecor = []
    this.ceilingMesh = null
    this.openingMeshes.clear()
    this.wallItemMeshes.clear()
    this.roomRoot = new TransformNode('room', this.scene)
    this.buildRoom(room, materials)
    const sm = this.shadow.getShadowMap()
    if (sm) {
      sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
      sm.resetRefreshCounter()
    }
  }

  /** Пересобрать/обновить мебель. */
  syncInstances(
    instances: Instance[],
    derived: Record<string, SolveResponse>,
    materials: Materials,
    materialVars: MaterialVariable[] = [],
    revision = 0,
  ): void {
    const alive = new Set<string>()
    let rebuilt = false
    const matsSig = JSON.stringify({
      rev: revision,
      project: materials,
      vars: materialVars,
      instances: instances.map((i) => [
        i.id,
        i.materials ?? null,
        i.partMaterials ?? null,
        i.zone ?? '',
      ]),
    })
    for (const inst of instances) {
      alive.add(inst.id)
      let root = this.roots.get(inst.id)
      if (!root) {
        root = new TransformNode(`inst:${inst.id}`, this.scene)
        this.roots.set(inst.id, root)
      }
      root.setParent(this.furniture)
      const objs = derived[inst.id]?.objects ?? []
      const sig = JSON.stringify(
        objs.map((o) => [o.name, o.kind, o.x, o.y, o.z, o.sx, o.sy, o.sz,
          o.hinge, o.drawer_id]),
      )
      if (this.instSig.get(inst.id) !== sig) {
        this.instSig.set(inst.id, sig)
        this.rebuildInstance(inst, root, objs)
        rebuilt = true
      }
      root.position.set(inst.x * MM, (inst.z || 0) * MM, inst.y * MM)
      root.rotation.y = (-inst.rot * Math.PI) / 180
    }
    for (const [id, root] of this.roots) {
      if (alive.has(id)) continue
      root.getChildMeshes().forEach((m) => m.dispose())
      root.dispose()
      this.roots.delete(id)
      this.instSig.delete(id)
      const prefix = `${id}:`
      for (const k of [...this.parts.keys()]) {
        if (k.startsWith(prefix)) {
          this.parts.get(k)?.dispose()
          this.parts.delete(k)
          this.partMeta.delete(k)
        }
      }
    }
    if (rebuilt || matsSig !== this.matsSig) {
      this.matsSig = matsSig
      this.applyMaterials(instances, derived, materials, materialVars)
    }
    if (rebuilt) {
      this.applyQualityToMeshes()
      const sm = this.shadow.getShadowMap()
      if (sm) {
        sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
        sm.resetRefreshCounter()
      }
    }
  }

  private rebuildInstance(
    inst: Instance,
    root: TransformNode,
    objs: SceneObject[],
  ): void {
    const prefix = `${inst.id}:`
    for (const k of [...this.parts.keys()]) {
      if (!k.startsWith(prefix)) continue
      const m = this.parts.get(k)
      if (m) {
        this.shadow.removeShadowCaster(m)
        m.dispose()
      }
      this.parts.delete(k)
      this.partMeta.delete(k)
    }
    root.getChildMeshes().forEach((m) => m.dispose())
    for (const k of [...this.materials.keys()]) {
      if (!k.startsWith(`${inst.id}:`)) continue
      this.materials.get(k)?.dispose()
      this.materials.delete(k)
    }
    objs.forEach((o, part) => {
      const key = `${inst.id}:${part}`
      const mesh = CreateBox(
        key,
        { width: o.sx * MM, height: o.sz * MM, depth: o.sy * MM },
        this.scene,
      )
      mesh.isPickable = true
      mesh.receiveShadows = true
      mesh.metadata = { instanceId: inst.id, part }
      const mat = this.materialFor(`${inst.id}:${ROLE_MAT[o.role || 'corpus'] || o.role || 'corpus'}`)
      mesh.material = mat
      if (o.role !== 'drawer' && o.role !== 'leg') {
        mesh.enableEdgesRendering(0.999)
        mesh.edgesWidth = 0.9
        mesh.edgesColor = new Color4(0.03, 0.04, 0.05, 0.72)
      }
      const base = { x: o.x, y: o.y, z: o.z, sx: o.sx, sy: o.sy, sz: o.sz }
      const meta: PartMeta = {
        instanceId: inst.id,
        part,
        kind: o.kind,
        name: o.name,
        role: o.role || 'corpus',
        base,
        hinge: o.hinge as 'left' | 'right' | undefined,
        drawerId: o.drawer_id,
      }
      if (o.kind === 'door' && o.hinge) {
        const pivot = new TransformNode(`${key}:pivot`, this.scene)
        pivot.parent = root
        const hingeX = o.hinge === 'left' ? o.x : o.x + o.sx
        pivot.position.set(hingeX * MM, 0, 0)
        mesh.parent = pivot
        const localX = o.hinge === 'left' ? o.sx / 2 : -o.sx / 2
        mesh.position.set(localX * MM, (o.z + o.sz / 2) * MM,
          (o.y + o.sy / 2) * MM)
        meta.pivot = pivot
      } else {
        mesh.parent = root
        mesh.position.set(
          (o.x + o.sx / 2) * MM,
          (o.z + o.sz / 2) * MM,
          (o.y + o.sy / 2) * MM,
        )
      }
      this.parts.set(key, mesh)
      this.partMeta.set(key, meta)
      if (this.quality === 'realistic' &&
        ['corpus', 'facade', 'worktop', 'plinth'].includes(o.role || 'corpus')) {
        this.shadow.addShadowCaster(mesh)
      }
      if (o.role === 'facade') {
        mesh.edgesColor = new Color4(0.06, 0.07, 0.08, 0.8)
      }
    })
  }

  private materialFor(role: string): StandardMaterial {
    const key = role || 'corpus'
    let m = this.materials.get(key)
    if (m) return m
    m = new StandardMaterial(`mat:${key}`, this.scene)
    m.specularColor = new Color3(0.06, 0.06, 0.06)
    m.roughness = 0.8
    m.backFaceCulling = false
    this.materials.set(key, m)
    return m
  }

  private textureFor(url: string, repeat: number): Texture {
    const rep = Math.max(0.25, Math.round(repeat * 4) / 4)
    const key = `${url}|${rep}`
    let tex = this.textures.get(key)
    if (tex) return tex
    tex = new Texture(url, this.scene)
    tex.wrapU = Texture.WRAP_ADDRESSMODE
    tex.wrapV = Texture.WRAP_ADDRESSMODE
    tex.uScale = rep
    tex.vScale = rep
    this.textures.set(key, tex)
    return tex
  }

  private applyMaterials(
    instances: Instance[],
    derived: Record<string, SolveResponse>,
    materials: Materials,
    materialVars: MaterialVariable[],
  ): void {
    for (const inst of instances) {
      for (const [key, mesh] of this.parts) {
        if (!key.startsWith(`${inst.id}:`)) continue
        const meta = this.partMeta.get(key)
        if (!meta) continue
        const obj = derived[inst.id]?.objects[meta.part]
        const role = obj?.role || 'corpus'
        const mk = ROLE_MAT[role] || role
        const src = obj
          ? resolveObjectMaterial(materials, materialVars, inst, obj,
              meta.part)
          : materials.corpus
        const schematic = this.quality === 'schematic'
        const textured = !schematic && !!src?.texture
        // Ключ включает деталь: у корпуса, полок и боковин могут быть
        // разные глобальные переменные при одной роли материала.
        const matKey = `${inst.id}:${meta.part}:${mk}`
        const fa = this.materialFor(matKey)
        if (schematic) {
          // «Каркас» — без текстур, но с фактическим цветом материала:
          // иначе смена цвета выглядит как «не реагирует».
          const grey: Record<string, string> = {
            corpus: '#b8bcc1', facade: '#8f969d', worktop: '#7d848b',
            plinth: '#6e757c', back: '#d3d7db', drawer: '#9aa0a6',
            leg: '#555b61',
          }
          const base = src?.color || grey[mk] || '#a9aeb3'
          fa.diffuseColor = matColor(base)
          fa.emissiveColor = matColor(src?.accent || base).scale(0.04)
          fa.diffuseTexture = null
        } else {
          fa.diffuseColor = matColor(src?.color || '#999999')
          fa.emissiveColor = matColor(src?.accent || src?.color || '#222222').scale(0.08)
          if (textured) {
            const face = Math.max(meta.base.sx, meta.base.sz, meta.base.sy)
            fa.diffuseTexture = this.textureFor(
              src.texture as string,
              face / (src.texScale || 600),
            )
          } else {
            fa.diffuseTexture = null
          }
        }
        mesh.material = fa
        fa.markAsDirty(Material.AllDirtyFlag)
      }
    }
  }

  private buildRoom(room: Room, materials: Materials): void {
    const pts = outlinePoints(room)
    const schematic = this.quality === 'schematic'
    const floorMat = this.materialFor('floor')
    const fm = materials.floor
    floorMat.diffuseColor = matColor(schematic ? '#aeb2b6' : (fm?.color || '#8b7a63'))
    floorMat.specularColor = new Color3(0.02, 0.02, 0.02)
    floorMat.roughness = 0.9
    floorMat.backFaceCulling = false
    floorMat.emissiveColor = matColor(fm?.color || '#8b7a63').scale(0.08)
    if (room.floor?.enabled !== false) {
      const floors: Mesh[] = []
      for (const tri of triangulate(pts)) {
        const mesh = new Mesh('floor', this.scene)
        const positions: number[] = []
        const inds: number[] = []
        const normals: number[] = []
        tri.forEach((p) => {
          positions.push(p.x * MM, 0, p.y * MM)
          normals.push(0, 1, 0)
        })
        // ровно один треугольник: обход против часовой при взгляде сверху
        inds.push(0, 2, 1)
        const vd = new VertexData()
        vd.positions = positions
        vd.indices = inds
        vd.normals = normals
        vd.applyToMesh(mesh)
        mesh.material = floorMat
        mesh.isPickable = false
        floors.push(mesh)
      }
      const merged = floors.length > 1
        ? Mesh.MergeMeshes(floors, true, true, undefined, false, false)
        : floors[0]
      if (merged) {
        merged.name = 'floor'
        merged.material = floorMat
        merged.receiveShadows = true
        merged.parent = this.roomRoot
        merged.isPickable = false
      }
    }
    this.roomH = room.h
    if (room.ceiling?.enabled) {
      const ceilMat = this.materialFor('ceiling')
      const cm = materials.ceiling
      ceilMat.diffuseColor = matColor(schematic ? '#d8dadd' : (cm?.color || '#efeee9'))
      ceilMat.emissiveColor = matColor(cm?.color || '#efeee9').scale(0.35)
      ceilMat.backFaceCulling = false
      const ceils: Mesh[] = []
      for (const tri of triangulate(pts)) {
        const mesh = new Mesh('ceiling', this.scene)
        const vd = new VertexData()
        const positions: number[] = []
        const inds: number[] = []
        const normals: number[] = []
        tri.forEach((p) => {
          positions.push(p.x * MM, room.h * MM, p.y * MM)
          normals.push(0, -1, 0)
        })
        // нормаль вниз — лицевая сторона видна снизу
        inds.push(0, 1, 2)
        vd.positions = positions
        vd.indices = inds
        vd.normals = normals
        vd.applyToMesh(mesh)
        mesh.material = ceilMat
        mesh.isPickable = false
        ceils.push(mesh)
      }
      const merged = ceils.length > 1
        ? Mesh.MergeMeshes(ceils, true, true, undefined, false, false)
        : ceils[0]
      if (merged) {
        merged.name = 'ceiling'
        merged.material = ceilMat
        merged.parent = this.roomRoot
        merged.isPickable = false
      }
    }

    const wallT = Math.max(40, Math.min(300, room.wallT ?? 100))
    const wallMat = this.materialFor('wall')
    wallMat.diffuseColor = matColor(schematic ? '#c3c6c9'
      : (materials.wall?.color || '#d5d1c9'))
    wallMat.emissiveColor = matColor(schematic ? '#c3c6c9' : '#d5d1c9').scale(0.16)
    wallMat.backFaceCulling = false
    const walls = roomWalls(room)
    for (const seg of walls) {
      this.buildWall(seg, room, wallT, wallMat)
    }
    this.buildWallItems(room, walls, materials)
  }

  private buildWall(
    seg: WallSeg,
    room: Room,
    wallT: number,
    mat: StandardMaterial,
  ): void {
    const ops = (room.openings ?? [])
      .filter((o) => o.wall === seg.index)
      .sort((a, b) => a.x - b.x)
    const h = room.h
    const angle = Math.atan2(seg.dy, seg.dx)
    const mid = wallT / 2
    const pieces: Mesh[] = []
    const addPiece = (s0: number, s1: number, z0: number, z1: number) => {
      if (s1 - s0 < 1 || z1 - z0 < 1) return
      const len = s1 - s0
      const piece = CreateBox(
        'wall',
        { width: len * MM, height: (z1 - z0) * MM, depth: wallT * MM },
        this.scene,
      )
      const sc = (s0 + s1) / 2
      const cx = seg.a.x + seg.dx * sc - seg.nx * mid
      const cy = seg.a.y + seg.dy * sc - seg.ny * mid
      piece.position.set(cx * MM, ((z0 + z1) / 2) * MM, cy * MM)
      piece.rotation.y = -angle
      piece.material = mat
      piece.isPickable = false
      pieces.push(piece)
    }
    let cursor = 0
    for (const o of ops) {
      const x0 = Math.max(0, Math.min(seg.len, o.x))
      const x1 = Math.max(x0, Math.min(seg.len, o.x + o.w))
      const z0 = Math.max(0, Math.min(h, o.z0))
      const z1 = Math.max(z0, Math.min(h, o.z1))
      addPiece(cursor, x0, 0, h)
      addPiece(x0, x1, 0, z0)
      addPiece(x0, x1, z1, h)
      this.buildOpening(seg, o, x0, x1, z0, z1, wallT, room)
      cursor = Math.max(cursor, x1)
    }
    addPiece(cursor, seg.len, 0, h)
    const merged = pieces.length > 1
      ? Mesh.MergeMeshes(pieces, true, true, undefined, false, false)
      : pieces[0]
    if (merged) {
      merged.name = 'wall'
      merged.material = mat
      merged.receiveShadows = true
      merged.parent = this.roomRoot
      merged.isPickable = true
      merged.metadata = { type: 'wall', wallIndex: seg.index }
      this.walls.push({
        mesh: merged,
        normal: { x: seg.nx, y: seg.ny },
        // центр берём из сегмента, а не из (возможно не обновлённого)
        // bounding box после MergeMeshes
        center: new Vector3(
          ((seg.a.x + seg.b.x) / 2) * MM,
          (h / 2) * MM,
          ((seg.a.y + seg.b.y) / 2) * MM,
        ),
        baseY: 0,
        baseH: 0,
        kind: 'wall',
      })
    }
  }

  private buildOpening(
    seg: WallSeg,
    o: Opening,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    wallT: number,
    room: Room,
  ): void {
    const mid = wallT / 2
    const angle = Math.atan2(seg.dy, seg.dx)
    const place = (s: number, z: number, inset: number) => {
      const x = seg.a.x + seg.dx * s + seg.nx * inset
      const y = seg.a.y + seg.dy * s + seg.ny * inset
      return v3(x, z, y)
    }
    const addBox = (
      name: string,
      s: number,
      z: number,
      inset: number,
      w: number,
      h: number,
      d: number,
      mat: StandardMaterial,
      rotY = 0,
    ) => {
      const m = CreateBox(
        name,
        { width: w * MM, height: h * MM, depth: d * MM },
        this.scene,
      )
      m.position = place(s, z, inset)
      m.rotation.y = -angle + rotY
      m.material = mat
      m.parent = this.roomRoot
      m.isPickable = true
      return m
    }
    const glass = this.materialFor('glass')
    glass.diffuseColor = new Color3(0.56, 0.74, 0.83)
    glass.alpha = 0.42
    glass.backFaceCulling = false
    const frame = this.materialFor('frame')
    frame.diffuseColor = new Color3(0.9, 0.89, 0.84)
    const doorMat = this.materialFor('door')
    doorMat.diffuseColor = matColor('#c7b394')
    const w = x1 - x0
    const h = z1 - z0
    const sMid = (x0 + x1) / 2
    // невидимый «паспорт» проёма: по нему удобно попадать мышью даже если
    // стекло/створка перекрыты геометрией стены
    const hit = CreateBox(
      'opening-hit',
      { width: Math.max(20, w - 20) * MM, height: Math.max(20, h - 20) * MM,
        depth: 10 * MM },
      this.scene,
    )
    hit.position = place(sMid, (z0 + z1) / 2, 40)
    hit.rotation.y = -angle
    hit.isPickable = true
    hit.metadata = { type: 'opening', openingId: o.id, wallIndex: seg.index }
    const hitMat = this.materialFor('opening-hit')
    hitMat.alpha = 0
    hitMat.disableDepthWrite = true
    hitMat.needDepthPrePass = false
    hit.material = hitMat
    hit.parent = this.roomRoot
    this.openingMeshes.set(o.id, [hit])
    if (o.kind === 'window') {
      const g = addBox('glass', sMid, (z0 + z1) / 2, 2, w - 40, h - 40, 12, glass)
      g.metadata = { type: 'opening', openingId: o.id, wallIndex: seg.index }
      this.openingMeshes.get(o.id)?.push(g)
      this.wallDecor.push(g)
    }
    if (o.kind === 'door' || o.kind === 'arch') {
      if (o.kind === 'door' && o.open) {
        const right = o.hinge === 'right'
        const hingeS = right ? x1 : x0
        const sign = right ? -1 : 1
        const ang = ((o.angle ?? 80) * Math.PI) / 180
        const freeS = hingeS + sign * w * Math.cos(ang)
        const freeI = mid + w * Math.sin(ang)
        const pivotS = hingeS
        const pivot = CreateBox(
          'doorpivot',
          { width: 0.01, height: 0.01, depth: 0.01 },
          this.scene,
        )
        pivot.isVisible = false
        pivot.position = place(pivotS, 0, 2)
        pivot.rotation.y = -angle
        pivot.parent = this.roomRoot
        const leaf = CreateBox(
          'doorleaf',
          { width: w * MM, height: h * MM, depth: 40 * MM },
          this.scene,
        )
        leaf.parent = pivot
        leaf.position.set((sign * w * MM) / 2, (z0 + z1) / 2 * MM, 0)
        leaf.material = doorMat
        leaf.isPickable = true
        leaf.metadata = { type: 'opening', openingId: o.id, wallIndex: seg.index }
        this.openingMeshes.get(o.id)?.push(leaf)
        this.wallDecor.push(leaf)
        pivot.rotation.y = -angle + (right ? ang : -ang)
        // компенсируем смещение свободного конца: ставим лист по направлению
        leaf.setEnabled(true)
      } else if (o.kind === 'door') {
        const leaf = addBox('doorleaf', sMid, (z0 + z1) / 2, 2, w - 20, h, 40, doorMat)
        leaf.metadata = { type: 'opening', openingId: o.id, wallIndex: seg.index }
        this.openingMeshes.get(o.id)?.push(leaf)
        this.wallDecor.push(leaf)
      }
    }
  }

  private buildWallItems(
    room: Room,
    walls: WallSeg[],
    materials: Materials,
  ): void {
    for (const item of room.wallItems ?? []) {
      const seg = walls.find((w) => w.index === item.wall)
      if (!seg) continue
      const angle = Math.atan2(seg.dy, seg.dx)
      const s = item.x + item.w / 2
      const x = seg.a.x + seg.dx * s + seg.nx * (item.depth / 2)
      const y = seg.a.y + seg.dy * s + seg.ny * (item.depth / 2)
      const m = CreateBox(
        `wallitem:${item.kind}`,
        { width: item.w * MM, height: item.h * MM, depth: item.depth * MM },
        this.scene,
      )
      m.position = v3(x, item.z + item.h / 2, y)
      m.rotation.y = -angle
      let role = 'corpus'
      if (item.kind === 'mirror') role = 'glass'
      if (item.kind === 'socket' || item.kind === 'switch') role = 'leg'
      const mat = this.materialFor(role)
      const src = materials[role] ?? materials.corpus
      mat.diffuseColor = matColor(src?.color || '#888888')
      m.material = mat
      m.parent = this.roomRoot
      m.isPickable = true
      m.metadata = { type: 'wallitem', wallIndex: item.wall, itemId: item.id }
      this.wallItemMeshes.set(item.id, m)
    }
  }

  private updateWalls(): void {
    const cam = this.scene.activeCamera
    if (!cam) return
    // потолок показываем только изнутри; сверху в разрезе он закрывает комнату
    if (this.ceilingMesh) {
      this.ceilingMesh.setEnabled(
        this.wallMode !== 'low' && cam.position.y < this.roomH * MM * 0.98,
      )
    }
    if (!this.walls.length) return
    if (this.wallMode === 'low') {
      for (const w of this.walls) w.mesh.setEnabled(true)
      return
    }
    for (const w of this.walls) {
      const dir = cam.position.subtract(w.center)
      const facing = w.normal.x * dir.x + w.normal.y * dir.z
      // стена, обращённая к камере, прячется в разрезе
      w.mesh.setEnabled(facing > -0.25)
    }
  }

  private tickAnim(): void {
    const schematic = this.quality === 'schematic'
    const byInst = new Map<string, {
      inst: Instance
      hasDoors: boolean
      doorOpen: boolean
    }>()
    for (const inst of state.project.instances) {
      const objs = derived[inst.id]?.objects ?? []
      let hasDoors = false
      let doorOpen = false
      for (let part = 0; part < objs.length; part++) {
        const o = objs[part]
        if (o.kind !== 'door') continue
        hasDoors = true
        if ((partAnimValues(inst, part)?.open ?? 0) > 1) doorOpen = true
      }
      byInst.set(inst.id, { inst, hasDoors, doorOpen })
    }
    for (const [key, meta] of this.partMeta) {
      const mesh = this.parts.get(key)
      if (!mesh) continue
      if (schematic) {
        mesh.setEnabled(meta.role !== 'facade')
        continue
      }
      const info = byInst.get(meta.instanceId)
      let on = ui.facades || meta.role !== 'facade'
      if (!on) {
        mesh.setEnabled(false)
        mesh.isPickable = false
        continue
      }
      if (meta.kind === 'drawerbox') {
        // при скрытых фасадах показываем короба даже задвинутыми
        if (ui.facades) {
          const a = info ? partAnimValues(info.inst, meta.part) : undefined
          on = (a?.slide ?? 0) > 1
        } else {
          on = true
        }
      } else if (ui.facades && info?.hasDoors && !info.doorOpen &&
        (meta.name.includes('Полка') || meta.name.includes('Перегородка'))) {
        on = false
      }
      mesh.setEnabled(on)
      mesh.isPickable = on
    }
    for (const inst of state.project.instances) {
      const info = byInst.get(inst.id)
      if (!info) continue
      for (const [key, meta] of this.partMeta) {
        if (meta.instanceId !== inst.id) continue
        const anim = partAnimValues(inst, meta.part)
        if (!anim) continue
        if (meta.pivot) {
          const angle = (anim.open ?? 0) * (Math.PI / 180)
          meta.pivot.rotation.y = meta.hinge === 'left' ? angle : -angle
        }
        if (meta.kind === 'drawerfront' || meta.kind === 'drawerbox') {
          const slide = anim.slide ?? 0
          const mesh = this.parts.get(key)
          if (mesh) {
            mesh.position.z = (meta.base.y + meta.base.sy / 2) * MM - slide * MM
          }
        }
      }
    }
    if (this.selectedIds.size || this.selectedWall != null ||
        this.selectedOpening || this.selectedItem) this.updateSelectionBox()
  }

  setSelected(ids: string[] | string): void {
    this.selectedIds = new Set(Array.isArray(ids) ? ids : ids ? [ids] : [])
    this.selectedWall = null
    this.selectedItem = null
    this.selectedOpening = null
    this.updateSelectionBox()
  }

  setSelectedWall(index: number | null, itemId: string | null = null): void {
    this.selectedWall = index
    this.selectedItem = itemId
    this.selectedOpening = null
    this.selectedIds = new Set()
    this.updateSelectionBox()
  }

  setSelectedOpening(id: string | null): void {
    this.selectedOpening = id
    this.selectedWall = null
    this.selectedItem = null
    this.selectedIds = new Set()
    this.updateSelectionBox()
  }

  private selectionMeshes(): Mesh[] {
    if (this.selectedItem) {
      const m = this.wallItemMeshes.get(this.selectedItem)
      return m ? [m] : []
    }
    if (this.selectedWall != null) {
      const w = this.walls.find((x) => x.mesh.metadata?.wallIndex === this.selectedWall)
      return w ? [w.mesh] : []
    }
    if (this.selectedOpening) return this.openingMeshes.get(this.selectedOpening) ?? []
    const out: Mesh[] = []
    for (const id of this.selectedIds) {
      const root = this.roots.get(id)
      if (!root) continue
      for (const m of root.getChildMeshes()) if (m.isEnabled()) out.push(m as Mesh)
    }
    return out
  }

  private updateSelectionBox(): void {
    const meshes = this.selectionMeshes()
    if (!meshes.length) {
      this.selectionBox.setEnabled(false)
      return
    }
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
    if (!Number.isFinite(min.x)) {
      this.selectionBox.setEnabled(false)
      return
    }
    const pad = 0.012
    const center = min.add(max).scale(0.5)
    const size = max.subtract(min)
    this.selectionBox.position.copyFrom(center)
    this.selectionBox.scaling.set(
      Math.max(0.01, size.x + pad * 2),
      Math.max(0.01, size.y + pad * 2),
      Math.max(0.01, size.z + pad * 2),
    )
    this.selectionBox.setEnabled(true)
  }

  setQuality(mode: 'realistic' | 'schematic'): void {
    this.quality = mode
    const schematic = mode === 'schematic'
    this.engine.setHardwareScalingLevel(schematic ? 1.25 : 1)
    this.scene.shadowsEnabled = !schematic
    this.scene.imageProcessingConfiguration.contrast = schematic ? 1.0 : 1.12
    this.scene.imageProcessingConfiguration.exposure = schematic ? 1.0 : 1.05
    this.scene.clearColor = schematic
      ? new Color4(0.30, 0.32, 0.35, 1)
      : new Color4(0.055, 0.066, 0.08, 1)
    const hadRoom = !!this.roomSig
    this.roomSig = ''
    this.applyMaterials(
      state.project.instances,
      derived,
      state.project.materials,
      state.project.materialVars,
    )
    if (hadRoom) this.syncRoom(state.project.room, state.project.materials)
    for (const m of this.parts.values()) {
      m.receiveShadows = !schematic
      m.edgesWidth = schematic ? 0.55 : 0.9
    }
    this.applyQualityToMeshes()
  }

  private applyQualityToMeshes(): void {
    const schematic = this.quality === 'schematic'
    for (const meta of this.partMeta.values()) {
      const key = `${meta.instanceId}:${meta.part}`
      const mesh = this.parts.get(key)
      if (!mesh) continue
      mesh.setEnabled(!(schematic && meta.role === 'facade'))
    }
    for (const m of this.wallDecor) m.setEnabled(!schematic)
  }

  setWallMode(mode: 'cutaway' | 'low'): void {
    this.wallMode = mode
  }

  setMode(mode: 'orbit' | 'first' | 'fly'): void {
    this.mode = mode
    if (mode === 'orbit') {
      this.scene.activeCamera = this.orbit
      this.orbit.attachControl(this.canvas, true)
      this.walk.detachControl()
    } else {
      const p = this.orbit.position
      this.walk.position.copyFrom(p)
      this.walk.position.y = mode === 'first' ? 1.6 : Math.max(0.4, p.y)
      this.walk.setTarget(this.orbit.target)
      this.scene.activeCamera = this.walk
      this.orbit.detachControl()
      this.walk.attachControl(this.canvas, true)
    }
  }

  setProjection(projection: 'persp' | 'ortho'): void {
    this.projection = projection
    this.applyProjection()
  }

  private projection: 'persp' | 'ortho' = 'persp'
  private applyProjection(): void {
    if (this.projection === 'ortho') {
      this.orbit.mode = Camera.ORTHOGRAPHIC_CAMERA
      this.updateOrtho()
    } else {
      this.orbit.mode = Camera.PERSPECTIVE_CAMERA
    }
  }

  private updateOrtho(): void {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight())
    const r = Math.max(1.2, this.orbit.radius * 0.48)
    this.orbit.orthoTop = r
    this.orbit.orthoBottom = -r
    this.orbit.orthoLeft = -r * aspect
    this.orbit.orthoRight = r * aspect
  }

  center(room: Room): void {
    const pts = outlinePoints(room)
    const b = pts.reduce(
      (acc, p) => ({
        minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    )
    this.setMode('orbit')
    this.orbit.target.set(
      ((b.minX + b.maxX) / 2) * MM,
      Math.min(1.4, room.h / 2000),
      ((b.minY + b.maxY) / 2) * MM,
    )
    this.orbit.radius = 2.4
    this.orbit.alpha = (-34 * Math.PI) / 180
    this.orbit.beta = (90 - 20) * (Math.PI / 180)
    this.applyProjection()
  }

  setView(name: 'iso' | 'front' | 'side' | 'top'): void {
    const map = {
      iso: [(-34 * Math.PI) / 180, (90 - 25) * (Math.PI / 180)],
      front: [0, Math.PI / 2],
      side: [(-90 * Math.PI) / 180, Math.PI / 2],
      top: [0, 0.001],
    } as const
    const [alpha, beta] = map[name]
    this.orbit.alpha = alpha
    this.orbit.beta = beta
  }

  fit(target: 'room' | 'module', room: Room, instanceId?: string | null): void {
    const pts = outlinePoints(room)
    let minX = Math.min(...pts.map((p) => p.x))
    let maxX = Math.max(...pts.map((p) => p.x))
    let minY = Math.min(...pts.map((p) => p.y))
    let maxY = Math.max(...pts.map((p) => p.y))
    let maxZ = room.h
    if (target === 'module' && instanceId && this.roots.has(instanceId)) {
      const meshes = this.roots.get(instanceId)!.getChildMeshes()
      if (meshes.length) {
        const b = meshes.reduce(
          (acc, m) => {
            const bb = m.getBoundingInfo().boundingBox
            return {
              min: Vector3.Minimize(acc.min, bb.minimumWorld),
              max: Vector3.Maximize(acc.max, bb.maximumWorld),
            }
          },
          { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) },
        )
        const center = b.min.add(b.max).scale(0.5)
        this.orbit.target.copyFrom(center)
        this.orbit.radius = b.max.subtract(b.min).length() * 1.15
        this.applyProjection()
        return
      }
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ)
    this.orbit.target.set(cx * MM, (maxZ / 2) * MM, cy * MM)
    this.orbit.radius = Math.max(2, diag * MM * 0.85)
    this.applyProjection()
  }

  /** Объектный режим: камера смотрит анфас, вращается вокруг объекта. */
  enterObjectMode(instanceId: string, leftFraction = 0.38): void {
    const root = this.roots.get(instanceId)
    if (!root) return
    const meshes = root.getChildMeshes()
    if (!meshes.length) return
    if (!this.savedCamera) {
      this.savedCamera = {
        alpha: this.orbit.alpha,
        beta: this.orbit.beta,
        radius: this.orbit.radius,
        target: this.orbit.target.asArray() as [number, number, number],
        offset: this.orbit.targetScreenOffset.asArray() as [number, number],
        projection: this.projection,
        mode: this.mode,
      }
    }
    this.setMode('orbit')
    this.objectId = instanceId
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
    if (!Number.isFinite(min.x)) return
    const center = min.add(max).scale(0.5)
    const size = max.subtract(min)
    const wm = root.getWorldMatrix()
    const right = Vector3.TransformNormal(new Vector3(1, 0, 0), wm).normalize()
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), wm).normalize()
    const front = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize()
    const maxDim = Math.max(size.x, size.y, size.z, 0.2)
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight())
    const vfov = this.orbit.fov
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    const left = Math.min(1, Math.max(0.2, leftFraction))
    const availHfov = 2 * Math.atan(Math.tan(hfov / 2) * left)
    const dist = Math.max(
      (size.x / 2) / Math.tan(availHfov / 2),
      (size.y / 2) / Math.tan(vfov / 2),
      0.3,
    ) * 1.32 + 0.05
    this.orbit.target.copyFrom(center)
    this.orbit.setPosition(
      center.add(front.scale(dist)).add(up.scale(maxDim * 0.03)),
    )
    this.orbit.radius = dist
    const shift = Math.max(0, 0.5 - left / 2) * 2 * dist * Math.tan(hfov / 2)
    this.orbit.targetScreenOffset.set(-shift, 0)
    this.applyProjection()
  }

  exitObjectMode(): void {
    if (!this.savedCamera) return
    const c = this.savedCamera
    this.orbit.alpha = c.alpha
    this.orbit.beta = c.beta
    this.orbit.radius = c.radius
    this.orbit.target.set(c.target[0], c.target[1], c.target[2])
    this.orbit.targetScreenOffset.set(c.offset[0], c.offset[1])
    this.projection = c.projection
    this.applyProjection()
    this.setMode(c.mode)
    this.savedCamera = null
    this.objectId = null
  }

  /** Показать модуль целиком с выбранного направления (по умолчанию — анфас). */
  focusInstance(
    instanceId: string,
    view: 'front' | 'iso' | 'side' | 'top' = 'front',
    leftFraction = 1,
  ): void {
    const root = this.roots.get(instanceId)
    if (!root) return
    const meshes = root.getChildMeshes()
    if (!meshes.length) return
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
    if (!Number.isFinite(min.x)) return
    const center = min.add(max).scale(0.5)
    const size = max.subtract(min)
    const wm = root.getWorldMatrix()
    const right = Vector3.TransformNormal(new Vector3(1, 0, 0), wm).normalize()
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), wm).normalize()
    const front = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize()
    const maxDim = Math.max(size.x, size.y, size.z, 0.2)
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight())
    const vfov = this.orbit.fov
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    const left = Math.min(1, Math.max(0.2, leftFraction))
    const availHfov = 2 * Math.atan(Math.tan(hfov / 2) * left)

    // габариты, которые должны попасть в оставшуюся левую часть экрана
    let worldW = size.x
    let worldH = size.y
    if (view === 'side') {
      worldW = size.z
      worldH = size.y
    } else if (view === 'top') {
      worldW = size.x
      worldH = size.z
    } else if (view === 'iso') {
      worldW = Math.max(size.x, size.z) * 1.15
      worldH = size.y * 1.08
    }
    const dist = Math.max(
      (worldW / 2) / Math.tan(availHfov / 2),
      (worldH / 2) / Math.tan(vfov / 2),
      0.3,
    ) * 1.18 + 0.04

    // сдвигаем цель вправо, чтобы объект встал в левую видимую часть
    const screenRight = view === 'side' ? front : right
    const shift = Math.max(0, 0.5 - left / 2) * 2 * dist * Math.tan(hfov / 2) * 1.35
    const target = center.add(screenRight.scale(shift))

    this.orbit.targetScreenOffset.set(0, 0)
    this.orbit.target.copyFrom(target)
    if (view === 'top') {
      this.orbit.alpha = 0
      this.orbit.beta = 0.01
      this.orbit.radius = dist
    } else {
      const dir = view === 'front'
        ? front
        : view === 'side'
          ? right
          : front.add(right.scale(0.75)).add(up.scale(0.55)).normalize()
      this.orbit.setPosition(target.add(dir.scale(dist)).add(up.scale(maxDim * 0.03)))
      this.orbit.radius = dist
    }
    this.applyProjection()
  }

  floorPoint(x: number, y: number): { x: number; y: number } | null {
    const cam = this.scene.activeCamera ?? this.orbit
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), cam)
    if (Math.abs(ray.direction.y) < 1e-6) return null
    const t = -ray.origin.y / ray.direction.y
    if (t < 0) return null
    const p = ray.origin.add(ray.direction.scale(t))
    return { x: p.x / MM, y: p.z / MM }
  }

  pick(x: number, y: number): {
    type: 'instance' | 'wall' | 'opening' | 'wallitem'
    instanceId?: string
    part?: number
    wallIndex?: number
    openingId?: string
    itemId?: string
  } | null {
    const p = this.scene.pick(
      x, y,
      (m) => m.isEnabled() && m.isVisible &&
        !!(m.metadata?.instanceId || m.metadata?.type),
    )
    if (!p.hit || !p.pickedMesh) return null
    const md = p.pickedMesh.metadata as Record<string, unknown> | undefined
    if (!md) return null
    if (md.instanceId) {
      return {
        type: 'instance',
        instanceId: String(md.instanceId),
        part: md.part as number | undefined,
      }
    }
    return md as unknown as {
      type: 'wall' | 'opening' | 'wallitem'
      wallIndex?: number
      openingId?: string
      itemId?: string
    }
  }

  project(x: number, y: number, z: number): { x: number; y: number } {
    const cam = this.scene.activeCamera ?? this.orbit
    const v = Vector3.Project(
      v3(x, z, y),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      cam.viewport.toGlobal(
        this.canvas.clientWidth || this.engine.getRenderWidth(),
        this.canvas.clientHeight || this.engine.getRenderHeight(),
      ),
    )
    return { x: v.x, y: v.y }
  }
}

