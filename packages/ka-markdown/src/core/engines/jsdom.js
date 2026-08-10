'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const LIB_DIR = path.join(__dirname, '..', '..', '..', 'lib');

// vendored 脚本源码(只读一次,进程内复用)
const TURNDOWN_SRC = fs.readFileSync(path.join(LIB_DIR, 'turndown.js'), 'utf8');
const GFM_SRC = fs.readFileSync(path.join(LIB_DIR, 'turndown-plugin-gfm.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(path.join(LIB_DIR, 'content.js'), 'utf8');

/**
 * jsdom 引擎:把 HTML 转成 Markdown。
 * 与浏览器扩展同源——在 jsdom 的 window 里注入 turndown + content.js,调 window.__mdConvert。
 * 页面 <script> 不会执行(runScripts: 'outside-only'),只解析静态 DOM。
 *
 * @param {string} html 原始 HTML
 * @param {object} [opts] { url, scope, images, links, header }
 * @returns {Promise<object>} { ok, markdown, title, url, error, scope }
 */
async function convertHtml(html, opts) {
  opts = opts || {};
  const url = opts.url || 'about:blank';
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only'
  });
  const win = dom.window;
  try {
    win.eval(TURNDOWN_SRC);
    win.eval(GFM_SRC);
    win.eval(CONTENT_SRC);
    const res = win.__mdConvert({
      scope: opts.scope,
      images: opts.images,
      links: opts.links,
      header: opts.header
    });
    return res;
  } finally {
    win.close();
  }
}

module.exports = { convertHtml };
