/* 公共工具：popup.html / editor.html 用 <script src="shared.js"> 引入，
 * background.js 用 importScripts('shared.js') 引入。
 */

'use strict';

function _errMsg(e) {
  return (e && e.message) ? e.message : String(e);
}

// 把指定标签页转换为 Markdown。
// 返回 { ok, markdown, title, url, error }
async function convertTab(tabId, opts) {
  opts = opts || {};
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/turndown.js', 'lib/turndown-plugin-gfm.js', 'content.js']
    });
  } catch (e) {
    return { ok: false, error: '无法在该页面注入脚本：' + _errMsg(e) };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function (o) { return window.__mdConvert(o); },
      args: [opts]
    });
    const res = results && results[0] && results[0].result;
    if (!res) return { ok: false, error: '未返回转换结果' };
    return res;
  } catch (e) {
    return { ok: false, error: '转换失败：' + _errMsg(e) };
  }
}

// 把标题变成合法文件名
function sanitizeFilename(name) {
  return String(name || 'page')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80) || 'page';
}

// 生成带时间戳的下载文件名：文章名-20260807-1430.md（避免重复下载同篇时重名覆盖）
function downloadFilename(title) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
  return sanitizeFilename(title) + '-' + ts + '.md';
}

// 触发浏览器下载
function downloadMarkdown(text, filename) {
  if (typeof URL.createObjectURL === 'function') {
    // 弹窗 / 编辑器（window 上下文）：用 blob URL，无大小限制
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return chrome.downloads.download({ url: url, filename: filename, saveAs: false });
  }
  // MV3 Service Worker 里没有 URL.createObjectURL → 回退用 data URL
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(text);
  return chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false });
}

// 转换选项默认值
const MD_SETTINGS_DEFAULTS = {
  scope: 'main',        // 主要内容 / 整个页面
  images: true,         // 包含图片
  links: true,          // 包含链接
  header: true,         // 添加来源说明
  autoCopy: false,      // 自动复制到剪贴板
  autoDownload: false,  // 自动下载
  showPreview: true     // 转换后显示预览面板
};

// 读取设置（合并默认值，旧数据缺字段也能正常工作）
async function getSettings() {
  const got = await chrome.storage.local.get('md_settings');
  return Object.assign({}, MD_SETTINGS_DEFAULTS, got.md_settings || {});
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ md_settings: settings });
}
