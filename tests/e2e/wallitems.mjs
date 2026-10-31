/**
 * Розетки/выключатели: перетаскивание по развёртке стены.
 * Запуск: BASE_URL=http://127.0.0.1:4173 node tests/e2e/wallitems.mjs
 */
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
let failures = 0
const check = (n, c, d = '') => {
  console.log(`${c ? 'ok  ' : 'FAIL'}   ${n}${d ? '  ' + d : ''}`)
  if (!c) failures++
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 40000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(6500)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.waitForTimeout(600)

  await page.locator('[data-tour="more"]').click()
  await page.getByRole('button', { name: 'Быстрый старт' }).click()
  await page.waitForTimeout(400)
  await page.locator('.quick__name input').fill('Розетки')
  await page.getByRole('button', { name: 'Создать проект' }).click()
  await page.waitForTimeout(9000)

  const item = await page.evaluate(() =>
    window.__furnitureDbg.state.project.room.wallItems[0])
  check('розетка создана', !!item, JSON.stringify(item))

  await page.getByRole('button', { name: '2D-стены', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.locator('.wallview__tab').nth(2).click()
  await page.waitForTimeout(800)

  const geom = await page.evaluate(() => {
    const st = window.__furnitureDbg.state
    const room = st.project.room
    const c = document.querySelector('.wallview__canvas')
    const r = c.getBoundingClientRect()
    const len = room.w
    const sc = Math.min((r.width - 68) / len, (r.height - 102) / room.h)
    const ox = 42 + (r.width - 68 - len * sc) / 2
    const oy = 54 + (r.height - 102 + room.h * sc) / 2
    const it = room.wallItems[0]
    return {
      x: r.left + ox + (it.x + it.w / 2) * sc,
      y: r.top + oy - (it.z + it.h / 2) * sc,
      sc, before: { x: it.x, z: it.z },
    }
  })
  await page.mouse.move(geom.x, geom.y)
  await page.mouse.down()
  await page.mouse.move(geom.x + 120, geom.y - 60, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() =>
    window.__furnitureDbg.state.project.room.wallItems[0])
  check('розетка сдвинулась по X', after.x > geom.before.x + 50,
    `${geom.before.x} → ${after.x}`)
  check('розетка сдвинулась по Z', after.z > geom.before.z + 20,
    `${geom.before.z} → ${after.z}`)
  check('ошибок консоли нет', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}
if (failures) process.exit(1)
console.log('\nНастенные предметы перетаскиваются по развёртке.')
