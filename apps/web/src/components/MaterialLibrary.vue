<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiMaterials, type CatalogMaterial, type MaterialCategory } from '../api'
import { setMaterial, setTexture } from '../state/project'
import type { Material } from '../render25d/types'

const props = defineProps<{
  role: string
  label: string
  instanceId?: string
  /** pick — вернуть выбранный материал наружу, не применяя */
  mode?: 'apply' | 'pick'
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', payload: { material?: Material; texture?: string }): void
}>()

const categories = ref<MaterialCategory[]>([])
const active = ref('Все')
const query = ref('')
const url = ref('')
const busy = ref(false)
const error = ref('')

const all = computed(() =>
  categories.value.flatMap((c) => c.items.map((i) => ({ ...i, category: c.name }))),
)
const groups = computed(() => ['Все', ...categories.value.map((c) => c.name)])
const items = computed(() => {
  const q = query.value.trim().toLowerCase()
  return all.value.filter((i) => {
    if (active.value !== 'Все' && i.category !== active.value) return false
    return !q || `${i.name} ${i.category} ${i.brand || ''} ${i.code || ''}`
      .toLowerCase().includes(q)
  })
})

onMounted(async () => {
  busy.value = true
  try {
    categories.value = await apiMaterials()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
})

function apply(item: CatalogMaterial): void {
  const material: Material = {
    name: item.name,
    color: item.color,
    accent: item.accent || item.color,
    pattern: (item.pattern || 'solid') as Material['pattern'],
    texScale: item.texScale,
  }
  if (props.mode === 'pick') {
    emit('pick', { material, texture: item.texture_url })
    emit('close')
    return
  }
  setMaterial(props.role, material, props.instanceId)
  setTexture(props.role, item.texture_url || null, props.instanceId)
  emit('close')
}

function applyUrl(): void {
  const u = url.value.trim()
  if (!u) return
  if (props.mode === 'pick') {
    emit('pick', { texture: u })
    emit('close')
    return
  }
  setTexture(props.role, u, props.instanceId)
  emit('close')
}

/** Сжать фото текстуры в квадрат 512 px, чтобы data URL не раздувал проект. */
async function onFile(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const bitmap = await createImageBitmap(file)
  const side = 512
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const scale = Math.max(side / bitmap.width, side / bitmap.height)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h)
  const texture = canvas.toDataURL('image/jpeg', 0.82)
  if (props.mode === 'pick') {
    emit('pick', { texture })
    emit('close')
    return
  }
  setTexture(props.role, texture, props.instanceId)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal" @click.self="emit('close')">
      <section class="modal__win matlib" role="dialog" aria-modal="true" aria-label="Библиотека материалов">
        <header class="modal__head">
          <span class="modal__title">Библиотека материалов</span>
          <span class="modal__sub">{{ label }}</span>
          <div class="modal__tools">
            <button class="btn btn--ghost btn--sm" @click="emit('close')">×</button>
          </div>
        </header>
        <div class="matlib__body">
          <div class="matlib__filters">
            <input v-model="query" class="input" type="search" placeholder="Поиск: дуб, графит, штукатурка…" />
            <div class="matlib__chips">
              <button
                v-for="g in groups" :key="g"
                class="chip" :class="{ 'chip--on': active === g }"
                @click="active = g"
              >{{ g }}</button>
            </div>
          </div>
          <div v-if="busy" class="dim">Загрузка каталога…</div>
          <div v-else-if="error" class="issues"><li>{{ error }}</li></div>
          <div v-else class="matlib__grid">
            <button
              v-for="m in items" :key="m.id"
              class="matcard"
              @click="apply(m)"
            >
              <span
                class="matcard__swatch"
                :style="m.texture_url
                  ? { backgroundImage: `url(${m.texture_url})`, backgroundSize: 'cover', borderColor: m.accent || m.color }
                  : { background: m.color, borderColor: m.accent || m.color }"
              ></span>
              <span class="matcard__name">{{ m.name }}</span>
              <span v-if="m.brand || m.code" class="matcard__brand">
                {{ [m.brand, m.code].filter(Boolean).join(' · ') }}
              </span>
              <span class="matcard__meta">
                {{ m.category }}
                <template v-if="m.price_m2"> · {{ m.price_m2 }} ₽/м²</template>
              </span>
            </button>
          </div>
          <div class="matlib__url">
            <span class="field__label">Своя текстура: фото или URL</span>
            <div class="matlib__url-row">
              <input v-model="url" class="input" placeholder="https://…/texture.jpg" />
              <button class="btn btn--sm" @click="applyUrl">Применить</button>
              <label class="btn btn--sm matlib__file">
                Загрузить фото
                <input type="file" accept="image/*" @change="onFile" />
              </label>
            </div>
            <span class="matlib__hint">
              Фото сжимается до 512×512 и сохраняется в проекте. Для бесшовной
              текстуры лучше квадратный кадр без бликов.
            </span>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
