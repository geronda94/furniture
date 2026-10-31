<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  mode: 'orbit' | 'first' | 'fly'
  touch: boolean
  /** текущее направление с клавиатуры: x — вправо, y — вперёд, z — выше */
  keys?: { x: number; y: number; z: number }
}>()

const emit = defineEmits<{
  (e: 'move', v: { x: number; y: number }): void
  (e: 'z', v: number): void
}>()

const base = ref<HTMLElement | null>(null)
const knob = ref({ x: 0, y: 0 })
const active = ref(false)
const zUp = ref(false)
const zDown = ref(false)
let pointerId = -1

const thumbStyle = computed(() => {
  const k = props.keys ?? { x: 0, y: 0, z: 0 }
  const x = active.value ? knob.value.x : k.x
  const y = active.value ? knob.value.y : -k.y
  return { transform: `translate(${x * 34}px, ${y * 34}px)` }
})
const zUpOn = computed(() => zUp.value || (props.keys?.z ?? 0) > 0)
const zDownOn = computed(() => zDown.value || (props.keys?.z ?? 0) < 0)
const upKey = computed(() => 'E')
const downKey = computed(() => 'Q')

const hint = computed(() => {
  if (props.mode === 'orbit') return 'сдвиг вида'
  return props.mode === 'first' ? 'идти' : 'лететь'
})

function update(e: PointerEvent): void {
  const el = base.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  let x = (e.clientX - cx) / (r.width * 0.42)
  let y = (e.clientY - cy) / (r.height * 0.42)
  const len = Math.hypot(x, y)
  if (len > 1) {
    x /= len
    y /= len
  }
  knob.value = { x, y }
  emit('move', { x, y })
}

function down(e: PointerEvent): void {
  e.preventDefault()
  e.stopPropagation()
  pointerId = e.pointerId
  active.value = true
  base.value?.setPointerCapture?.(e.pointerId)
  update(e)
}

function move(e: PointerEvent): void {
  if (!active.value || e.pointerId !== pointerId) return
  e.preventDefault()
  update(e)
}

function up(e?: PointerEvent): void {
  if (e && e.pointerId !== pointerId) return
  if (!active.value) return
  active.value = false
  pointerId = -1
  knob.value = { x: 0, y: 0 }
  emit('move', { x: 0, y: 0 })
}

function pressZ(v: number, e: PointerEvent): void {
  e.preventDefault()
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  if (v > 0) zUp.value = true
  else zDown.value = true
  emit('z', v)
}

function releaseZ(v: number, e: PointerEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (v > 0) zUp.value = false
  else zDown.value = false
  const value = zDown.value ? -1 : zUp.value ? 1 : 0
  emit('z', value)
}

function clear(): void {
  zUp.value = false
  zDown.value = false
  emit('z', 0)
}

onBeforeUnmount(() => {
  emit('move', { x: 0, y: 0 })
  emit('z', 0)
})
</script>

<template>
  <div
    class="campad"
    :class="{ 'campad--desktop': !touch, 'campad--active': active }"
    aria-label="Управление камерой"
  >
    <div
      ref="base"
      class="campad__joy"
      role="application"
      :aria-label="`Джойстик: ${hint}`"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @lostpointercapture="up"
      @contextmenu.prevent
    >
      <span class="campad__ring campad__ring--h" aria-hidden="true"></span>
      <span class="campad__ring campad__ring--v" aria-hidden="true"></span>
      <span class="campad__thumb" :style="thumbStyle" aria-hidden="true"></span>
      <span class="campad__label">{{ hint }}</span>
      <!-- Подписи осей внутри ролика: на телефоне — стрелки, на ПК — клавиши. -->
      <span class="campad__key campad__key--w" aria-hidden="true">{{ touch ? '↑' : 'W' }}</span>
      <span class="campad__key campad__key--a" aria-hidden="true">{{ touch ? '←' : 'A' }}</span>
      <span class="campad__key campad__key--s" aria-hidden="true">{{ touch ? '↓' : 'S' }}</span>
      <span class="campad__key campad__key--d" aria-hidden="true">{{ touch ? '→' : 'D' }}</span>
    </div>

    <div class="campad__z" aria-label="Высота камеры">
      <button
        class="campad__zbtn"
        :class="{ 'campad__zbtn--on': zUpOn }"
        title="Выше (E)"
        aria-label="Поднять камеру, клавиша E"
        @pointerdown="pressZ(1, $event)"
        @pointerup="releaseZ(1, $event)"
        @pointercancel="clear"
        @lostpointercapture="clear"
      ><span>▲</span><small v-if="!touch">{{ upKey }}</small></button>
      <button
        class="campad__zbtn"
        :class="{ 'campad__zbtn--on': zDownOn }"
        title="Ниже (Q)"
        aria-label="Опустить камеру, клавиша Q"
        @pointerdown="pressZ(-1, $event)"
        @pointerup="releaseZ(-1, $event)"
        @pointercancel="clear"
        @lostpointercapture="clear"
      ><span>▼</span><small v-if="!touch">{{ downKey }}</small></button>
    </div>

  </div>
</template>
