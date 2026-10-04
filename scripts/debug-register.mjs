import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[console.${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) =>
  console.log(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`),
);

await page.goto('http://127.0.0.1:3100/register', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await browser.close();