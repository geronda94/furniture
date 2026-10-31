let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  ({ chromium } = await import('playwright-core'))
}
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
import { statSync } from 'node:fs'
const browser = await chromium.launch({
  args: ['--no-sandbox'],
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 40000 })
const demo = page.getByText('Посмотреть демо', { exact: false })
if (await demo.count()) await demo.first().click()
await page.waitForTimeout(7000)
const skip = page.locator('.tour__skip')
if (await skip.count()) await skip.first().click().catch(() => {})
await page.locator('[data-tour="more"]').click()
await page.getByRole('button', { name: 'Готовый проект' }).click()
await page.waitForTimeout(12000)
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}   ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}
for (const name of ['PDF КП', 'XLSX', 'DXF деталей', 'SVG раскроя']) {
  const p = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
  await page.getByRole('button', { name, exact: true }).click()
  const dl = await p
  if (!dl) { check(name, false, 'нет файла'); continue }
  const size = statSync(await dl.path()).size
  check(name, size > 1000, `${dl.suggestedFilename()} · ${size} Б`)
}
if (failures) process.exit(1)
console.log('\nВыгрузки PDF/XLSX/DXF/SVG работают.')
await browser.close()
