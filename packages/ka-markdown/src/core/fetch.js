'use strict';

const DEFAULT_UA = 'Mozilla/5.0 (compatible; ka-markdown/0.1.0)';

// 暂时性失败才会重试的状态码:限流 / 服务端临时错误
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// 无 status(网络错误/超时)视为可重试;有 status 看是否在可重试集合
function isRetryableError(e) {
  return e && typeof e.status === 'number' ? RETRYABLE_STATUS.has(e.status) : true;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function attemptFetch(url, opts, timeoutMs) {
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
      const err = new Error('HTTP ' + res.status + ' ' + res.statusText);
      err.status = res.status;
      throw err;
    }
    const html = await res.text();
    return { html: html, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓取页面 HTML,带可配置重试。
 * 只在暂时性失败(网络错误 / 超时 / HTTP 408 425 429 500 502 503 504)时重试,
 * 永久性失败(404/403 等)不重试。重试间隔递增退避:base × 1、2、3…
 *
 * @param {string} url
 * @param {object} [opts] { timeoutMs, userAgent, retries, retryDelayMs }
 *   retries: 额外重试次数(默认 0,即不重试)
 *   retryDelayMs: 基础重试间隔毫秒(默认 1000)
 * @returns {Promise<{ html: string, finalUrl: string, status: number }>}
 */
async function fetchHtml(url, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 20000;
  const retries = opts.retries || 0;
  const retryDelayMs = opts.retryDelayMs || 1000;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await attemptFetch(url, opts, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries || !isRetryableError(e)) throw e;
      await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

module.exports = { fetchHtml };
