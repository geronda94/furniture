<script setup lang="ts">
import { computed } from 'vue'
import { updateParams } from '../state/project'
import type { FrontBlock, Params } from '../state/defaults'

const props = defineProps<{ params: Params }>()

const gapTop = computed(() => props.params.gapTop ?? 2)
const gapBottom = computed(() => props.params.gapBottom ?? 2)
const gapBetween = computed(() => props.params.gapBetween ?? 3)
const openH = computed(() => props.params.H - gapTop.value - gapBottom.value)

function num(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}

/* ---------- фасады ---------- */
function legacyBlocks(v: Params): FrontBlock[] {
  if (v.fronts?.length) return v.fronts.map((b) => ({ ...b }))
  if (v.drawers && v.doors) {
    return [
      { type: 'drawers', count: 1, height: 200 },
      { type: 'doors', count: v.doors, height: 0 },
    ]
  }
  if (v.drawers) {
    const hs = v.drawerHeights?.length
      ? v.drawerHeights
      : Array.from({ length: v.drawers }, () => 0)
    return hs.map((h) => ({
      type: 'drawers' as const,
      count: 1,
      height: Math.round(h),
    }))
  }
  return v.doors ? [{ type: 'doors', count: v.doors, height: 0 }] : []
}

const blocks = computed<FrontBlock[]>(() => legacyBlocks(props.params))

function counts(list: FrontBlock[]): { doors: number; drawers: number } {
  return {
    doors: list.filter((b) => b.type === 'doors').reduce((s, b) => s + b.count, 0),
    drawers: list.filter((b) => b.type === 'drawers').reduce((s, b) => s + b.count, 0),
  }
}
function writeFronts(next: FrontBlock[]): void {
  const c = counts(next)
  updateParams({ fronts: next, doors: c.doors, drawers: c.drawers })
}
function setBlock(i: number, patch: Partial<FrontBlock>): void {
  writeFronts(blocks.value.map((b, k) => (k === i ? { ...b, ...patch } : b)))
}
function addBlock(type: 'doors' | 'drawers'): void {
  writeFronts([...blocks.value, { type, count: 1, height: 0 }])
}
function removeBlock(i: number): void {
  writeFronts(blocks.value.filter((_, k) => k !== i))
}
function move(i: number, dy: number): void {
  const next = [...blocks.value]
  const j = i + dy
  if (j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j], next[i]]
  writeFronts(next)
}
function preset(key: string): void {
  const v = props.params
  if (!v) return
  if (key === 'doors') {
    writeFronts([{ type: 'doors', count: Math.max(1, Math.ceil(v.W / 600)), height: 0 }])
  } else if (key === 'drawers') {
    writeFronts([
      { type: 'drawers', count: 1, height: 0 },
      { type: 'drawers', count: 1, height: 0 },
      { type: 'drawers', count: 1, height: 0 },
    ])
  } else if (key === 'mix') {
    writeFronts([
      { type: 'drawers', count: 1, height: 200 },
      { type: 'drawers', count: 1, height: 200 },
      { type: 'doors', count: 2, height: 0 },
    ])
  } else if (key === 'drawer-door') {
    writeFronts([
      { type: 'drawers', count: 1, height: 200 },
      { type: 'doors', count: 2, height: 0 },
    ])
  } else if (key === 'door-drawer') {
    writeFronts([
      { type: 'doors', count: 2, height: 0 },
      { type: 'drawers', count: 1, height: 200 },
    ])
  } else if (key === 'reset') {
    updateParams({ fronts: undefined })
  }
}

const preview = computed(() => {
  const v = props.params
  if (!v) return []
  const available = openH.value
  const fixed = blocks.value.reduce((s, b) => s + (b.height || 0), 0)
  const autos = blocks.value.filter((b) => !b.height).length
  const autoH = autos
    ? Math.max(0, available - fixed - gapBetween.value * (blocks.value.length - 1)) / autos
    : 0
  return blocks.value.map((b, i) => ({
    ...b,
    i,
    h: b.height || autoH,
    label:
      b.type === 'doors'
        ? `${b.count} ${b.count === 1 ? 'дверь' : 'двери'}`
        : `${b.count} ${b.count === 1 ? 'ящик' : 'ящика'}`,
  }))
})


