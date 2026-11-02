/**
 * Полное управление через ИИ-чат без реальной LLM: проект → комната →
 * окно → мебель → материалы → preview → apply.
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
    body: JSON.stringify({
      configured: true, provider: 'mock', model: 'mock', tools: 20,
    }),
  }))
  await page.route('**/api/ai/chat', async (route) => {
    const body = route.request().postDataJSON()
    const msgs = Array.isArray(body.messages) ? body.messages : []
    let lastUser = -1
    msgs.forEach((m, i) => { if (m.role === 'user') lastUser = i })
    const answered = lastUser >= 0
      && msgs.slice(lastUser + 1).some((m) => m.role === 'tool')
    const text = String(msgs[lastUser]?.content || '')
    const reply = (message) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, model: 'mock', message, usage: {} }),
    })
    const done = { role: 'assistant', content: 'Готово к применению.', tool_calls: [] }
    if (answered) {
      await reply(done)
      return
    }
    if (/Создай/.test(text)) {
      await reply({
        role: 'assistant',
        content: 'Создаю проект.',
        tool_calls: [{
          id: 'call_create', type: 'function',
          function: {
            name: 'project_create',
            arguments: JSON.stringify({ name: 'ИИ-дизайн' }),
          },
        }],
      })
      return
    }
    if (/Предпросмотр вернул ошибки/.test(text)) {
      await reply({
        role: 'assistant',
        content: 'Исправил высоту: 2600 мм корпуса + 100 цоколя = 2700.',
        tool_calls: [{
          id: 'call_fix', type: 'function',
          function: {
            name: 'add_module',
            arguments: JSON.stringify({
              preset: 'wardrobe1200',
              params: { W: 2000, H: 2600, worktopT: 0, doors: 4 },
            }),
          },
        }],
      })
      return
    }
    if (/Шкаф/.test(text)) {
      await reply({
        role: 'assistant',
        content: 'Ставлю шкаф.',
        tool_calls: [{
          id: 'call_bad', type: 'function',
          function: {
            name: 'add_module',
            arguments: JSON.stringify({
              preset: 'wardrobe1200',
              params: { W: 2000, H: 2700, worktopT: 0, doors: 4 },
            }),
          },
        }],
      })
      return
    }
    if (/Открой/.test(text)) {
      await reply({
        role: 'assistant',
        content: 'Открываю проект.',
        tool_calls: [{
          id: 'call_open', type: 'function',
          function: {
            name: 'project_open',
            arguments: JSON.stringify({ id: oldPid }),
          },
        }],
      })
      return
    }
    if (/Проверь/.test(text)) {
      await reply({
        role: 'assistant',
        content: 'Проверяю.',
        tool_calls: [
          { id: 'call_val', type: 'function',
            function: { name: 'validate', arguments: '{}' } },
          { id: 'call_q', type: 'function',
            function: { name: 'get_quote', arguments: '{}' } },
        ],
      })
      return
    }
    await reply({
      role: 'assistant',
      content: 'Строю комнату и мебель.',
      tool_calls: [
        {
          id: 'call_room', type: 'function',
          function: {
            name: 'resize_room',
            arguments: JSON.stringify({
              w: 4000, d: 3000, h: 2700, wallT: 100, shape: 'rect',
            }),
          },
        },
        {
          id: 'call_window', type: 'function',
          function: {
            name: 'add_opening',
            arguments: JSON.stringify({
              kind: 'window', wall: 0, x: 1200, w: 1500,
              z0: 900, z1: 2200,
            }),
          },
        },
        {
          id: 'call_mod1', type: 'function',
          function: {
            name: 'add_module',
            arguments: JSON.stringify({ preset: 'base600' }),
          },
        },
        {
          id: 'call_mod2', type: 'function',
          function: {
            name: 'add_module',
            arguments: JSON.stringify({ preset: 'drawers600' }),
          },
        },
        {
          id: 'call_mat', type: 'function',
          function: {
            name: 'set_materials',
            arguments: JSON.stringify({
              materials: {
                facade: { name: 'МДФ графит', color: '#303030' },
              },
            }),
          },
        },
      ],
    })
  })

  await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 })
  const demo = page.getByText('Посмотреть демо', { exact: false })
  if (await demo.count()) await demo.first().click()
  await page.waitForTimeout(7000)
  const skip = page.locator('.tour__skip')
  if (await skip.count()) await skip.first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)

  const oldPid = await page.evaluate(() => window.__furnitureDbg.state.projectId)
  await page.locator('.ai-launcher').click()
  const panel = page.locator('.ai-panel')
  await panel.locator('textarea').fill('Создай новый проект «ИИ-дизайн»')
  await panel.locator('textarea').press('Enter')

  await page.waitForFunction(
    (old) => window.__furnitureDbg.state.projectId !== old, oldPid,
    { timeout: 20000 })
  const newPid = await page.evaluate(() => window.__furnitureDbg.state.projectId)
  check('чат создал и открыл проект', !!newPid && newPid !== oldPid, newPid)
  check('диалог перенесён в новый проект',
    (await panel.locator('.ai-msg').count()) > 0,
    String(await panel.locator('.ai-msg').count()))

  await panel.locator('textarea').fill(
    'Комната 4×3, окно 1.5 м, две тумбы и фасады МДФ')
  await panel.locator('textarea').press('Enter')
  await panel.locator('.ai-preview').waitFor({ timeout: 25000 })
  const pvText = await panel.locator('.ai-preview').innerText()
  check('в предпросмотре видна комната и модули',
    /комната/.test(pvText) && /\+2 модулей/.test(pvText), pvText)

  await panel.getByText('Применить', { exact: true }).click()
  await page.waitForTimeout(5000)

  const after = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    return {
      w: s.project.room.w,
      d: s.project.room.d,
      outline: s.project.room.outline?.length ?? 0,
      openings: s.project.room.openings?.length ?? 0,
      instances: s.project.instances.length,
      facade: s.project.materials?.facade?.color,
      pid: s.projectId,
    }
  })
  check('комната 4000×3000', after.w === 4000 && after.d === 3000,
    `${after.w}×${after.d}`)
  check('окно добавлено', after.openings === 1, String(after.openings))
  check('два модуля добавлены', after.instances === 2, String(after.instances))
  check('материал фасада применён', after.facade === '#303030',
    String(after.facade))

  const layout = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}/layout`)
    return r.json()
  }, after.pid)
  check('валидатор без ошибок', layout.errors === 0,
    `errors=${layout.errors} ${(layout.issues || []).slice(0, 2)
      .map((i) => i.code).join(',')}`)

  // Чтение состояния клиентскими инструментами.
  await panel.locator('textarea').fill('Проверь проект и покажи смету')
  await panel.locator('textarea').press('Enter')
  await page.waitForTimeout(4000)
  const chatText = await panel.locator('.ai-log').innerText()
  check('validate вернул результат', /Проверка: ошибок 0/.test(chatText),
    chatText.slice(-160))
  check('get_quote вернул смету', /Смета:.*RON/.test(chatText),
    chatText.slice(-160))

  // Автоисправление предпросмотра: первый пакет с ошибкой, второй — верный.
  await panel.locator('textarea').fill('Поставь шкаф 2000 мм до потолка')
  await panel.locator('textarea').press('Enter')
  await page.waitForFunction(() => {
    const el = document.querySelector('.ai-log')
    return !!el && /исправляю автоматически/i.test(el.textContent || '')
  }, null, { timeout: 30000 })
  check('автоисправление предпросмотра сработало', true)
  await page.waitForFunction(() => {
    const el = document.querySelector('.ai-preview')
    return !!el && /ошибок 0/.test(el.textContent || '')
  }, null, { timeout: 40000 })
  const pv2 = await panel.locator('.ai-preview').innerText()
  check('после автоисправления ошибок нет', /ошибок 0/.test(pv2), pv2)
  await panel.getByText('Применить', { exact: true }).click()
  await page.waitForTimeout(4500)
  const tall = await page.evaluate(() => {
    const s = window.__furnitureDbg.state
    return s.project.instances
      .filter((i) => Number(i.params.W) >= 1900)
      .map((i) => ({ W: i.params.W, H: i.params.H }))
  })
  check('шкаф встал с исправленной высотой',
    tall.length === 1 && tall[0].H === 2600, JSON.stringify(tall))

  // Переключение на существующий проект.
  await panel.locator('textarea').fill('Открой демо-проект')
  await panel.locator('textarea').press('Enter')
  await page.waitForFunction(
    (pid) => window.__furnitureDbg.state.projectId === pid, oldPid,
    { timeout: 20000 })
  check('чат открыл существующий проект',
    (await page.evaluate(() => window.__furnitureDbg.state.projectId)) === oldPid)

  // Убираем за собой тестовый проект.
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
  }, after.pid)
  // Один 422 — ожидаемый: первый пакет с ошибкой, который чат исправил сам.
  const unexpected = errors.filter((e) => !/status of 422/.test(e))
  check('ошибок консоли нет', unexpected.length === 0,
    unexpected.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`)
  process.exit(1)
}
console.log('\nИИ-чат: проект → комната → окно → мебель → материалы → apply работает.')
