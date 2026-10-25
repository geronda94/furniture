<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import NumField from './NumField.vue'
import MaterialPanel from './MaterialPanel.vue'
import MaterialVarsPanel from './MaterialVarsPanel.vue'
import {
  applyGlobalsToAll,
  runners,
  setGlobals,
  setProjectPricing,
  state,
  ui,
  type BackKind,
  type Frame,
  type Hardware,
  type ProjectGlobals,
  type Reinforce,
} from '../state/project'
import { apiPricingOptions, type PricingOptions } from '../api'

const emit = defineEmits<{ (e: 'close'): void }>()
const tab = ref<'globals' | 'materials' | 'vars' | 'pricing'>(ui.settingsTab)

const g = () => state.project.globals

function set<K extends keyof ProjectGlobals>(
  key: K,
  value: ProjectGlobals[K],
): void {
  setGlobals({ [key]: value } as Partial<ProjectGlobals>)
}

function onThickness(e: Event): void {
  set('t', Number((e.target as HTMLSelectElement).value))
}
function onBack(e: Event): void {
  set('back', (e.target as HTMLSelectElement).value as BackKind)
}
function onReinforce(e: Event): void {
  set('reinforce', (e.target as HTMLSelectElement).value as Reinforce)
}
function onFrame(e: Event): void {
  set('frame', (e.target as HTMLSelectElement).value as Frame)
}
function onHardware(e: Event): void {
  set('hardware', (e.target as HTMLSelectElement).value as Hardware)
}
function onRunner(e: Event): void {
  set('runners', (e.target as HTMLSelectElement).value)
}

const pricing = ref<PricingOptions | null>(null)
onMounted(() => {
  apiPricingOptions().then((o) => (pricing.value = o)).catch(() => {})
})
const shops = computed(() =>
  (pricing.value?.shops ?? []).filter(
    (s) => !state.project.market || s.market === state.project.market,
  ),
)
const activeMarket = computed(() =>
  pricing.value?.markets.find((m) => m.id === state.project.market) ?? null,
)
function setMarket(e: Event): void {
  const market = (e.target as HTMLSelectElement).value
  const shop = pricing.value?.shops.find((s) => s.market === market)
  setProjectPricing({ market, ...(shop ? { shop: shop.id } : {}) })
}
function setShop(e: Event): void {
  setProjectPricing({ shop: (e.target as HTMLSelectElement).value })
}
function setSupplier(e: Event): void {
  setProjectPricing({ supplier: (e.target as HTMLSelectElement).value })
}
</script>

