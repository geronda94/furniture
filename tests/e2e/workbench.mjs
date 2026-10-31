/**
 * Карточка модуля: вкладки «Сборка» и «Смета» вынесены в компоненты —
 * проверяем, что они открываются, считают данные и не дают ошибок.
 *
 * Запуск: BASE_URL=http://127.0.0.1:4173 node tests/e2e/workbench.mjs
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

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 40000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.waitForTimeout(800)

  const row = page.locator('.tree__row--item', { hasText: 'Тумба 800' }).first()
  await (await row.count() ? row : page.locator('.tree__row--item').first()).click()
  await page.waitForTimeout(1000)
  const openFull = page.getByText('Детали и конструктор', { exact: false }).first()
  if (await openFull.count()) await openFull.click()
  await page.waitForTimeout(1500)

  const tabs = page.locator('.wb__tab')
  check('карточка модуля открылась', await page.locator('.wb').count() > 0)
  check('вкладок 9', await tabs.count() === 9, String(await tabs.count()))

  await tabs.filter({ hasText: 'Сборка' }).first().click()
  await page.waitForTimeout(800)
  const lists = page.locator('.wb__lists')
  const asm = await lists.innerText()
  check('«Сборка»: карта присадки', /КАРТА ПРИСАДКИ/.test(asm))
  check('«Сборка»: фильтры операций', await page.locator('.wb__chips .chip').count() > 0,
    String(await page.locator('.wb__chips .chip').count()))
  check('«Сборка»: карты деталей', await page.locator('.wb__map').count() > 0,
    String(await page.locator('.wb__map').count()))

  await tabs.filter({ hasText: 'Фасады' }).first().click()
  await page.waitForTimeout(700)
  const fronts = await lists.innerText()
  check('«Фасады»: блоки и превью', /Только двери/.test(fronts) &&
    await page.locator('.fc-block').count() > 0,
    String(await page.locator('.fc-block').count()))
  check('«Фасады»: схема высот', await page.locator('.fc__elevation').count() > 0)

  await tabs.filter({ hasText: 'Смета' }).first().click()
  await page.waitForTimeout(800)
  const cost = await lists.innerText()
  check('«Смета»: заголовок', /Смета модуля/i.test(cost))
  check('«Смета»: строки и итог', /С НДС/.test(cost) && (cost.match(/×/g) || []).length > 2)
  check('ошибок консоли нет', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nКарточка модуля: вкладки работают.')
