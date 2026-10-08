const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = 'C:/Users/Gustavo Fugulin/.gemini/antigravity-ide/brain/7ab31cbb-4b83-441b-bd55-7ea4f021815b/scratch/screenshots';
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  console.log('=== LAUNCHING CHROMIUM (CHROME) ===');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  // Track network & console
  const networkLogs = [];
  const consoleLogs = [];
  const errors = [];
  let supabaseRequests = 0;
  let unexpected404s = 0;
  let unexpected500s = 0;

  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    consoleLogs.push({ type, text });
    if (type === 'error' && !text.includes('favicon') && !text.includes('Failed to load resource')) {
      errors.push(text);
      console.log(`[Browser Console Error] ${text}`);
    }
  });

  page.on('pageerror', err => {
    errors.push(err.message);
    console.log(`[Page Error] ${err.message}`);
  });

  page.on('request', req => {
    const url = req.url();
    if (url.includes('supabase.co')) {
      supabaseRequests++;
      console.log(`[ALERT] Supabase request detected: ${url}`);
    }
  });

  page.on('response', res => {
    const status = res.status();
    const url = res.url();
    if (status === 404 && !url.includes('favicon')) {
      unexpected404s++;
      console.log(`[Network 404] ${url}`);
    }
    if (status >= 500) {
      unexpected500s++;
      console.log(`[Network 500] ${url} (${status})`);
    }
  });

  console.log('\n--- FLOW-01: Login & Workspace Selection ---');
  await page.goto('https://staging.operix-pro.com/auth', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_login_page.png') });

  // Fill login
  await page.fill('input[type="email"]', 'owner@operix-staging.com');
  await page.fill('input[type="password"]', 'StagingPass123!');
  await page.click('button[type="submit"]');

  // Wait for navigation
  await page.waitForURL('https://staging.operix-pro.com/', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  console.log(`[FLOW-01] Logged in successfully. Current URL: ${page.url()}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_dashboard.png') });

  // Check workspace name in DOM
  const bodyText = await page.textContent('body');
  const hasWorkspace = bodyText.includes('Operix Homologation Corp') || bodyText.includes('Operix');
  console.log(`[FLOW-01] Workspace text visible: ${hasWorkspace}`);

  console.log('\n--- FLOW-03 / GOLDEN PATH: Clients & Locations ---');
  await page.goto('https://staging.operix-pro.com/clients', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_clients_page.png') });
  console.log(`[GOLDEN PATH] Navigated to /clients. Page title: ${await page.title()}`);

  console.log('\n--- Checking Supabase requests so far ---');
  console.log(`Supabase requests: ${supabaseRequests}`);
  console.log(`Unexpected 404s: ${unexpected404s}`);
  console.log(`Unexpected 500s: ${unexpected500s}`);
  console.log(`Console errors: ${errors.length}`);

  await browser.close();
  console.log('=== TEST STEP 1 COMPLETED ===');
}

run().catch(err => {
  console.error('Fatal error in runner:', err);
  process.exit(1);
});
