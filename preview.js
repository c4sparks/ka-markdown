/* Markdown 渲染预览（popup / editor 共用）。
 * 依赖 lib/marked.min.js（页面内 <script src> 引入）。
 *
 * 安全设计：预览内容来自网页抓取的 Markdown，可能含恶意 HTML。
 * 这里把渲染结果塞进 sandbox iframe（无 allow-scripts），
 * 且扩展页默认 CSP `script-src 'self'` 也会拦截内联脚本，
 * 双重防护下页面内容里的 <script> / onerror / javascript: 都无法执行。
 */

'use strict';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 预览页样式：跟随源网页主题（light / dark）。theme 来自 content.js 检测结果。
function previewCss(theme) {
  const dark = theme !== 'light';
  const bg = dark ? '#1e1f26' : '#ffffff';
  const text = dark ? '#e6e7ee' : '#1f2328';
  const heading = dark ? '#ffffff' : '#111827';
  const quote = dark ? '#b9bfcc' : '#57606a';
  const border = dark ? '#3a3d4a' : '#d0d7de';
  const codeBg = dark ? '#2b2e39' : '#f6f8fa';
  const preBg = dark ? '#12141a' : '#f6f8fa';
  const link = dark ? '#6ea8ff' : '#0969da';
  return 'body{font:14px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:' + text + ';' +
    'background:' + bg + ';margin:0 auto;padding:24px;max-width:820px}' +
    'h1,h2,h3,h4{line-height:1.3;margin:1.2em 0 .5em;font-weight:600;color:' + heading + '}' +
    'h1{font-size:1.6em;border-bottom:1px solid ' + border + ';padding-bottom:.3em}' +
    'h2{font-size:1.3em;border-bottom:1px solid ' + border + ';padding-bottom:.2em}' +
    'h3{font-size:1.12em}h4{font-size:1em}' +
    'p{margin:.6em 0}' +
    'a{color:' + link + ';text-decoration:none}a:hover{text-decoration:underline}' +
    'img{max-width:100%;height:auto;border:1px solid ' + border + ';border-radius:4px}' +
    'code{background:' + codeBg + ';padding:1px 5px;border-radius:4px;font:12px/1.5 Consolas,monospace}' +
    'pre{background:' + preBg + ';border:1px solid ' + border + ';border-radius:6px;padding:12px;overflow:auto}' +
    'pre code{background:none;padding:0;font:12.5px/1.6 Consolas,monospace}' +
    'table{border-collapse:collapse;margin:.8em 0}' +
    'th,td{border:1px solid ' + border + ';padding:5px 10px}' +
    'th{background:' + codeBg + '}' +
    'blockquote{border-left:3px solid #4c8bf5;margin:.8em 0;padding:.2em 0 .2em 14px;color:' + quote + '}' +
    'ul,ol{padding-left:26px;margin:.6em 0}' +
    'li{margin:.15em 0}' +
    'hr{border:none;border-top:1px solid ' + border + ';margin:1.4em 0}' +
    'blockquote p{margin:.3em 0}';
}

// 把 markdown 渲染进指定的 <iframe>（sandbox，无脚本）。
// theme: 'light' | 'dark'，决定预览背景色（跟随源网页）。
function renderMarkdownPreview(iframe, md, theme) {
  var html;
  try {
    html = (window.marked && window.marked.parse) ? window.marked.parse(String(md || '')) : '';
  } catch (e) {
    html = '<p>预览渲染失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>';
  }
  if (!html) html = '<p class="empty">（内容为空）</p>';
  iframe.setAttribute('sandbox', 'allow-popups');
  iframe.srcdoc =
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + previewCss(theme) + '.empty{color:#9aa0b0}</style></head>' +
    '<body>' + html + '</body></html>';
}
