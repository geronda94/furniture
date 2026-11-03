/**
 * Импорт плана из чата: SVG → превью и контур → «Применить комнату» → apply.
 * Без vision-модели: SVG/DXF/PDF-текст разбираются на сервере.
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

  const before = await page.evaluate(() => ({
    pid: window.__furnitureDbg.state.projectId,
  }))
  check('демо открыт', !!before.pid, before.pid)

  await page.locator('.ai-launcher').click()
  const panel = page.locator('.ai-panel')
  await panel.locator('input[type=file]').setInputFiles(
    new URL('./fixtures/plan.svg', import.meta.url).pathname)
  await panel.locator('.ai-plan').waitFor({ timeout: 25000 })
  const card = await panel.locator('.ai-plan').innerText()
  check('план распознан: 4200×3100', /4200×3100/.test(card), card.slice(0, 160))
  const apply = panel.getByText('Новый проект по плану', { exact: true })
  check('кнопка «Новый проект по плану» доступна', await apply.isEnabled())

  await apply.click()
  await page.waitForFunction(
    (old) => window.__furnitureDbg.state.projectId !== old, before.pid,
    { timeout: 25000 })
  const newPid = await page.evaluate(() => window.__furnitureDbg.state.projectId)
  check('создан проект по плану', newPid !== before.pid, newPid)
  await panel.locator('.ai-preview').waitFor({ timeout: 25000 })
  const pv = await panel.locator('.ai-preview').innerText()
  check('предпросмотр комнаты', /комната/.test(pv) && /ошибок 0/.test(pv), pv)
  await panel.getByText('Применить', { exact: true }).click()
  await page.waitForTimeout(4500)

  const state = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    return {
      w: s.project.room.w, d: s.project.room.d,
      outline: s.project.room.outline?.length ?? 0,
      instances: s.project.instances.length,
      names: s.project.instances.map((i) => i.name),
    }
  })
  check('комната 4200×3100', state.w === 4200 && state.d === 3100,
    JSON.stringify(state))
  check('проект пустой (только комната)', state.instances === 0,
    JSON.stringify(state.names))

  // Картинка без vision: показываем превью и просим размеры.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64')
  await panel.locator('input[type=file]').setInputFiles({
    name: 'plan.png', mimeType: 'image/png', buffer: png,
  })
  await page.waitForTimeout(2000)
  const card2 = await panel.locator('.ai-plan').innerText()
  check('картинка без vision: размеры не распознаны',
    /размеры не распознаны/.test(card2), card2.slice(0, 140))
  check('картинка без vision: применение недоступно',
    !(await panel.getByText('Новый проект по плану').isEnabled()))

  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
  }, newPid)
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-чат: импорт плана SVG → комната через preview/apply работает.')
