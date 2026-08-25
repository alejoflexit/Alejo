const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const user = process.env.LIGHTDATA_USER;
const password = process.env.LIGHTDATA_PASSWORD;
if (!user || !password) throw new Error('Faltan credenciales');

(async () => {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.goto('https://flexit.lightdata.app', { waitUntil: 'networkidle2', timeout: 30000 });
    const inputs = await page.$$('input');
    await inputs[0].type(user);
    await inputs[1].type(password);
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    console.log(`Post-login path: ${new URL(page.url()).pathname}`);

    await page.goto('https://flexit.lightdata.app/modules/envios/listado/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log(`Listado path: ${new URL(page.url()).pathname}`);
    const structure = await page.evaluate(() => ({
      forms: [...document.forms].map(form => ({ id: form.id, action: new URL(form.action || location.href).pathname })),
      controls: [...document.querySelectorAll('input,button,a')].slice(0, 120).map(el => ({
        tag: el.tagName,
        id: el.id,
        name: el.getAttribute('name'),
        type: el.getAttribute('type'),
        text: (el.textContent || '').trim().slice(0, 60),
        href: el instanceof HTMLAnchorElement && el.href ? new URL(el.href).pathname : null,
      })),
      scripts: [...document.scripts].map(s => s.src ? new URL(s.src).pathname : '[inline]'),
      hasReceiptLabel: document.body.innerText.toLowerCase().includes('recibido por'),
    }));
    console.log(JSON.stringify(structure));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
