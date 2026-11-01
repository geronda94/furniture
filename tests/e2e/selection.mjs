/**
 * Выделение и подсветка граней размеров.
 *
 * Контракт:
 *  - обычный клик — всегда один активный элемент: либо модуль, либо деталь;
 *  - Shift/Ctrl/Alt — только они добавляют/убирают из группы;
 *  - клик по пустому месту снимает и модуль, и деталь;
 *  - размеры подсвечивают реальные рёбра (line.view__dims-edge), а не
 *    поперечные засечки; вырожденные (в точку) рёбра не рисуются.
 *
 * Запуск: BASE_URL=http://127.0.0.1:5176 node tests/e2e/selection.mjs
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
  await page.waitForTimeout(600)

  const activeModules = () => page.locator('.tree__row--item.is-active').count()
  const activeParts = () => page.locator('.tree__row--part.is-active').count()

  const name = 'Мойка 800'
  const node = page.locator('.tree__instance', { hasText: name }).first()
  await node.locator('.tree__row--item').click()
  await page.waitForTimeout(700)
  check('клик по модулю: один активный модуль', await activeModules() === 1)
  check('клик по модулю: активных деталей нет', await activeParts() === 0)

  const modal = await page.locator('.object-modal').boundingBox()
  const sidebar = await page.locator('.sidebar').boundingBox()
  check('быстрая карточка стоит у боковой панели',
    !!modal && !!sidebar && Math.abs(modal.x + modal.width - (sidebar.x - 12)) < 5,
    modal && sidebar
      ? `карточка ${Math.round(modal.x + modal.width)}, панель ${Math.round(sidebar.x)}`
      : 'нет карточки/панели')

  // Полки внутри закрытых дверей скрыты — открываем двери, чтобы деталь
  // была видна и контур выбора строился по её мешу.
  const doors = page.getByRole('button', { name: /Двери/ })
  if (await doors.count()) {
    await doors.first().click().catch(() => {})
    await page.waitForTimeout(500)
  }

  // раскрыть детали модуля и выбрать полку
  await node.locator('.tree__twist').first().click()
  await page.waitForTimeout(300)
  await node.locator('.tree__row--sub').first().click()
  await page.waitForTimeout(300)
  const partRows = node.locator('.tree__row--part')
  const texts = await partRows.allInnerTexts()
  const shelf = texts.findIndex((t) => /Полка/i.test(t))
  check('у модуля есть деталь «Полка»', shelf >= 0, `строк ${texts.length}`)
  if (shelf >= 0) {
    await partRows.nth(shelf).click()
    await page.waitForTimeout(700)
    check('клик по детали: активных модулей 0', await activeModules() === 0)
    check('клик по детали: активна ровно одна деталь', await activeParts() === 1)
    const hull = await page.evaluate(() => {
      const p = document.querySelector('.view__sel polygon, .view__sel polyline')
      return p ? p.getAttribute('points')?.trim().split(/\s+/).length ?? 0 : 0
    })
    check('обводка идёт по контуру детали', hull >= 3, `точек ${hull}`)
  }

  // клик по другому модулю снимает деталь
  const other = page.locator('.tree__instance', { hasText: 'Тумба 800' }).first()
  await other.locator('.tree__row--item').click()
  await page.waitForTimeout(600)
  check('другой модуль: один активный, деталей нет',
    await activeModules() === 1 && await activeParts() === 0)

  // группа — только с модификатором
  const second = page.locator('.tree__instance', { hasText: 'Тумба 600' }).first()
  await second.locator('.tree__row--item').click({ modifiers: ['Control'] })
  await page.waitForTimeout(500)
  check('Ctrl+клик добавляет в группу', await activeModules() === 2)
  await page.locator('.tree__instance', { hasText: 'Тумба 800' }).first()
    .locator('.tree__row--item').click()
  await page.waitForTimeout(500)
  check('обычный клик по участнику группы её схлопывает', await activeModules() === 1)
  await page.locator('.tree__instance', { hasText: 'Тумба 600' }).first()
    .locator('.tree__row--item').click({ modifiers: ['Alt'] })
  await page.waitForTimeout(500)
  check('Alt+клик тоже добавляет в группу', await activeModules() === 2)

  // размеры на детали: подсветка реальных рёбер
  await page.evaluate(() => { window.__furnitureDbg.ui.dims3d = true })
  if (shelf >= 0) {
    await node.locator('.tree__row--item').click()
    await page.waitForTimeout(500)
    // Модуль уже раскрыт выше — повторный клик по « twist» его закрыл бы.
    if (await node.locator('.tree__row--part').count() === 0) {
      await node.locator('.tree__twist').first().click()
      await page.waitForTimeout(300)
      await node.locator('.tree__row--sub').first().click()
      await page.waitForTimeout(300)
    }
    await node.locator('.tree__row--part').nth(shelf).click()
    await page.waitForTimeout(900)
  }
  const edges = await page.evaluate(() => [...document.querySelectorAll('.view__dims-edge')].map((l) => {
    const x1 = +l.getAttribute('x1'); const y1 = +l.getAttribute('y1')
    const x2 = +l.getAttribute('x2'); const y2 = +l.getAttribute('y2')
    return { len: Math.hypot(x2 - x1, y2 - y1), stroke: getComputedStyle(l).stroke }
  }))
  check('подсветка граней есть', edges.length > 0, `рёбер ${edges.length}`)
  check('вырожденных рёбер нет', edges.every((e) => e.len >= 5))
  const perDim = await page.evaluate(() => [...document.querySelectorAll('.view__dims > g')]
    .map((g) => g.querySelectorAll('.view__dims-edge').length))
  check('у размера между объектами подсвечены обе грани',
    perDim.some((n) => n >= 2), JSON.stringify(perDim))
  check('цвета размеров используются',
    edges.some((e) => e.stroke === 'rgb(216, 166, 255)') &&
    edges.some((e) => e.stroke === 'rgb(255, 210, 138)'))
  // Оранжевая обводка/силуэт детали больше не должны перекрывать цветные
  // рёбра размеров; объёмная wireframe-рамка при включённых размерах скрыта.
  const glow = await page.evaluate(() => {
    const r = window.__furnitureRenderer
    let outline = 0
    let orange = 0
    for (const m of r.scene.meshes) {
      if (m.renderOutline) outline++
      const c = m.edgesColor
      if (c && c.r > 0.9 && c.g > 0.45 && c.g < 0.85 && c.b < 0.3) orange++
    }
    const box = r.scene.meshes.find((m) => m.name === 'selection')
    return { outline, orange, box: box ? box.isEnabled() : null }
  })
  check('нет оранжевой обводки детали', glow.outline === 0 && glow.orange === 0,
    JSON.stringify(glow))
  check('объёмная рамка скрыта при размерах', glow.box === false)
  check('ошибок консоли нет', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nВыделение и подсветка граней: контракт соблюдён.')
