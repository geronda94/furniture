import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const exe = '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:4173'}/`, { waitUntil: 'networkidle', timeout: 40000 })
const demo = page.getByText('Посмотреть демо', { exact: false })
if (await demo.count()) await demo.first().click()
await page.waitForTimeout(7000)
const skip = page.locator('.tour__skip')
if (await skip.count()) await skip.first().click().catch(() => {})
await page.waitForTimeout(600)
await page.locator('[data-tour="more"]').click()
await page.getByRole('button', { name: 'Готовый проект' }).click()
await page.waitForTimeout(600)
for (const name of ['Отверстия CSV', 'Детали CSV', 'Раскрой CSV', 'Фурнитура CSV']) {
  const p = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
  await page.getByRole('button', { name, exact: true }).click()
  const dl = await p
  if (!dl) { console.log(name, 'NO DOWNLOAD'); continue }
  const txt = readFileSync(await dl.path(), 'utf8')
  console.log(name, dl.suggestedFilename(), 'lines', txt.trim().split(/\r?\n/).length,
    'head', txt.replace(/^\ufeff/, '').split(/\r?\n/)[1]?.slice(0, 60))
}
await browser.close()
