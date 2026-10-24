<script setup lang="ts">
const props = defineProps<{
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'change', value: number): void }>()

function clampVal(v: number): number {
  const lo = props.min ?? -Infinity
  const hi = props.max ?? Infinity
  return Math.min(hi, Math.max(lo, v))
}

function bump(dir: number) {
  emit('change', clampVal(props.value + dir * (props.step ?? 1)))
}

function commit(e: Event) {
  const v = (e.target as HTMLInputElement).valueAsNumber
  if (Number.isFinite(v)) emit('change', clampVal(v))
}
</script>

<template>
  <div class="field">
    <span class="field__label">{{ label }}</span>
    <div class="numfield">
      <button
        class="numfield__btn"
        type="button"
        :disabled="disabled"
        :aria-label="`Уменьшить: ${label}`"
        @click="bump(-1)"
      >
        −
      </button>
      <input
        class="numfield__input"
        type="number"
        :min="min"
        :max="max"
        :step="step ?? 1"
        :value="value"
        :disabled="disabled"
        :aria-label="label"
        @change="commit"
      />
      <button
        class="numfield__btn"
        type="button"
        :disabled="disabled"
        :aria-label="`Увеличить: ${label}`"
        @click="bump(1)"
      >
        +
      </button>
    </div>
  </div>
</template>
