'use strict';

const DEFAULT_UA = 'Mozilla/5.0 (compatible; ka-markdown/0.1.0)';

/**
 * 抓取页面 HTML(Node 18+ 内置 fetch)。
 *
 * @param {string} url
 * @param {object} [opts] { timeoutMs, userAgent }
 * @returns {Promise<{ html: string, finalUrl: string, status: number }>}
 */
async function fetchHtml(url, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': opts.userAgent || DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    }
    const html = await res.text();
    return { html: html, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchHtml };
