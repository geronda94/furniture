/**
 * Контракт управления камерой на сенсоре.
 *
 * Правила (с 2026-10-28):
 *   - палец и мышь вращают сцену одинаково: «хватаем и тянем» —
 *     свайп вправо двигает сцену вправо;
 *   - джойстик: вверх — вперёд по взгляду, вправо — вправо;
 *   - прогулка отключена в интерфейсе (см. docs/39-walk-disabled.md).
 *
 * Запуск: BASE_URL=http://127.0.0.1:4173 node tests/e2e/touch.mjs
 * Нужен `?perf=1`: только там renderer доступен из window.
 * При другой версии Playwright: PW_CHROME=/path/to/chrome.
 */
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}   ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

async function openDemo(page) {
  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 40000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(5500)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForFunction(() => !!window.__furnitureRenderer, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(600)
}

async function swipe(cdp, page, x0, y0, dx, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }],
  })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x0 + (i * dx) / steps, y: y0, id: 1 }],
    })
    await page.waitForTimeout(30)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(450)
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})

try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2,
  })
  const mp = await mobile.newPage()
  await openDemo(mp)
  const cdp = await mobile.newCDPSession(mp)

  // --- орбита: свайп вправо двигает сцену вправо ---
  // Направление читаем по alpha камеры: проекция точек на телефоне шумит
  // (часть комнаты уходит за камеру). Сцена идёт за пальцем, когда при
  // свайпе вправо alpha уменьшается.
  const alpha = () => mp.evaluate(() => window.__furnitureRenderer.orbit.alpha)
  const x0 = await alpha()
  await swipe(cdp, mp, 300, 500, 105)
  const x1 = await alpha()
  check('свайп вправо двигает сцену вправо', x1 < x0 - 0.02,
    `alpha ${x0.toFixed(2)} → ${x1.toFixed(2)}`)

  // --- прогулка отключена в интерфейсе (docs/39) ---
  const walkBtn = await mp.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((x) => x.textContent.trim() === 'Прогулка').length)
  check('прогулка отключена в интерфейсе', walkBtn === 0)

  // --- подписи ролика внутри круга и не лезут на кнопки Z ---
  const pad = await mp.evaluate(() => {
    const joy = document.querySelector('.campad__joy').getBoundingClientRect()
    const z = document.querySelector('.campad__z').getBoundingClientRect()
    const out = {}
    for (const k of ['w', 'a', 's', 'd']) {
      const b = document.querySelector('.campad__key--' + k)
        .getBoundingClientRect()
      out[k] = {
        inside: b.left >= joy.left - 1 && b.right <= joy.right + 1 &&
          b.top >= joy.top - 1 && b.bottom <= joy.bottom + 1,
        overZ: b.right > z.left && b.left < z.right,
      }
    }
    return out
  })
  check('подписи осей внутри ролика',
    Object.values(pad).every((v) => v.inside))
  check('подписи не перекрывают кнопки высоты',
    Object.values(pad).every((v) => !v.overZ))
  await mobile.close()

  // --- ПК: мышь вращает в ту же сторону, что палец ---
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const dp = await desktop.newPage()
  await openDemo(dp)
  const mx0 = await dp.evaluate(() => window.__furnitureRenderer.orbit.alpha)
  await dp.mouse.move(700, 500)
  await dp.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await dp.mouse.move(700 + i * 13, 500)
    await dp.waitForTimeout(30)
  }
  await dp.mouse.up()
  await dp.waitForTimeout(400)
  const mx1 = await dp.evaluate(() => window.__furnitureRenderer.orbit.alpha)
  check('мышь и палец двигают сцену одинаково', Math.sign(mx1 - mx0) === Math.sign(x1 - x0),
    `mouse ${(mx1 - mx0).toFixed(0)} / touch ${(x1 - x0).toFixed(0)}`)
  await desktop.close()
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nКонтракт сенсорной камеры соблюдён.')
