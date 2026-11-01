/**
 * Внешние размеры: расстояния от выбранного модуля до стен и соседних
 * объектов. Отдельная кнопка «Снаружи», своя палитра (стена — светлая,
 * объект — серая), не путается с размерами деталей.
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/outer-dims.mjs
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

  await page.locator('.tree__instance', { hasText: 'Мойка 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(800)

  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)
  const dimGroup = page.locator('.view__group[aria-label="Размеры"]')
  const insideBtn = dimGroup.locator('.tab', { hasText: 'Внутри' })
  const outsideBtn = dimGroup.locator('.tab', { hasText: 'Снаружи' })
  check('есть две отдельные кнопки размеров',
    await insideBtn.count() === 1 && await outsideBtn.count() === 1)

  // Оставляем только внешние размеры
  if (await insideBtn.evaluate((el) => el.classList.contains('tab--active'))) {
    await insideBtn.click()
  }
  await outsideBtn.click()
  await page.waitForTimeout(900)

  const dims = await page.evaluate(() => [...document.querySelectorAll('.view__dims > g')].map((g) => ({
    text: g.querySelector('text')?.textContent ?? '',
    hint: g.querySelector('title')?.textContent ?? '',
    stroke: g.querySelector('line')?.style.stroke ?? '',
  })))
  check('внешние размеры есть', dims.length > 0, JSON.stringify(dims))
  check('есть расстояние до стены', dims.some((d) => d.hint === 'до стены'),
    JSON.stringify(dims))
  check('внутренних размеров деталей нет',
    !dims.some((d) => /^[ШВГТ↕←→↑↓] /.test(d.text) && !d.hint.includes('стен') &&
      !d.hint.includes('«')))
  check('стена светлая, объект серый',
    dims.every((d) => d.stroke === 'rgb(223, 231, 238)' || d.stroke === 'rgb(158, 171, 184)'),
    dims.map((d) => d.stroke).join(' | '))

  // Сдвигаем модуль: слева остаётся 50 до стены, справа — 50 до соседа.
  await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const i = s.project.instances.find((x) => x.name === 'Мойка 800')
    if (i) i.x = 50
  })
  await page.waitForTimeout(700)
  const dims2 = await page.evaluate(() => [...document.querySelectorAll('.view__dims > g')].map((g) => ({
    text: g.querySelector('text')?.textContent ?? '',
    hint: g.querySelector('title')?.textContent ?? '',
    stroke: g.querySelector('line')?.style.stroke ?? '',
  })))
  check('есть расстояние до соседнего объекта',
    dims2.some((d) => d.hint.includes('«') && d.stroke === 'rgb(158, 171, 184)'),
    JSON.stringify(dims2))

  // Выключаем внешние — размеров не остаётся
  await outsideBtn.click()
  await page.waitForTimeout(500)
  const left = await page.locator('.view__dims > g').count()
  check('внешние размеры выключаются', left === 0, `осталось ${left}`)
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nВнешние размеры: контракт соблюдён.')
