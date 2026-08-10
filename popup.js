'use strict';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const titleEl = $('pageTitle');
const textarea = $('markdown');

let current = null; // { markdown, title, url }
let lastRenderedKey = null; // 预览已渲染内容的指纹，避免切换时重复跑 marked

// 防抖：编辑时不要每个按键都重新跑一遍 marked 解析，停下 150ms 再渲染
function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// 把当前内容渲染进预览 iframe；内容（含主题）没变就不重跑。
// 编辑时也调用它 → 预览保持最新，切到预览时直接显示，不用现解析。
function renderPreviewNow() {
  const key = textarea.value + '' + ((current && current.theme) || 'light');
  if (key === lastRenderedKey) return;
  lastRenderedKey = key;
  renderMarkdownPreview($('preview'), textarea.value, current && current.theme);
}

const refreshPreview = debounce(renderPreviewNow, 150);

// 预览 / 编辑视图切换
function setView(mode) {
  const wrap = $('md-wrap');
  wrap.dataset.view = mode;
  $('view-preview').classList.toggle('active', mode === 'preview');
  $('view-edit').classList.toggle('active', mode === 'edit');
  if (mode === 'preview') requestAnimationFrame(renderPreviewNow);
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function convertNow(scope) {
  setStatus('转换中…');
  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    setStatus('无法获取当前标签页', 'err');
    return;
  }
  if (/^(chrome|edge|about|devtools|extension):/.test(tab.url || '')) {
    setStatus('该页面不支持转换（浏览器内部页面）', 'err');
    textarea.value = '';
    return;
  }
  const res = await convertTab(tab.id, {
    scope,
    images: settings.images,
    links: settings.links,
    header: settings.header
  });
  if (res.ok) {
    current = res;
    titleEl.textContent = res.title || res.url;
    titleEl.title = res.url || '';
    textarea.value = res.markdown;

    // 「转换后显示预览面板」：勾选→直接展示渲染预览，关闭→停留在编辑视图
    setView(settings.showPreview ? 'preview' : 'edit');

    // 自动复制 / 自动下载
    const acts = [];
    if (settings.autoCopy) { if (await copyMarkdown(true)) acts.push('已复制'); }
    if (settings.autoDownload) { if (await downloadMd(true)) acts.push('已下载'); }
    setStatus('已转换 · ' + res.markdown.length + ' 字符' + (acts.length ? ' · ' + acts.join('，') : ''), 'ok');
  } else {
    current = null;
    textarea.value = '';
    setStatus('转换失败：' + (res.error || '未知错误'), 'err');
  }
}

async function copyMarkdown(silent) {
  const text = textarea.value;
  if (!text) { if (!silent) setStatus('没有可复制的内容', 'err'); return false; }
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    textarea.select();
    document.execCommand('copy');
    textarea.setSelectionRange(0, 0);
  }
  if (!silent) setStatus('已复制到剪贴板', 'ok');
  return true;
}

async function downloadMd(silent) {
  const text = textarea.value;
  if (!text) { if (!silent) setStatus('没有可下载的内容', 'err'); return false; }
  const name = downloadFilename(current && current.title);
  try {
    await downloadMarkdown(text, name);
    if (!silent) setStatus('已下载', 'ok');
    return true;
  } catch (e) {
    if (!silent) setStatus('下载失败：' + (e && e.message ? e.message : e), 'err');
    return false;
  }
}

async function openEditor() {
  await chrome.storage.local.set({
    md_editor_data: {
      markdown: textarea.value,
      title: current ? current.title : '',
      url: current ? current.url : '',
      theme: current ? current.theme : undefined,
      scope: current ? current.scope : undefined
    }
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  window.close();
}

async function openSettings() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html#settings') });
  window.close();
}

async function openHelp() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html#help') });
  window.close();
}

// ---- 初始化 ----
async function init() {
  const settings = await getSettings();
  const radios = document.querySelectorAll('input[name="scope"]');
  for (const r of radios) {
    if (r.value === settings.scope) r.checked = true;
    r.addEventListener('change', async () => {
      const s = await getSettings();
      s.scope = r.value;
      await saveSettings(s);
      await convertNow(r.value);
    });
  }
  $('reconvert').addEventListener('click', () => {
    const checked = document.querySelector('input[name="scope"]:checked');
    convertNow(checked ? checked.value : 'main');
  });
  $('copy').addEventListener('click', () => copyMarkdown());
  $('download').addEventListener('click', () => downloadMd());
  $('view-preview').addEventListener('click', () => setView('preview'));
  $('view-edit').addEventListener('click', () => setView('edit'));
  // 编辑内容 → 预览保持最新，切到预览时直接显示
  textarea.addEventListener('input', refreshPreview);
  $('region').addEventListener('click', async () => {
    // 通知后台进入区域选取模式，然后关闭弹窗让用户点选页面
    await chrome.runtime.sendMessage({ type: 'md-start-pick' });
    window.close();
  });
  $('editor').addEventListener('click', openEditor);
  $('settings').addEventListener('click', openSettings);
  $('help').addEventListener('click', openHelp);
  await convertNow(settings.scope);
}

init();
