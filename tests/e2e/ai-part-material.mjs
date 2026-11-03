/**
 * Материал отдельной детали через ИИ-чат: клиент считает uid детали,
 * сервер сохраняет partOverrides через preview/apply. Проверяем и откат.
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

  let targetId = ''
  let chatCalls = 0
  await page.route('**/api/ai/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true, provider: 'mock', model: 'mock', tools: 10 }),
  }))
  await page.route('**/api/ai/chat', async (route) => {
    chatCalls++
    if (chatCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          model: 'mock',
          message: {
            role: 'assistant',
            content: 'Крашу первую деталь в дуб.',
            tool_calls: [{
              id: 'call_part',
              type: 'function',
              function: {
                name: 'set_part_material',
                arguments: JSON.stringify({
                  id: targetId,
                  part: 0,
                  patch: {
                    name: 'Дуб', color: '#a9825a',
                    accent: '#7c5a36', pattern: 'wood',
                  },
                }),
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
  await page.waitForFunction(() => {
    const d = window.__furnitureDbg?.derived
    const id = window.__furnitureDbg?.state?.project?.instances?.[0]?.id
    return !!(d && id && d[id]?.objects?.length)
  }, null, { timeout: 30000 })

  const before = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    return {
      pid: s.projectId,
      id: s.project.instances[0]?.id,
      overrides: Object.keys(s.project.instances[0]?.partOverrides ?? {}).length,
    }
  })
  targetId = before.id

  await page.locator('.ai-launcher').click()
  const panel = page.locator('.ai-panel')
  await panel.locator('textarea').fill('Покрась первую деталь в дуб')
  await panel.locator('textarea').press('Enter')
  await panel.locator('.ai-preview').waitFor({ timeout: 25000 })
  const pv = await panel.locator('.ai-preview').innerText()
  check('предпросмотр материала детали', /изменено 1/.test(pv) && /ошибок 0/.test(pv), pv)
  await panel.getByText('Применить', { exact: true }).click()
  await page.waitForTimeout(4000)

  const after = await page.evaluate((id) => {
    const inst = window.__furnitureDbg.state.project.instances.find((i) => i.id === id)
    const ov = Object.entries(inst?.partOverrides ?? {})
    return {
      count: ov.length,
      key: ov[0]?.[0] ?? '',
      material: ov[0]?.[1] ?? null,
    }
  }, before.id)
  check('материал детали сохранён', after.count === before.overrides + 1,
    JSON.stringify(after.material))
  check('цвет и узор применились',
    after.material?.color === '#a9825a' && after.material?.pattern === 'wood',
    JSON.stringify(after.material))

  // Откат: сбрасываем оверрайд, чтобы гостевая копия демо осталась чистой.
  await page.evaluate(async ({ pid, id, uid }) => {
    await fetch(`/api/projects/${pid}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actions: [{ op: 'reset_part_override', id, uid }],
        commit: true,
        strict: true,
      }),
    })
  }, { pid: before.pid, id: before.id, uid: after.key })
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-чат: материал отдельной детали через preview/apply работает.')
