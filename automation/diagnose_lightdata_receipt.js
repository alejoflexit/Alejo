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

    await page.evaluate(() => window.FmenuShow('envios_listado', 8));
    await new Promise(resolve => setTimeout(resolve, 3000));
    const listingStructure = await page.evaluate(() => ({
      controls: [...document.querySelectorAll('input,button,select')].filter(el => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }).slice(0, 160).map(el => ({
        tag: el.tagName,
        id: el.id,
        name: el.getAttribute('name'),
        type: el.getAttribute('type'),
        text: (el.textContent || '').trim().slice(0, 60),
        placeholder: el.getAttribute('placeholder'),
      })),
      receiptLabels: [...document.querySelectorAll('label,div,span')].filter(el => /recibido por/i.test(el.textContent || '')).slice(0, 10).map(el => ({ id: el.id, text: (el.textContent || '').trim().slice(0, 100) })),
    }));
    console.log(`Listing structure: ${JSON.stringify(listingStructure)}`);
    const receiptTemplate = await page.evaluate(() => {
      const html = document.getElementById('modalEnvio')?.innerHTML || '';
      const index = html.toLowerCase().indexOf('recibido por');
      const context = index >= 0 ? html.slice(Math.max(0, index - 500), index + 900) : '';
      return {
        context: context.replace(/value=("[^"]*"|'[^']*')/gi, 'value="[redacted]"'),
        appEnviosKeys: Object.keys(window.appEnvios || {}).filter(key => /envio|alta|edit|ver|detalle|cargar/i.test(key)),
        openEditSource: String(window.appEnvios?.openEdit || '').slice(0, 6000),
        getAjaxSource: String(window.getAjax || '').slice(0, 12000),
      };
    });
    console.log(`Receipt template: ${JSON.stringify(receiptTemplate)}`);
    const detailRequests = [];
    page.on('request', request => {
      try {
        const url = new URL(request.url());
        if (/envio|controlador|ajax|alta/i.test(url.pathname)) detailRequests.push({ method: request.method(), path: url.pathname, postData: request.postData() });
      } catch {}
    });
    await page.evaluate(() => window.appEnvios.openEdit(941916));
    await new Promise(resolve => setTimeout(resolve, 5000));
    const receiptValue = await page.$eval('#envio_alta_recibidopor', input => input.value).catch(() => '');
    const receiptDigits = receiptValue.replace(/\D/g, '');
    console.log(`Detail requests: ${JSON.stringify(detailRequests)}`);
    console.log(`Shipment 941916 receiver: ${JSON.stringify({
      present: Boolean(receiptValue.trim()),
      name: receiptValue.replace(/\b(?:DNI|DOCUMENTO)\s*:?\s*[\d.\s-]{4,}.*$/i, '').trim() || undefined,
      documentLast4: receiptDigits.length >= 4 ? receiptDigits.slice(-4) : undefined,
    })}`);
    const responseShape = await page.evaluate(async () => {
      const body = new URLSearchParams({ operador: 'get', did: '941916' });
      const response = await fetch('/modules/envios/alta/controlador.php', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
      });
      const payload = await response.json();
      const matches = [];
      const visit = (value, path = '') => {
        if (!value || typeof value !== 'object' || matches.length >= 20) return;
        for (const [key, child] of Object.entries(value)) {
          const nextPath = path ? `${path}.${key}` : key;
          if (/recib|dni|documento/i.test(key)) matches.push({ path: nextPath, type: typeof child, present: Boolean(String(child || '').trim()) });
          if (child && typeof child === 'object') visit(child, nextPath);
        }
      };
      visit(payload);
      return { topLevelType: Array.isArray(payload) ? 'array' : typeof payload, matches };
    });
    console.log(`Detail response shape: ${JSON.stringify(responseShape)}`);

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
