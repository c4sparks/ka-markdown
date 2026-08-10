/* 后台 Service Worker：右键菜单 + 区域选取入口 */
'use strict';

importScripts('shared.js');

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  // 二级菜单：父项「将本页转换为 Markdown」→ 转换主要内容 / 转换整页
  chrome.contextMenus.create({
    id: 'md-page-menu',
    title: '将本页转换为 Markdown',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'md-convert-main',
    title: '转换主要内容',
    parentId: 'md-page-menu',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'md-convert-page',
    title: '转换整页',
    parentId: 'md-page-menu',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'md-convert-selection',
    title: '将选中内容转换为 Markdown',
    contexts: ['selection']
  });
});

// 统一的“转换结果 → 自动下载 → 打开编辑器”流程
async function handleResult(res, settings) {
  let downloaded = false;
  if (settings.autoDownload && res.ok) {
    try {
      await downloadMarkdown(res.markdown, downloadFilename(res.title));
      downloaded = true;
    } catch (e) { /* 下载失败则照常打开编辑器 */ }
  }

  const openEditor = settings.showPreview || !downloaded;
  if (!openEditor) return;

  await chrome.storage.local.set({
    md_editor_data: {
      markdown: res.ok ? res.markdown : ('# 转换失败\n\n' + (res.error || '未知错误')),
      title: res.title || '',
      url: res.url || '',
      theme: res.theme || 'light',
      // 记录本次实际使用的范围（右键「转换主要内容 / 转换整页」），让编辑器打开时选中项与右键一致
      scope: res.scope
    }
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
}

async function injectConverter(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['lib/turndown.js', 'lib/turndown-plugin-gfm.js', 'content.js']
  });
}

// 在标签页里执行一个函数并取回结果（func 与 content.js 同处隔离世界）
async function runInTab(tabId, func, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: func,
    args: args
  });
  return results && results[0] ? results[0].result : null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  const settings = await getSettings();

  if (info.menuItemId === 'md-convert-main' || info.menuItemId === 'md-convert-page') {
    let res = null;
    try {
      await injectConverter(tab.id);
      // 二级菜单里选的范围优先，不再跟随设置里的默认范围
      res = await runInTab(tab.id, (o) => window.__mdConvert(o), [{
        scope: info.menuItemId === 'md-convert-page' ? 'page' : 'main',
        images: settings.images,
        links: settings.links,
        header: settings.header
      }]);
    } catch (e) {
      res = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    await handleResult(res || { ok: false, error: '转换失败' }, settings);
    return;
  }

  if (info.menuItemId === 'md-convert-selection') {
    let res = null;
    try {
      await injectConverter(tab.id);
      res = await runInTab(tab.id, (o) => window.__mdConvertSelection(o), [{
        images: settings.images,
        links: settings.links,
        header: settings.header
      }]);
    } catch (e) {
      res = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    await handleResult(res || { ok: false, error: '转换失败' }, settings);
    return;
  }
});

// 弹窗「区域转换」：进入选取模式，等用户点选页面区域后转换
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'md-start-pick') return;

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) return;
      const settings = await getSettings();
      await injectConverter(tab.id);
      // func 返回 Promise，executeScript 会等用户点选 / Esc 后取回结果
      const res = await runInTab(tab.id, (o) => window.__startRegionPicker(o), [{
        images: settings.images,
        links: settings.links,
        header: settings.header
      }]);
      if (res) await handleResult(res, settings);
    } catch (e) { /* 用户未选或标签页已关，忽略 */ }
  })();
  return false;
});
