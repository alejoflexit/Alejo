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
    const rootStructure = await page.evaluate(() => ({
      title: document.title,
      frames: [...document.querySelectorAll('iframe')].map(frame => ({ id: frame.id, name: frame.name, src: frame.src ? new URL(frame.src).pathname : null })),
      links: [...document.querySelectorAll('a')].filter(a => /env[ií]o/i.test(`${a.textContent} ${a.href}`)).slice(0, 30).map(a => ({
        id: a.id,
        text: (a.textContent || '').trim().slice(0, 80),
        href: a.href ? `${new URL(a.href).pathname}${new URL(a.href).search}` : null,
        onclick: a.getAttribute('onclick'),
      })),
    }));
    console.log(`Root structure: ${JSON.stringify(rootStructure)}`);
    console.log(`Frame paths: ${page.frames().map(frame => { try { return new URL(frame.url()).pathname; } catch { return frame.url(); } }).join(' | ')}`);

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
