'use strict';

const path = require('path');

const LIB_DIR = path.join(__dirname, '..', '..', '..', 'lib');

/**
 * Playwright 可选引擎(高保真,JS 渲染页面用)。
 * 与扩展行为几乎 100% 一致:真实浏览器加载页面后,注入 turndown + content.js,调 window.__mdConvert。
 *
 * 未安装时调用会抛出明确提示。安装:
 *   npm install playwright && npx playwright install chromium
 *
 * @param {string} url
 * @param {object} [opts] { scope, images, links, header, timeoutMs, userAgent }
 * @returns {Promise<object>} { ok, markdown, title, url, error, scope }
 */
async function convertUrlWithPlaywright(url, opts) {
  opts = opts || {};
  let pw;
  try {
    pw = require('playwright');
  } catch (e) {
    throw new Error(
      '未安装 Playwright 引擎。请运行:npm install playwright && npx playwright install chromium'
    );
  }
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: opts.userAgent || undefined
    });
    const page = await context.newPage();
    if (opts.timeoutMs) page.setDefaultTimeout(opts.timeoutMs);
    await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs || 30000 });

    await page.addScriptTag({ path: path.join(LIB_DIR, 'turndown.js') });
    await page.addScriptTag({ path: path.join(LIB_DIR, 'turndown-plugin-gfm.js') });
    await page.addScriptTag({ path: path.join(LIB_DIR, 'content.js') });

    const res = await page.evaluate(function (o) {
      return window.__mdConvert({
        scope: o.scope,
        images: o.images,
        links: o.links,
        header: o.header
      });
    }, {
      scope: opts.scope,
      images: opts.images,
      links: opts.links,
      header: opts.header
    });
    return res;
  } finally {
    await browser.close();
  }
}

module.exports = { convertUrlWithPlaywright };
