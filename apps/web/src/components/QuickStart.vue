<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { apiQuickStart, type QuickStartInput } from '../api'
import { notify, openProject, ui } from '../state/project'

const emit = defineEmits<{ (e: 'close'): void }>()

type Opening = {
  kind: 'window' | 'door'
  wall: number
  x: number
  w: number
}
type Socket = { kind: 'socket' | 'switch'; wall: number; x: number; z: number }

const name = ref('Моя кухня')
const room = reactive({
  w: 3600, d: 2800, h: 2700, wallT: 100,
  shape: 'rect' as 'rect' | 'l', cutW: 1200, cutD: 900,
})
const kind = ref<'kitchen' | 'wardrobe' | 'storage'>('kitchen')
const wall = ref(2)
const height = ref(2400)
const openings = reactive<Opening[]>([
  { kind: 'window', wall: 0, x: 900, w: 1200 },
  { kind: 'door', wall: 3, x: 800, w: 900 },
])
const sockets = reactive<Socket[]>([
  { kind: 'socket', wall: 2, x: 600, z: 1100 },
])
// Для Г-образной комнаты — проёмы на длинных стенах.
watch(() => room.shape, (shape) => {
  openings.splice(0, openings.length,
    ...(shape === 'l'
      ? [
          { kind: 'window' as const, wall: 0, x: 600, w: 1200 },
          { kind: 'door' as const, wall: 5, x: 800, w: 900 },
        ]
      : [
          { kind: 'window' as const, wall: 0, x: 900, w: 1200 },
          { kind: 'door' as const, wall: 3, x: 800, w: 900 },
        ]))
  if (shape === 'l') wall.value = 4
  else wall.value = 2
})
const busy = ref(false)
const error = ref('')

const outline = computed<[number, number][]>(() => {
  const w = room.w
  const d = room.d
  if (room.shape !== 'l') return [[0, 0], [w, 0], [w, d], [0, d]]
  const cw = Math.max(600, Math.min(w - 600, room.cutW || 1200))
  const cd = Math.max(600, Math.min(d - 600, room.cutD || 900))
  return [[0, 0], [w, 0], [w, d - cd], [w - cw, d - cd], [w - cw, d], [0, d]]
})

const wallLabels = computed(() => {
  const pts = outline.value
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]
    const len = Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]))
    return `Стена ${i + 1} · ${len} мм`
  })
})

const scenarioLabel = computed(() => (
  kind.value === 'kitchen' ? 'Кухня' : 'Встроенный шкаф/гардероб'
))

const canSubmit = computed(() => (
  room.w >= 1200 && room.d >= 1200 && room.h >= 2000 && !busy.value
))

function addOpening(): void {
  openings.push({ kind: 'window', wall: 0, x: 400, w: 1200 })
}
function addSocket(): void {
  sockets.push({ kind: 'socket', wall: wall.value, x: 600, z: 1100 })
}

