/**
 * ИИ-чат: панель открывается, видит контекст, честно сообщает о настройке.
 * Если DEEPSEEK_API_KEY задан — панель готова к диалогу; если нет — показывает
 * подсказку и блокирует ввод (без падений).
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/ai-chat.mjs
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

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)

  check('кнопка ИИ видна', await page.locator('.ai-launcher').count() === 1)
  await page.locator('.ai-launcher').click()
  const panel = page.locator('.ai-panel')
  check('панель чата открылась', await panel.count() === 1)
  await page.waitForTimeout(1500)
  const text = await panel.innerText()
  check('видит контекст проекта', /Вижу:/.test(text), text.split('\n')[2] || '')
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/ai/status')
    return { status: r.status, body: await r.json() }
  })
  check('статус ИИ доступен', status.status === 200)
  if (!status.body.configured) {
    check('без ключа — подсказка о настройке',
      /DEEPSEEK_API_KEY/.test(text))
    check('без ключа — ввод заблокирован',
      await panel.locator('textarea').isDisabled())
  } else {
    check('с ключом — ввод активен',
      !(await panel.locator('textarea').isDisabled()))
  }
  await panel.locator('.ai-x').click()
  check('панель закрывается', await panel.count() === 0)
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-чат: панель и настройка в порядке.')
