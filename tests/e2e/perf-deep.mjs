/**
 * Глубокий замер производительности: ПК, Android (Redmi 14C), iOS (iPhone).
 *
 * Измеряем то, что не зависит от программного GPU песочницы:
 *   - FPS приложения (движок) и FPS кадров;
 *   - время фаз кадра: отрисовка, анимации (tickAnim), стены;
 *   - JS-работу цикла без отрисовки (мс в секунду) — это CPU-бутылочное горло;
 *   - long tasks (> 50 мс) — из-за них «подвисает» канвас;
 *   - draw calls, треугольники, меши, материалы, память;
 *   - 2D: развёртки и план (свой canvas, без WebGL);
 *   - задержку от касания до следующего отрисованного кадра.
 *
 * GPU здесь программный (SwiftShader): абсолютный FPS — нижняя граница,
 * зато JS-время, draw calls и long tasks сравнимы с телефоном.
 * Redmi 14C дополнительно прогоняем с троттлингом CPU ×4.
 *
 *   BASE_URL=https://5176.it2b.top node tests/e2e/perf-deep.mjs
 *   PROFILES=redmi-14c node tests/e2e/perf-deep.mjs
 */
let chromium
let devices = {}
try {
  ({ chromium, devices } = await import('playwright'))
} catch {
  ({ chromium, devices } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const ONLY = (process.env.PROFILES || '').split(',').filter(Boolean)
const SECONDS = Number(process.env.SECONDS || 8)

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; 23128PC33G) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'

const PROFILES = [
  { label: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  {
    label: 'redmi-14c',
    options: {
      viewport: { width: 720, height: 1640 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, userAgent: ANDROID_UA,
    },
  },
  {
    label: 'redmi-14c-4x',
    options: {
      viewport: { width: 720, height: 1640 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, userAgent: ANDROID_UA,
    },
    throttle: 4,
  },
  {
    label: 'iphone-13',
    options: devices['iPhone 13'] || {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
].filter((p) => !ONLY.length || ONLY.includes(p.label))

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})

/** Ставит счётчики фаз и кадров. Возвращает id для снятия. */
const instrument = () => {
  const r = window.__furnitureRenderer
  const scene = r.scene
  const acc = (window.__deep = {
    anim: 0, walls: 0, render: 0, frames: 0, raf: 0,
    frameTimes: [], long: [], start: performance.now(), lastFrame: 0,
  })
  const wrap = (obj, name, key) => {
    const orig = obj[name].bind(obj)
    obj[name] = (...args) => {
      const t0 = performance.now()
      const v = orig(...args)
      acc[key] += performance.now() - t0
      return v
    }
    return () => { obj[name] = orig }
  }
  window.__deepUnpatch = [
    wrap(scene, 'render', 'render'),
    wrap(r, 'tickAnim', 'anim'),
    wrap(r, 'updateWalls', 'walls'),
  ]
  scene.registerAfterRender(() => {
    const now = performance.now()
    if (acc.lastFrame) acc.frameTimes.push(now - acc.lastFrame)
    acc.lastFrame = now
    acc.frames++
  })
  const tick = () => {
    acc.raf++
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration > 20 && e.duration < 60000) acc.long.push(e.duration)
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* нет API */ }
}

/** Снять показатели и обнулить счётчики. */
const readAndReset = () => {
  const acc = window.__deep
  const r = window.__furnitureRenderer
  const el = (performance.now() - acc.start) / 1000
  const frames = acc.frames || 1
  const ft = acc.frameTimes.slice().sort((a, b) => a - b)
  const pct = (q) => (ft.length ? +ft[Math.floor(ft.length * q)].toFixed(1) : 0)
  const stats = window.__furniturePerf || {}
  const out = {
    sec: +el.toFixed(1),
    appFps: Math.round(r.scene.getEngine().getFps()),
    rafFps: Math.round(acc.raf / el),
    frames: acc.frames,
    renderMs: +(acc.render / frames).toFixed(2),
    animMs: +(acc.anim / frames).toFixed(2),
    wallsMs: +(acc.walls / frames).toFixed(2),
    animSec: +(acc.anim / el).toFixed(0),
    wallsSec: +(acc.walls / el).toFixed(0),
    frameP50: pct(0.5),
    frameP95: pct(0.95),
    longCount: acc.long.length,
    longP95: acc.long.length
      ? Math.round(acc.long.slice().sort((a, b) => a - b)[
        Math.floor(acc.long.length * 0.95)])
      : 0,
    draw: stats.drawCalls, tris: stats.triangles, meshes: stats.meshes,
    materials: stats.materials, heap: stats.heap, quality: stats.quality,
    renderer: stats.renderer,
  }
  acc.anim = 0; acc.walls = 0; acc.render = 0; acc.frames = 0; acc.raf = 0
  acc.frameTimes = []; acc.long = []; acc.start = performance.now()
  acc.lastFrame = 0
  return out
}

async function measure2d(page, label) {
  return page.evaluate(async (label) => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => x.textContent.trim() === label)
    b?.click()
    await new Promise((res) => setTimeout(res, 1200))
    const t0 = performance.now()
    let n = 0
    await new Promise((res) => {
      const step = () => {
        n++
        if (performance.now() - t0 > 2000) res()
        else requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
    return +(n / ((performance.now() - t0) / 1000)).toFixed(0)
  }, label)
}

async function run(profile) {
  const ctx = await browser.newContext({ ...profile.options, locale: 'ru-RU' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const cdp = await ctx.newCDPSession(page)
  if (profile.throttle && profile.throttle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.throttle })
  }

  const t0 = Date.now()
  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 90000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForFunction(() => !!window.__furnitureRenderer, { timeout: 40000 })
  const loadMs = Date.now() - t0

  await page.waitForTimeout(4000)          // прогрев
  await page.evaluate(instrument)
  await page.waitForTimeout(SECONDS * 1000)
  const normal = await page.evaluate(readAndReset)

  // JS без отрисовки: сколько стоит сам цикл (анимации + стены)
  await page.evaluate(() => {
    const r = window.__furnitureRenderer
    window.__realRender = r.scene.render
    r.scene.render = () => {}
  })
  await page.waitForTimeout(SECONDS * 1000)
  const jsOnly = await page.evaluate(readAndReset)
  await page.evaluate(() => {
    const r = window.__furnitureRenderer
    r.scene.render = window.__realRender
  })

  // касание → следующий отрисованный кадр
  const inputLag = await page.evaluate(async () => {
    const r = window.__furnitureRenderer
    const el = r.canvas
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const t = performance.now()
    const next = new Promise((res) => {
      const obs = r.scene.onAfterRenderObservable.add(() => {
        r.scene.onAfterRenderObservable.remove(obs)
        res(performance.now() - t)
      })
    })
    el.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 7, pointerType: 'touch', clientX: x, clientY: y,
      bubbles: true, isPrimary: true, button: 0, buttons: 1,
    }))
    const dt = await next
    el.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 7, pointerType: 'touch', clientX: x, clientY: y,
      bubbles: true, isPrimary: true, button: 0, buttons: 0,
    }))
    return +dt.toFixed(1)
  })

  const wallsFps = await measure2d(page, '2D-стены').catch(() => null)
  const planFps = await measure2d(page, 'План').catch(() => null)

  await ctx.close()
  return {
    label: profile.label, ok: true, loadMs, inputLag, wallsFps, planFps,
    normal, jsOnly, errors: errors.slice(0, 3),
  }
}

