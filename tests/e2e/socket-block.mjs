/**
 * Физика: розетка/выступ на стене не даёт поставить модуль вплотную сквозь
 * себя, но позволяет прижаться к её краю. Проверяем координату и подсказку.
 *
 * BASE_URL=http://127.0.0.1:5176 node tests/e2e/socket-block.mjs
 */
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
let failures = 0
const check = (n, c, d = '') => {
  console.log(`${c ? 'ok  ' : 'FAIL'}   ${n}${d ? '  ' + d : ''}`)
  if (!c) failures++
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 40000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(1200)

  const setup = await page.evaluate(async () => {
    const rows = await (await fetch('/api/projects')).json()
    const src = rows.projects[0].id
    const doc = await (await fetch('/api/projects/' + src)).json()
    const pid = 'e2e-socket-' + Date.now().toString(36)
    doc.name = 'E2E socket block'
    delete doc._solutions
    doc.instances = []
    doc.props = []
    doc.folders = []
    doc.room.w = 3000
    doc.room.d = 3000
    doc.room.h = 2700
    doc.room.wallT = 100
    doc.room.outline = [[0, 0], [3000, 0], [3000, 3000], [0, 3000]]
    doc.room.partitions = []
    doc.room.openings = []
    doc.room.wallItems = [{
      id: 'w-socket', kind: 'socket', wall: 0, x: 1000, z: 300,
      w: 80, h: 80, depth: 12,
    }]
    const put = await fetch('/api/projects/' + pid, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    })
    const add = await fetch(`/api/projects/${pid}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actions: [{
          op: 'add_instance', preset: 'base600',
          x: 600, y: 560, rot: 180,
        }],
        commit: true,
      }),
    })
    const addJson = await add.json().catch(() => ({}))
    localStorage.setItem('furniture.project', pid)
    return { pid, put: put.status, add: add.status, addJson }
  })
  check('проект с розеткой создан', setup.put === 200 && setup.add === 200,
    JSON.stringify(setup))

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.waitForTimeout(500)

  const before = await page.evaluate(() => {
    const st = window.__furnitureDbg.state
    return {
      id: st.project.instances[0]?.id,
      name: st.project.instances[0]?.name,
      x: st.project.instances[0]?.x,
      items: st.project.room.wallItems,
    }
  })
  check('модуль и розетка в проекте',
    !!before.id && before.items?.length === 1,
    JSON.stringify(before))

  const seam = await page.evaluate(() => {
    const st = window.__furnitureDbg.state
    const inst = st.project.instances[0]
    const r = window.__furnitureRenderer
    const root = r.roots.get(inst.id)
    // rot = 180: задняя грань в мировых координатах = root.z - D
    const back = (root?.position?.z || 0) - inst.params.D / 1000
    return { back, D: inst.params.D }
  })
  check('мебель не утопает в стене (зазор 1.5 мм)',
    seam.back > 0.0005 && seam.back < 0.003,
    `back=${seam.back.toFixed(4)} м`)

  await page.getByText(before.name, { exact: true }).first().click()
  await page.waitForTimeout(400)
  const xInput = page.locator('input[aria-label="X"]')
  await xInput.fill('1600')
  await xInput.evaluate((el) => el.dispatchEvent(
    new Event('change', { bubbles: true })))
  await page.waitForTimeout(700)

  const after = await page.evaluate(() => {
    const st = window.__furnitureDbg.state
    return {
      x: st.project.instances[0]?.x,
      toast: document.querySelector('.toast')?.textContent || '',
    }
  })
  check('модуль не прошёл сквозь розетку',
    after.x >= 900 && after.x <= 1010, `x=${after.x}`)
  check('есть предупреждение про розетку',
    /розетк/i.test(after.toast), after.toast.trim())
  check('ошибок консоли нет', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}
if (failures) process.exit(1)
console.log('\nРозетка/выступ на стене блокирует модуль, предупреждение выдаётся.')