</script>

<template>
  <div class="wb__fronts">

        <div class="wb__row wb__row--2">
          <label class="field"><span class="field__label">Материал фасадов</span>
            <select class="select" :value="params.facadeMaterial || 'ldsp'"
              @change="update({ facadeMaterial: ($event.target as HTMLSelectElement).value as 'ldsp' | 'mdf' })">
              <option value="ldsp">ЛДСП</option>
              <option value="mdf">МДФ</option>
            </select>
          </label>
          <label class="field"><span class="field__label">Тип фасада</span>
            <select class="select" :value="params.facadeStyle || 'handle'"
              @change="update({ facadeStyle: ($event.target as HTMLSelectElement).value as 'flat' | 'milled' | 'handle' | 'push' | 'profile' })">
              <option value="flat">Гладкий</option>
              <option value="milled">Фрезерованный</option>
              <option value="handle">С ручкой</option>
              <option value="push">Push-to-open (без ручки)</option>
              <option value="profile">Профиль-ручка</option>
            </select>
          </label>
        </div>
        <p class="dim wb__note">
          Материал влияет на деталировку и смету. Push/профиль отключают
          отверстия под ручки; фрезеровка — декор без изменения корпуса.
        </p>
        <div class="wb__chips">
          <button class="chip" @click="preset('doors')">Только двери</button>
          <button class="chip" @click="preset('drawers')">Только ящики</button>
          <button class="chip" @click="preset('drawer-door')">Ящик + двери</button>
          <button class="chip" @click="preset('door-drawer')">Двери + ящик</button>
          <button class="chip" @click="preset('mix')">Микс</button>
          <button class="chip" @click="preset('reset')">Авто</button>
        </div>
        <div class="fc__blocks">
          <div v-for="(b, i) in blocks" :key="i" class="fc-block">
            <div class="fc-block__head">
              <span class="fc-block__no">{{ i + 1 }}</span>
              <select class="select fc-block__type" :value="b.type"
                @change="setBlock(i, { type: ($event.target as HTMLSelectElement).value as 'doors' | 'drawers' })">
                <option value="doors">Двери</option><option value="drawers">Ящики</option>
              </select>
              <div class="fc-block__acts">
                <button class="tree__act" title="Выше" @click="move(i, -1)">↑</button>
                <button class="tree__act" title="Ниже" @click="move(i, 1)">↓</button>
                <button class="tree__act" title="Удалить" @click="removeBlock(i)">×</button>
              </div>
            </div>
            <div class="fc-block__row">
              <label class="field"><span class="field__label">{{ b.type === 'doors' ? 'Полотен' : 'Ящиков' }}</span>
                <input class="input" type="number" min="1" max="6" :value="b.count" @input="setBlock(i, { count: num($event) })" />
              </label>
              <label class="field"><span class="field__label">Высота, мм (0 — авто)</span>
                <input class="input" type="number" min="0" max="2000" step="10" :value="b.height" @input="setBlock(i, { height: num($event) })" />
              </label>
            </div>
          </div>
          <div v-if="!blocks.length" class="dim wb__note">Фасадов нет — открытая секция.</div>
        </div>
        <div class="wb__actions">
          <button class="btn btn--sm" @click="addBlock('doors')">＋ двери</button>
          <button class="btn btn--sm" @click="addBlock('drawers')">＋ ящики</button>
        </div>
        <div class="fc__elevation wb__elevation" :style="{ aspectRatio: `${params.W} / ${params.H}` }">
          <div v-for="b in preview" :key="b.i" class="fc__band" :class="`fc__band--${b.type}`" :style="{ flexGrow: Math.max(1, b.h) }">
            <span>{{ b.label }}</span><small>{{ b.height ? `${Math.round(b.height)} мм` : 'авто' }}</small>
          </div>
          <div v-if="!preview.length" class="fc__band fc__band--open"><span>Открытая секция</span></div>
        </div>
        <p class="dim wb__note">Сверху вниз. Высота 0 — блок добирает остаток. Зазоры 2/3 мм учитываются автоматически.</p>
        </div>
</template>