<template>
  <Teleport to="body">
    <div class="modal modal--settings" @click.self="emit('close')">
      <section class="modal__win settings" role="dialog" aria-modal="true" aria-label="Настройки проекта">
        <header class="modal__head">
          <span class="modal__title">Проект</span>
          <span class="modal__sub">глобальные переменные и материалы</span>
          <div class="modal__tools">
            <button
              class="btn btn--sm"
              @click="ui.settingsOpen = false; ui.versionsOpen = true"
            >Версии…</button>
            <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="settings__tabs">
          <button
            class="wb__tab"
            :class="{ 'wb__tab--on': tab === 'globals' }"
            @click="tab = 'globals'"
          >Глобальные</button>
          <button
            class="wb__tab"
            :class="{ 'wb__tab--on': tab === 'materials' }"
            @click="tab = 'materials'"
          >Материалы проекта</button>
          <button
            class="wb__tab"
            :class="{ 'wb__tab--on': tab === 'vars' }"
            @click="tab = 'vars'"
          >Переменные</button>
          <button
            class="wb__tab"
            :class="{ 'wb__tab--on': tab === 'pricing' }"
            @click="tab = 'pricing'"
          >Цены и рынок</button>
        </div>

        <div v-if="tab === 'globals'" class="settings__body">
          <p class="settings__lead">
            Значения по умолчанию для всех модулей. Модуль может переопределить
            любое поле — тогда изменение глобального значения его не тронет.
          </p>

          <div class="settings__grid">
            <label class="field">
              <span class="field__label">Толщина ЛДСП</span>
              <select class="select" :value="g().t" @change="onThickness">
                <option :value="10">10 мм</option>
                <option :value="16">16 мм</option>
                <option :value="18">18 мм</option>
                <option :value="22">22 мм</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Задняя стенка</span>
              <select class="select" :value="g().back" @change="onBack">
                <option value="dvp">ДВП</option>
                <option value="same">Тот же ЛДСП</option>
                <option value="cardboard">Картон</option>
                <option value="none">Нет</option>
              </select>
            </label>
            <NumField
              label="Толщина задней, мм" :value="g().backT" :min="1" :max="18"
              :step="1" :disabled="g().back === 'none'"
              @change="set('backT', $event)"
            />
            <label class="field">
              <span class="field__label">Каркас</span>
              <select class="select" :value="g().frame" @change="onFrame">
                <option value="inset">Вкладной</option>
                <option value="overlay">Накладной</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Крыша корпуса</span>
              <button
                class="btn btn--sm"
                :class="{ 'btn--primary': g().roof }"
                @click="set('roof', !g().roof)"
              >{{ g().roof ? 'Есть' : 'Нет' }}</button>
            </label>
            <label class="field">
              <span class="field__label">Царги</span>
              <select class="select" :value="g().reinforce" @change="onReinforce">
                <option value="auto">Авто</option>
                <option value="on">Всегда</option>
                <option value="off">Нет</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Петли</span>
              <select class="select" :value="g().hardware" @change="onHardware">
                <option value="blum">Blum</option>
                <option value="hettich">Hettich</option>
                <option value="gtv">GTV</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Направляющие</span>
              <select class="select" :value="g().runners" @change="onRunner">
                <option v-for="r in runners" :key="r.id" :value="r.id">
                  {{ r.brand }} · {{ r.name }}
                </option>
              </select>
            </label>
            <NumField
              label="Цоколь, мм" :value="g().plinthH" :min="0" :max="300"
              :step="10" @change="set('plinthH', $event)"
            />
            <NumField
              label="Столешница, мм" :value="g().worktopT" :min="0" :max="80"
              :step="1" @change="set('worktopT', $event)"
            />
            <NumField
              label="Зазор по бокам" :value="g().gapSide" :min="0" :max="10"
              :step="0.5" @change="set('gapSide', $event)"
            />
            <NumField
              label="Зазор между фасадами" :value="g().gapBetween" :min="1" :max="8"
              :step="0.5" @change="set('gapBetween', $event)"
            />
            <NumField
              label="Зазор сверху" :value="g().gapTop" :min="0" :max="10"
              :step="0.5" @change="set('gapTop', $event)"
            />
            <NumField
              label="Зазор снизу" :value="g().gapBottom" :min="0" :max="10"
              :step="0.5" @change="set('gapBottom', $event)"
            />
          </div>

          <div class="settings__auto">
            <label class="check">
              <input
                type="checkbox"
                :checked="g().autoApply"
                @change="set('autoApply', ($event.target as HTMLInputElement).checked)"
              />
              <span>Применять изменения сразу ко всем модулям</span>
            </label>
            <button class="btn btn--sm" @click="applyGlobalsToAll">
              Применить ко всем (сбросить переопределения)
            </button>
          </div>

          <p class="dim settings__hint">
            Модуль, у которого поле изменено вручную, помечается как
            переопределённый. Сброс — в карточке модуля.
          </p>
        </div>

        <div v-else-if="tab === 'materials'" class="settings__body">
          <MaterialPanel />
          <p class="dim settings__hint">
            Базовые материалы по ролям. Если для части изделия задана переменная
            материала — она имеет приоритет над этим значением. Материал модуля
            перекрывает и переменные, и проект.
          </p>
        </div>

        <div v-else-if="tab === 'vars'" class="settings__body">
          <MaterialVarsPanel />
        </div>

        <div v-else-if="tab === 'pricing'" class="settings__body">
          <p class="settings__lead">
            Рынок задаёт валюту и НДС, цех — формат листа, раскрой, кромку и
            сборку, поставщик — цены фурнитуры. Сметы всех модулей
            пересчитываются сразу.
          </p>
          <div class="settings__grid">
            <label class="field">
              <span class="field__label">Рынок</span>
              <select class="select" :key="`m-${pricing?.markets.length ?? 0}`" :value="state.project.market" @change="setMarket">
                <option v-for="m in pricing?.markets ?? []" :key="m.id" :value="m.id">
                  {{ m.name }} · {{ m.currency }} · НДС {{ m.vat_percent }}%
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Цех</span>
              <select class="select" :key="`s-${shops.map((x) => x.id).join(',')}`" :value="state.project.shop" @change="setShop">
                <option v-for="s in shops" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Поставщик фурнитуры</span>
              <select class="select" :key="`u-${pricing?.suppliers.length ?? 0}`" :value="state.project.supplier" @change="setSupplier">
                <option v-for="s in pricing?.suppliers ?? []" :key="s.id" :value="s.id">
                  {{ s.name }}
                </option>
              </select>
            </label>
          </div>
          <div v-if="activeMarket" class="settings__price-note">
            <b>{{ activeMarket.name }}</b> · {{ activeMarket.currency }}
            ({{ activeMarket.symbol }}) · {{ activeMarket.source }}
          </div>
          <p class="dim">
            Прайсы: <code>specs/pricing/&lt;market&gt;.yaml</code>,
            цеха — <code>specs/shops.yaml</code>, поставщики —
            <code>specs/suppliers.yaml</code>. Значения стартовые: сверить с цехом.
          </p>
        </div>
      </section>
    </div>
  </Teleport>
</template>
