/**
 * E2E smoke: демо-вход, развёртки стен, мобильная шапка, строгая проверка.
 *
 * Запуск (стек уже поднят, Vite preview проксирует /api):
 *   BASE_URL=http://127.0.0.1:4173 node tests/e2e/smoke.mjs
 *
 * Переменные:
 *   BASE_URL  — адрес web (по умолчанию http://127.0.0.1:4173)
 *   SHOTS     — папка для скриншотов (по умолчанию /tmp/furn-e2e)
 */
import { mkdirSync } from 'node:fs'

// В CI ставится полный playwright; локально достаточно playwright-core
// с указанным PW_CHROME.
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const SHOTS = process.env.SHOTS || '/tmp/furn-e2e'
mkdirSync(SHOTS, { recursive: true })

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}   ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

async function demo(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 40000 })
  const tour = page.locator('.tour__skip')
  const btn = page.getByText('Посмотреть демо', { exact: false })
  if (await btn.count()) await btn.first().click()
  await page.waitForTimeout(4500)
  if (await tour.count()) await tour.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(800)
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})
try {
  // --- ПК: 3D и развёртки ---
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await desktop.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

  await demo(page)
  check('демо открылось', await page.locator('.app').count() > 0 || await page.locator('.workspace').count() > 0)
  check('3D-сцена есть', await page.locator('canvas').count() > 0)
  await page.screenshot({ path: `${SHOTS}/desktop-3d.png` })

  // Esc закрывает окно модуля, но не снимает выделение (иначе ломаются
  // размеры выбранного модуля в развёртках стен).
  await page.locator('.tree__row--item').first().click()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('Esc закрывает окно, но оставляет выделение',
    await page.locator('.tree__row--item.is-active').count() > 0)

  await page.getByRole('button', { name: '2D-стены', exact: true }).click().catch(() => {})
  await page.waitForTimeout(1200)
  check('развёртки стен открылись', await page.locator('.wallview').count() > 0)
  check('вкладок стен >= 4', await page.locator('.wallview__tab').count() >= 4,
    String(await page.locator('.wallview__tab').count()))
  await page.screenshot({ path: `${SHOTS}/desktop-walls.png` })

  await page.getByRole('button', { name: 'План', exact: true }).click().catch(() => {})
  await page.waitForTimeout(900)
  check('план открылся', await page.locator('.view--plan').count() > 0)
  await page.getByRole('button', { name: '3D', exact: true }).click().catch(() => {})
  await page.waitForTimeout(900)
  check('возврат в 3D', await page.locator('.wallview').count() === 0)

  // --- декор: библиотека, панель, поворот ---
  await page.getByRole('button', { name: 'Добавить', exact: false }).first().click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Декор', exact: true }).click()
  await page.waitForTimeout(400)
  const decorCards = page.locator('.add__grid .cat-card')
  check('библиотека декора открылась', await decorCards.count() >= 10,
    String(await decorCards.count()))
  const decorCount = async () => {
    const t = await page.getByRole('tab', { name: /^Декор/ }).innerText()
    return Number((t.match(/\((\d+)\)/) || [])[1] ?? -1)
  }
  const propsBefore = await decorCount()
  await decorCards.nth(8).click()
  await page.waitForTimeout(1200)
  check('панель декора открылась', await page.locator('.prop-panel').count() > 0)
  const propsAfter = await decorCount()
  check('декор добавлен', propsBefore >= 0 && propsAfter === propsBefore + 1,
    `${propsBefore} → ${propsAfter}`)
  const before = await page.locator('.prop-panel .numfield__input').first()
    .inputValue().catch(() => '')
  await page.getByRole('button', { name: '⟳ 90°' }).click()
  await page.waitForTimeout(300)
  check('поворот/поля декора работают', await page.locator('.prop-panel').count() > 0)
  await page.screenshot({ path: `${SHOTS}/desktop-decor.png` })
  await page.locator('.prop-panel').getByRole('button', { name: 'Удалить' }).click()
  await page.waitForTimeout(600)
  check('декор удаляется', await page.locator('.prop-panel').count() === 0
    && (await decorCount()) === propsBefore)

  check('ошибок консоли нет', errors.length === 0, errors.join(' | '))
  await desktop.close()

  // --- Телефон: шапка развёрток и возврат в 3D ---
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2,
  })
  const mp = await mobile.newPage()
  const mErrors = []
  mp.on('pageerror', (e) => mErrors.push(e.message.slice(0, 200)))
  mp.on('console', (m) => { if (m.type() === 'error') mErrors.push(m.text().slice(0, 200)) })

  await mp.goto(`${BASE}/?draft=1`, { waitUntil: 'networkidle', timeout: 40000 })
  const mbtn = mp.getByText('Посмотреть демо', { exact: false })
  if (await mbtn.count()) await mbtn.first().click()
  await mp.waitForTimeout(5000)
  const mskip = mp.locator('.tour__skip')
  if (await mskip.count()) await mskip.first().click().catch(() => {})
  await mp.keyboard.press('Escape').catch(() => {})
  await mp.waitForTimeout(800)

  check('мобильные развёртки видны', await mp.locator('.wallview').count() > 0)
  check('мобильная шапка развёрток есть',
    await mp.locator('.wallview .view__head').isVisible().catch(() => false))
  await mp.screenshot({ path: `${SHOTS}/mobile-walls.png` })

  await mp.getByRole('button', { name: '3D', exact: true }).click().catch(() => {})
  await mp.waitForTimeout(1200)
  check('на телефоне есть выход в 3D', await mp.locator('.wallview').count() === 0)

  // мобильный список декора
  await mp.locator('.mobilebar__btn').nth(1).click()
  await mp.waitForTimeout(500)
  await mp.getByRole('tab', { name: /^Декор/ }).click()
  await mp.waitForTimeout(400)
  check('мобильная вкладка декора', await mp.locator('.outliner__note').count() > 0)
  await mp.screenshot({ path: `${SHOTS}/mobile-decor.png` })
  await mp.locator('.tree__row--item').first().click()
  await mp.waitForTimeout(700)
  check('декор выбирается на телефоне', await mp.locator('.prop-panel').count() > 0)
  check('шторка объектов закрылась', await mp.locator('.outliner').isVisible().catch(() => false) === false)
  check('мобильных ошибок консоли нет', mErrors.length === 0, mErrors.join(' | '))
  await mobile.close()
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nE2E smoke пройден.')
