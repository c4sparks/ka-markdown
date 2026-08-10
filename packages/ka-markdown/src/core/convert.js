'use strict';

const { fetchHtml } = require('./fetch');
const { convertHtml } = require('./engines/jsdom');
const { convertUrlWithPlaywright, isPlaywrightAvailable } = require('./engines/playwright');

/**
 * 判断 jsdom 结果是否"可疑",需要升级到 Playwright 重抓。
 * 显式指定 engine=jsdom 时绝不升级。
 *
 * @param {string} html 原始 HTML
 * @param {object} res jsdom 转换结果
 * @param {object} [opts]
 * @returns {boolean}
 */
function shouldUpgrade(html, res, opts) {
  if (opts && opts.engine === 'jsdom') return false;
  if (!res || !res.ok) return false;

  const md = (res.markdown || '').trim();
  if (!md) return true; // 完全空 → 可疑(可能是 JS 渲染的页面)

  const textLen = md.length;
  const htmlLen = (html || '').length;

  // 1) HTML 很大但正文极少:多半内容靠 JS 渲染,jsdom 拿不到
  if (textLen < 200 && htmlLen > 30000) return true;

  // 2) SPA 标记(Next/Nuxt/React 挂载点等)且正文偏少
  const spaMarker = /__NEXT_DATA__|__NUXT__|ng-app|data-reactroot|id=["'](root|app)["']/i.test(html);
  if (spaMarker && textLen < 800) return true;

  return false;
}

/**
 * 抓取 URL 并转为 Markdown。
 *
 * @param {string} url
 * @param {object} [opts]
 *   { scope, images, links, header, engine, timeoutMs, userAgent }
 *   engine: 'auto'(默认,jsdom 优先、可疑时升级 playwright)| 'jsdom' | 'playwright'
 * @returns {Promise<object>} { ok, markdown, title, url, error, scope, engine, upgraded? }
 */
async function urlToMarkdown(url, opts) {
  opts = opts || {};
  const engine = opts.engine || 'auto';

  // 显式指定 playwright:直接走,不装/失败时抛出明确错误
  if (engine === 'playwright') {
    return convertUrlWithPlaywright(url, opts);
  }

  // jsdom / auto 都先走 jsdom 快抓
  const { html, finalUrl } = await fetchHtml(url, opts);
  const res = await convertHtml(html, {
    url: finalUrl,
    scope: opts.scope,
    images: opts.images,
    links: opts.links,
    header: opts.header
  });
  res.engine = 'jsdom';

  // auto:结果可疑且 playwright 可用时升级重抓;升级失败回落 jsdom 结果
  if (engine === 'auto' && shouldUpgrade(html, res, opts) && isPlaywrightAvailable()) {
    try {
      const pwRes = await convertUrlWithPlaywright(url, opts);
      if (pwRes && pwRes.ok) {
        pwRes.upgraded = true;
        return pwRes;
      }
    } catch (e) {
      // 升级失败:保留 jsdom 结果
    }
  }

  return res;
}

/**
 * 把已拿到的 HTML 就地转成 Markdown(不需要抓取)。
 *
 * @param {string} html
 * @param {object} [opts] { baseUrl|url, scope, images, links, header }
 * @returns {Promise<object>}
 */
async function htmlToMarkdown(html, opts) {
  opts = opts || {};
  const res = await convertHtml(html, {
    url: opts.baseUrl || opts.url,
    scope: opts.scope,
    images: opts.images,
    links: opts.links,
    header: opts.header
  });
  res.engine = 'jsdom';
  return res;
}

module.exports = { urlToMarkdown, htmlToMarkdown, shouldUpgrade };
