<script setup lang="ts">
import { computed, ref } from 'vue'
import { useModalDrag } from '../composables/useModalDrag'
import {
  defaultParams,
  derived,
  runners,
  setMount,
  state,
  updateParams,
  type BackKind,
  type Frame,
  type FrontBlock,
  type Hardware,
  type Params,
  type Reinforce,
} from '../state/project'
import { moduleInfo } from '../module/info'

const props = defineProps<{ instanceId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const winEl = ref<HTMLElement | null>(null)
const { style: dragStyle, onDown: onDragStart } = useModalDrag(winEl)

const inst = computed(() =>
  state.project.instances.find((i) => i.id === props.instanceId) ?? null,
)
const info = computed(() =>
  inst.value ? moduleInfo(inst.value, derived[inst.value.id]?.objects) : null,
)
const dims = computed(() => derived[props.instanceId]?.dims ?? null)
const drawers = computed(() => derived[props.instanceId]?.drawers ?? [])
const p = computed<Params | null>(() => inst.value?.params ?? null)
const tab = ref<'body' | 'fronts' | 'details'>('fronts')

const gapBottom = 2
const gapTop = 2
const gapBetween = 3
const openH = computed(() => (p.value ? p.value.H - gapTop - gapBottom : 0))

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
  return v.doors
    ? [{ type: 'doors', count: v.doors, height: 0 }]
    : []
}

const blocks = computed<FrontBlock[]>(() => (p.value ? legacyBlocks(p.value) : []))

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
  const next = blocks.value.map((b, k) => (k === i ? { ...b, ...patch } : b))
  writeFronts(next)
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
  const v = p.value
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

function num(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}

const cutouts = computed(() => p.value?.cutouts ?? [])
function addCutout(): void {
  update({ cutouts: [...cutouts.value, { x: 200, y: 150, w: 400, h: 350 }] })
}
function setCutout(i: number, key: 'x' | 'y' | 'w' | 'h', e: Event): void {
  const next = cutouts.value.map((c, k) =>
    k === i ? { ...c, [key]: num(e) } : c,
  )
  update({ cutouts: next })
}
function removeCutout(i: number): void {
  update({ cutouts: cutouts.value.filter((_, k) => k !== i) })
}

function update(patch: Partial<Params>): void {
  updateParams(patch)
}

function resetBody(): void {
  if (inst.value) setMount(inst.value.id, 'floor')
  update(defaultParams())
}

const warnings = computed(() => {
  const v = p.value
  if (!v) return []
  const out: string[] = []
  if (!v.roof) out.push('Без крыши добавятся верхние царги 60 мм.')
  if (v.back === 'none') out.push('Без задней стенки добавятся задние царги.')
  if (v.back === 'cardboard') out.push('Картон 3 мм — рекомендуются задние царги.')
  if (v.t !== 16) out.push(`Толщина ЛДСП ${v.t} мм: пересчитаны все вкладные размеры.`)
  return out
})

