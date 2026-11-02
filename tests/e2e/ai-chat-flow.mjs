/**
 * Сквозной ИИ-чат без реальной LLM: подменяем /api/ai/chat, проверяем
 * tool-call → preview → apply → reload. Так проверяется вся механика чата,
 * не тратя токены и не завися от ключа.
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

  await page.route('**/api/ai/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true, provider: 'mock', model: 'mock', tools: 3 }),
  }))
  let calls = 0
  let sawToolResult = false
  await page.route('**/api/ai/chat', async (route) => {
    calls++
    const body = route.request().postDataJSON()
    if (Array.isArray(body.messages) && body.messages.some((m) => m.role === 'tool')) {
      sawToolResult = true
    }
    if (calls === 1) {
      const id = await page.evaluate(() =>
        window.__furnitureDbg.state.project.instances[0]?.id)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          model: 'mock',
          message: {
            role: 'assistant',
            content: 'Переименую модуль для проверки.',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'update_module',
                arguments: JSON.stringify({ id, name: 'ИИ-тест' }),
              },
            }],
          },
          usage: {},
        }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          model: 'mock',
          message: { role: 'assistant', content: 'Готово к применению.', tool_calls: [] },
          usage: {},
        }),
      })
    }
  })

  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)

  const { id, originalName, pid } = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const first = s.project.instances[0]
    return { id: first?.id, originalName: first?.name, pid: s.projectId }
  })
  await page.locator('.ai-launcher').click()
  const panel = page.locator('.ai-panel')
  await page.waitForTimeout(800)
  check('ввод доступен при настроенном ИИ',
    !(await panel.locator('textarea').isDisabled()))
  await panel.locator('textarea').fill('Переименуй первый модуль в ИИ-тест')
  await panel.locator('textarea').press('Enter')
  await panel.locator('.ai-preview').waitFor({ timeout: 20000 })
  check('tool-call обработан', sawToolResult)
  check('предпросмотр показан', await panel.locator('.ai-preview').count() === 1)
  const previewText = await panel.locator('.ai-preview').innerText()
  check('в предпросмотре есть изменения и цена',
    /модулей|изменено/.test(previewText) && /смета/.test(previewText), previewText)
  const apply = panel.getByText('Применить', { exact: true })
  check('кнопка «Применить» есть', await apply.count() === 1)
  await apply.click()
  await page.waitForTimeout(3500)
  const name = await page.evaluate((id) =>
    window.__furnitureDbg.state.project.instances.find((i) => i.id === id)?.name, id)
  check('изменение применено и проект перезагружен', name === 'ИИ-тест',
    String(name))
  // Вернуть демо-проект в исходное имя, чтобы не засорять окружение.
  await page.evaluate(async ({ pid, id, name }) => {
    await fetch(`/api/projects/${pid}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actions: [{ op: 'update_instance', id, name }],
        commit: true,
        strict: true,
      }),
    })
  }, { pid, id, name: originalName })
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-чат: сквозной сценарий tool-call → preview → apply работает.')
