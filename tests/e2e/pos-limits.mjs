/**
 * Ограничения при смещении модуля по осям X/Y/Z из быстрой карточки.
 *
 * Контракт:
 *  - в стену/соседа/потолок модуль не уезжает;
 *  - при упоре значение подрезается до ближайшего допустимого и показывается
 *    сообщение; поле возвращает фактическое значение;
 *  - навесной шкаф не опускается ниже безопасных 1100 мм.
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/pos-limits.mjs
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

  const info = () => page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const i = s.project.instances.find((x) => x.id === s.selection)
    return {
      id: i.id, x: i.x, y: i.y, z: i.z || 0,
      W: i.params.W, D: i.params.D, H: i.params.H, rot: i.rot,
      roomW: s.project.room.w, roomD: s.project.room.d,
      roomH: s.project.room.h,
      toast: window.__furnitureDbg.ui.toast?.text ?? '',
    }
  })
  const overlaps = () => page.evaluate(() => {
    const s = window.__furnitureDbg.state
    const me = s.project.instances.find((x) => x.id === s.selection)
    const box = (i) => {
      const p = i.params
      const W = p.W
      const D = p.D
      const swap = Math.abs(i.rot % 180) === 90
      const total = p.mount === 'wall' ? p.H
        : (p.plinthH || 0) + p.H + (p.worktopT || 0)
      const z0 = i.z || 0
      return {
        x: i.x, y: i.y, w: swap ? D : W, d: swap ? W : D,
        z0, z1: z0 + total, id: i.id,
      }
    }
    const a = box(me)
    const hits = []
    for (const i of s.project.instances) {
      if (i.id === me.id) continue
      const b = box(i)
      if (a.x < b.x + b.w - 0.05 && a.x + a.w > b.x + 0.05 &&
          a.y < b.y + b.d - 0.05 && a.y + a.d > b.y + 0.05 &&
          a.z0 < b.z1 - 0.5 && a.z1 > b.z0 + 0.5) hits.push(i.name)
    }
    return hits
  })
  async function setField(label, value) {
    const f = page.locator('.object-modal .field', { hasText: label }).locator('input')
    await f.fill(String(value))
    await f.press('Enter')
    await page.waitForTimeout(900)
    return f
  }

  // X: сосед вплотную — расширяться/сдвигаться в него нельзя
  await page.locator('.tree__instance', { hasText: 'Мойка 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  const errorsBefore = await page.evaluate(() =>
    window.__furniture?.layoutState?.issues
      ?.filter((i) => i.level === 'error').length ?? 0)
  const p0 = await info()
  const xf = await setField('X', 2000)
  const p1 = await info()
  check('не уезжает в соседний модуль по X', p1.x === p0.x, `${p0.x} -> ${p1.x}`)
  check('поле X возвращает фактическое значение',
    await xf.inputValue() === String(p1.x), await xf.inputValue())
  check('показано ограничение по X',
    /Не помещается|Ограничено/.test(p1.toast), p1.toast)

  // Y: за пределы комнаты не выпускает. Берём модуль в свободной зоне,
  // чтобы не проверять сцену у мойки в другой комнате.
  await page.locator('.tree__instance', { hasText: 'Пенал-холодильник 650' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  const yf = await setField('Y', 9999)
  const p2 = await info()
  check('по Y не выезжает за комнату', p2.y < 9999 && p2.y + p2.D <= p2.roomD + 0.5,
    `y=${p2.y}, D=${p2.D}, roomD=${p2.roomD}`)
  check('поле Y показывает фактическое значение',
    await yf.inputValue() === String(p2.y), await yf.inputValue())
  check('показано ограничение по Y',
    /Ограничено/.test(p2.toast), p2.toast)
  check('после сдвига по Y нет пересечений', (await overlaps()).length === 0,
    JSON.stringify(await overlaps()))

  // Z: навесной не опускается в базу и ниже безопасной высоты
  await page.locator('.tree__instance', { hasText: 'Навесной 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  const zf = await setField('Z', 0)
  const p3 = await info()
  check('навесной не опускается ниже 1100 мм', p3.z >= 1100,
    `z=${p3.z}`)
  check('верх навесного не выше потолка', p3.z + p3.H <= p3.roomH + 0.5,
    `${p3.z}+${p3.H} <= ${p3.roomH}`)
  check('поле Z показывает фактическое значение',
    await zf.inputValue() === String(p3.z), await zf.inputValue())
  check('показано ограничение по Z', /Ограничено/.test(p3.toast), p3.toast)
  check('после сдвига по Z нет пересечений', (await overlaps()).length === 0,
    JSON.stringify(await overlaps()))

  const issueErrors = await page.evaluate(() =>
    window.__furniture?.layoutState?.issues
      ?.filter((i) => i.level === 'error').length ?? 0)
  check('новых ошибок расстановки нет',
    issueErrors <= errorsBefore, `${errorsBefore} -> ${issueErrors}`)
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nОграничения при смещении по осям: контракт соблюдён.')
