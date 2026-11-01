/**
 * Валидация: пункты можно выбрать и физически исправить.
 * Проверяем на навесном шкафу: опускаем его ниже нормы, затем чиним
 * из панели расстановки (галочка → «Исправить выбранные»).
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/validation.mjs
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
  await page.waitForTimeout(400)

  await page.locator('.tree__instance', { hasText: 'Навесной 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  const zField = page.locator('.object-modal .field', { hasText: 'Z' }).locator('input')
  await zField.fill('1100')
  await zField.press('Enter')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)

  await page.getByText(/расстановка:|Проверить предупреждения/i).first().click()
  const panel = page.locator('.layout-panel')
  let row = panel.locator('.layout-panel__row', { hasText: 'высота навесных' }).first()
  for (let i = 0; i < 24 && !(await row.count()); i++) {
    await page.waitForTimeout(500)
    row = panel.locator('.layout-panel__row', { hasText: 'высота навесных' }).first()
  }
  check('ошибка по высоте навесного появилась', await row.count() === 1)
  check('у пункта есть галочка выбора', await row.locator('input[type=checkbox]').count() === 1)

  await row.locator('input[type=checkbox]').check()
  await page.waitForTimeout(200)
  const bulk = panel.getByText(/Исправить выбранные \(1\)/)
  check('кнопка «Исправить выбранные» активна', await bulk.count() === 1)
  await bulk.click()
  await page.waitForTimeout(3000)

  const left = await panel.locator('.layout-panel__row', { hasText: 'высота навесных' }).count()
  check('ошибка исчезла после исправления', left === 0, `осталось ${left}`)
  const z = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const i = s.project.instances.find((x) => x.id === s.selection)
    return i?.z
  })
  check('шкаф физически поднят к норме', z === 1450, `z=${z}`)
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nВалидация и физические исправления: контракт соблюдён.')
