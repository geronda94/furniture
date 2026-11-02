/**
 * ИИ-фундамент: контекст сцены (камера, выделение, комната, объекты,
 * ошибки) и клиентские инструменты (камера/выделение/вид/размеры/снимок).
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/ai-context.mjs
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

  check('ИИ-API доступен', await page.evaluate(() => !!window.__furnitureAI))
  const ctx = await page.evaluate(() => window.__furnitureAI.context())
  check('контекст: схема', ctx?.schema === 'furniture/ai-context@1')
  check('контекст: камера', typeof ctx?.camera?.alphaDeg === 'number'
    && typeof ctx?.camera?.radius === 'number')
  check('контекст: комната', ctx?.room?.w > 0 && ctx?.room?.d > 0)
  check('контекст: объекты', (ctx?.project?.instances?.length ?? 0) > 0
    && (ctx?.project?.props?.length ?? 0) > 0)
  check('контекст: ошибки', typeof ctx?.issues?.errors === 'number')

  const id = ctx?.project?.instances?.[0]?.id
  const selected = await page.evaluate(async (id) => {
    await window.__furnitureAI.run('selection_set', { kind: 'module', id })
    return window.__furnitureAI.context().selection
  }, id)
  check('инструмент: выделить модуль', selected?.kind === 'module' && selected?.id === id,
    JSON.stringify(selected))

  const cam = await page.evaluate(async () => {
    await window.__furnitureAI.run('camera_set', {
      alpha: 30, beta: 60, radius: 5, target: [1, 1, 1],
    })
    return window.__furnitureAI.context().camera
  })
  check('инструмент: камера', Math.abs(cam.alphaDeg - 30) < 1
    && Math.abs(cam.betaDeg - 60) < 1, JSON.stringify(cam))

  const shot = await page.evaluate(async () =>
    window.__furnitureAI.run('scene_screenshot', { max_width: 640 }))
  check('инструмент: снимок канваса',
    shot.ok && String(shot.result).startsWith('data:image/jpeg'),
    shot.ok ? 'data-url' : shot.error)

  const dims = await page.evaluate(async () => {
    await window.__furnitureAI.run('dims_set', { inside: false, outside: true, gaps: false })
    return window.__furnitureAI.context().app.dims
  })
  check('инструмент: размеры', dims.inside === false && dims.outside === true,
    JSON.stringify(dims))

  const tools = await page.evaluate(async () => {
    const r = await fetch('/api/ai/tools')
    return { status: r.status, body: await r.json() }
  })
  check('API: /api/ai/tools', tools.status === 200
    && Array.isArray(tools.body.tools)
    && tools.body.tools.some((t) => t.kind === 'client'),
    `${tools.status}, ${tools.body.tools?.length} инструментов`)

  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-контекст и клиентские инструменты: контракт соблюдён.')