const rows = []
try {
  for (const p of PROFILES) {
    try {
      rows.push(await run(p))
    } catch (e) {
      rows.push({ label: p.label, ok: false, error: String(e).slice(0, 200) })
    }
  }
} finally {
  await browser.close()
}

const pad = (v, n) => String(v ?? '—').padEnd(n)
console.log(pad('профиль', 14) + pad('appFPS', 8) + pad('кадр p50/p95', 14) +
  pad('render', 8) + pad('anim', 7) + pad('walls', 7) +
  pad('JS/сек', 9) + pad('long', 8) + pad('draw', 6) + pad('память', 8) +
  pad('2D стены/план', 15) + 'ввод')
for (const r of rows) {
  if (!r.ok) { console.log(pad(r.label, 14) + 'FAIL ' + r.error); continue }
  const n = r.normal
  const js = r.jsOnly
  console.log(
    pad(r.label, 14) + pad(n.appFps, 8) +
    pad(`${n.frameP50}/${n.frameP95}`, 14) +
    pad(n.renderMs, 8) + pad(n.animMs, 7) + pad(n.wallsMs, 7) +
    pad(`${js.animSec + js.wallsSec} мс`, 9) +
    pad(n.longCount ? `${n.longCount}×${n.longP95}` : '0', 8) +
    pad(n.draw, 6) + pad(`${n.heap} MB`, 8) +
    pad(`${r.wallsFps ?? '—'}/${r.planFps ?? '—'}`, 15) +
    `${r.inputLag} мс`,
  )
}
const ren = rows.find((r) => r.ok)?.normal?.renderer || '—'
console.log(`\nрендерер: ${ren}`)
console.log('загрузка демо: ' + rows.filter((r) => r.ok)
  .map((r) => `${r.label} ${(r.loadMs / 1000).toFixed(1)} с`).join(', '))
for (const r of rows) {
  if (r.ok && r.errors?.length) console.log('ошибки консоли:', r.label, r.errors.join(' | '))
}