const preview = computed(() => {
  const v = p.value
  if (!v) return []
  const available = openH.value
  const fixed = blocks.value.reduce((s, b) => s + (b.height || 0), 0)
  const autos = blocks.value.filter((b) => !b.height).length
  const autoH = autos ? Math.max(0, available - fixed - gapBetween * (blocks.value.length - 1)) / autos : 0
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
  <Teleport to="body">
  <div class="modal modal--constructor" @click.self="emit('close')">
    <section v-if="inst && p" class="modal__win fc" ref="winEl" :style="dragStyle">
      <header class="modal__head" @pointerdown="onDragStart">
        <span class="modal__title">Конструктор мебели</span>
        <span class="modal__sub">{{ inst.name || 'Модуль' }}</span>
        <div class="modal__tools">
          <button class="btn btn--ghost btn--sm" title="Закрыть" @click="emit('close')">
            ×
          </button>
        </div>
      </header>

      <div class="fc__body">
        <aside class="fc__settings">
          <div class="fc__tabs">
            <button
              class="fc__tab" :class="{ 'fc__tab--on': tab === 'fronts' }"
              @click="tab = 'fronts'"
            >
              Фасады
            </button>
            <button
              class="fc__tab" :class="{ 'fc__tab--on': tab === 'body' }"
              @click="tab = 'body'"
            >
              Корпус
            </button>
            <button
              class="fc__tab" :class="{ 'fc__tab--on': tab === 'details' }"
              @click="tab = 'details'"
            >
              Детали
            </button>
          </div>

          <template v-if="tab === 'fronts'">
            <div class="fc__presets">
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
                  <select
                    class="select fc-block__type"
                    :value="b.type"
                    @change="setBlock(i, { type: ($event.target as HTMLSelectElement).value as 'doors' | 'drawers' })"
                  >
                    <option value="doors">Двери</option>
                    <option value="drawers">Ящики</option>
                  </select>
                  <div class="fc-block__acts">
                    <button class="tree__act" title="Выше" @click="move(i, -1)">↑</button>
                    <button class="tree__act" title="Ниже" @click="move(i, 1)">↓</button>
                    <button class="tree__act" title="Удалить" @click="removeBlock(i)">×</button>
                  </div>
                </div>
                <div class="fc-block__row">
                  <label class="field">
                    <span class="field__label">{{ b.type === 'doors' ? 'Полотен' : 'Ящиков' }}</span>
                    <input
                      class="input" type="number" min="1" max="6"
                      :value="b.count"
                      @input="setBlock(i, { count: num($event) })"
                    />
                  </label>
                  <label class="field">
                    <span class="field__label">Высота, мм (0 — авто)</span>
                    <input
                      class="input" type="number" min="0" max="2000" step="10"
                      :value="b.height"
                      @input="setBlock(i, { height: num($event) })"
                    />
                  </label>
                </div>
              </div>
              <div v-if="!blocks.length" class="dim fc__empty">
                Фасадов нет — открытая секция.
              </div>
            </div>

            <div class="fc__add">
              <button class="btn btn--sm" @click="addBlock('doors')">＋ двери</button>
              <button class="btn btn--sm" @click="addBlock('drawers')">＋ ящики</button>
            </div>

            <div class="fc__hint dim">
              Сверху вниз. Высота 0 — блок добирает остаток. Зазоры 2/3 мм
              учитываются автоматически.
            </div>
          </template>

          <template v-else-if="tab === 'body'">
            <div class="add__row3">
              <label class="field">
                <span class="field__label">Ширина</span>
                <input class="input" type="number" min="200" max="3000" step="10"
                  :value="p.W" @input="update({ W: num($event) })" />
              </label>
              <label class="field">
                <span class="field__label">Высота</span>
                <input class="input" type="number" min="200" max="2600" step="10"
                  :value="p.H" @input="update({ H: num($event) })" />
              </label>
              <label class="field">
                <span class="field__label">Глубина</span>
                <input class="input" type="number" min="200" max="900" step="10"
                  :value="p.D" @input="update({ D: num($event) })" />
              </label>
            </div>

            <div class="add__row2">
              <label class="field">
                <span class="field__label">Толщина ЛДСП</span>
                <select class="select" :value="p.t"
                  @change="update({ t: Number(($event.target as HTMLSelectElement).value) })">
                  <option :value="10">10 мм</option>
                  <option :value="16">16 мм</option>
                  <option :value="18">18 мм</option>
                  <option :value="22">22 мм</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Каркас</span>
                <select class="select" :value="p.frame"
                  @change="update({ frame: ($event.target as HTMLSelectElement).value as Frame })">
                  <option value="inset">Вкладной</option>
                  <option value="overlay">Накладной</option>
                </select>
              </label>
            </div>

            <div class="add__row2">
              <label class="field">
                <span class="field__label">Тип модуля</span>
                <select class="select" :value="p.mount"
                  @change="setMount(inst!.id, ($event.target as HTMLSelectElement).value as 'floor' | 'wall')">
                  <option value="floor">Напольный</option>
                  <option value="wall">Навесной</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Цоколь, мм</span>
                <input class="input" type="number" min="0" max="300" step="10"
                  :value="p.plinthH" @input="update({ plinthH: num($event) })" />
              </label>
            </div>
            <label class="field">
              <span class="field__label">Столешница, мм (0 — без)</span>
              <input class="input" type="number" min="0" max="80" step="2"
                :value="p.worktopT" @input="update({ worktopT: num($event) })" />
            </label>

            <div class="add__row2">
              <label class="field">
                <span class="field__label">Петли</span>
                <select class="select" :value="p.hardware"
                  @change="update({ hardware: ($event.target as HTMLSelectElement).value as Hardware })">
                  <option value="blum">Blum</option>
                  <option value="hettich">Hettich</option>
                  <option value="gtv">GTV</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Полки</span>
                <input class="input" type="number" min="0" max="8" step="1"
                  :value="p.shelves" @input="update({ shelves: num($event) })" />
              </label>
            </div>

            <label class="field">
              <span class="field__label">Крыша корпуса</span>
              <select class="select" :value="p.roof ? 'yes' : 'no'"
                @change="update({ roof: ($event.target as HTMLSelectElement).value === 'yes' })">
                <option value="yes">Есть</option>
                <option value="no">Нет (добавятся царги)</option>
              </select>
            </label>

            <div class="add__row2">
              <label class="field">
                <span class="field__label">Задняя стенка</span>
                <select class="select" :value="p.back"
                  @change="update({ back: ($event.target as HTMLSelectElement).value as BackKind })">
                  <option value="dvp">ДВП</option>
                  <option value="same">Тот же ЛДСП</option>
                  <option value="cardboard">Картон</option>
                  <option value="none">Нет</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Толщина задней</span>
                <input class="input" type="number" min="1" max="18" step="1"
                  :value="p.backT" @input="update({ backT: num($event) })" />
              </label>
            </div>

            <div class="add__row2">
              <label class="field">
                <span class="field__label">Царги</span>
                <select class="select" :value="p.reinforce"
                  @change="update({ reinforce: ($event.target as HTMLSelectElement).value as Reinforce })">
                  <option value="auto">Авто (по необходимости)</option>
                  <option value="on">Всегда</option>
                  <option value="off">Не добавлять</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Направляющие</span>
                <select class="select" :value="p.runners"
                  :disabled="!p.drawers"
                  @change="update({ runners: ($event.target as HTMLSelectElement).value })">
                  <option v-for="r in runners" :key="r.id" :value="r.id">
                    {{ r.name }}
                  </option>
                </select>
              </label>
            </div>

            <div class="fc__cutouts">
              <div class="fc__cutouts-head">
                <span class="field__label">Вырезы в столешнице</span>
                <button class="btn btn--sm" @click="addCutout">＋ вырез</button>
              </div>
              <div v-for="(c, i) in cutouts" :key="i" class="fc__cutout">
                <div class="fc__cutout-head">
                  <span class="ctx__outline-no">{{ i + 1 }}</span>
                  <span class="dim">X {{ c.x }} · Y {{ c.y }} · {{ c.w }}×{{ c.h }}</span>
                  <button class="tree__act" title="Удалить" @click="removeCutout(i)">×</button>
                </div>
                <div class="ctx__part-grid">
                  <label class="coord"><span>X</span>
                    <input type="number" :value="c.x" step="10" @change="setCutout(i, 'x', $event)" />
                  </label>
                  <label class="coord"><span>Y</span>
                    <input type="number" :value="c.y" step="10" @change="setCutout(i, 'y', $event)" />
                  </label>
                  <label class="coord"><span>Ширина</span>
                    <input type="number" :value="c.w" step="10" @change="setCutout(i, 'w', $event)" />
                  </label>
                  <label class="coord"><span>Глубина</span>
                    <input type="number" :value="c.h" step="10" @change="setCutout(i, 'h', $event)" />
                  </label>
                </div>
              </div>
              <p v-if="!cutouts.length" class="dim fc__hint">
                Мойка, плита, врезная техника. X/Y — от левого/переднего края
                столешницы; вырез вычитается из столешницы в 3D и идёт в присадку.
              </p>
            </div>

            <button class="btn btn--sm" @click="resetBody">
              Сбросить корпус
            </button>
          </template>

          <template v-else>
            <div v-if="dims" class="fc__details">
              <div class="fc__dims">
                <span>Наружные</span>
                <b>{{ dims.outer.W }} × {{ dims.outer.H }} × {{ dims.outer.D }}</b>
                <span>Внутренние</span>
                <b>{{ dims.inner.W }} × {{ dims.inner.H }} × {{ dims.inner.D }}</b>
                <span>Плита / задник</span>
                <b>{{ dims.t }} / {{ dims.t_back }} мм</b>
              </div>
              <div v-if="drawers.length" class="fc__drawers">
                <b>Ящики</b>
                <div v-for="d in drawers" :key="d.id" class="fc__drawer-row">
                  <span>№{{ d.id }}</span>
                  <span>короб {{ d.box_w }}×{{ d.box_h }}×{{ d.box_len }}</span>
                  <span>фасад {{ d.front_w }}×{{ d.front_h }}</span>
                </div>
              </div>
              <details v-for="g in info?.groups ?? []" :key="g.key" open class="fc__group">
                <summary>{{ g.label }} · {{ g.elements.length }}</summary>
                <div v-for="el in g.elements" :key="el.index" class="fc__element">
                  <span>{{ el.title }}</span>
                  <b>{{ el.w }}×{{ el.h }}×{{ el.d }}</b>
                </div>
              </details>
            </div>
            <div v-else class="dim fc__hint">Деталировка ещё не рассчитана.</div>
          </template>

          <ul v-if="warnings.length" class="fc__warn">
            <li v-for="w in warnings" :key="w">{{ w }}</li>
          </ul>
        </aside>

        <div class="fc__preview">
          <div class="fc__preview-head">
            <b>Фасад</b>
            <span class="dim">{{ p.W }} × {{ p.H }} мм</span>
          </div>
          <div
            class="fc__elevation"
            :style="{ aspectRatio: `${p.W} / ${p.H}` }"
          >
            <div
              v-for="b in preview"
              :key="b.i"
              class="fc__band"
              :class="`fc__band--${b.type}`"
              :style="{ flexGrow: Math.max(1, b.h) }"
            >
              <span>{{ b.label }}</span>
              <small>{{ b.height ? `${Math.round(b.height)} мм` : 'авто' }}</small>
            </div>
            <div v-if="!preview.length" class="fc__band fc__band--open">
              <span>Открытая секция</span>
            </div>
          </div>
          <div class="fc__legend dim">
            Двери — полотна по ширине; ящики — ряды фасадов и короба.
            Высота проёма {{ Math.round(openH) }} мм.
          </div>
        </div>
      </div>

      <footer class="fc__foot">
        <span class="dim">
          Изменения применяются сразу и пересчитывают деталировку.
        </span>
        <span class="spacer"></span>
        <button class="btn btn--primary" @click="emit('close')">Готово</button>
      </footer>
    </section>
  </div>
  </Teleport>
</template>
