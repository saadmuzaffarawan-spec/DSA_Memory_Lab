// Visual check: node tools/shot.mjs <name> [width] [height] [actions...]   (needs `npx vite preview --port 4173` running)
import { chromium } from 'playwright-core';
const [name = 'home', w = '1440', h = '900', ...acts] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const url = process.env.URL || 'http://localhost:4173/';
await page.goto(url);
await page.waitForSelector('.mem, .empty, .banner', { timeout: 20000, state: 'attached' });
await page.waitForTimeout(400);
for (const a of acts) {
  const [cmd, ...rest] = a.split(':');
  const arg = rest.join(':');
  if (cmd === 'click') await page.click(arg);
  else if (cmd === 'step') for (let i = 0; i < +arg; i++) { const b = page.locator('button[aria-label="Step into"]'); if (await b.isDisabled()) break; await b.click(); await page.waitForTimeout(40); }
  else if (cmd === 'tab') await page.click(`.tab:has-text("${arg}")`);
  else if (cmd === 'example') { await page.click('.menu > button'); await page.click(`.menu-item:has-text("${arg}")`); await page.waitForTimeout(900); }
  else if (cmd === 'plat') await page.click(`.seg button:has-text("${arg}")`);
  else if (cmd === 'dark') await page.emulateMedia({ colorScheme: 'dark' });
  else if (cmd === 'wait') await page.waitForTimeout(+arg);
  await page.waitForTimeout(150);
}
await page.screenshot({ path: `tools/shots/${name}.png` });
console.log('shot', name, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
