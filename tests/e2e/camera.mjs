/**
 * Контракт камеры 3D: вращение «хватаем сцену», панорама роликом, колесо, WASD.
 *
 * Почему отдельный тест: направление вращения ломалось дважды (мышь и палец
 * вели себя по-разному), а панорама средней кнопкой не работала вовсе.
 * Одна точка проекции — плохой индикатор (может стоять на оси вращения),
 * поэтому смотрим средний сдвиг нескольких точек пола и beta камеры.
 *
 * Запуск: BASE_URL=http://127.0.0.1:4173 node tests/e2e/camera.mjs
 * Нужен `?perf=1`: только там renderer доступен из window.
 */
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(6000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  try {
    await page.waitForFunction(() => !!window.__furnitureRenderer, { timeout: 30000 })
  } catch (e) {
    await page.screenshot({ path: '/tmp/furn-ui/camera-timeout.png', timeout: 40000 }).catch(() => {})
    throw e
  }
  await page.waitForTimeout(800)

  const cam = () => page.evaluate(() => {
    const r = window.__furnitureRenderer
    return {
      sensX: r.orbit.angularSensibilityX,
      alpha: +r.orbit.alpha.toFixed(3),
      beta: +r.orbit.beta.toFixed(3),
      radius: +r.orbit.radius.toFixed(3),
      target: r.orbit.target.asArray().map((v) => +v.toFixed(3)),
    }
  })
  // Точки берём внутри текущей комнаты: углы всей квартиры могут уйти за
  // камеру, и проекция «за спиной» переворачивает средний сдвиг.
  const meanX = () => page.evaluate(() => {
    const r = window.__furnitureRenderer
    // Берём площадь текущей комнаты, а не общий контур квартиры: углы
    // всей квартиры могут уйти за камеру и перевернуть средний сдвиг.
    const st = window.__furnitureDbg?.state
    const f = st?.project.folders.find((q) => q.id === st.folderId)
      ?? st?.project.folders[0]
    const rect = f?.area || r.walkRect || { x: 0, y: 0, w: 5200, d: 4200 }
    const pts = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.5, 0.5]]
      .map(([u, v]) => [rect.x + u * rect.w, rect.y + v * rect.d])
    return pts.reduce((s, [x, y]) => s + r.project(x, y, 0).x, 0) / pts.length
  })
  const drag = async (button, dx, dy = 0) => {
    await page.mouse.move(700, 450)
    await page.mouse.down({ button })
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(700 + (i * dx) / 10, 450 + (i * dy) / 10)
      await page.waitForTimeout(20)
    }
    await page.mouse.up({ button })
    await page.waitForTimeout(1100)
  }

  const start = await cam()
  check('чувствительность положительная (сцена за курсором)', start.sensX > 0,
    `sensX=${start.sensX}`)
  // Камера не должна уезжать за пределы сцены: при неверном fit радиус
  // упирался в upperRadiusLimit (40), и было видно только наружную стену.
  check('камера вписана в комнату (радиус < 30 м)', start.radius < 30,
    `radius=${start.radius}`)

  const a = await meanX()
  await drag('left', 160)
  const b = await meanX()
  check('мышь вправо → сцена вправо', b > a + 5, `${a.toFixed(0)} → ${b.toFixed(0)}`)

  const beta0 = (await cam()).beta
  await drag('left', 0, 160)
  const beta1 = (await cam()).beta
  check('вертикальное движение меняет наклон', Math.abs(beta1 - beta0) > 0.2,
    `beta ${beta0} → ${beta1}`)

  const beforePan = (await cam()).target
  await drag('middle', -150, 0)
  const afterPan = (await cam()).target
  check('средняя кнопка (ролик) панорамирует',
    afterPan.some((v, i) => Math.abs(v - beforePan[i]) > 0.05),
    `${JSON.stringify(beforePan)} → ${JSON.stringify(afterPan)}`)

  const radius0 = (await cam()).radius
  await page.mouse.move(700, 450)
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(700)
  check('колесо меняет масштаб', Math.abs((await cam()).radius - radius0) > 0.1,
    `${radius0} → ${(await cam()).radius}`)

  const target0 = (await cam()).target
  await page.keyboard.down('w')
  await page.waitForTimeout(700)
  await page.keyboard.up('w')
  await page.waitForTimeout(300)
  const target1 = (await cam()).target
  check('W двигает вид', target1.some((v, i) => Math.abs(v - target0[i]) > 0.01),
    `${JSON.stringify(target0)} → ${JSON.stringify(target1)}`)

  // --- палец ведёт себя как мышь ---
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2,
  })
  const mp = await mobile.newPage()
  await mp.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo2 = mp.getByText('Посмотреть демо', { exact: false })
  if (await demo2.count()) await demo2.first().click()
  await mp.waitForTimeout(6500)
  const skip2 = mp.locator('.tour__skip')
  if (await skip2.count()) await skip2.first().click().catch(() => {})
  await mp.keyboard.press('Escape').catch(() => {})
  await mp.waitForTimeout(900)
  const cdp = await mobile.newCDPSession(mp)
  const mobileAlpha = () => mp.evaluate(() =>
    window.__furnitureRenderer.orbit.alpha)
  const mobileMean = () => mp.evaluate(() => {
    const r = window.__furnitureRenderer
    // Берём площадь текущей комнаты, а не общий контур квартиры: углы
    // всей квартиры могут уйти за камеру и перевернуть средний сдвиг.
    const st = window.__furnitureDbg?.state
    const f = st?.project.folders.find((q) => q.id === st.folderId)
      ?? st?.project.folders[0]
    const rect = f?.area || r.walkRect || { x: 0, y: 0, w: 5200, d: 4200 }
    const pts = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.5, 0.5]]
      .map(([u, v]) => [rect.x + u * rect.w, rect.y + v * rect.d])
    return pts.reduce((s, [x, y]) => s + r.project(x, y, 0).x, 0) / pts.length
  })
  let touchId = 1
  const swipe = async (dx) => {
    const x0 = 195, y0 = 520
    const id = touchId++
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: x0, y: y0, id }],
    })
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x0 + (i * dx) / 8, y: y0, id }],
      })
      await mp.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await mp.waitForTimeout(1100)
  }
  // Направление проверяем по alpha: сцена идёт за пальцем, когда при
  // свайпе вправо alpha уменьшается. Проекция точек на телефоне шумит:
  // часть комнаты уходит за камеру.
  const a0 = await mobileAlpha()
  await swipe(120)
  const a1 = await mobileAlpha()
  check('палец вправо → сцена идёт за пальцем', a1 < a0 - 0.02,
    `alpha ${a0.toFixed(2)} → ${a1.toFixed(2)}`)
  await mp.waitForTimeout(700)
  await swipe(-120)
  const a2 = await mobileAlpha()
  check('палец влево → сцена идёт за пальцем', a2 > a1 + 0.02,
    `alpha ${a1.toFixed(2)} → ${a2.toFixed(2)}`)
} finally {
  await browser.close()
}

console.log(failures ? `провалов: ${failures}` : 'все проверки камеры пройдены')
process.exit(failures ? 1 : 0)
