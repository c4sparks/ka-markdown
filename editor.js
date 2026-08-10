'use strict';

const $ = (id) => document.getElementById(id);
const logEl = $('batch-log');

let cancelled = false;
let currentTitle = ''; // 单页编辑器当前内容对应的标题
let viewMode = 'edit'; // 'preview' | 'split' | 'edit'
let currentTheme = 'light'; // 预览背景主题，跟随源网页
let lastRenderedKey = null; // 预览已渲染内容的指纹，避免切换时重复跑 marked

// 防抖：编辑过程中不要每个按键都重新跑一遍 marked 解析，停下 150ms 再渲染
function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// 把当前内容渲染进预览 iframe；内容（含主题）没变就不重跑。
// 编辑时始终调用它 → 预览保持最新，切到预览/分屏时直接显示，不用现解析。
function renderPreviewNow() {
  const key = $('md-editor').value + '' + (currentTheme || 'light');
  if (key === lastRenderedKey) return;
  lastRenderedKey = key;
  renderMarkdownPreview($('md-preview'), $('md-editor').value, currentTheme);
}

const refreshPreview = debounce(renderPreviewNow, 150);

// 切换单页编辑器的视图：预览（渲染）/ 分屏 / 编辑（原文）
function setView(mode) {
  viewMode = mode;
  const wrap = $('editor-wrap');
  if (wrap) wrap.dataset.view = mode;
  for (const m of ['preview', 'split', 'edit']) {
    const btn = $('view-' + m);
    if (btn) btn.classList.toggle('active', mode === m);
  }
  if (mode === 'preview' || mode === 'split') {
    // 视图立刻切换，渲染放到下一帧：大文档点击立即可见、不阻塞，内容随后填充
    requestAnimationFrame(renderPreviewNow);
  }
}

// 设置项 ID 映射
const SETTING_IDS = {
  images: 'opt-images',
  links: 'opt-links',
  header: 'opt-header',
  autoCopy: 'opt-autocopy',
  autoDownload: 'opt-autodownload',
  showPreview: 'opt-showpreview'
};

// ---------------- 通用 ----------------

function setStatus(text, kind) {
  const el = $('status-editor');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function setSettingsStatus(text, kind) {
  const el = $('settings-status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function logLine(text, kind) {
  const div = document.createElement('div');
  div.textContent = text;
  if (kind) div.className = kind;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function isOwnPage(url) {
  return url && url.startsWith(chrome.runtime.getURL(''));
}

// 找一个可转换的标签页：优先当前激活页，其次窗口里最靠右的普通网页
async function findConvertibleTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isGood = (t) => t && t.id != null && !isOwnPage(t.url) && /^https?:/.test(t.url || '');
  if (isGood(active)) return active;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (isGood(tabs[i])) return tabs[i];
  }
  return null;
}

async function copyText(text, silent) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  return true;
}

async function saveMd(text, title, silent) {
  if (!text) return false;
  const name = downloadFilename(title);
  try {
    await downloadMarkdown(text, name);
    return true;
  } catch (e) {
    if (!silent) setStatus('下载失败：' + (e && e.message ? e.message : e), 'err');
    return false;
  }
}

// 转换时统一应用“自动复制 / 自动下载 / 显示预览”
function applyAutoActions(res, silent) {
  return (async () => {
    const s = await getSettings();
    // 勾选「显示预览」→ 转换完直接展示渲染预览；否则回到编辑视图
    setView(s.showPreview ? 'preview' : 'edit');
    const acts = [];
    if (s.autoCopy && (await copyText(res.markdown, silent))) acts.push('已复制');
    if (s.autoDownload && (await saveMd(res.markdown, res.title, silent))) acts.push('已下载');
    return acts;
  })();
}

// ---------------- 单页编辑器 ----------------

