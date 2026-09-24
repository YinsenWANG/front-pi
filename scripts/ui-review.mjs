import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desktop.goto('http://127.0.0.1:5173/');
await desktop.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await desktop.locator('.model-pill').click();
await desktop.screenshot({ path: '/private/tmp/front-pi-settings.png', fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto('http://127.0.0.1:5173/');
await mobile.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000, state: 'attached' });
await mobile.screenshot({ path: '/private/tmp/front-pi-mobile.png', fullPage: true });
const mobileMetrics = await mobile.evaluate(() => ({
  viewport: innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  workspaceVisible: Boolean(document.querySelector('.workspace-pane')),
}));
await mobile.getByRole('button', { name: '切换工作区面板' }).click();
await mobile.getByText('浏览器沙箱').waitFor();
await mobile.screenshot({ path: '/private/tmp/front-pi-mobile-workspace.png', fullPage: true });
if (mobileMetrics.documentWidth > mobileMetrics.viewport || mobileMetrics.workspaceVisible) throw new Error(JSON.stringify(mobileMetrics));
console.log(JSON.stringify(mobileMetrics));
await browser.close();
