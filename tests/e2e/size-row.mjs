/**
 * Быстрая смена габаритов модуля из карточки объекта.
 *
 * Контракт:
 *  - в быстрой карточке после «Положения» есть ряд «Размеры модуля» (Ш/В);
 *  - меняется размер всего модуля, а не выбранной детали;
 *  - после смены пересчитываются детали: 3D-габарит объекта меняется.
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/size-row.mjs
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
  await page.waitForTimeout(400)

  await page.locator('.tree__instance', { hasText: 'Мойка 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(700)

  const modal = page.locator('.object-modal')
  const wField = modal.locator('.field', { hasText: 'Ш' }).locator('input')
  const hField = modal.locator('.field', { hasText: 'В' }).locator('input')
  check('в карточке есть ряд размеров модуля',
    await wField.count() === 1 && await hField.count() === 1)

  const params = () => page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const i = s.project.instances.find((x) => x.id === s.selection)
    return { W: i.params.W, H: i.params.H, id: i.id }
  })
  const bbox = () => page.evaluate(() => {
    const r = window.__furnitureRenderer
    const s = window.__furnitureDbg.state
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9
    for (const m of r.roots.get(s.selection)?.getChildMeshes() ?? []) {
      m.computeWorldMatrix(true)
      const bb = m.getBoundingInfo().boundingBox
      minX = Math.min(minX, bb.minimumWorld.x); maxX = Math.max(maxX, bb.maximumWorld.x)
      minY = Math.min(minY, bb.minimumWorld.y); maxY = Math.max(maxY, bb.maximumWorld.y)
      minZ = Math.min(minZ, bb.minimumWorld.z); maxZ = Math.max(maxZ, bb.maximumWorld.z)
    }
    return {
      h: +(maxY - minY).toFixed(4),
      span: +Math.max(maxX - minX, maxZ - minZ).toFixed(4),
    }
  })

  const p0 = await params()
  const b0 = await bbox()
  async function waitBbox(pred, ms = 9000) {
    const t0 = Date.now()
    let b = await bbox()
    while (Date.now() - t0 < ms && !pred(b)) {
      await page.waitForTimeout(300)
      b = await bbox()
    }
    return b
  }
  await modal.locator('button[aria-label="Увеличить: В"]').click()
  await page.waitForTimeout(600)
  const p1 = await params()
  const b1 = await waitBbox((b) => b.h > b0.h + 0.005)
  check('высота меняется у модуля, не у детали', p1.H === p0.H + 10,
    `${p0.H} -> ${p1.H}`)
  check('детали пересчитаны: габарит по высоте вырос', b1.h > b0.h + 0.005,
    `${b0.h} -> ${b1.h}`)

  // Этот модуль стоит вплотную к соседу: расширять в него нельзя.
  await modal.locator('button[aria-label="Увеличить: Ш"]').click()
  await page.waitForTimeout(900)
  const p2 = await params()
  const toast = await page.evaluate(() => window.__furnitureDbg.ui.toast?.text ?? '')
  check('ширина не уходит в соседний модуль/стену', p2.W === p1.W,
    `${p1.W} -> ${p2.W}`)
  check('показано ограничение по ширине', /Не помещается|Ограничено/.test(toast), toast)

  // Высокий навесной шкаф: рост упирается в потолок и подрезается.
  await page.locator('.tree__instance', { hasText: 'Навесной 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  const tall = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const i = s.project.instances.find((x) => x.id === s.selection)
    return { H: i.params.H, z: i.z || 0, room: s.project.room.h }
  })
  const hInput2 = page.locator('.object-modal .field', { hasText: 'В' }).locator('input')
  await hInput2.fill('2000')
  await hInput2.press('Enter')
  await page.waitForTimeout(1400)
  const clamped = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const i = s.project.instances.find((x) => x.id === s.selection)
    return { H: i.params.H, z: i.z || 0, room: s.project.room.h, toast: window.__furnitureDbg.ui.toast?.text ?? '' }
  })
  check('высота не пробивает потолок',
    clamped.z + clamped.H <= clamped.room + 0.5,
    `${clamped.z}+${clamped.H} <= ${clamped.room}`)
  check('высота подрезана до допустимой и показано ограничение',
    clamped.H < 2000 && /Ограничено/.test(clamped.toast),
    `${tall.H} -> ${clamped.H}; ${clamped.toast}`)

  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nРазмеры модуля из быстрой карточки: контракт соблюдён.')
