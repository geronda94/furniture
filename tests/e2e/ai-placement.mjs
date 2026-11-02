/**
 * ИИ добавляет модуль без координат — сервер сам ставит его в свободное
 * место. Проверяем: модуль не в стене, валидатор без ошибок, откат.
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
  await page.route('**/api/ai/chat', async (route) => {
    calls++
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          model: 'mock',
          message: {
            role: 'assistant',
            content: 'Добавлю тумбу в свободное место.',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'add_module',
                arguments: JSON.stringify({ preset: 'base600' }),
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
          message: { role: 'assistant', content: 'Готово.', tool_calls: [] },
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

  const before = await page.evaluate(() => ({
    pid: window.__furnitureDbg.state.projectId,
    ids: window.__furnitureDbg.state.project.instances.map((i) => i.id),
  }))
  await page.locator('.ai-launcher').click()
  const panel = page.locator('.ai-panel')
  await panel.locator('textarea').fill('Добавь модуль 600')
  await panel.locator('textarea').press('Enter')
  await panel.locator('.ai-preview').waitFor({ timeout: 20000 })
  check('предпросмотр добавления', true)
  await panel.getByText('Применить', { exact: true }).click()
  await page.waitForTimeout(4000)

  const after = await page.evaluate((ids) => {
    const s = window.__furnitureDbg.state
    const added = s.project.instances.find((i) => !ids.includes(i.id))
    return {
      added: added && {
        id: added.id, x: added.x, y: added.y, rot: added.rot,
        W: added.params.W, D: added.params.D,
      },
      count: s.project.instances.length,
    }
  }, before.ids)
  check('модуль добавлен', !!after.added, String(after.added?.id))
  const layout = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}/layout`)
    return r.json()
  }, before.pid)
  check('валидатор без ошибок', layout.errors === 0,
    `errors=${layout.errors} warnings=${layout.warnings}`)

  if (after.added) {
    const inWall = await page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${pid}/layout`)
      const d = await r.json()
      return (d.issues || []).filter((i) =>
        i.level === 'error' && i.instance &&
        /in-wall|outside|opening|overlap/.test(i.code))
    }, before.pid)
    check('нет ошибок стены/наложения', inWall.length === 0,
      inWall.map((i) => i.code).join(','))
    await page.evaluate(async ({ pid, id }) => {
      await fetch(`/api/projects/${pid}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: [{ op: 'delete_instance', id }],
          commit: true,
          strict: false,
        }),
      })
    }, { pid: before.pid, id: after.added.id })
    const restored = await page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${pid}`)
      return (await r.json()).instances.length
    }, before.pid)
    check('тестовый модуль удалён', restored === before.ids.length,
      String(restored))
  }
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-постановка: модуль встаёт в свободное место, без ошибок.')
