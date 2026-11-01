import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Effect } from '@babylonjs/core/Materials/effect'
import { Material } from '@babylonjs/core/Materials/material'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder'
import '@babylonjs/core/Rendering/edgesRenderer'
import '@babylonjs/core/Rendering/outlineRenderer'
import '@babylonjs/core/Culling/ray'
import type { Instance } from '../state/project'
import { animState, derived, partAnimValues, state, ui } from '../state/project'
import type { AssemblyOperation, SolveResponse } from '../api'
import type {
  Material as SurfaceMaterial,
  MaterialVariable,
  Materials,
  Prop,
  Opening,
  Room,
  SceneObject,
} from '../render25d/types'
import { resolveObjectMaterial } from '../material/vars'
import { textureFor } from '../render25d/textures'
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
  /** индекс стены в roomWalls — для проёмов */
  index: number
  /** начало/конец в плане, мм */
  a: { x: number; y: number }
  b: { x: number; y: number }
  t: number
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
  private propsRoot: TransformNode
  private propSig = ''
  private propMats = new Map<string, StandardMaterial>()
  private materials = new Map<string, StandardMaterial>()
  private textures = new Map<string, Texture>()
  private procTextures = new Map<string, DynamicTexture>()
  private parts = new Map<string, Mesh>()
  private partMeta = new Map<string, PartMeta>()
  /** Ключи частей по модулю: без обхода всех 380+ мешей каждый кадр. */
  private partsByInst = new Map<string, string[]>()
  /** Нужно пересчитать видимость/анимации (правка, флаги, конец анимации). */
  private animDirty = true
  private wasPlaying = false
  private walls: WallMeta[] = []
  private roomSig = ''
  private instSig = new Map<string, string>()
  private matsSig = ''
  private roots = new Map<string, TransformNode>()
  private mode: 'orbit' | 'first' | 'fly' = 'orbit'
  private wallMode: 'cutaway' | 'low' = 'cutaway'
  private selected = ''
  private quality: 'realistic' | 'schematic' | 'blueprint' = 'realistic'
  private clayMats = new Map<string, ShaderMaterial>()
  /** Чертёж: фиксированная камера, без свободного вращения. */
  private blueprint = false
  private bpView: 'iso' | 'front' | 'side' | 'top' = 'iso'
  private bpPivot: 'room' | 'object' = 'room'
  private hemi: HemisphericLight | null = null
  private dir: DirectionalLight | null = null
  private roomLightOn = true
  private lampLights = new Map<string, { light: PointLight; on: boolean }>()
  private sinkStreams = new Map<string, Mesh>()
  private wallDecor: Mesh[] = []
  private ceilingMesh: Mesh | null = null
  private roomH = 0
  private roomBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  /** Комната, в которой сейчас камера прогулки: держим её внутри. */
  private walkRect: { x: number; y: number; w: number; d: number } | null = null
  private walkObstacles: { x: number; y: number; w: number; d: number }[] = []
  private walkRadius = 200
  private walkRoomName = ''
  private walkEye = 1.6
  private walkVy = 0
  private walkGrounded = true
  private walkFov = 1.02
  private seated: { id: string; kind: string; eye: number } | null = null
  private selectionBox: Mesh
  /** Плавный доворот камеры к объекту: без рывка при клике. */
  private camTween: {
    t: number
    dur: number
    fromA: number
    fromB: number
    fromR: number
    fromTarget: Vector3
    toA: number
    toB: number
    toR: number
    toTarget: Vector3
  } | null = null
  private selectedPartInst: string | null = null
  private selectedPart: number | null = null
  private edgeSaved = new Map<Mesh, { width: number; color: Color4 }>()
  private outlineSaved = new Map<Mesh, { on: boolean; color: Color3; width: number }>()
  private selectedIds = new Set<string>()
  private selectedWall: number | null = null
  private selectedItem: string | null = null
  private selectedOpening: string | null = null
  private selectedProp: TransformNode | null = null
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
  /** Был ли включён «Чертёж» до входа в объектный режим. */
  private objectBp = false
  private visibleIds: Set<string> | null = null
  private visiblePropIds: Set<string> | null = null
  private propRoots = new Map<string, TransformNode>()
  private roomData: Room | null = null
  private hardwareVisible = true

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
    this.orbit.lowerRadiusLimit = 0.55
    this.orbit.upperRadiusLimit = 40
    this.orbit.wheelDeltaPercentage = 0.01
    // Не приближаемся «сквозь» текстуры к курсору: цель остаётся в комнате,
    // а минимальный радиус не даёт камере войти в корпус.
    this.orbit.zoomToMouseLocation = false
    this.orbit.useNaturalPinchZoom = true
    this.orbit.panningSensibility = 480
    // Положительная чувствительность = «хватаем сцену»: тянем вправо —
    // сцена идёт вправо. С минусом было наоборот (проверено замером
    // проекции углов комнаты: средний сдвиг −12 px вместо +19 px).
    this.orbit.angularSensibilityX = 1100
    this.orbit.angularSensibilityY = 1100
    this.orbit.inertia = 0.82
    this.orbit.attachControl(canvas, true)

    // Панорама «роликом» (средняя кнопка мыши). В Babylon по умолчанию
    // за панораму отвечают только правая кнопка и Ctrl+ЛКМ — средняя
    // кнопка не была замаплена, поэтому перемещение роликом не работало.
    try {
      this.orbit.movement.input.addEntry({
        source: 'pointer', button: 1, interaction: 'pan',
      })
    } catch {
      /* старые сборки Babylon без inputMap — остаются правая/Ctrl+ЛКМ */
    }
    // Средняя кнопка в браузере включает автоскролл: гасим его на канвасе,
    // иначе панорама «дёргается» и страница уезжает.
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button === 1) e.preventDefault()
    })
    canvas.addEventListener('auxclick', (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    })

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
    this.walk.speed = 2.6
    // Мышь в прогулке ведём сами (pointer lock): инерция только мешала —
    // камера «догоняла» курсор и улетала дальше нужного.
    this.walk.inertia = 0.35
    this.walk.angularSensibility = 900
    this.walk.minZ = 0.05
    // Поле зрения как у человека: 58° по вертикали (~90° по горизонтали
    // на 16:9). Прежние 0.8 рад (46°) ощущались зажатыми.
    this.walk.fov = this.walkFov
    // Штатные мышь/клавиатура Babylon конфликтуют с нашим управлением:
    // оставляем только сенсорный обзор.
    this.walk.inputs.removeByType('FreeCameraMouseInput')
    this.walk.inputs.removeByType('FreeCameraKeyboardMoveInput')
    // Сенсорный обзор в прогулке: по умолчанию Babylon ставит 200000
    // (почти не поворачивается) и в «неправильную» сторону.
    const walkTouch = (this.walk.inputs.attached as unknown as Record<
      string, { touchAngularSensibility?: number }
    >).touch
    if (walkTouch) walkTouch.touchAngularSensibility = -16000

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), this.scene)
    hemi.intensity = 0.98
    hemi.groundColor = new Color3(0.28, 0.29, 0.31)
    this.hemi = hemi
    const dir = new DirectionalLight('dir', new Vector3(-0.55, -1, -0.7), this.scene)
    dir.position = new Vector3(4, 7, 5)
    dir.intensity = 0.72
    this.dir = dir

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
    this.propsRoot = new TransformNode('props', this.scene)
    this.scene.activeCamera = this.orbit
    const selMat = new StandardMaterial('sel-mat', this.scene)
    selMat.wireframe = true
    selMat.emissiveColor = matColor('#ffc04a')
    selMat.alpha = 0.55
    selMat.disableLighting = true
    selMat.disableDepthWrite = true
    this.selectionBox = CreateBox('selection', { size: 1 }, this.scene)
    this.selectionBox.material = selMat
    this.selectionBox.isPickable = false
    this.selectionBox.setEnabled(false)

    this.setQuality('realistic')
    this.engine.runRenderLoop(() => {
      if (this.disposed) return
      this.tickAnim()
      this.tickWalk()
      this.tickCamera()
      this.updateWalls()
      if (this.projection === 'ortho') this.updateOrtho()
      this.scene.render()
    })
  }

  dispose(): void {
    this.disposed = true
    for (const m of this.clayMats.values()) m.dispose()
    this.clayMats.clear()
    this.scene.dispose()
    this.engine.dispose()
  }

  resize(): void {
    this.engine.resize()
    this.applyProjection()
  }

  /** Пересобрать комнату (стены, пол, потолок, проёмы). */
  syncRoom(room: Room, materials: Materials): void {
    this.roomData = room
    const sig = JSON.stringify({ room, mats: materials })
    if (sig === this.roomSig) return
    this.roomSig = sig
    this.roomRoot.getChildMeshes().forEach((m) => m.dispose())
    this.roomRoot.dispose()
    this.walls = []
    this.lowWalls = false
    this.wallDecor = []
    this.ceilingMesh = null
    this.openingMeshes.clear()
    this.wallItemMeshes.clear()
    this.roomRoot = new TransformNode('room', this.scene)
    this.roomH = room.h * MM
    const pts = outlinePoints(room)
    this.roomBounds = {
      minX: Math.min(...pts.map((p) => p.x)) * MM,
      maxX: Math.max(...pts.map((p) => p.x)) * MM,
      minY: Math.min(...pts.map((p) => p.y)) * MM,
      maxY: Math.max(...pts.map((p) => p.y)) * MM,
    }
    this.buildRoom(room, materials)
    if (this.isClay()) this.applyClayMaterials()
    const sm = this.shadow.getShadowMap()
    if (sm) {
      sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
      sm.resetRefreshCounter()
    }
  }

  /** Декоративная мебель демо-сцены: не участвует в BOM и picking. */
  syncProps(props: Prop[] = []): void {
    const sig = JSON.stringify(props)
    if (sig === this.propSig) return
    this.propSig = sig
    this.propsRoot.getChildMeshes().forEach((m) => m.dispose())
    this.propsRoot.dispose()
    this.propRoots.clear()
    this.propsRoot = new TransformNode('props', this.scene)
    const matCache = this.propMats
    const shade = (hex: string, k: number): string => {
      const c = matColor(hex)
      return new Color3(
        Math.min(1, c.r * k),
        Math.min(1, c.g * k),
        Math.min(1, c.b * k),
      ).toHexString()
    }
    interface Paint {
      color: string
      alpha?: number
      spec?: number
      glow?: number
    }
    const material = (
      color: string, alpha = 1, spec = 0.06, glow = 0.05,
    ): StandardMaterial => {
      const key = `${color}|${alpha}|${spec}|${glow}`
      let m = matCache.get(key)
      if (m) return m
      m = new StandardMaterial(`prop:${key}`, this.scene)
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
    const paint = (color: string): Paint => ({ color })
    const fabric = (color: string): Paint => ({ color, spec: 0.02, glow: 0.04 })
    const wood = (color: string): Paint => ({ color, spec: 0.14, glow: 0.03 })
    const ceramic = (color: string): Paint => ({ color, spec: 0.34, glow: 0.04 })
    const metal = (color = '#9aa1a6'): Paint => ({ color, spec: 0.55, glow: 0.02 })
    const glass = (color = '#cfe4ea'): Paint => ({
      color, alpha: 0.2, spec: 0.75, glow: 0.03,
    })
    const screen = (color = '#0b0d10'): Paint => ({
      color, spec: 0.5, glow: 0.18,
    })
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
      }, this.scene)
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
      }, this.scene)
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
      const m = CreateSphere(name, { diameter: 1, segments: 14 }, this.scene)
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
      }, this.scene)
      m.parent = parent
      m.rotation.z = Math.PI / 2
      // Капсула: диаметр 1, полная длина 1.5 по локальной Y; после поворота
      // на 90° длина идёт по X. Раньше масштаб был в миллиметрах и с
      // перепутанными осями — подушки и одеяла уходили сквозь пол.
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
      }, this.scene)
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

    for (const p of props) {
      const root = new TransformNode(`prop:${p.id}`, this.scene)
      this.propRoots.set(p.id, root)
      root.parent = this.propsRoot
      root.position.set(p.x * MM, (p.z || 0) * MM, p.y * MM)
      root.rotation.y = (-(p.rot || 0) * Math.PI) / 180
      const w = p.w, d = p.d, h = p.h
      const c = p.color || '#8b8f95'
      const a = p.accent || shade(c, 1.18)
      const dark = shade(c, 0.62)
      const type = p.type

      if (type === 'bed') {
        const frame = wood(c)
        legs(root, 'bed-leg', w, d, 110, 90, metal(dark), 56)
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
      } else if (type === 'sofa' || type === 'armchair') {
        const n = type === 'armchair' ? 1 : 3
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
      } else if (type === 'chair') {
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
      } else if (type === 'coffee-table' || type === 'dresser') {
        if (type === 'dresser') {
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
        } else {
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
      } else if (type === 'tv') {
        add(root, 'tv-frame', w, h * 0.76, 55, 0, 0, h * 0.58,
          paint('#26292d'))
        add(root, 'tv-screen', w - 34, h * 0.76 - 34, 14, 0, -32,
          h * 0.58, screen())
        add(root, 'tv-neck', 90, h * 0.2, 60, 0, 0, h * 0.15,
          metal('#2c3034'))
        add(root, 'tv-foot', Math.max(420, w * 0.34), 26, 260, 0, 0, 13,
          metal('#2c3034'))
        add(root, 'tv-bar', w * 0.5, 22, 40, 0, -10, 8, paint('#17191c'))
      } else if (type === 'rug') {
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
      } else if (type === 'bathtub') {
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
      } else if (type === 'toilet') {
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
      } else if (type === 'vanity') {
        const legH = 60
        const bodyH = h - 120
        add(root, 'vanity-plinth', w - 20, legH, d - 20, 0, 0, legH / 2,
          wood(dark))
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
      } else if (type === 'shower') {
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
      } else if (type === 'plant') {
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
      } else if (type === 'hood') {
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
      } else if (type === 'lamp') {
        cyl(root, 'lamp-base', w * 0.56, 32, 0, 0, 16, metal('#3a3d40'))
        cyl(root, 'lamp-pole', 26, h * 0.78, 0, 0, h * 0.43,
          metal('#6f767b'))
        cyl(root, 'lamp-shade', w * 0.78, h * 0.17, 0, 0, h * 0.87,
          { color: a, spec: 0.05, glow: 0.35 }, w * 0.5)
        cyl(root, 'lamp-glow', w * 0.58, 8, 0, 0, h * 0.79,
          { color: '#ffe6b0', spec: 0.1, glow: 0.95 })
      } else if (type === 'fridge') {
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
      } else if (type === 'stove') {
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
      } else if (type === 'sink') {
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

      // Тени только от крупных деталей: сотни мелких болванок роняют FPS.
      for (const m of root.getChildMeshes()) {
        // Декор выбирается мышью: id нужен для панели свойств.
        m.isPickable = true
        m.metadata = { type: 'prop', propId: p.id }
        const mat = m.material as StandardMaterial | null
        if (!mat || mat.alpha < 0.99) continue
        m.computeWorldMatrix(true)
        const e = m.getBoundingInfo().boundingBox.extendSizeWorld
        if (8 * e.x * e.y * e.z > 0.012) this.shadow.addShadowCaster(m)
      }
    }
    if (this.isClay()) this.applyClayMaterials()
    // Новые кастеры появляются после первого рендера карты теней.
    // Без сброса Babylon может перерисовывать её каждый кадр.
    const sm = this.shadow.getShadowMap()
    if (sm) {
      sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
      sm.resetRefreshCounter()
    }
  }

  /** Показывать только модули выбранной комнаты (папки). */
  setVisibleInstances(ids: Set<string> | null): void {
    this.visibleIds = ids && ids.size ? new Set(ids) : null
    this.applyInstanceVisibility()
  }

  /** Показывать только декор текущей комнаты. */
  setVisibleProps(ids: Set<string> | null): void {
    this.visiblePropIds = ids && ids.size ? new Set(ids) : null
    this.applyPropVisibility()
  }

  private applyPropVisibility(): void {
    if (this.objectId) return
    for (const [id, root] of this.propRoots) {
      root.setEnabled(!this.visiblePropIds || this.visiblePropIds.has(id))
    }
  }

  private applyInstanceVisibility(): void {
    if (this.objectId) return
    for (const [id, root] of this.roots) {
      root.setEnabled(!this.visibleIds || this.visibleIds.has(id))
    }
    this.applyPropVisibility()
  }

  /** Текущее положение «человека» в плане, мм. */
  walkerPosition(): { x: number; y: number; yaw: number; eye: number } | null {
    if (this.mode === 'orbit') return null
    return {
      x: this.walk.position.x / MM,
      y: this.walk.position.z / MM,
      yaw: (this.walk.rotation.y * 180) / Math.PI,
      eye: this.walk.position.y,
    }
  }

  /** Сколько мешей сейчас в сцене (для HUD производительности). */
  meshCount(): number {
    return this.scene.meshes.length
  }

  private lowWalls = false
  private lastDraws = 0
  private lastFrameId = 0

  /** Метрики сцены для замера производительности (не зависят от GPU). */
  perfStats(): {
    meshes: number; active: number; materials: number; textures: number;
    triangles: number; drawCalls: number; renderer: string;
  } {
    const scene = this.scene
    let triangles = 0
    for (const m of scene.meshes) {
      const total = m.getTotalIndices?.() ?? 0
      if (total > 0) triangles += total / 3
    }
    const engine = scene.getEngine() as unknown as {
      _drawCalls?: { current?: number }
    }
    let renderer = ''
    try {
      const gl = engine as unknown as {
        _gl?: WebGL2RenderingContext | WebGLRenderingContext
      }
      const ctx = gl._gl
      if (ctx) {
        const ext = ctx.getExtension('WEBGL_debug_renderer_info')
        renderer = String(ctx.getParameter(
          ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER,
        ) || '')
      }
    } catch {
      renderer = ''
    }
    // _drawCalls.current — накопительный счётчик; приводим к «на кадр».
    const frameId = scene.getFrameId()
    const frames = Math.max(1, frameId - (this.lastFrameId || frameId - 1))
    const perFrame = Math.max(0, (engine._drawCalls?.current ?? 0) - this.lastDraws)
    this.lastDraws = engine._drawCalls?.current ?? 0
    this.lastFrameId = frameId
    return {
      meshes: scene.meshes.length,
      active: scene.getActiveMeshes().length,
      materials: scene.materials.length,
      textures: scene.textures.length,
      triangles: Math.round(triangles),
      drawCalls: Math.round(perFrame / frames),
      renderer,
    }
  }

  /** Ограничить нагрузку на слабом GPU. */
  setPerformance(weak: boolean): void {
    this.engine.setHardwareScalingLevel(weak ? 1.35 : 1)
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
        this.rebuildInstance(inst, root, objs, derived[inst.id]?.operations ?? [])
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
      this.partsByInst.delete(id)
    }
    this.animDirty = true
    if (rebuilt || matsSig !== this.matsSig) {
      this.matsSig = matsSig
      this.applyMaterials(instances, derived, materials, materialVars)
      if (this.isClay()) this.applyClayMaterials()
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

  /** Показать/скрыть ручки и другую фурнитуру в 3D. */
  setHardwareVisible(visible: boolean): void {
    this.hardwareVisible = visible
    for (const root of this.roots.values()) {
      for (const mesh of root.getChildMeshes()) {
        if (mesh.metadata?.hardware) mesh.setEnabled(visible)
      }
    }
  }

  private rebuildInstance(
    inst: Instance,
    root: TransformNode,
    objs: SceneObject[],
    operations: AssemblyOperation[] = [],
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
    this.partsByInst.delete(inst.id)
    root.getChildMeshes().forEach((m) => m.dispose())
    for (const k of [...this.materials.keys()]) {
      if (!k.startsWith(`${inst.id}:`)) continue
      this.materials.get(k)?.dispose()
      this.materials.delete(k)
    }
    const handleHoles = new Map<string, { x: number; y: number }[]>()
    for (const op of operations) {
      if (op.kind !== 'handle' || !op.part) continue
      const list = handleHoles.get(op.part) ?? []
      list.push({ x: op.x, y: op.y })
      handleHoles.set(op.part, list)
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
      // Временный материал до applyMaterials; один на все детали,
      // иначе кэш растёт на каждый модуль и роль.
      mesh.material = this.materialFor('part-default')
      // Рёбра — самая дорогая часть сборки (лишняя геометрия на каждую
      // деталь). Рисуем их только у крупных деталей: на телефоне сборка
      // сцены из-за них занимала секунды.
      if (['corpus', 'facade', 'worktop', 'plinth'].includes(o.role || 'corpus')
        && o.kind !== 'drawer' && o.kind !== 'leg') {
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
      const keys = this.partsByInst.get(inst.id) ?? []
      keys.push(key)
      this.partsByInst.set(inst.id, keys)
      // Ручка: две операции kind=handle дают межцентровое и высоту.
      // Меш — ребёнок двери/фасада, поэтому ручка едет вместе с открытием.
      const holes = o.op_part ? handleHoles.get(o.op_part) : undefined
      if ((o.kind === 'door' || o.kind === 'drawerfront') && holes?.length) {
        const xs = holes.map((h) => h.x)
        const left = Math.min(...xs)
        const right = Math.max(...xs)
        const y = holes.reduce((sum, h) => sum + h.y, 0) / holes.length
        const length = Math.max(64, right - left + 40)
        const hm = this.hardwareMaterial()
        const handle = CreateBox(
          `${key}:handle`,
          {
            width: length * MM,
            height: 16 * MM,
            depth: 20 * MM,
          },
          this.scene,
        )
        handle.parent = mesh
        handle.position.set(
          ((left + right) / 2 - o.sx / 2) * MM,
          (-o.sy / 2 - 14) * MM,
          (y - o.sz / 2) * MM,
        )
        handle.material = hm
        handle.isPickable = false
        handle.metadata = { instanceId: inst.id, part, hardware: true }
        handle.setEnabled(this.hardwareVisible)
      }
      if (this.quality === 'realistic' &&
        ['corpus', 'facade', 'worktop', 'plinth'].includes(o.role || 'corpus')) {
        this.shadow.addShadowCaster(mesh)
      }
      if (o.role === 'facade') {
        mesh.edgesColor = new Color4(0.06, 0.07, 0.08, 0.8)
      }
    })
  }

  /** Металл ручек: общий кэш, чтобы clay мог вернуть его после выхода. */
  private hardwareMaterial(): StandardMaterial {
    const hm = this.materialFor('hardware')
    hm.diffuseColor = matColor('#aeb6bc')
    hm.specularColor = new Color3(0.55, 0.6, 0.64)
    hm.roughness = 0.35
    return hm
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

  /** Процедурная текстура для материала без загруженного фото. */
  private proceduralTexture(
    src: SurfaceMaterial,
    repeat: number,
  ): DynamicTexture | null {
    const canvas = textureFor(src)
    if (!canvas) return null
    const key = `${src.pattern}|${src.color}|${src.accent || ''}|${repeat}`
    const hit = this.procTextures.get(key)
    if (hit) return hit
    const tex = new DynamicTexture(
      key,
      { width: canvas.width, height: canvas.height },
      this.scene,
      true,
    )
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
    ctx.drawImage(canvas, 0, 0)
    tex.update()
    tex.wrapU = Texture.WRAP_ADDRESSMODE
    tex.wrapV = Texture.WRAP_ADDRESSMODE
    tex.uScale = repeat
    tex.vScale = repeat
    this.procTextures.set(key, tex)
    return tex
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

  private isClay(): boolean {
    return this.quality === 'schematic' || this.quality === 'blueprint'
  }

  private clayTone(role?: string): number {
    if (role === 'facade' || role === 'door') return 1
    if (role === 'worktop') return 2
    if (!role) return 3
    return 0
  }

  /** Серый clay-шейдер «Каркаса» и «Чертежа»: мягкий градиент, без цвета. */
  private clayMaterial(tone = 0): ShaderMaterial {
    const key = `bp:${tone}`
    const cached = this.clayMats.get(key)
    if (cached) return cached
    if (!Effect.ShadersStore['furnitureClayVertexShader']) {
      Effect.ShadersStore['furnitureClayVertexShader'] = `
        precision highp float;
        attribute vec3 position;
        attribute vec3 normal;
        uniform mat4 world;
        uniform mat4 worldViewProjection;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec4 wp = world * vec4(position, 1.0);
          vWorld = wp.xyz;
          vNormal = normalize(mat3(world) * normal);
          gl_Position = worldViewProjection * vec4(position, 1.0);
        }
      `
      Effect.ShadersStore['furnitureClayFragmentShader'] = `
        precision highp float;
        varying vec3 vNormal;
        varying vec3 vWorld;
        uniform vec3 uBase;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 L = normalize(vec3(-0.45, 0.85, 0.55));
          float diff = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
          float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
          float grad = clamp(vWorld.y * 0.24 + 0.72, 0.5, 1.0);
          vec3 col = uBase * (0.46 + 0.54 * diff);
          col *= mix(0.88, 1.07, sky);
          col *= grad;
          col += vec3(0.05, 0.05, 0.05) * (1.0 - diff);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    }
    const palette = [
      new Color3(0.80, 0.80, 0.80),
      new Color3(0.72, 0.72, 0.72),
      new Color3(0.87, 0.87, 0.87),
      new Color3(0.76, 0.76, 0.76),
      new Color3(0.90, 0.90, 0.90),
      new Color3(0.78, 0.78, 0.78),
    ]
    const mat = new ShaderMaterial(key, this.scene, 'furnitureClay', {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'worldViewProjection', 'uBase'],
    })
    mat.setColor3('uBase', palette[Math.max(0, Math.min(5, tone))])
    mat.backFaceCulling = true
    this.clayMats.set(key, mat)
    return mat
  }

  /** Разложить clay-материалы и тонкие контуры по мешам сцены. */
  private applyClayMaterials(): void {
    const skip = new Set<Mesh>([this.selectionBox])
    const partMeshes = new Set(this.parts.values())
    const roleByMesh = new Map<Mesh, string>()
    for (const [key, mesh] of this.parts) {
      const role = this.partMeta.get(key)?.role
      roleByMesh.set(mesh, role ? (ROLE_MAT[role] || role) : 'corpus')
    }
    for (const m of this.scene.meshes) {
      if (!(m instanceof Mesh) || skip.has(m)) continue
      if (m.name.startsWith('sink-stream:')) continue
      let tone = 0
      if (m.name === 'wall' || m.name === 'ceiling') tone = 4
      else if (m.name === 'floor') tone = 5
      else tone = this.clayTone(roleByMesh.get(m))
      m.material = this.clayMaterial(tone)
      m.receiveShadows = false
      const role = roleByMesh.get(m)
      const wantEdges = m.name === 'wall' || (partMeshes.has(m) &&
        (role === 'corpus' || role === 'facade' || role === 'worktop'))
      if (wantEdges) {
        if (!m.edgesRenderer) m.enableEdgesRendering(0.999)
        m.edgesWidth = 0.9
        m.edgesColor = new Color4(0.22, 0.24, 0.26, 0.85)
      } else if (m.edgesRenderer) {
        m.disableEdgesRendering()
      }
    }
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
        if (this.isClay()) {
          mesh.material = this.clayMaterial(this.clayTone(mk))
          mesh.receiveShadows = false
          continue
        }
        // Ручки — дочерние меши детали: clay перекрашивает и их, поэтому
        // при выходе из clay возвращаем металл, даже если материал детали
        // не менялся (sig совпал).
        for (const child of mesh.getChildMeshes()) {
          if (child.metadata?.hardware) {
            child.material = this.hardwareMaterial()
            child.receiveShadows = true
          }
        }
        const textured = !!src?.texture
        const face = Math.max(meta.base.sx, meta.base.sz, meta.base.sy)
        const repeat = face / (src?.texScale || 600)
        // Материал общий по содержимому (цвет + текстура + повтор), а не по
        // детали: иначе 300+ материалов = 300+ состояний и медленный рендер.
        const qRepeat = src?.pattern === 'solid' || !src
          ? 0
          : Math.max(0.25, Math.round(repeat * 2) / 2)
        const matKey = `r|${src?.pattern || 'solid'}|${src?.color || ''}|` +
          `${src?.accent || ''}|${src?.texture || ''}|${qRepeat}`
        const fa = this.materialFor(matKey)
        const sig = (fa as StandardMaterial & { __sig?: string }).__sig
        if (sig === matKey) {
          mesh.material = fa
          continue
        }
        ;(fa as StandardMaterial & { __sig?: string }).__sig = matKey
        const texture = textured && src?.texture
          ? this.textureFor(src.texture, repeat)
          : src
            ? this.proceduralTexture(src, repeat)
            : null
        // Текстура уже содержит цвет; белый diffuse не затемняет её.
        fa.diffuseColor = texture
          ? new Color3(1, 1, 1)
          : matColor(src?.color || '#999999')
        fa.emissiveColor = matColor(src?.accent || src?.color || '#222222').scale(0.06)
        fa.diffuseTexture = texture
        mesh.material = fa
        fa.markAsDirty(Material.AllDirtyFlag)
      }
    }
  }

  private buildRoom(room: Room, materials: Materials): void {
    const pts = outlinePoints(room)
    // В «Каркасе»/«Чертеже» не создаём текстуры комнаты.
    const schematic = this.quality === 'schematic' || this.quality === 'blueprint'
    const floorMat = this.materialFor('floor')
    const fm = materials.floor
    const floorTex = !schematic && fm
      ? this.proceduralTexture(
          fm,
          Math.max(2, Math.max(room.w, room.d) / (fm.texScale || 1000)),
        )
      : null
    floorMat.diffuseColor = floorTex
      ? new Color3(1, 1, 1)
      : matColor(schematic ? '#aeb2b6' : (fm?.color || '#8b7a63'))
    floorMat.diffuseTexture = floorTex
    floorMat.specularColor = new Color3(0.02, 0.02, 0.02)
    floorMat.roughness = 0.9
    floorMat.backFaceCulling = true
    // Низ цоколя и пол тоже совпадают по плоскости — уводим пол на 1 unit.
    floorMat.zOffset = 1
    floorMat.zOffsetUnits = 1
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
    wallMat.backFaceCulling = true
    // Стена и задняя стенка модуля стоят в одной плоскости: без смещения
    // глубины на стыке мерцает текстура («мебель входит в стену»).
    wallMat.zOffset = 1
    wallMat.zOffsetUnits = 1
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
      merged.metadata = {
        type: 'wall',
        wallIndex: seg.index,
        // Нужен прогулке: по сегменту считается расстояние до стены и
        // попадание в проём (открытая дверь — проход, закрытая — нет).
        seg: {
          ax: seg.a.x, ay: seg.a.y,
          bx: seg.b.x, by: seg.b.y,
          t: wallT,
        },
      }
      this.walls.push({
        mesh: merged,
        normal: { x: seg.nx, y: seg.ny },
        index: seg.index,
        a: { x: seg.a.x, y: seg.a.y },
        b: { x: seg.b.x, y: seg.b.y },
        t: wallT,
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
    // В прогулке стены всегда на месте: иначе «разрез» прячет их
    // и кажется, что камера проходит сквозь текстуры.
    if (this.mode === 'first') {
      for (const w of this.walls) w.mesh.setEnabled(true)
      this.ceilingMesh?.setEnabled(true)
      return
    }
    if (this.wallMode === 'low') {
      // «Низкие стены»: не просто показать все, а реально опустить их,
      // иначе снаружи стена закрывает комнату (серый экран).
      // roomH уже в миллиметрах.
      if (!this.lowWalls) {
        this.lowWalls = true
        const low = Math.min(1, 1100 / Math.max(1, this.roomH))
        for (const w of this.walls) {
          w.mesh.scaling.y = low
          // Мерж-меши у стен с проёмами имеют разный «нуль»: после сжатия
          // выравниваем низ каждой стены по полу.
          w.mesh.computeWorldMatrix(true)
          const minY = w.mesh.getBoundingInfo().boundingBox.minimumWorld.y
          w.mesh.position.y -= minY
        }
      }
      for (const w of this.walls) w.mesh.setEnabled(true)
      this.ceilingMesh?.setEnabled(false)
      return
    }
    if (this.lowWalls) {
      this.lowWalls = false
      for (const w of this.walls) {
        w.mesh.scaling.y = 1
        w.mesh.position.y = 0
      }
    }
    for (const w of this.walls) {
      w.mesh.scaling.y = 1
      const dir = cam.position.subtract(w.center)
      const facing = w.normal.x * dir.x + w.normal.y * dir.z
      // стена, обращённая к камере, прячется в разрезе
      w.mesh.setEnabled(facing > -0.25)
    }
  }

  /** Пересчитать видимость и анимации; можно звать точечно (флаги UI). */
  markAnimDirty(): void {
    this.animDirty = true
  }

  private tickAnim(): void {
    // Анимация идёт только у одного модуля за раз. Если ничего не играет
    // и правок не было — на кадре делать нечего: раньше здесь каждый кадр
    // обходились все части всех модулей (на Redmi это 25-60 % ядра).
    const playing = animState.playing
    if (this.wasPlaying && !playing) this.animDirty = true
    this.wasPlaying = playing
    if (!playing && !this.animDirty) return
    this.animDirty = false

    const targets = playing
      ? state.project.instances.filter((i) => i.id === animState.instanceId)
      : state.project.instances
    for (const inst of targets) {
      const keys = this.partsByInst.get(inst.id)
      if (!keys?.length) continue
      const objs = derived[inst.id]?.objects ?? []
      let hasDoors = false
      let doorOpen = false
      for (let part = 0; part < objs.length; part++) {
        if (objs[part].kind !== 'door') continue
        hasDoors = true
        if ((partAnimValues(inst, part)?.open ?? 0) > 1) doorOpen = true
      }
      for (const key of keys) {
        const meta = this.partMeta.get(key)
        const mesh = this.parts.get(key)
        if (!meta || !mesh) continue
        // Фасады показываем всегда, если пользователь явно не выключил
        // их кнопкой. Это одинаково для «Полного», «Каркаса» и «Чертежа».
        let on = ui.facades || meta.role !== 'facade'
        if (!on) {
          mesh.setEnabled(false)
          mesh.isPickable = false
        } else {
          if (meta.kind === 'drawerbox') {
            on = ui.facades
              ? ((partAnimValues(inst, meta.part)?.slide ?? 0) > 1)
              : true
          } else if (ui.facades && hasDoors && !doorOpen &&
            (meta.name.includes('Полка') || meta.name.includes('Перегородка'))) {
            on = false
          }
          mesh.setEnabled(on)
          mesh.isPickable = on
        }
        const anim = partAnimValues(inst, meta.part)
        if (!anim) continue
        if (meta.pivot) {
          const angle = (anim.open ?? 0) * (Math.PI / 180)
          meta.pivot.rotation.y = meta.hinge === 'left' ? angle : -angle
        }
        if (meta.kind === 'drawerfront' || meta.kind === 'drawerbox') {
          const slide = anim.slide ?? 0
          mesh.position.z = (meta.base.y + meta.base.sy / 2) * MM - slide * MM
        }
      }
    }
    if (this.selectedIds.size || this.selectedWall != null ||
        this.selectedOpening || this.selectedItem || this.selectedPart != null) {
      this.updateSelectionBox()
    }
  }

  setSelected(ids: string[] | string): void {
    this.selectedIds = new Set(Array.isArray(ids) ? ids : ids ? [ids] : [])
    if (this.selectedPartInst && !this.selectedIds.has(this.selectedPartInst)) {
      this.selectedPartInst = null
      this.selectedPart = null
    }
    this.selectedWall = null
    this.selectedItem = null
    this.selectedOpening = null
    this.selectedProp = null
    this.updateSelectionBox()
  }

  /** Выбрать конкретную деталь модуля (дверь, полку, боковину). */
  setSelectedPart(instanceId: string | null, part: number | null): void {
    this.selectedPartInst = part == null ? null : instanceId
    this.selectedPart = part
    this.updateSelectionBox()
  }

  setSelectedWall(index: number | null, itemId: string | null = null): void {
    this.selectedWall = index
    this.selectedItem = itemId
    this.selectedOpening = null
    this.selectedProp = null
    this.selectedIds = new Set()
    this.updateSelectionBox()
  }

  setSelectedOpening(id: string | null): void {
    this.selectedOpening = id
    this.selectedWall = null
    this.selectedItem = null
    this.selectedProp = null
    this.selectedIds = new Set()
    this.updateSelectionBox()
  }

  private selectionMeshes(): Mesh[] {
    // Деталь важнее модуля: подсвечиваем ровно её, а не весь корпус.
    if (this.selectedPartInst && this.selectedPart != null) {
      const m = this.parts.get(`${this.selectedPartInst}:${this.selectedPart}`)
      return m && m.isEnabled() ? [m] : []
    }
    if (this.selectedItem) {
      const m = this.wallItemMeshes.get(this.selectedItem)
      return m ? [m] : []
    }
    if (this.selectedWall != null) {
      const w = this.walls.find((x) => x.mesh.metadata?.wallIndex === this.selectedWall)
      return w ? [w.mesh] : []
    }
    if (this.selectedOpening) return this.openingMeshes.get(this.selectedOpening) ?? []
    if (this.selectedProp) {
      return this.selectedProp.getChildMeshes() as Mesh[]
    }
    const out: Mesh[] = []
    for (const id of this.selectedIds) {
      const root = this.roots.get(id)
      if (!root) continue
      for (const m of root.getChildMeshes()) if (m.isEnabled()) out.push(m as Mesh)
    }
    return out
  }

  private applySelectionGlow(_meshes: Mesh[]): void {
    // Цветную подсветку рёбер больше не рисуем: она перекрывала цветные
    // рёбра размеров и искажала вид детали. Выделение показывают экранная
    // рамка (и размеры, если включены). Метод оставлен, чтобы снять
    // подсветку, сохранённую в предыдущих версиях/кадрах.
    for (const [m, prev] of this.edgeSaved) {
      m.edgesWidth = prev.width
      m.edgesColor = prev.color
    }
    for (const [m, prev] of this.outlineSaved) {
      m.renderOutline = prev.on
      m.outlineColor = prev.color
      m.outlineWidth = prev.width
    }
    this.edgeSaved.clear()
    this.outlineSaved.clear()
  }

  private updateSelectionBox(): void {
    const meshes = this.selectionMeshes()
    this.applySelectionGlow(meshes)
    if (!meshes.length) {
      this.selectionBox.setEnabled(false)
      return
    }
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      // Без свежей мировой матрицы bounding boxWorld устаревший: объект
      // уезжал из кадра, а цель камеры оказывалась ниже центра.
      m.computeWorldMatrix(true)
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
    // С включёнными размерами объёмную рамку не показываем: она спорит
    // с цветными рёбрами размеров. Остаётся пунктирная экранная рамка.
    this.selectionBox.setEnabled(!ui.dims3d && !ui.dimsOuter)
  }

  setQuality(mode: 'realistic' | 'schematic' | 'blueprint'): void {
    const wasClay = this.isClay()
    this.quality = mode
    const schematic = mode === 'schematic'
    const blueprint = mode === 'blueprint'
    // Ограничиваем плотность пикселей: iPhone 13 отдаёт DPR 3, и canvas
    // рисуется в 9 раз больше площади. На глаз разницы с DPR 2 нет, а
    // заливка — главное узкое место на телефонах (docs/36).
    let dprCap = Math.max(1, (window.devicePixelRatio || 1) / 2)
    // Слабый телефон: ещё ниже плотность пикселей — заливка тут дороже всего.
    try {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      const cores = navigator.hardwareConcurrency || 8
      if (coarse && cores <= 6) dprCap = Math.max(dprCap, 1.5)
    } catch { /* ignore */ }
    this.engine.setHardwareScalingLevel(
      dprCap * (schematic || blueprint ? 1.25 : 1),
    )
    this.scene.shadowsEnabled = !schematic && !blueprint
    this.scene.imageProcessingConfiguration.contrast =
      blueprint ? 1.0 : schematic ? 1.0 : 1.12
    this.scene.imageProcessingConfiguration.exposure =
      blueprint ? 1.0 : schematic ? 1.0 : 1.05
    this.scene.clearColor = schematic || blueprint
      ? new Color4(0.905, 0.905, 0.9, 1)
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
    if (schematic || blueprint) this.applyClayMaterials()
    for (const m of this.parts.values()) {
      m.receiveShadows = !schematic && !blueprint
      m.edgesWidth = 0.9
    }
    if (wasClay && !schematic && !blueprint) {
      this.propSig = ''
      this.syncProps(state.project.props ?? [])
    }
    this.applyQualityToMeshes()
  }

  private applyQualityToMeshes(): void {
    const schematic = this.quality === 'schematic'
    const blueprint = this.quality === 'blueprint'
    for (const meta of this.partMeta.values()) {
      const key = `${meta.instanceId}:${meta.part}`
      const mesh = this.parts.get(key)
      if (!mesh) continue
      // Видимость фасадов решает ui.facades, а не режим отрисовки.
      mesh.setEnabled(ui.facades || meta.role !== 'facade')
    }
    for (const m of this.wallDecor) m.setEnabled(!schematic && !blueprint)
    if (this.isClay()) this.applyClayMaterials()
    this.markAnimDirty()
  }

  /** Включить/выключить чертёжный режим камеры (фиксированные ракурсы). */
  setBlueprint(on: boolean): void {
    this.camTween = null
    this.blueprint = on
    if (on) {
      this.setMode('orbit')
      this.orbit.detachControl()
      this.projection = 'ortho'
      this.applyProjection()
      this.setBlueprintPivot(this.bpPivot)
      this.setBlueprintView(this.bpView)
    } else {
      this.projection = 'persp'
      this.orbit.mode = Camera.PERSPECTIVE_CAMERA
      this.orbit.attachControl(this.canvas, true)
      this.applyProjection()
    }
  }

  setBlueprintView(name: 'iso' | 'front' | 'side' | 'top'): void {
    this.bpView = name
    const map = {
      iso: [(-34 * Math.PI) / 180, (90 - 30) * (Math.PI / 180)],
      front: [0, Math.PI / 2],
      side: [(-90 * Math.PI) / 180, Math.PI / 2],
      top: [0, 0.001],
    } as const
    const [alpha, beta] = map[name]
    this.orbit.alpha = alpha
    this.orbit.beta = beta
    this.projection = 'ortho'
    this.orbit.mode = Camera.ORTHOGRAPHIC_CAMERA
    this.updateOrtho()
  }

  setBlueprintPivot(kind: 'room' | 'object'): void {
    this.bpPivot = kind
    if (kind === 'object') {
      const id = [...this.selectedIds][0] ?? this.objectId
      const root = id ? this.roots.get(id) : null
      const meshes = root?.getChildMeshes() ?? []
      if (meshes.length) {
        let min = new Vector3(Infinity, Infinity, Infinity)
        let max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const m of meshes) {
          m.computeWorldMatrix(true)
          const bb = m.getBoundingInfo().boundingBox
          min = Vector3.Minimize(min, bb.minimumWorld)
          max = Vector3.Maximize(max, bb.maximumWorld)
        }
        const c = min.add(max).scale(0.5)
        this.orbit.target.copyFrom(c)
        const size = max.subtract(min)
        this.orbit.radius = Math.max(1.2, size.length() * 1.4)
        this.updateOrtho()
        return
      }
      // Нет выбранного объекта — работаем от комнаты, но не падаем.
      this.bpPivot = 'room'
    }
    const b = this.roomBounds
    this.orbit.target.set(
      ((b.minX + b.maxX) / 2),
      Math.min(1.4, (this.roomH * MM) / 2),
      ((b.minY + b.maxY) / 2),
    )
    this.orbit.radius = Math.max(2.4, Math.hypot(
      b.maxX - b.minX, b.maxY - b.minY, this.roomH * MM,
    ) * 0.84)
    this.updateOrtho()
  }

  blueprintZoom(factor: number): void {
    if (!this.blueprint) return
    this.orbit.radius = Math.min(40, Math.max(0.35, this.orbit.radius * factor))
    this.updateOrtho()
  }

  blueprintState(): {
    on: boolean
    view: 'iso' | 'front' | 'side' | 'top'
    pivot: 'room' | 'object'
  } {
    return { on: this.blueprint, view: this.bpView, pivot: this.bpPivot }
  }

  setWallMode(mode: 'cutaway' | 'low'): void {
    this.wallMode = mode
  }

  setOrbit(alphaDeg: number, betaDeg: number): void {
    this.camTween = null
    this.orbit.alpha = (alphaDeg * Math.PI) / 180
    this.orbit.beta = (betaDeg * Math.PI) / 180
  }

  /**
   * Режимы камеры: обзор и прогулка. Прогулка оставлена в коде, но в
   * интерфейсе отключена (см. docs/39-walk-disabled.md); свободный полёт
   * удалён — конфигуратору он не нужен.
   */
  setMode(mode: 'orbit' | 'first' | 'fly'): void {
    if (mode === this.mode) return
    this.camTween = null
    const from = this.mode
    this.mode = mode
    if (mode === 'orbit') {
      this.seated = null
      // Возвращаемся к обзору вокруг места, где была камера прогулки,
      // иначе орбита остаётся в старой точке и «прыгает» через комнату.
      if (from === 'first') {
        const fwd = this.walk.getDirection(new Vector3(0, 0, 1))
        const target = this.walk.position.add(fwd.scale(1.8))
        this.orbit.target.copyFrom(target)
        this.orbit.radius = Math.max(1.6, Math.min(6, this.orbit.radius))
        this.applyProjection()
      }
      this.scene.activeCamera = this.orbit
      this.orbit.attachControl(this.canvas, true)
      this.walk.detachControl()
    } else {
      // Ставим камеру в комнату, а не туда, где случайно оказалась орбита.
      const b = this.roomBounds
      const cx = (b.minX + b.maxX) / 2
      const cz = (b.minY + b.maxY) / 2
      const eye = mode === 'first' ? this.walkEye : 1.9
      if (from === 'orbit') {
        const dir = this.orbit.getDirection(new Vector3(0, 0, 1))
        dir.y = 0
        if (dir.lengthSquared() < 1e-8) dir.set(0, 0, -1)
        dir.normalize()
        this.walk.position.set(cx, eye, cz)
        this.walk.setTarget(new Vector3(
          cx + dir.x * 2.5, eye, cz + dir.z * 2.5,
        ))
      } else {
        this.walk.position.y = eye
      }
      this.seated = null
      this.walkGrounded = mode === 'first'
      this.walkVy = 0
      this.scene.activeCamera = this.walk
      this.orbit.detachControl()
      this.walk.attachControl(this.canvas, true)
    }
  }

  /** Поставить «человека» в точку комнаты (мм) с направлением взгляда. */
  placeWalker(xmm: number, ymm: number, yawDeg = 0, eye = 1.6): void {
    this.walkEye = eye
    this.seated = null
    this.walkGrounded = true
    this.walkVy = 0
    this.walk.position.set(xmm * MM, eye, ymm * MM)
    const a = (yawDeg * Math.PI) / 180
    this.walk.setTarget(new Vector3(
      xmm * MM + Math.sin(a) * 2,
      eye,
      ymm * MM + Math.cos(a) * 2,
    ))
    this.scene.activeCamera = this.walk
    this.orbit.detachControl()
    this.walk.attachControl(this.canvas, true)
    this.mode = 'first'
  }

  /** Стена/перегородка мешает пройти в точку (x,z) — мм. */
  private walkBlocked(xmm: number, ymm: number): boolean {
    const radius = 220
    for (const w of this.walls) {
      if (w.kind !== 'wall') continue
      // сегмент стены по центру: восстановим из нормали и центра нельзя,
      // поэтому используем сохранённый сегмент в metadata
      const seg = (w.mesh.metadata as {
        seg?: { ax: number; ay: number; bx: number; by: number; t: number }
      } | undefined)?.seg
      if (!seg) continue
      const dx = seg.bx - seg.ax
      const dy = seg.by - seg.ay
      const len2 = dx * dx + dy * dy
      if (len2 < 1) continue
      const t = Math.max(0, Math.min(1,
        ((xmm - seg.ax) * dx + (ymm - seg.ay) * dy) / len2))
      const px = seg.ax + dx * t
      const py = seg.ay + dy * t
      if (Math.hypot(xmm - px, ymm - py) > seg.t / 2 + radius) continue
      // проём: можно пройти
      const openings = state.project.room.openings ?? []
      const idx = (w.mesh.metadata as { wallIndex?: number }).wallIndex
      const along = t * Math.sqrt(len2)
      const inOpening = openings.some((o) => {
        if (Number(o.wall) !== idx) return false
        if (along < Number(o.x) + 60) return false
        if (along > Number(o.x) + Number(o.w) - 60) return false
        if (o.kind === 'arch') return true
        // Закрытая дверь (angle < 30°) — препятствие, открытая — проход.
        return o.kind === 'door' && (Number(o.angle ?? 80) > 30)
      })
      if (!inOpening) return true
    }
    return false
  }

  /**
   * Границы прогулки: прямоугольник текущей комнаты и препятствия
   * (мебель/декор) в плане, мм. Пустой rect отключает ограничение.
   */
  setWalkArea(
    rect: { x: number; y: number; w: number; d: number } | null,
    obstacles: { x: number; y: number; w: number; d: number }[] = [],
    name = '',
  ): void {
    this.walkRect = rect
    this.walkObstacles = obstacles
    this.walkRoomName = name
  }

  /** Имя комнаты под камерой прогулки (для HUD). */
  currentRoomName(): string {
    return this.walkRoomName
  }

  private walkBlockedByRoom(xmm: number, ymm: number): boolean {
    const r = this.walkRect
    if (!r) return false
    const pad = this.walkRadius
    return (
      xmm < r.x + pad ||
      xmm > r.x + r.w - pad ||
      ymm < r.y + pad ||
      ymm > r.y + r.d - pad
    )
  }

  private walkBlockedByFurniture(xmm: number, ymm: number): boolean {
    const pad = this.walkRadius
    for (const o of this.walkObstacles) {
      if (
        xmm > o.x - pad && xmm < o.x + o.w + pad &&
        ymm > o.y - pad && ymm < o.y + o.d + pad
      ) return true
    }
    return false
  }

  /** Можно ли поставить камеру в точку (мм) — для спавна/подсказок. */
  canStandAt(xmm: number, ymm: number): boolean {
    return this.canStand(xmm, ymm)
  }

  private canStand(xmm: number, ymm: number): boolean {
    // «Прогулка» — человек: комната, мебель и стены (режим отключён в UI).
    if (this.mode === 'first') {
      if (this.walkBlockedByRoom(xmm, ymm)) return false
      if (this.walkBlockedByFurniture(xmm, ymm)) return false
    }
    return !this.walkBlocked(xmm, ymm)
  }

  /**
   * Движение камеры от джойстика/клавиш.
   * forward/strafe/vertical — −1…1, dt — секунды.
   * В обзоре сдвигается цель орбиты, в прогулке/полёте — сама камера.
   */
  moveCamera(
    forward: number,
    strafe: number,
    vertical: number,
    dt: number,
    fast = false,
  ): void {
    if (this.seated) return
    const f = Math.max(-1, Math.min(1, forward))
    const s = Math.max(-1, Math.min(1, strafe))
    const v = Math.max(-1, Math.min(1, vertical))
    if (!f && !s && !v) return
    const speed = (this.mode === 'orbit' ? 1.8 : this.mode === 'fly' ? 3.4 : 2.4) * (fast ? 2.2 : 1)
    const step = speed * Math.min(0.05, Math.max(0, dt))

    if (this.mode === 'orbit') {
      const fwd = this.orbit.target.subtract(this.orbit.position)
      fwd.y = 0
      if (fwd.lengthSquared() < 1e-8) fwd.set(0, 0, 1)
      fwd.normalize()
      // right = up × forward. Для взгляда на −Z это −X, т.е. именно
      // экранная правая сторона (раньше здесь был обратный вектор).
      const right = new Vector3(fwd.z, 0, -fwd.x)
      this.orbit.target.addInPlace(fwd.scale(f * step))
      this.orbit.target.addInPlace(right.scale(s * step))
      this.orbit.target.y = Math.min(
        Math.max(0.05, this.roomH + 2),
        Math.max(0.05, this.orbit.target.y + v * step),
      )
      // Замыкаем вид в комнате: цель орбиты не уезжает за её стены.
      const wr = this.walkRect
      if (wr) {
        const pad = 150 * MM
        this.orbit.target.x = Math.min(
          Math.max(wr.x * MM + pad, this.orbit.target.x),
          (wr.x + wr.w) * MM - pad,
        )
        this.orbit.target.z = Math.min(
          Math.max(wr.y * MM + pad, this.orbit.target.z),
          (wr.y + wr.d) * MM - pad,
        )
      }
      this.applyProjection()
      return
    }

    const fwd = this.walk.getDirection(new Vector3(0, 0, 1))
    fwd.y = 0
    if (fwd.lengthSquared() < 1e-8) fwd.set(0, 0, 1)
    fwd.normalize()
    const right = this.walk.getDirection(new Vector3(1, 0, 0))
    right.y = 0
    if (right.lengthSquared() < 1e-8) right.set(1, 0, 0)
    right.normalize()

    // Скользим вдоль стены/мебели: сначала полный шаг, затем только по X
    // или только по Z. Так камера не застревает на углах.
    const dx = f * step * fwd.x + s * step * right.x
    const dz = f * step * fwd.z + s * step * right.z
    const px = this.walk.position.x
    const pz = this.walk.position.z
    const free = (mx: number, mz: number) => this.canStand(
      (px + mx) / MM, (pz + mz) / MM)
    if (free(dx, dz)) {
      this.walk.position.x = px + dx
      this.walk.position.z = pz + dz
    } else if (Math.abs(dx) > 1e-6 && free(dx, 0)) {
      this.walk.position.x = px + dx
    } else if (Math.abs(dz) > 1e-6 && free(0, dz)) {
      this.walk.position.z = pz + dz
    }
    if (this.mode === 'fly') {
      this.walk.position.y = Math.min(
        Math.max(0.12, this.roomH + 3),
        Math.max(0.12, this.walk.position.y + v * step),
      )
    } else if (this.walkGrounded) {
      // Высоту в прогулке ведёт гравитация (прыжок), а не кнопки.
      this.walk.position.y = this.walkEye
    }
  }

  /** Мышиный обзор в прогулке: без зажатой кнопки, сразу за курсором. */
  look(dx: number, dy: number): void {
    if (this.seated) {
      this.walk.rotation.y += dx * 0.0021
      this.walk.rotation.x = Math.min(1.35, Math.max(-1.35,
        this.walk.rotation.x + dy * 0.0021))
      return
    }
    if (this.mode !== 'first' && this.mode !== 'fly') return
    this.walk.rotation.y += dx * 0.0021
    // rotation.x положительный — взгляд вниз; ограничиваем, чтобы не
    // переворачивалась камера.
    this.walk.rotation.x = Math.min(1.35, Math.max(-1.35,
      this.walk.rotation.x + dy * 0.0021))
  }

  /** Прыжок в прогулке (пробел). */
  jump(): void {
    if (this.mode !== 'first' || this.seated) return
    if (!this.walkGrounded) return
    this.walkVy = 3.6
    this.walkGrounded = false
  }

  private tickWalk(): void {
    if (this.mode !== 'first' || this.seated) return
    if (!this.walkGrounded) {
      const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000)
      this.walkVy -= 9.81 * dt
      this.walk.position.y += this.walkVy * dt
      if (this.walk.position.y <= this.walkEye) {
        this.walk.position.y = this.walkEye
        this.walkVy = 0
        this.walkGrounded = true
      }
    } else if (Math.abs(this.walk.position.y - this.walkEye) > 1e-4) {
      this.walk.position.y = this.walkEye
    }
  }

  /** Сесть/лечь: камера на уровне сидящего/лежащего, взгляд свободный. */
  sitAt(xmm: number, ymm: number, yawDeg: number, eye: number, id: string, kind: string): void {
    this.seated = { id, kind, eye }
    this.walkGrounded = true
    this.walkVy = 0
    this.walk.position.set(xmm * MM, eye, ymm * MM)
    const a = (yawDeg * Math.PI) / 180
    this.walk.setTarget(new Vector3(
      xmm * MM + Math.sin(a) * 2,
      eye + (kind === 'bed' ? 0.32 : 0),
      ymm * MM + Math.cos(a) * 2,
    ))
    // Лёжа смотрим вверх, а не в пол.
    if (kind === 'bed') this.walk.rotation.x = -0.95
    this.scene.activeCamera = this.walk
  }

  standUp(): void {
    if (!this.seated) return
    this.seated = null
    this.walk.position.y = this.walkEye
    this.walkGrounded = true
    this.walkVy = 0
  }

  isSeated(): boolean {
    return !!this.seated
  }

  seatedId(): string | null {
    return this.seated?.id ?? null
  }

  setWalkFov(deg: number): void {
    this.walkFov = Math.min(1.35, Math.max(0.65, (deg * Math.PI) / 180))
    this.walk.fov = this.walkFov
  }

  walkFovDeg(): number {
    return Math.round((this.walkFov * 180) / Math.PI)
  }

  /** Включить/выключить светильник-декор. */
  toggleLamp(id: string, x: number, y: number, z: number): boolean {
    let rec = this.lampLights.get(id)
    if (!rec) {
      const light = new PointLight(`lamp:${id}`, new Vector3(x * MM, z * MM, y * MM), this.scene)
      light.intensity = 0.65
      light.range = 4.5
      light.diffuse = new Color3(1, 0.86, 0.62)
      rec = { light, on: false }
      this.lampLights.set(id, rec)
    }
    rec.on = !rec.on
    rec.light.setEnabled(rec.on)
    return rec.on
  }

  isLampOn(id: string): boolean {
    return this.lampLights.get(id)?.on ?? false
  }

  /** Кран: тонкая струя воды из излива. */
  toggleSink(id: string, x: number, y: number, z: number): boolean {
    const cur = this.sinkStreams.get(id)
    if (cur) {
      const on = !cur.isEnabled()
      cur.setEnabled(on)
      return on
    }
    const m = CreateCylinder(`sink-stream:${id}`, {
      diameter: 0.012, height: 0.22, tessellation: 10,
    }, this.scene)
    m.position.set(x * MM, (z + 60) * MM, y * MM)
    const mat = this.materialFor('water')
    mat.diffuseColor = new Color3(0.55, 0.78, 0.92)
    mat.emissiveColor = new Color3(0.25, 0.42, 0.55)
    mat.alpha = 0.55
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND
    m.material = mat
    m.isPickable = false
    this.sinkStreams.set(id, m)
    return true
  }

  isSinkOn(id: string): boolean {
    return this.sinkStreams.get(id)?.isEnabled() ?? false
  }

  /** Выключатель: общий свет комнаты. */
  toggleRoomLight(): boolean {
    this.roomLightOn = !this.roomLightOn
    if (this.hemi) this.hemi.intensity = this.roomLightOn ? 0.98 : 0.12
    if (this.dir) this.dir.intensity = this.roomLightOn ? 0.72 : 0.06
    return this.roomLightOn
  }

  roomLightIsOn(): boolean {
    return this.roomLightOn
  }

  /** Плавно поднять/опустить камеру на заданную высоту (для кнопок «сброс»). */
  setCameraHeight(y: number): void {
    if (this.mode === 'orbit') {
      this.orbit.target.y = Math.max(0.05, y)
      this.applyProjection()
    } else {
      this.walk.position.y = Math.max(0.12, y)
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

  /** Ось вращения обзора в точку (мм), если меши ещё не собраны. */
  setOrbitTarget(xmm: number, ymm: number, zmm: number): void {
    this.setMode('orbit')
    this.orbit.target.set(xmm * MM, zmm * MM, ymm * MM)
    this.applyProjection()
  }

  /** Ось вращения обзора — центр прямоугольной зоны (комнаты). */
  setPivotArea(a: { x: number; y: number; w: number; d: number }): void {
    this.setMode('orbit')
    this.orbit.target.set(
      (a.x + a.w / 2) * MM,
      Math.min(1.3, (this.roomH * MM) / 2),
      (a.y + a.d / 2) * MM,
    )
    this.applyProjection()
  }

  /** Ось вращения обзора — центр комнаты (или выбранной папки). */
  setPivotRoom(room: Room): void {
    const pts = outlinePoints(room)
    const b = pts.reduce(
      (a, p) => ({
        minX: Math.min(a.minX, p.x), maxX: Math.max(a.maxX, p.x),
        minY: Math.min(a.minY, p.y), maxY: Math.max(a.maxY, p.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    )
    this.setMode('orbit')
    this.orbit.target.set(
      ((b.minX + b.maxX) / 2) * MM,
      Math.min(1.3, room.h / 2000),
      ((b.minY + b.maxY) / 2) * MM,
    )
    this.applyProjection()
  }

  /** Ось вращения обзора — центр выбранного объекта мебели. */
  setPivotObject(instanceId: string): boolean {
    const root = this.roots.get(instanceId)
    const meshes = root?.getChildMeshes() ?? []
    if (!meshes.length) return false
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
    if (!Number.isFinite(min.x)) return false
    this.bpPivot = 'object'
    this.setMode('orbit')
    this.orbit.target.copyFrom(min.add(max).scale(0.5))
    if (this.blueprint) {
      const size = max.subtract(min)
      this.orbit.radius = Math.max(1.2, size.length() * 1.45)
      this.updateOrtho()
    }
    this.applyProjection()
    return true
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
    this.camTween = null
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
    // Узкий экран телефона: горизонтальный угол меньше вертикального,
    // поэтому комнату считаем по обеим осям, иначе камера «внутри» сцены.
    const wpx = this.engine.getRenderWidth() || 1
    const hpx = this.engine.getRenderHeight() || 1
    const aspect = wpx / Math.max(1, hpx)
    const halfV = Math.tan(this.orbit.fov / 2)
    const halfH = halfV * Math.max(0.35, aspect)
    // diag в миллиметрах — радиус в метрах.
    const diagM = diag * MM
    const needed = Math.max(diagM / 2 / halfV, diagM / 2 / halfH) * 0.92
    // Не уезжаем за габарит комнаты: снаружи стены закрывают вид (серый
    // экран). На узком экране лучше показать часть комнаты изнутри, чем
    // внешнюю стену; пользователь может отъехать колесом.
    const radius = Math.min(needed, diagM * 1.7)
    this.orbit.radius = Math.max(2, radius)
    this.applyProjection()
  }

  /** Объектный режим: камера смотрит анфас, вращается вокруг объекта. */
  enterObjectMode(instanceId: string, leftFraction = 0.38): void {
    // В объектном режиме камера обязана вращаться, даже если пришли из
    // «Чертежа» с зафиксированной ортокамерой. Стиль не меняем.
    this.objectBp = this.blueprint
    if (this.blueprint) this.setBlueprint(false)
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
    // В объектном режиме можно подойти ближе, но не входить в деталь.
    this.orbit.lowerRadiusLimit = 0.12
    this.orbit.minZ = 0.01
    // В режиме детали комната и соседние модули только мешают: камера
    // подходит вплотную, и обратные стороны стен дают чёрные плоскости.
    this.roomRoot.setEnabled(false)
    this.propsRoot.setEnabled(false)
    for (const [id, root] of this.roots) {
      root.setEnabled(id === instanceId)
    }
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      // Без свежей мировой матрицы bounding boxWorld устаревший: объект
      // уезжал из кадра, а цель камеры оказывалась ниже центра.
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
    if (!Number.isFinite(min.x)) return
    const center = min.add(max).scale(0.5)
    const size = max.subtract(min)
    const wm = root.getWorldMatrix()
    // Фасад ищем по створкам: у повёрнутых модулей локальная ось не совпадает
    // с реальной стороной фасада, и камера оказывалась за спиной шкафа.
    const facadeSum = new Vector3(0, 0, 0)
    let facadeN = 0
    for (const m of meshes) {
      const part = (m.metadata as { part?: number } | null)?.part
      const meta = part != null ? this.partMeta.get(`${instanceId}:${part}`) : null
      if (!meta || meta.role !== 'facade') continue
      m.computeWorldMatrix(true)
      facadeSum.addInPlace(m.getBoundingInfo().boundingBox.centerWorld)
      facadeN++
    }
    let front = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize()
    if (facadeN) {
      const dir = facadeSum.scale(1 / facadeN).subtract(center)
      dir.y = 0
      if (dir.lengthSquared() > 1e-6) front = dir.normalize()
    }
    // Экранные оси считаем от направления камеры, а не от локальных осей
    // модуля: у повёрнутых на 180° модулей локальный +X смотрит в другую
    // сторону, и объект уезжал под панель конструктора.
    const worldUp = new Vector3(0, 1, 0)
    const right = Vector3.Cross(worldUp, front).normalize()
    const up = Vector3.Cross(front, right).normalize()
    // Объект должен занимать ~86% свободной (левой) области. Считаем
    // расстояние по ширине и высоте отдельно и добавляем глубину, чтобы
    // передняя грань не оказалась за near-плоскостью.
    this.projection = 'persp'
    this.applyProjection()
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight())
    const vfov = this.orbit.fov
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    const left = Math.min(0.95, Math.max(0.2, leftFraction))
    const availHfov = 2 * Math.atan(Math.tan(hfov / 2) * left)
    const fill = 0.86
    const dist = Math.max(
      (size.x / 2) / (Math.tan(availHfov / 2) * fill),
      (size.y / 2) / (Math.tan(vfov / 2) * fill),
      0.3,
    ) + size.z * 0.5 + 0.06

    // Сдвигаем цель так, чтобы центр объекта встал в центр свободной
    // (левой) части кадра. Сдвиг считаем по половине ширины кадра на
    // расстоянии dist; коэффициент 0.85 подобран замером (перспектива
    // сдвигает чуть меньше расчётного).
    // Канвас уже сужен до свободной части (см. setCanvasDock), поэтому
    // цель — ровно центр объекта: вращение идёт вокруг него.
    const target = center.clone()
    this.orbit.targetScreenOffset.set(0, 0)
    this.orbit.target.copyFrom(target)
    this.orbit.setPosition(target.add(front.scale(dist)))
    this.orbit.radius = dist
    this.applyProjection()
  }

  /** Зум в объектном режиме (кнопки на канвасе и колесо). */
  zoomBy(factor: number): void {
    const lo = this.orbit.lowerRadiusLimit ?? 0.12
    const hi = this.orbit.upperRadiusLimit ?? 40
    this.orbit.radius = Math.min(hi, Math.max(lo, this.orbit.radius * factor))
  }

  /** Вписать текущий объект в свободную часть кадра. */
  fitObject(): void {
    if (!this.objectId) return
    this.enterObjectMode(this.objectId, 1)
  }

  /** Приблизить конкретную деталь (длинная боковина и т.п.). */
  focusPart(instanceId: string, part: number): void {
    const mesh = this.parts.get(`${instanceId}:${part}`)
    if (!mesh) return
    if (this.objectId !== instanceId) this.enterObjectMode(instanceId, 1)
    mesh.computeWorldMatrix(true)
    const bb = mesh.getBoundingInfo().boundingBox
    const center = bb.centerWorld.clone()
    const radius = bb.maximumWorld.subtract(bb.minimumWorld).length() / 2
    const rw = this.engine.getRenderWidth() || 1
    const rh = this.engine.getRenderHeight() || 1
    const vf = this.orbit.fov
    const hf = 2 * Math.atan(Math.tan(vf / 2) * (rw / Math.max(1, rh)))
    const dist = Math.max(
      this.orbit.lowerRadiusLimit ?? 0.12,
      radius / Math.sin(Math.min(vf, hf) / 2) * 1.08,
    )
    const dir = this.orbit.position.subtract(this.orbit.target)
    if (dir.lengthSquared() < 1e-6) dir.set(0, 0, 1)
    dir.normalize()
    this.orbit.target.copyFrom(center)
    this.orbit.setPosition(center.add(dir.scale(dist)))
    this.orbit.radius = dist
    this.applyProjection()
  }

  exitObjectMode(): void {
    if (!this.savedCamera) return
    this.roomRoot.setEnabled(true)
    this.propsRoot.setEnabled(true)
    for (const root of this.roots.values()) root.setEnabled(true)
    const c = this.savedCamera
    this.orbit.alpha = c.alpha
    this.orbit.beta = c.beta
    this.orbit.radius = c.radius
    this.orbit.target.set(c.target[0], c.target[1], c.target[2])
    this.orbit.targetScreenOffset.set(c.offset[0], c.offset[1])
    this.orbit.lowerRadiusLimit = 0.55
    this.orbit.minZ = 0.05
    this.projection = c.projection
    this.applyProjection()
    this.setMode(c.mode)
    if (this.objectBp) {
      this.objectBp = false
      this.setBlueprint(true)
    }
    this.savedCamera = null
    this.objectId = null
    this.applyInstanceVisibility()
    this.applyPropVisibility()
  }

  /** Показать модуль целиком с выбранного направления (по умолчанию — анфас). */
  focusInstance(
    instanceId: string,
    view: 'front' | 'iso' | 'side' | 'top' = 'front',
    leftFraction = 1,
    bottomFraction = 1,
    animate = true,
  ): void {
    const root = this.roots.get(instanceId)
    if (!root) return
    this.frameNode(root, view, leftFraction, bottomFraction, animate)
  }

  /** Прервать плавный доворот (пользователь сам взялся за камеру). */
  cancelCameraTween(): void {
    this.camTween = null
  }

  /**
   * Уже удобно смотрим на модуль? Тогда клик по нему/его деталям не должен
   * переставлять камеру: объект достаточно крупный и в кадре.
   */
  isInstanceWellFramed(instanceId: string): boolean {
    const root = this.roots.get(instanceId)
    if (!root) return false
    const meshes = root.getChildMeshes()
    if (!meshes.length) return false
    const W = this.canvas.clientWidth || this.engine.getRenderWidth()
    const H = this.canvas.clientHeight || this.engine.getRenderHeight()
    if (!W || !H) return false
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
      for (const c of bb.vectorsWorld) {
        const p = this.project(c.x / MM, c.z / MM, c.y / MM)
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    if (!Number.isFinite(minX)) return false
    const cover = Math.max((maxX - minX) / W, (maxY - minY) / H)
    const cx = (minX + maxX) / 2 / W
    const cy = (minY + maxY) / 2 / H
    const centered = cx > 0.07 && cx < 0.93 && cy > 0.07 && cy < 0.93
    const size = max.subtract(min)
    const t = this.orbit.target
    const pad = 0.35
    const inside =
      t.x >= min.x - Math.max(0.2, size.x * pad) &&
      t.x <= max.x + Math.max(0.2, size.x * pad) &&
      t.y >= min.y - Math.max(0.2, size.y * pad) &&
      t.y <= max.y + Math.max(0.2, size.y * pad) &&
      t.z >= min.z - Math.max(0.2, size.z * pad) &&
      t.z <= max.z + Math.max(0.2, size.z * pad)
    return centered && inside && cover >= 0.32
  }

  private tickCamera(): void {
    if (!this.camTween) return
    const tw = this.camTween
    tw.t += Math.min(64, this.engine.getDeltaTime()) / 1000
    let k = Math.min(1, tw.t / tw.dur)
    k = k * k * (3 - 2 * k)
    this.orbit.alpha = tw.fromA + (tw.toA - tw.fromA) * k
    this.orbit.beta = tw.fromB + (tw.toB - tw.fromB) * k
    this.orbit.radius = tw.fromR + (tw.toR - tw.fromR) * k
    this.orbit.target.copyFrom(Vector3.Lerp(tw.fromTarget, tw.toTarget, k))
    if (tw.t >= tw.dur) this.camTween = null
  }

  /** Выделить декор рамкой (без движения камеры). */
  setSelectedProp(propId: string | null): void {
    this.selectedIds = new Set()
    this.selectedWall = null
    this.selectedItem = null
    this.selectedOpening = null
    this.selectedProp = propId
      ? this.scene.getTransformNodeByName(`prop:${propId}`)
      : null
    this.updateSelectionBox()
  }

  /** Показать декор в 3D (ошибки расстановки по декоративным объектам). */
  focusProp(propId: string, view: 'front' | 'iso' | 'side' | 'top' = 'iso'): void {
    const root = this.scene.getTransformNodeByName(`prop:${propId}`)
    if (!root) return
    this.selectedIds = new Set()
    this.selectedWall = null
    this.selectedItem = null
    this.selectedOpening = null
    this.selectedProp = root
    this.updateSelectionBox()
    this.frameNode(root, view, 1)
  }

  /** Кадрирование произвольной ветки (модуль, декор). */
  private frameNode(
    root: TransformNode,
    view: 'front' | 'iso' | 'side' | 'top',
    leftFraction: number,
    bottomFraction = 1,
    animate = true,
  ): void {
    const meshes = root.getChildMeshes()
    if (!meshes.length) return
    const fromA = this.orbit.alpha
    const fromB = this.orbit.beta
    const fromR = this.orbit.radius
    const fromTarget = this.orbit.target.clone()
    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const m of meshes) {
      // Без свежей мировой матрицы bounding boxWorld устаревший: объект
      // уезжал из кадра, а цель камеры оказывалась ниже центра.
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
    if (!Number.isFinite(min.x)) return
    const center = min.add(max).scale(0.5)
    const size = max.subtract(min)
    const wm = root.getWorldMatrix()
    // Фасад ищем по створкам: у повёрнутых модулей локальная ось не совпадает
    // с реальной стороной фасада, и камера оказывалась за спиной шкафа.
    const facadeSum = new Vector3(0, 0, 0)
    let facadeN = 0
    for (const m of meshes) {
      const part = (m.metadata as { part?: number } | null)?.part
      const instId = [...this.roots.entries()]
        .find(([, r]) => r === root)?.[0] ?? ''
      const meta = part != null ? this.partMeta.get(`${instId}:${part}`) : null
      if (!meta || meta.role !== 'facade') continue
      m.computeWorldMatrix(true)
      facadeSum.addInPlace(m.getBoundingInfo().boundingBox.centerWorld)
      facadeN++
    }
    let front = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize()
    if (facadeN) {
      const dir = facadeSum.scale(1 / facadeN).subtract(center)
      dir.y = 0
      if (dir.lengthSquared() > 1e-6) front = dir.normalize()
    }
    // Экранные оси считаем от направления камеры, а не от локальных осей
    // модуля: у повёрнутых на 180° модулей локальный +X смотрит в другую
    // сторону, и объект уезжал под панель конструктора.
    const worldUp = new Vector3(0, 1, 0)
    const right = Vector3.Cross(worldUp, front).normalize()
    const up = Vector3.Cross(front, right).normalize()
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
    const shift = 0 // DEBUG: без сдвига
    // Нижняя панель/шторка закрывает часть экрана: поднимаем объект в
    // свободную область, смещая цель вниз по мировой «вверх».
    const bottom = Math.min(1, Math.max(0.3, bottomFraction))
    const shiftY = Math.max(0, 0.5 - bottom / 2) * 2 * dist * Math.tan(vfov / 2)
    const target = center
      .add(screenRight.scale(shift))
      .subtract(up.scale(shiftY))

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
    if (animate && !this.blueprint && this.mode === 'orbit') {
      // Плавно доворачиваем камеру: клик по объекту не должен «прыгать».
      let toA = this.orbit.alpha
      let dA = toA - fromA
      while (dA > Math.PI) dA -= Math.PI * 2
      while (dA < -Math.PI) dA += Math.PI * 2
      toA = fromA + dA
      this.camTween = {
        t: 0,
        dur: 0.45,
        fromA, fromB, fromR, fromTarget,
        toA,
        toB: this.orbit.beta,
        toR: this.orbit.radius,
        toTarget: this.orbit.target.clone(),
      }
      this.orbit.alpha = fromA
      this.orbit.beta = fromB
      this.orbit.radius = fromR
      this.orbit.target.copyFrom(fromTarget)
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
    type: 'instance' | 'wall' | 'opening' | 'wallitem' | 'prop'
    instanceId?: string
    part?: number
    wallIndex?: number
    openingId?: string
    itemId?: string
    propId?: string
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
    if (md.propId) {
      return { type: 'prop', propId: String(md.propId) }
    }
    return md as unknown as {
      type: 'wall' | 'opening' | 'wallitem' | 'prop'
      wallIndex?: number
      openingId?: string
      itemId?: string
    }
  }

  /** Обновить контуры выбранного (после пересборки мешей). */
  refreshSelectionGlow(): void {
    this.applySelectionGlow(this.selectionMeshes())
  }

  /** Пересчитать объёмную рамку выбора (например, при включении размеров). */
  refreshSelectionBox(): void {
    this.updateSelectionBox()
  }

  /** Экранная рамка вокруг выбранного объекта/детали (CSS px). */
  selectionScreenBounds(): { x: number; y: number; w: number; h: number } | null {
    const meshes = this.selectionMeshes()
    if (!meshes.length) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const m of meshes) {
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      for (const c of bb.vectorsWorld) {
        const p = this.project(c.x / MM, c.z / MM, c.y / MM)
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    if (!Number.isFinite(minX)) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }

  /** Контур выделения по проекции деталей: выпуклая оболочка, а не
   *  прямоугольник — обводка идёт по самому объекту, а не «плавает». */
  selectionScreenHull(): { x: number; y: number }[] {
    const meshes = this.selectionMeshes()
    const pts: { x: number; y: number }[] = []
    for (const m of meshes) {
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      for (const c of bb.vectorsWorld) {
        pts.push(this.project(c.x / MM, c.z / MM, c.y / MM))
      }
    }
    if (pts.length < 3) return pts
    pts.sort((a, b) => a.x - b.x || a.y - b.y)
    const cross = (
      o: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    const lower: { x: number; y: number }[] = []
    for (const p of pts) {
      while (lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop()
      }
      lower.push(p)
    }
    const upper: { x: number; y: number }[] = []
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i]
      while (upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop()
      }
      upper.push(p)
    }
    lower.pop()
    upper.pop()
    return lower.concat(upper)
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

