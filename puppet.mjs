import puppeteer from 'puppeteer';

const url = 'https://www.nepalstock.com/company/detail/274';

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-http2',
    '--disable-features=UseHttp2',
    '--disable-blink-features=AutomationControlled',
  ],
  ignoreHTTPSErrors: true,
});

const page = await browser.newPage();
await page.setUserAgent(
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
);
await page.setExtraHTTPHeaders({
  'accept-language': 'en-US,en;q=0.9',
});

page.on('request', (req) => {
  const reqUrl = req.url();
  if (reqUrl.includes('nepalstock.com/api/')) {
    console.log('REQUEST', req.method(), reqUrl);
    const headers = req.headers();
    console.log('  headers', JSON.stringify(headers));
    if (req.method() === 'POST') {
      const postData = req.postData();
      if (postData) console.log('  postData', postData);
    }
  }
});

page.on('response', async (res) => {
  const resUrl = res.url();
  if (resUrl.includes('nepalstock.com/api/')) {
    console.log('RESPONSE', res.status(), resUrl);
    const headers = res.headers();
    console.log('  headers', JSON.stringify(headers));
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });

// Wait a bit for any late XHRs.
await new Promise((resolve) => setTimeout(resolve, 5000));

await browser.close();
