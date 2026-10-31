/**
 * Библиотека объектов: категория «Мебель» с субкатегориями, мягкая мебель,
 * кровати, столы; добавление объекта в проект.
 *
 * Запуск: BASE_URL=http://127.0.0.1:4173 node tests/e2e/library.mjs
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

  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 40000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.waitForTimeout(800)

  await page.getByRole('button', { name: /Добавить/ }).first().click()
  await page.waitForTimeout(700)
  const chips = await page.locator('.add__groups .chip').allTextContents()
  check('субкатегории мебели', ['Корпусная', 'Мягкая мебель', 'Кровати',
    'Столы и стулья'].every((c) => chips.includes(c)), chips.join(', '))

  await page.getByRole('button', { name: 'Мягкая мебель', exact: true }).click()
  await page.waitForTimeout(300)
  let names = await page.locator('.cat-card .cat-card__name').allTextContents()
  await page.getByRole('button', { name: 'Корпусная', exact: true }).click()
  await page.waitForTimeout(300)
  const corpusNames = await page.locator('.cat-card .cat-card__name').allTextContents()
  check('угловой модуль в корпусной',
    corpusNames.some((n) => n.includes('Угловой')), corpusNames.slice(-4).join(', '))
  await page.getByRole('button', { name: 'Мягкая мебель', exact: true }).click()
  await page.waitForTimeout(300)
  check('мягкая мебель: диваны и кресла',
    names.some((n) => n.includes('Диван')) &&
    names.some((n) => n.includes('Кресло')), names.join(', '))

  const before = await page.evaluate(() =>
    window.__furnitureDbg.state.project.props.length)
  await page.locator('.cat-card', { hasText: 'Диван 2-местный' }).click()
  await page.waitForTimeout(700)
  const after = await page.evaluate(() =>
    window.__furnitureDbg.state.project.props.length)
  check('диван добавляется', after === before + 1, `${before} → ${after}`)

  await page.getByRole('button', { name: /Добавить/ }).first().click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Кровати', exact: true }).click()
  await page.waitForTimeout(300)
  names = await page.locator('.cat-card .cat-card__name').allTextContents()
  check('кровати 900–1800', ['900', '1200', '1600', '1800'].every((w) =>
    names.some((n) => n.includes(w))), names.join(', '))

  check('ошибок консоли нет', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nБиблиотека объектов: субкатегории и мягкая мебель работают.')
