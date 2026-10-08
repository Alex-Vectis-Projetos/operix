const { chromium } = require('playwright');

async function testUI() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  console.log('1. Logging in to staging...');
  await page.goto('https://staging.operix-pro.com/auth');
  await page.fill('input[type="email"]', 'owner@operix-staging.com');
  await page.fill('input[type="password"]', 'StagingPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('https://staging.operix-pro.com/', { timeout: 15000 });

  console.log('2. Testing /clients page...');
  await page.goto('https://staging.operix-pro.com/clients');
  await page.waitForTimeout(4000);

  const proClientText = await page.locator('text=HOMOLOG-FIX-PRO-001').first().isVisible();
  const perClientText = await page.locator('text=HOMOLOG-FIX-PER-001').first().isVisible();
  console.log('UI: HOMOLOG-FIX-PRO-001 visible in table:', proClientText);
  console.log('UI: HOMOLOG-FIX-PER-001 visible in table:', perClientText);

  console.log('3. Testing /people page...');
  await page.goto('https://staging.operix-pro.com/people');
  await page.waitForTimeout(4000);

  const personText = await page.locator('text=HOMOLOG-FIX-PERSON-001').first().isVisible();
  console.log('UI: HOMOLOG-FIX-PERSON-001 visible in table:', personText);

  await browser.close();
}

testUI().catch(err => {
  console.error(err);
  process.exit(1);
});
