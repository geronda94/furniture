/**
 * Умный фокус камеры при клике по объекту/детали.
 *
 * Контракт:
 *  - если объект уже хорошо вписан в кадр, клики по нему и его деталям
 *    НЕ двигают камеру;
 *  - если объект далеко/не в кадре, камера едет к нему плавно (не рывком).
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/camera-focus.mjs
 */
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5176'
let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}   ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)

  const name = 'Мойка 800'
  await page.locator('.tree__instance', { hasText: name }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const r = window.__furnitureRenderer
    r.fit('module', window.__furnitureDbg.state.project.room,
      window.__furnitureDbg.state.selection)
  })
  await page.waitForTimeout(900)

  const cam = () => page.evaluate(() => {
    const r = window.__furnitureRenderer
    return {
      a: +r.orbit.alpha.toFixed(3),
      r: +r.orbit.radius.toFixed(3),
      framed: r.isInstanceWellFramed('i1'),
    }
  })
  const fitted = await cam()
  check('модуль после вписывания считается хорошо видимым', fitted.framed,
    JSON.stringify(fitted))

  const centers = await page.evaluate(() => {
    const r = window.__furnitureRenderer
    const out = []
    for (const m of r.roots.get('i1')?.getChildMeshes() ?? []) {
      if (m.metadata?.part == null) continue
      const c = m.getBoundingInfo().boundingBox.centerWorld
      const p = r.project(c.x / 0.001, c.z / 0.001, c.y / 0.001)
      out.push({ x: Math.round(p.x), y: Math.round(p.y) })
    }
    return out
  })
  const cb = await page.locator('canvas.view__canvas').first().boundingBox()
  check('у модуля есть детали для клика', centers.length > 0, `точек ${centers.length}`)

  for (const p of centers.slice(0, 2)) {
    const before = await cam()
    await page.mouse.click(cb.x + p.x, cb.y + p.y)
    await page.waitForTimeout(550)
    const after = await cam()
    check('клик по детали не сбивает удобный ракурс',
      Math.abs(before.r - after.r) < 0.01 && Math.abs(before.a - after.a) < 0.01,
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  }

  // Ставим камеру далеко: фокус должен поехать плавно.
  await page.evaluate(() => {
    const r = window.__furnitureRenderer
    r.orbit.target.set(4.5, 1.35, 3.5)
    r.orbit.radius = 16
  })
  await page.waitForTimeout(300)
  const far = await cam()
  check('издалека объект не считается вписанным', !far.framed, JSON.stringify(far))

  await page.evaluate(() => {
    window.__furnitureRenderer.focusInstance('i1', 'front', 1, 1, true)
  })
  const radii = []
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(80)
    radii.push((await cam()).r)
  }
  await page.waitForTimeout(500)
  const end = await cam()
  const moving = radii.some((r) => r < far.r - 0.2 && r > end.r + 0.05)
  check('камера едет к объекту плавно, а не рывком', moving,
    JSON.stringify(radii))
  check('после фокуса объект вписан', end.framed, JSON.stringify(end))
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nУмный фокус камеры: контракт соблюдён.')
