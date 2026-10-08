const { chromium } = require('playwright');

async function testConsole() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => {
    logs.push(msg.text());
  });

  await page.goto('https://staging.operix-pro.com/auth');
  await page.fill('input[type="email"]', 'owner@operix-staging.com');
  await page.fill('input[type="password"]', 'StagingPass123!');
  await page.click('button[type="submit"]');

  await page.waitForURL('https://staging.operix-pro.com/', { timeout: 15000 });
  await page.goto('https://staging.operix-pro.com/clients');
  await page.waitForTimeout(3000);

  const supabaseLogs = logs.filter(l => l.includes('[SUPABASE]'));
  console.log('All Supabase logs count:', supabaseLogs.length);
  supabaseLogs.forEach((l, i) => console.log(`Log ${i}:`, l));

  await page.goto('https://staging.operix-pro.com/people');
  await page.waitForTimeout(3000);
  const supabaseInitLogsPeople = logs.filter(l => l.includes('[SUPABASE] createClient'));
  console.log('Supabase singleton init logs count on /people:', supabaseInitLogsPeople.length);

  await browser.close();
}
testConsole().catch(err => {
  console.error(err);
  process.exit(1);
});
