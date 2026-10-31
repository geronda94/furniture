/**
 * Замер 3D: FPS, кадр, draw calls, треугольники, память — на эмуляции
 * устройств (iPhone 13, Pixel 7, ноутбук). Реальный телефон не нужен.
 *
 * Запуск:
 *   BASE_URL=https://5176.it2b.top node tests/e2e/perf.mjs
 *   PROFILES=iphone-13,pixel-7 node tests/e2e/perf.mjs
 *   SECONDS=8 SHOTS=/tmp/furn-perf node tests/e2e/perf.mjs
 *
 * Важно: эмуляция повторяет экран, DPR и тач, но не GPU. Если браузер
 * рендерит программно (SwiftShader), FPS — нижняя оценка; draw calls,
 * треугольники и материалы от GPU не зависят и сравнимы между устройствами.
 * Скрипт печатает строку рендерера, чтобы это было видно.
 */
let chromium
let devices = {}
try {
  ({ chromium, devices } = await import('playwright'))
} catch {
  ({ chromium, devices } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const SHOTS = process.env.SHOTS || '/tmp/furn-perf'
const SECONDS = Number(process.env.SECONDS || 8)
const ONLY = (process.env.PROFILES || '').split(',').filter(Boolean)

const PROFILES = [
  { label: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  {
    label: 'iphone-13',
    options: devices['iPhone 13'] || {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  {
    label: 'pixel-7',
    options: devices['Pixel 7'] || {
      viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2.6,
    },
  },
  {
    label: 'iphone-se',
    options: devices['iPhone SE'] || {
      viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2,
    },
  },
].filter((p) => !ONLY.length || ONLY.includes(p.label))

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})

async function measure(label, options) {
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForFunction(() => !!window.__furnitureRenderer, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)

  const samples = []
  for (let i = 0; i < SECONDS; i++) {
    await page.waitForTimeout(1000)
    const row = await page.evaluate(() => window.__furniturePerf ?? null)
    if (row) samples.push(row)
  }
  await page.screenshot({ path: `${SHOTS}/${label}.png` })
  await ctx.close()

  if (!samples.length) {
    return { label, ok: false, errors }
  }
  const fps = samples.map((s) => s.fps).sort((a, b) => a - b)
  const last = samples[samples.length - 1]
  const avg = fps.reduce((a, b) => a + b, 0) / fps.length
  return {
    label,
    ok: true,
    fps: Math.round(avg),
    p50: fps[Math.floor(fps.length / 2)],
    min: fps[0],
    max: fps[fps.length - 1],
    heap: Math.max(...samples.map((s) => s.heap || 0)),
    meshes: last.meshes,
    active: last.active,
    materials: last.materials,
    textures: last.textures,
    triangles: last.triangles,
    drawCalls: last.drawCalls,
    quality: last.quality,
    lowGpu: last.lowGpu,
    renderer: last.renderer,
    errors,
  }
}

const rows = []
try {
  for (const p of PROFILES) {
    rows.push(await measure(p.label, p.options))
  }
} finally {
  await browser.close()
}

const pad = (v, n) => String(v ?? '—').padEnd(n)
console.log(
  pad('профиль', 12) + pad('FPS', 5) + pad('min', 5) + pad('кадр', 7) +
  pad('draw', 6) + pad('треуг.', 9) + pad('меши', 6) + pad('матер.', 8) +
  pad('память', 9) + 'режим',
)
for (const r of rows) {
  if (!r.ok) {
    console.log(pad(r.label, 12) + 'FAIL  ' + (r.errors?.[0] || 'нет данных'))
    continue
  }
  const frame = r.fps > 0 ? (1000 / r.fps).toFixed(1) : '—'
  console.log(
    pad(r.label, 12) + pad(r.fps, 5) + pad(r.min, 5) + pad(frame, 7) +
    pad(r.drawCalls, 6) + pad(r.triangles, 9) + pad(r.meshes, 6) +
    pad(r.materials, 8) + pad(`${r.heap} MB`, 9) + (r.quality || ''),
  )
}
const renderer = rows.find((r) => r.ok)?.renderer || 'неизвестно'
console.log(`\nрендерер: ${renderer}`)
console.log(`профили: ${rows.map((r) => r.label).join(', ')}`)

const failed = rows.filter((r) => !r.ok)
process.exit(failed.length ? 1 : 0)
