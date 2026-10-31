/**
 * Быстрый старт: комната + окно/дверь/розетка + кухня → готовый проект
 * с расчётом, сметой и сводкой (детали, раскрой, присадка, фурнитура).
 *
 * Запуск: BASE_URL=http://127.0.0.1:4173 node tests/e2e/quickstart.mjs
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
  await page.waitForTimeout(6500)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.waitForTimeout(600)

  await page.locator('[data-tour="more"]').click()
  await page.getByRole('button', { name: 'Быстрый старт' }).click()
  await page.waitForTimeout(400)
  check('мастер открылся', await page.locator('.quick').count() === 1)

  await page.locator('.quick__name input').fill('Кухня аудит')
  await page.getByRole('button', { name: 'Создать проект' }).click()
  await page.waitForTimeout(9000)

  const st = await page.evaluate(() => ({
    name: window.__furnitureDbg.state.project.name,
    inst: window.__furnitureDbg.state.project.instances.length,
    status: document.querySelector('.statusbar')?.innerText || '',
  }))
  check('проект создан и открыт', st.name === 'Кухня аудит', st.name)
  check('модули расставлены', st.inst >= 4, String(st.inst))
  const extra = await page.evaluate(() => ({
    hood: (window.__furnitureDbg.state.project.props || [])
      .some((p) => p.type === 'hood'),
    annex: window.__furnitureDbg.state.project.instances
      .some((i) => (i.name || '').includes('Антресоль')),
  }))
  // Расстановка проверяется после сохранения (debounce + запрос): ждём текст.
  await page.waitForFunction(
    () => /расстановка:/.test(document.querySelector('.statusbar')?.innerText || ''),
    { timeout: 30000 },
  ).catch(() => {})
  const st2 = await page.evaluate(() => ({
    status: document.querySelector('.statusbar')?.innerText || '',
  }))
  check('вытяжка добавлена', extra.hood)
  check('антресоли добавлены', extra.annex)
  check('расстановка ок', /расстановка: ок/.test(st2.status), st2.status.slice(0, 80))
  check('валидатор ок', /валидатор: ок/.test(st.status))

  await page.locator('[data-tour="more"]').click()
  await page.getByRole('button', { name: 'Готовый проект' }).click()
  await page.waitForTimeout(14000)
  const stats = await page.locator('.result__stats').innerText()
  const rows = await page.locator('.result__table tbody tr').count()
  check('сводка: строки по модулям', rows === st.inst, String(rows))
  check('сводка: детали/листы', /ДЕТАЛЕЙ/.test(stats) && /ЛИСТОВ/.test(stats))
  check('сводка: отверстия', /ОТВЕРСТИЙ/.test(stats) &&
    Number((stats.match(/ОТВЕРСТИЙ\s*\n?\s*(\d+)/) || [])[1] || 0) > 0)
  check('сводка: смета', /СМЕТА/.test(stats) && /lei|RON|EUR/.test(stats))
  const kpd = Number((stats.match(/КПД РАСКРОЯ\s*\n?\s*(\d+)/) || [])[1] || 0)
  // Абсолютный КПД зависит от набора деталей; проверяем, что он не упал
  // до «по-модульного» уровня (было ~45 %).
  check('общий раскрой эффективнее по-модульного', kpd >= 55, `${kpd}%`)
  check('сводка: фурнитура', /Петли/.test(await page.locator('.result').innerText()))
  check('готовность к производству',
    await page.locator('.result__ready.is-ready').count() === 1,
    (await page.locator('.result__ready').innerText()).replace(/\n/g, ' | '))

  // --- Г-образная комната ---
  await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click()
  await page.waitForTimeout(400)
  await page.locator('[data-tour="more"]').click()
  await page.getByRole('button', { name: 'Быстрый старт' }).click()
  await page.waitForTimeout(400)
  await page.locator('.quick__name input').fill('Кухня Г-образная')
  await page.locator('.quick select').first().selectOption('l')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Создать проект' }).click()
  await page.waitForTimeout(10000)
  const lshape = await page.evaluate(() => ({
    outline: window.__furnitureDbg.state.project.room.outline?.length || 0,
    inst: window.__furnitureDbg.state.project.instances.length,
    status: document.querySelector('.statusbar')?.innerText || '',
  }))
  check('Г-образная комната (6 стен)', lshape.outline === 6, String(lshape.outline))
  check('Г-образная: мебель расставлена', lshape.inst >= 2, String(lshape.inst))
  check('Г-образная: расстановка ок', /расстановка: ок/.test(lshape.status),
    lshape.status.slice(0, 80))

  check('ошибок консоли нет', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nБыстрый старт: проект со сметой, раскроем и присадкой готов.')
