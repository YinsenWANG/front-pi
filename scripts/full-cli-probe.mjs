import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await page.locator('.workspace-tabs').getByRole('button', { name: '终端' }).click();
async function command(input, timeout = 120000) {
  const previous = await page.locator('.terminal-view pre').textContent() || '';
  await page.locator('.terminal-command input').fill(input);
  await page.locator('.terminal-command input').press('Enter');
  await page.waitForFunction((oldLength) => {
    const text = document.querySelector('.terminal-view pre')?.textContent || '';
    return text.length > oldLength && /\[exit \d+\]\s*$/.test(text);
  }, previous.length, { timeout });
  const result = await page.locator('.terminal-view pre').textContent() || '';
  return result.slice(previous.length);
}
console.log((await command('npm init -y', 30000)).slice(-500));
console.log((await command('npm install --ignore-scripts @earendil-works/pi-coding-agent@0.87.1', 180000)).slice(-2000));
console.log((await command('npm ls --depth=0', 30000)).slice(-1000));
console.log(await command('node_modules/.bin/pi --version', 30000));
await browser.close();
