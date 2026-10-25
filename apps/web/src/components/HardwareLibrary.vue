<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import HardwareIcon from './HardwareIcon.vue'
import { apiHardwareCatalog, type HardwareCatalog } from '../api'

export type HardwareKind =
  | 'handles' | 'hinges' | 'runners' | 'legs'
  | 'gas' | 'shelf' | 'fasteners'

const props = defineProps<{
  kind: HardwareKind
  current?: string
}>()
const emit = defineEmits<{
  (e: 'select', payload: { kind: HardwareKind; id: string }): void
  (e: 'close'): void
}>()

const tab = ref<HardwareKind>(props.kind)
const catalog = ref<HardwareCatalog | null>(null)
onMounted(() => {
  apiHardwareCatalog()
    .then((c) => (catalog.value = c))
    .catch(() => {})
})

interface Card {
  id: string
  name: string
  meta: string
  icon: string
  tags?: string
}

const TABS: { id: HardwareKind; label: string }[] = [
  { id: 'handles', label: 'Ручки' },
  { id: 'hinges', label: 'Петли' },
  { id: 'runners', label: 'Направляющие' },
  { id: 'legs', label: 'Опоры' },
  { id: 'gas', label: 'Патроны' },
  { id: 'shelf', label: 'Полкодержатели' },
  { id: 'fasteners', label: 'Крепёж' },
]

const cards = computed<Card[]>(() => {
  const c = catalog.value
  if (!c) return []
  switch (tab.value) {
    case 'handles':
      return c.handles.map((h) => {
        const kind = (h as { kind?: string }).kind || 'bar'
        return {
          id: h.id, name: h.name, icon: kind,
          meta: `${h.brand || 'generic'} · ${h.centers ? `${h.centers} мм` : 'без межцентрового'}`,
        }
      })
    case 'hinges':
      return c.hinges.map((h) => ({
        id: (h as { brand_key?: string }).brand_key || h.id,
        name: h.name,
        meta: h.brand || '',
        icon: 'hinge',
      }))
    case 'runners':
      return c.drawer_runners.map((r) => ({
        id: r.id, name: r.name, icon: 'runner',
        meta: `${r.brand || 'generic'} · зазор ${r.side_gap} мм`,
      }))
    case 'legs':
      return c.legs.map((l) => ({
        id: l.id, name: l.name, icon: 'leg',
        meta: `${l.holes.length ? `${l.holes.length} отв.` : 'без разметки'}${l.plate ? ` · ${l.plate}×${l.plate}` : ''}`,
      }))
    case 'gas':
      return c.gas_struts.map((g) => ({
        id: g.id, name: g.name, icon: 'gas',
        meta: `${g.brand} · ${g.force_n} Н · до ${g.door_weight_max} кг`,
      }))
    case 'shelf':
      return c.shelf_supports.map((s) => ({
        id: s.id, name: s.name, icon: 'shelf',
        meta: `${s.hole_dia} мм · ${s.note}`,
      }))
    case 'fasteners':
      return c.fasteners.map((f) => ({
        id: f.id, name: f.name, icon: 'fastener',
        meta: `Ø${f.face_dia} / пилот Ø${f.pilot_dia}`,
      }))
  }
  return []
})

function choose(id: string): void {
  emit('select', { kind: tab.value, id })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--hardware" @click.self="emit('close')">
      <section class="modal__win hwlib" role="dialog" aria-modal="true"
        aria-label="Библиотека фурнитуры">
        <header class="modal__head">
          <span class="modal__title">Библиотека фурнитуры</span>
          <span class="modal__sub">выберите модель — она применится к модулю</span>
          <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
        </header>
        <div class="hwlib__tabs">
          <button
            v-for="t in TABS" :key="t.id"
            class="wb__tab" :class="{ 'wb__tab--on': tab === t.id }"
            @click="tab = t.id"
          >{{ t.label }}</button>
        </div>
        <div class="hwlib__body">
          <div v-if="!catalog" class="dim">Загрузка каталога…</div>
          <div v-else class="hwlib__grid">
            <button
              v-for="c in cards" :key="c.id"
              class="hw-card" :class="{ 'hw-card--on': current === c.id }"
              @click="choose(c.id)"
            >
              <HardwareIcon :kind="c.icon" class="hw-card__icon" />
              <span class="hw-card__name">{{ c.name }}</span>
              <span class="hw-card__meta">{{ c.meta }}</span>
            </button>
            <div v-if="!cards.length" class="dim">Нет позиций в каталоге.</div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
