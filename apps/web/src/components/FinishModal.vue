<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import NumField from './NumField.vue'
import {
  addFinish, finishCalc, removeFinish, state, ui, updateFinish,
  type Finish,
} from '../state/project'
import { apiMaterials, type CatalogMaterial } from '../api'

const emit = defineEmits<{ (e: 'close'): void }>()
const materials = ref<CatalogMaterial[]>([])
const form = reactive<Finish>({
  id: '', name: 'Пол', kind: 'floor', x: 0, y: 0, w: 2000, d: 2000,
  material: 'Плитка белая 300×300', color: '#e8e7e2',
  tileW: 300, tileH: 300, grout: 2, waste: 10, price_m2: 1250,
})

onMounted(async () => {
  apiMaterials()
    .then((cats) => {
      materials.value = cats
        .filter((c) => ['tile', 'floor', 'plaster'].includes(c.id))
        .flatMap((c) => c.items)
    })
    .catch(() => {})
  const room = state.project.room
  const src = ui.finishId
    ? state.project.finishes?.find((f) => f.id === ui.finishId)
    : null
  if (src) Object.assign(form, JSON.parse(JSON.stringify(src)))
  else Object.assign(form, {
    id: '', name: 'Пол', kind: 'floor',
    x: 0, y: 0, w: Math.round(room.w / 2), d: Math.round(room.d / 2),
    material: 'Плитка белая 300×300', color: '#e8e7e2',
    tileW: 300, tileH: 300, grout: 2, waste: 10, price_m2: 1250,
  })
})

const calc = computed(() => finishCalc(form))
const isTile = computed(() =>
  /плитк|керамогранит/i.test(form.material) || form.kind === 'wall',
)

function pickMaterial(e: Event): void {
  const name = (e.target as HTMLSelectElement).value
  const m = materials.value.find((x) => x.name === name)
  form.material = name
  if (m) {
    form.color = m.color
    form.price_m2 = m.price_m2 ?? form.price_m2
    if (/600/.test(m.name)) { form.tileW = 600; form.tileH = 600 }
    if (/300/.test(m.name)) { form.tileW = 300; form.tileH = 300 }
    if (/200/.test(m.name)) { form.tileW = 200; form.tileH = 200 }
  }
}

function save(): void {
  if (form.id) updateFinish(form.id, { ...form })
  else addFinish({ ...form })
  emit('close')
}
function del(): void {
  if (form.id && window.confirm('Удалить отделку?')) {
    removeFinish(form.id)
    emit('close')
  }
}
function num(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--finish" @click.self="emit('close')">
      <section class="modal__win finish" role="dialog" aria-modal="true"
        aria-label="Отделка и расчёт плитки">
        <header class="modal__head">
          <span class="modal__title">{{ form.id ? 'Отделка' : 'Новая отделка' }}</span>
          <span class="modal__sub">площадь, плитка, швы и стоимость</span>
          <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
        </header>
        <div class="finish__body">
          <div class="wb__row wb__row--2">
            <label class="field"><span class="field__label">Название</span>
              <input class="input" :value="form.name"
                @input="form.name = ($event.target as HTMLInputElement).value" />
            </label>
            <label class="field"><span class="field__label">Поверхность</span>
              <select class="select" :value="form.kind"
                @change="form.kind = ($event.target as HTMLSelectElement).value as Finish['kind']">
                <option value="floor">Пол</option>
                <option value="wall">Стена</option>
                <option value="ceiling">Потолок</option>
              </select>
            </label>
          </div>
          <div class="finish__grid">
            <NumField label="X, мм" :value="form.x" :min="0" :max="20000" :step="10" @change="form.x = $event" />
            <NumField label="Y, мм" :value="form.y" :min="0" :max="20000" :step="10" @change="form.y = $event" />
            <NumField label="Ширина, мм" :value="form.w" :min="100" :max="20000" :step="10" @change="form.w = $event" />
            <NumField label="Глубина/высота, мм" :value="form.d" :min="100" :max="20000" :step="10" @change="form.d = $event" />
          </div>
          <label class="field"><span class="field__label">Материал из библиотеки</span>
            <select class="select" :value="form.material" @change="pickMaterial">
              <option v-for="m in materials" :key="m.id" :value="m.name">{{ m.name }}</option>
            </select>
          </label>
          <div class="wb__row wb__row--2">
            <label class="field"><span class="field__label">Цвет</span>
              <input type="color" class="finish__color" :value="form.color"
                @input="form.color = ($event.target as HTMLInputElement).value" />
            </label>
            <NumField label="Цена, за м²" :value="form.price_m2" :min="0" :max="100000" :step="10" @change="form.price_m2 = $event" />
          </div>
          <div v-if="isTile" class="finish__grid">
            <NumField label="Плитка W, мм" :value="form.tileW" :min="10" :max="2000" :step="10" @change="form.tileW = $event" />
            <NumField label="Плитка H, мм" :value="form.tileH" :min="10" :max="2000" :step="10" @change="form.tileH = $event" />
            <NumField label="Шов, мм" :value="form.grout" :min="0" :max="20" :step="0.5" @change="form.grout = $event" />
            <NumField label="Запас, %" :value="form.waste" :min="0" :max="50" :step="1" @change="form.waste = $event" />
          </div>
          <div class="finish__calc">
            <div><span>Площадь</span><b>{{ calc.area }} м²</b></div>
            <div><span>Плиток</span><b>{{ calc.tiles }} шт</b></div>
            <div><span>Упаковок</span><b>{{ calc.boxes }}</b></div>
            <div><span>Затирка</span><b>≈{{ calc.groutKg }} кг</b></div>
            <div><span>Стоимость</span><b>{{ calc.cost }} {{ state.project.market === 'eu' ? '€' : 'lei' }}</b></div>
          </div>
        </div>
        <footer class="finish__foot">
          <button v-if="form.id" class="btn btn--sm wb__danger" @click="del">Удалить</button>
          <span class="statusbar__spacer"></span>
          <button class="btn btn--sm" @click="emit('close')">Отмена</button>
          <button class="btn btn--sm btn--primary" @click="save">Сохранить</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
