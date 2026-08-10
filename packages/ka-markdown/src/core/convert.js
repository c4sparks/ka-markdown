'use strict';

const { fetchHtml } = require('./fetch');
const { convertHtml } = require('./engines/jsdom');

/**
 * 抓取 URL 并转为 Markdown。
 *
 * @param {string} url
 * @param {object} [opts]
 *   { scope, images, links, header, engine, timeoutMs, userAgent }
 *   engine: 'jsdom'(默认) | 'playwright'(需另行安装)
 * @returns {Promise<object>} { ok, markdown, title, url, error, scope }
 */
async function urlToMarkdown(url, opts) {
  opts = opts || {};
  if (opts.engine === 'playwright') {
    const { convertUrlWithPlaywright } = require('./engines/playwright');
    return convertUrlWithPlaywright(url, opts);
  }
  const { html, finalUrl } = await fetchHtml(url, opts);
  const res = await convertHtml(html, {
    url: finalUrl,
    scope: opts.scope,
    images: opts.images,
    links: opts.links,
    header: opts.header
  });
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
  return res;
}

module.exports = { urlToMarkdown, htmlToMarkdown };
