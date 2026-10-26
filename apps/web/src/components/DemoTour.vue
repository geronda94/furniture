<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ui } from '../state/project'

type Step = {
  title: string
  text: string
  selectors?: string[]
}

const steps: Step[] = [
  {
    title: 'Это демо-кухня',
    text: 'Мы проведём по основным местам. Можно нажимать «Далее» или сразу закрыть подсказку — демо останется доступным.',
  },
  {
    title: '3D-сцена',
    text: 'Вращайте сцену мышью или пальцем, приближайте колесом или щипком. Внизу слева — план комнаты, вверху — ракурсы и вписать в экран.',
    selectors: ['[data-tour="scene"]'],
  },
  {
    title: 'Объекты и помещение',
    text: 'Слева — мебель, справа (на телефоне — кнопка «Объекты») — стены, проёмы и отделка. Выберите модуль, чтобы открыть его карточку.',
    selectors: ['[data-tour="objects"]', '.sidebar', '.mobilebar'],
  },
  {
    title: 'Добавление модуля',
    text: 'Кнопка «＋ Добавить» открывает библиотеку мебели, техники, окон и дверей. Новый модуль сразу появится в комнате.',
    selectors: ['[data-tour="add"]', '[data-tour="add-mobile"]'],
  },
  {
    title: 'Проект целиком',
    text: 'В меню «Ещё» — файлы, настройки, версии и коммерческое предложение. В настройках задаются материалы, присадка, цены и рынок.',
    selectors: ['[data-tour="more"]'],
  },
  {
    title: 'Готово к работе',
    text: 'Это гостевой проект: двигайте мебель и смотрите присадку. Для сохранения на своём аккаунте зарегистрируйтесь — проекты будут доступны с любого устройства.',
  },
]

const step = ref(0)
const target = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const stepEl = computed(() => steps[step.value])
const isLast = computed(() => step.value === steps.length - 1)

function findTarget(): HTMLElement | null {
  for (const sel of stepEl.value.selectors ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      if (
        r.width > 4 && r.height > 4 &&
        r.bottom > 0 && r.top < window.innerHeight &&
        r.right > 0 && r.left < window.innerWidth &&
        s.display !== 'none' && s.visibility !== 'hidden' &&
        Number(s.opacity || 1) > 0.05
      ) return el
    }
  }
  return null
}

function measure(): void {
  const el = findTarget()
  if (!el) {
    target.value = null
    return
  }
  const r = el.getBoundingClientRect()
  const pad = 6
  target.value = {
    x: Math.max(6, r.left - pad),
    y: Math.max(6, r.top - pad),
    w: Math.min(window.innerWidth - 12, r.width + pad * 2),
    h: Math.min(window.innerHeight - 12, r.height + pad * 2),
  }
}

function sync(): void {
  void nextTick(measure)
}

function next(): void {
  if (isLast.value) {
    finish()
    return
  }
  step.value++
  sync()
}

function prev(): void {
  if (step.value === 0) return
  step.value--
  sync()
}

function finish(): void {
  ui.tourOpen = false
  try {
    localStorage.setItem('furniture.tour.done', '1')
  } catch {
    /* ignore */
  }
}

const holeStyle = computed(() => target.value
  ? {
      left: `${target.value.x}px`,
      top: `${target.value.y}px`,
      width: `${target.value.w}px`,
      height: `${target.value.h}px`,
    }
  : {})

const cardStyle = computed(() => {
  const t = target.value
  if (window.innerWidth <= 760) {
    if (t && t.y + t.h / 2 > window.innerHeight * 0.58) {
      return { top: '86px', bottom: 'auto' }
    }
    return {}
  }
  if (!t) return {}
  const below = t.y + t.h + 16
  return below < window.innerHeight - 190
    ? { left: `${Math.max(16, Math.min(t.x, window.innerWidth - 370))}px`, top: `${below}px` }
    : { left: `${Math.max(16, Math.min(t.x, window.innerWidth - 370))}px`, bottom: `${Math.max(16, window.innerHeight - t.y + 16)}px` }
})

function onKey(e: KeyboardEvent): void {
  if (!ui.tourOpen) return
  if (e.key === 'Escape') finish()
  else if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
}

function onResize(): void {
  if (ui.tourOpen) measure()
}

onMounted(() => {
  sync()
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onResize, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onResize, true)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div class="tour" :class="{ 'tour--plain': !target }" role="dialog" aria-modal="true" aria-label="Обучение">
      <div v-if="target" class="tour__hole" :style="holeStyle"></div>
      <section class="tour__card" :style="cardStyle">
        <div class="tour__top">
          <span class="tour__step">{{ step + 1 }} / {{ steps.length }}</span>
          <button class="tour__skip" @click="finish">Пропустить</button>
        </div>
        <h3>{{ stepEl.title }}</h3>
        <p>{{ stepEl.text }}</p>
        <div class="tour__actions">
          <button class="btn btn--sm" :disabled="step === 0" @click="prev">Назад</button>
          <button class="btn btn--primary btn--sm" @click="next">
            {{ isLast ? 'Начать работу' : 'Далее' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