async function convertCurrentTab() {
  const tab = await findConvertibleTab();
  if (!tab) {
    setStatus('没有可转换的网页标签页，请先切换到目标页面', 'err');
    return;
  }
  const settings = await getSettings();
  const scope = document.querySelector('input[name="scope-editor"]:checked').value;
  setStatus('转换中…');
  const res = await convertTab(tab.id, {
    scope, images: settings.images, links: settings.links, header: settings.header
  });
  if (res.ok) {
    $('md-editor').value = res.markdown;
    currentTitle = res.title || '';
    currentTheme = res.theme || 'light';
    const acts = await applyAutoActions(res);
    setStatus('已转换：' + (res.title || res.url) + (acts.length ? ' · ' + acts.join('，') : ''), 'ok');
  } else {
    setStatus('转换失败：' + (res.error || '未知错误'), 'err');
  }
}

async function saveSingleFile() {
  const text = $('md-editor').value;
  if (!text) { setStatus('没有可下载的内容', 'err'); return; }
  if (await saveMd(text, currentTitle)) setStatus('已下载', 'ok');
}

// ---------------- 批量转换 ----------------

function parseUrls(text, base) {
  return text.split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !s.startsWith('//'))
    .map((s) => {
      if (/^https?:\/\//i.test(s)) return s;
      if (base) return base.replace(/\/+$/, '') + '/' + s.replace(/^\/+/, '');
      return 'https://' + s;
    });
}

function waitForComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (!t || t.status === 'complete' || Date.now() - started > timeoutMs) {
          clearInterval(timer);
          resolve();
        }
      } catch (e) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

async function runBatch() {
  const base = $('batch-base').value.trim();
  const urls = parseUrls($('batch-urls').value, base);
  if (urls.length === 0) { logLine('未输入有效的网址。', 'err'); return; }
  const settings = await getSettings();
  const scope = document.querySelector('input[name="scope-batch"]:checked').value;

  cancelled = false;
  $('batch-start').disabled = true;
  $('batch-stop').disabled = false;
  logLine('开始批量转换，共 ' + urls.length + ' 个页面（范围：' + (scope === 'main' ? '主要内容' : '整个页面') + '）…');

  let ok = 0, fail = 0;
  for (let i = 0; i < urls.length; i++) {
    if (cancelled) { logLine('已停止。', 'dim'); break; }
    const url = urls[i];
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await waitForComplete(tab.id, 20000);
      const res = await convertTab(tab.id, {
        scope, images: settings.images, links: settings.links, header: settings.header
      });
      if (res.ok) {
        const name = downloadFilename(res.title);
        await downloadMarkdown(res.markdown, name);
        logLine('✔ [' + (i + 1) + '/' + urls.length + '] ' + name + '  ← ' + res.url, 'ok');
        ok++;
      } else {
        logLine('✘ [' + (i + 1) + '/' + urls.length + '] ' + url + ' — ' + (res.error || '转换失败'), 'err');
        fail++;
      }
    } catch (e) {
      logLine('✘ [' + (i + 1) + '/' + urls.length + '] ' + url + ' — ' + (e && e.message ? e.message : e), 'err');
      fail++;
    } finally {
      if (tab && tab.id != null) {
        try { await chrome.tabs.remove(tab.id); } catch (e) { /* 标签页可能已被关闭 */ }
      }
    }
    updateProgress(i + 1, urls.length, ok, fail);
    await new Promise((r) => setTimeout(r, 300));
  }

  $('batch-start').disabled = false;
  $('batch-stop').disabled = true;
  logLine(cancelled ? '已取消。' : '完成：成功 ' + ok + '，失败 ' + fail + '。', cancelled ? 'dim' : 'ok');
}

function updateProgress(done, total, ok, fail) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progress-bar').style.width = pct + '%';
  $('progress-label').textContent = done + ' / ' + total + ' · 成功 ' + ok + ' · 失败 ' + fail + (cancelled ? ' · 已停止' : '');
}

// ---------------- 设置 ----------------

async function loadSettingsUI() {
  const s = await getSettings();
  for (const key of Object.keys(SETTING_IDS)) {
    $(SETTING_IDS[key]).checked = !!s[key];
  }
}

// 让两个「范围」单选组与设置的 scope 对齐
function syncScopeRadios(scope) {
  for (const name of ['scope-editor', 'scope-batch']) {
    const radios = document.querySelectorAll('input[name="' + name + '"]');
    for (const r of radios) if (r.value === scope) r.checked = true;
  }
}

