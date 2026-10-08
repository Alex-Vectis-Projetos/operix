const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('https://staging.operix-pro.com/auth', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'owner@operix-staging.com');
  await page.fill('input[type="password"]', 'StagingPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('https://staging.operix-pro.com/', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Check if consent modal is visible
  const hasConsentModal = await page.$('text="Consentimento Legal Obrigatório"');
  console.log('Consent modal visible:', Boolean(hasConsentModal));

  if (hasConsentModal) {
    console.log('Checking all consent checkboxes...');
    const labels = [
      'Aceito os Termos de Uso',
      'Aceito a Política de Privacidade',
      'Autorizo o processamento de dados',
      'Autorizo o armazenamento seguro',
      'Entendo as políticas de compartilhamento'
    ];
    for (const label of labels) {
      await page.click(`label:has-text("${label}")`);
      await page.waitForTimeout(200);
    }

    console.log('Clicking Continuar para o sistema...');
    await page.click('button:has-text("Continuar para o sistema")');
    await page.waitForTimeout(1500);
  }

  // Now check /ai page
  console.log('Navigating to /ai...');
  await page.goto('https://staging.operix-pro.com/ai', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('URL after /ai:', page.url());
  const body = await page.textContent('body');
  console.log('Has Em breve · Fase 2:', body.includes('Em breve · Fase 2') || body.includes('Em breve'));
  console.log('Page heading:', await page.textContent('h1'));

  await browser.close();
})();
