/**
 * Аудит интерфейса: ключевые экраны на ПК и телефоне.
 *
 * Проверяет: экран открывается, нет ошибок консоли, нет горизонтального
 * скролла, ключевые элементы на месте. Складывает скриншоты.
 *
 *   BASE_URL=https://5176.it2b.top node tests/e2e/ui-audit.mjs
 *   PROFILES=iphone-13 node tests/e2e/ui-audit.mjs
 */
let chromium
let devices = {}
try {
  ({ chromium, devices } = await import('playwright'))
} catch {
  ({ chromium, devices } = await import('playwright-core'))
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const SHOTS = process.env.SHOTS || '/tmp/furn-ui'
const ONLY = (process.env.PROFILES || '').split(',').filter(Boolean)

const PROFILES = [
  { label: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  {
    label: 'iphone-13',
    options: devices['iPhone 13'] || {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
].filter((p) => !ONLY.length || ONLY.includes(p.label))

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})

async function run(profile) {
  const ctx = await browser.newContext({ ...profile.options, locale: 'ru-RU' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  const overflow = async () => page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth)
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${profile.label}-${name}.png` })

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 })
  check(`${profile.label}: вход открылся`, (await page.title()).length > 0)
  const demo = page.getByText('Посмотреть демо', { exact: false })
  check(`${profile.label}: кнопка демо на месте`, (await demo.count()) > 0)

  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForFunction(() => !!window.__furnitureRenderer, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await shot('3d')
  check(`${profile.label}: 3D-канвас`, (await page.locator('canvas').count()) > 0)
  check(`${profile.label}: «следующий шаг» в статусбаре`,
    (await page.locator('.statusbar__next').count()) > 0)
  check(`${profile.label}: нет горизонтального скролла в 3D`,
    (await overflow()) <= 1, String(await overflow()))

  // Развёртки и план: вход — «2D-стены», внутри вкладка «План»
  let draft = page.getByRole('button', { name: '2D-стены', exact: true })
  if (!(await draft.count())) {
    // На телефоне вход в 2D живёт в шторке «Вид»
    const viewTab = page.getByRole('button', { name: /Вид/ })
    if (await viewTab.count()) {
      await viewTab.last().click({ force: true }).catch(() => {})
      await page.waitForTimeout(700)
    }
    draft = page.getByRole('button', { name: '2D-стены', exact: true })
  }
  check(`${profile.label}: вход в 2D-развёртки есть`, (await draft.count()) > 0)
  if (await draft.count()) {
    await draft.first().click().catch(() => {})
    await page.waitForTimeout(2500)
    await shot('walls')
    check(`${profile.label}: развёртки открываются`,
      (await page.locator('canvas').count()) > 0)
    check(`${profile.label}: развёртки без горизонтального скролла`,
      (await overflow()) <= 1, String(await overflow()))

    const plan = page.getByRole('button', { name: 'План', exact: true })
    await plan.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    check(`${profile.label}: вкладка «План» есть`, (await plan.count()) > 0)
    if (await plan.count()) {
      await plan.first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(2000)
      await shot('plan')
      check(`${profile.label}: план без горизонтального скролла`,
        (await overflow()) <= 1, String(await overflow()))
      const back = page.getByRole('button', { name: '3D', exact: true })
      if (await back.count()) await back.first().click().catch(() => {})
      await page.waitForTimeout(1500)
    }
  }

  // Панель расстановки: у ошибок есть подсказка и «Исправить»
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /расстановка/i.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(1500)
  const panel = page.locator('.layout-panel')
  if (await panel.count()) {
    await shot('layout')
    const rows = page.locator('.layout-panel__row')
    check(`${profile.label}: панель расстановки открылась`, (await rows.count()) >= 0)
    check(`${profile.label}: у строк есть подсказка «что делать»`,
      (await page.locator('.layout-panel__fix').count()) > 0
      || (await rows.count()) === 0,
      `строк: ${await rows.count()}`)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(500)
  } else {
    check(`${profile.label}: панель расстановки не открылась`, false)
  }

  // Мастер-режим: прячет продвинутые панели и возвращается обратно
  if (profile.label === 'desktop') {
    await page.locator('[data-tour="more"]').click().catch(() => {})
    await page.waitForTimeout(500)
    const toggle = page.getByText(/Включить мастер-режим|Мастер-режим включён/)
    if (await toggle.count()) {
      await toggle.first().click().catch(() => {})
      await page.waitForTimeout(900)
      const st = await page.evaluate(() => ({
        master: !!window.__furnitureDbg?.ui?.master,
        cam: [...document.querySelectorAll('.view__group-label')]
          .map((x) => x.textContent.trim()),
        tabs: [...document.querySelectorAll('.outliner__tabs .tab')]
          .map((x) => x.textContent.trim()),
      }))
      // Проверяем по DOM: флаг в отладочном объекте может отставать,
      // а пользователю важно, что панели действительно скрылись.
      check('мастер-режим включается (панели скрыты)',
        !st.cam.includes('Камера'), st.cam.join(','))
      check('в мастер-режиме вкладки объектов на месте',
        st.tabs.length === 3, st.tabs.join(','))
      await page.locator('[data-tour="more"]').click().catch(() => {})
      await page.waitForTimeout(400)
      await page.getByText(/Мастер-режим включён/).first().click().catch(() => {})
      await page.waitForTimeout(700)
    } else {
      check('мастер-режим: пункт меню найден', false)
    }
  }

  // Готовый проект: «Ещё» → «Готовый проект»
  await page.getByRole('button', { name: /Ещё|Меню/i }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  const result = page.getByText('Готовый проект', { exact: false })
  check(`${profile.label}: «Готовый проект» в меню есть`, (await result.count()) > 0)
  if (await result.count()) {
    await result.first().click().catch(() => {})
    await page.waitForTimeout(3000)
    await shot('result')
    check(`${profile.label}: «Готовый проект» открылся`,
      (await page.getByText(/готовность к производству|Раскрой/i).count()) > 0)
  }

  check(`${profile.label}: ошибок консоли нет`,
    errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

try {
  for (const p of PROFILES) await run(p)
} finally {
  await browser.close()
}

console.log(failures ? `\nпровалов: ${failures}` : '\nвсе проверки UI пройдены')
process.exit(failures ? 1 : 0)