function close(): void {
  if (!busy.value) emit('close')
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  const input = {
    name: name.value.trim() || scenarioLabel.value,
    room: {
      w: room.w, d: room.d, h: room.h, wallT: room.wallT,
      shape: room.shape, cutW: room.cutW, cutD: room.cutD,
    },
    kind: kind.value,
    wall: wall.value,
    height: height.value,
    openings: openings.map((o) => ({ ...o })),
    sockets: sockets.map((s) => ({ ...s })),
  }
  try {
    const res = await apiQuickStart(input)
    await openProject(res.id)
    const count = Array.isArray(res.project.instances)
      ? res.project.instances.length : 0
    notify(`${scenarioLabel.value}: ${count} модулей, проверка пройдена`,
      null, 'success')
    ui.quickOpen = false
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal" @click.self="close">
    <section class="modal__win quick" role="dialog" aria-modal="true"
      aria-label="Быстрый старт">
      <header class="modal__head">
        <div>
          <b>Быстрый старт</b>
          <span class="dim">комната → расстановка → готовый проект</span>
        </div>
        <button class="btn btn--ghost btn--sm" title="Закрыть" @click="close">×</button>
      </header>

      <div class="quick__body">
        <section class="quick__step">
          <span class="quick__no">1</span>
          <div class="quick__content">
            <label class="field quick__name">
              <span class="field__label">Название проекта</span>
              <input v-model="name" class="input" maxlength="80" />
            </label>
            <div class="quick__grid">
              <label class="field"><span class="field__label">Длина, мм</span>
                <input v-model.number="room.w" class="input" type="number" min="1200" max="12000" step="100" />
              </label>
              <label class="field"><span class="field__label">Глубина, мм</span>
                <input v-model.number="room.d" class="input" type="number" min="1200" max="12000" step="100" />
              </label>
              <label class="field"><span class="field__label">Высота, мм</span>
                <input v-model.number="room.h" class="input" type="number" min="2000" max="4500" step="50" />
              </label>
              <label class="field"><span class="field__label">Толщина стен, мм</span>
                <input v-model.number="room.wallT" class="input" type="number" min="40" max="300" step="10" />
              </label>
            </div>
            <div class="quick__grid quick__grid--wall">
              <label class="field"><span class="field__label">Форма комнаты</span>
                <select v-model="room.shape" class="select">
                  <option value="rect">Прямоугольная</option>
                  <option value="l">Г-образная</option>
                </select>
              </label>
              <template v-if="room.shape === 'l'">
                <label class="field"><span class="field__label">Вырез по ширине, мм</span>
                  <input v-model.number="room.cutW" class="input" type="number" min="600" step="50" />
                </label>
                <label class="field"><span class="field__label">Вырез по глубине, мм</span>
                  <input v-model.number="room.cutD" class="input" type="number" min="600" step="50" />
                </label>
              </template>
            </div>
          </div>
        </section>

        <section class="quick__step">
          <span class="quick__no">2</span>
          <div class="quick__content">
            <div class="quick__head">
              <b>Окна, двери и электрика</b>
              <span class="dim">можно пропустить</span>
            </div>
            <div v-for="(o, i) in openings" :key="`o${i}`" class="quick__row">
              <select v-model="o.kind" class="select">
                <option value="window">Окно</option>
                <option value="door">Дверь</option>
              </select>
              <select v-model.number="o.wall" class="select">
                <option v-for="(l, wi) in wallLabels" :key="wi" :value="wi">{{ l }}</option>
              </select>
              <label class="quick__num"><span>от угла</span>
                <input v-model.number="o.x" class="input" type="number" min="0" step="50" />
              </label>
              <label class="quick__num"><span>ширина</span>
                <input v-model.number="o.w" class="input" type="number" min="300" step="50" />
              </label>
              <button class="btn btn--ghost btn--sm" title="Удалить"
                @click="openings.splice(i, 1)">×</button>
            </div>
            <button class="btn btn--sm" @click="addOpening">＋ окно/дверь</button>

            <div v-for="(s, i) in sockets" :key="`s${i}`" class="quick__row">
              <select v-model="s.kind" class="select">
                <option value="socket">Розетка</option>
                <option value="switch">Выключатель</option>
              </select>
              <select v-model.number="s.wall" class="select">
                <option v-for="(l, wi) in wallLabels" :key="wi" :value="wi">{{ l }}</option>
              </select>
              <label class="quick__num"><span>от угла</span>
                <input v-model.number="s.x" class="input" type="number" min="0" step="50" />
              </label>
              <label class="quick__num"><span>высота</span>
                <input v-model.number="s.z" class="input" type="number" min="100" max="2500" step="50" />
              </label>
              <button class="btn btn--ghost btn--sm" title="Удалить"
                @click="sockets.splice(i, 1)">×</button>
            </div>
            <button class="btn btn--sm" @click="addSocket">＋ розетка/выключатель</button>
          </div>
        </section>

        <section class="quick__step">
          <span class="quick__no">3</span>
          <div class="quick__content">
            <div class="quick__head"><b>Что планируем</b></div>
            <div class="quick__scenarios">
              <button class="quick__card" :class="{ 'quick__card--on': kind === 'kitchen' }"
                @click="kind = 'kitchen'">
                <b>Кухня</b>
                <span>ряд + навесные, мойка, варочная, холодильник</span>
              </button>
              <button class="quick__card" :class="{ 'quick__card--on': kind === 'wardrobe' }"
                @click="kind = 'wardrobe'">
                <b>Гардероб / шкаф</b>
                <span>встроенный шкаф на стену, полки и штанга</span>
              </button>
            </div>
            <div class="quick__grid quick__grid--wall">
              <label class="field"><span class="field__label">Стена для мебели</span>
                <select v-model.number="wall" class="select">
                  <option v-for="(l, wi) in wallLabels" :key="wi" :value="wi">{{ l }}</option>
                </select>
              </label>
              <label v-if="kind !== 'kitchen'" class="field">
                <span class="field__label">Высота шкафа, мм</span>
                <input v-model.number="height" class="input" type="number" min="1800" max="2700" step="50" />
              </label>
            </div>
          </div>
        </section>

        <p v-if="error" class="quick__error">{{ error }}</p>
      </div>

      <footer class="modal__foot">
        <span class="dim">Создаст новый проект и сразу посчитает деталировку, смету и раскрой.</span>
        <button class="btn btn--primary" :disabled="!canSubmit" @click="submit">
          {{ busy ? 'Создаю…' : 'Создать проект' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.quick { width: min(980px, 96vw); max-height: 92vh; display: flex; flex-direction: column; }
.quick__body { overflow: auto; padding: 14px 18px; display: grid; gap: 14px; }
.quick__step { display: flex; gap: 14px; align-items: flex-start; }
.quick__no { width: 28px; height: 28px; border-radius: 50%; flex: 0 0 auto;
  display: grid; place-items: center; background: var(--accent); color: #1b1305;
  font-weight: 700; }
.quick__content { flex: 1; min-width: 0; display: grid; gap: 10px; }
.quick__name { max-width: 420px; }
.quick__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.quick__grid--wall { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 560px; }
.quick__row { display: grid; grid-template-columns: 120px 1fr 110px 110px 34px; gap: 8px; align-items: end; }
.quick__num { display: grid; gap: 2px; font-size: 10px; color: var(--dim); }
.quick__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.quick__scenarios { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.quick__card { text-align: left; display: grid; gap: 4px; padding: 12px 14px;
  border-radius: 12px; border: 1px solid var(--line-2); background: rgba(20,23,27,0.6);
  color: var(--text); cursor: pointer; }
.quick__card b { font-size: 14px; }
.quick__card span { font-size: 11px; color: var(--dim); }
.quick__card--on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.quick__error { margin: 0; padding: 10px 12px; border-radius: 10px;
  background: rgba(214, 76, 76, 0.12); border: 1px solid rgba(214, 76, 76, 0.45);
  color: #ffb4b4; font-size: 12px; }
.modal__foot { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 12px 18px; border-top: 1px solid var(--line); }
@media (max-width: 760px) {
  .quick__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .quick__row { grid-template-columns: 1fr 1fr; }
  .quick__row .btn { justify-self: end; }
  .quick__scenarios { grid-template-columns: 1fr; }
}
</style>