async function initSettings() {
  await loadSettingsUI();
  for (const key of Object.keys(SETTING_IDS)) {
    $(SETTING_IDS[key]).addEventListener('change', async () => {
      const s = await getSettings();
      s[key] = $(SETTING_IDS[key]).checked;
      await saveSettings(s);
      setSettingsStatus('已保存', 'ok');
    });
  }
  $('settings-reset').addEventListener('click', async () => {
    await saveSettings(Object.assign({}, MD_SETTINGS_DEFAULTS));
    await loadSettingsUI();
    syncScopeRadios(MD_SETTINGS_DEFAULTS.scope);
    setSettingsStatus('已恢复默认', 'ok');
  });
}

// ---------------- 初始化 ----------------

function switchTab(name) {
  const map = {
    editor: ['tab-editor', 'panel-editor'],
    batch: ['tab-batch', 'panel-batch'],
    settings: ['tab-settings', 'panel-settings'],
    help: ['tab-help', 'panel-help']
  };
  for (const key of Object.keys(map)) {
    const [tabId, panelId] = map[key];
    $(tabId).classList.toggle('active', key === name);
    $(panelId).classList.toggle('hidden', key !== name);
  }
}

async function init() {
  // 标签切换
  $('tab-editor').addEventListener('click', () => switchTab('editor'));
  $('tab-batch').addEventListener('click', () => switchTab('batch'));
  $('tab-settings').addEventListener('click', () => switchTab('settings'));
  $('tab-help').addEventListener('click', () => switchTab('help'));

  // 单页编辑器
  $('convert-current').addEventListener('click', convertCurrentTab);
  // 「主要内容 / 整个页面」点一下即按所选范围直接抓取当前标签页，
  // 切换范围 = 自动重新转换，不必再单独点「转换当前标签页」（与弹窗行为一致）
  for (const r of document.querySelectorAll('input[name="scope-editor"]')) {
    r.addEventListener('change', async () => {
      const s = await getSettings();
      s.scope = r.value;
      await saveSettings(s);
      await convertCurrentTab();
    });
  }
  $('copy-editor').addEventListener('click', async () => {
    if (await copyText($('md-editor').value)) setStatus('已复制到剪贴板', 'ok');
  });
  $('download-editor').addEventListener('click', saveSingleFile);
  $('view-preview').addEventListener('click', () => setView('preview'));
  $('view-split').addEventListener('click', () => setView('split'));
  $('view-edit').addEventListener('click', () => setView('edit'));
  // 编辑内容 → 预览实时跟随（分屏时右边即刻更新）
  $('md-editor').addEventListener('input', refreshPreview);

  // 批量
  $('batch-start').addEventListener('click', runBatch);
  $('batch-stop').addEventListener('click', () => { cancelled = true; });

  // 设置
  await initSettings();

  // 从右键菜单 / 弹窗传入的初始内容
  const got = await chrome.storage.local.get('md_editor_data');
  // 记录本次转换实际使用的范围（右键选了「转换整页」则编辑器也应选中「整个页面」）
  const incomingScope = got.md_editor_data && got.md_editor_data.scope;
  if (got.md_editor_data) {
    $('md-editor').value = got.md_editor_data.markdown || '';
    currentTitle = got.md_editor_data.title || '';
    currentTheme = got.md_editor_data.theme || 'light';
    setStatus(got.md_editor_data.title || '已就绪', 'ok');
    await chrome.storage.local.remove('md_editor_data');
  }

  // 默认范围设置：带入了本次实际范围时优先跟随，否则用持久化默认值
  const settings = await getSettings();
  syncScopeRadios(incomingScope || settings.scope);
  // 初始视图：勾选「显示预览」且有内容时直接展示预览，否则停留在编辑视图
  setView(settings.showPreview && $('md-editor').value ? 'preview' : 'edit');

  // 设置 / 操作手册直达（弹窗 ⚙ / 自定义入口）
  if (location.hash === '#settings') switchTab('settings');
  else if (location.hash === '#help') switchTab('help');
}

init();
