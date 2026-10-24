import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Перетаскивание модального окна с ограничением: центр окна не выходит за экран,
 *  то есть хотя бы половина окна всегда видна. */
export function useModalDrag(win: Ref<HTMLElement | null>) {
  const offset = ref({ x: 0, y: 0 })
  let base: DOMRect | null = null
  let drag: { sx: number; sy: number; ox: number; oy: number } | null = null

  const style = computed(() => ({
    transform: `translate3d(${offset.value.x}px, ${offset.value.y}px, 0)`,
  }))

  function clamp(): void {
    if (!base) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const fitsX = base.width <= vw
    const fitsY = base.height <= vh
    const minX = fitsX ? -base.left : -base.left + base.width / 2
    const maxX = fitsX ? vw - base.right : -base.left + base.width / 2
    const minY = fitsY ? -base.top : -base.top + base.height / 2
    const maxY = fitsY ? vh - base.bottom : -base.top + base.height / 2
    offset.value = {
      x: Math.min(maxX, Math.max(minX, offset.value.x)),
      y: Math.min(maxY, Math.max(minY, offset.value.y)),
    }
  }

  function onDown(e: PointerEvent): void {
    const t = e.target as HTMLElement | null
    if (t?.closest('button, input, select, textarea, a')) return
    if (!win.value) return
    if (!base) {
      const r = win.value.getBoundingClientRect()
      base = new DOMRect(r.left - offset.value.x, r.top - offset.value.y,
        r.width, r.height)
    }
    drag = {
      sx: e.clientX,
      sy: e.clientY,
      ox: offset.value.x,
      oy: offset.value.y,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    e.preventDefault()
  }

  function onMove(e: PointerEvent): void {
    if (!drag) return
    offset.value = {
      x: drag.ox + e.clientX - drag.sx,
      y: drag.oy + e.clientY - drag.sy,
    }
    clamp()
  }

  function onUp(): void {
    drag = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  function onResize(): void {
    base = null
    clamp()
  }

  onMounted(() => {
    requestAnimationFrame(() => {
      if (!win.value) return
      const r = win.value.getBoundingClientRect()
      base = new DOMRect(r.left, r.top, r.width, r.height)
      window.addEventListener('resize', onResize)
    })
  })
  onBeforeUnmount(() => {
    onUp()
    window.removeEventListener('resize', onResize)
  })

  function reset(): void {
    offset.value = { x: 0, y: 0 }
    base = null
  }

  return { style, onDown, reset }
}
