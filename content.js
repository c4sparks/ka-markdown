/* Ka - 网页转Markdown —— 核心转换器
 * 使用方式：先通过 chrome.scripting.executeScript 注入
 *   lib/turndown.js、lib/turndown-plugin-gfm.js 与本文件（幂等），
 * 再由调用方执行  func: (o) => window.__mdConvert(o), args: [{ scope, header }]。
 *
 * opts:
 *   scope  'main'（默认，正文区域） | 'page'（整个页面）
 *   images 是否保留图片（默认 true）
 *   links  是否保留链接（默认 true；false 时链接只留文字）
 *   header 是否在开头附加标题与来源行（默认 true，即“添加来源说明”）
 *   root   指定要转换的 DOM 节点（区域转换 / 选中内容用，原样转换不过滤导航页脚）
 *
 * 另外暴露两个区域转换入口：
 *   window.__mdConvertSelection(opts)  转换当前选中的内容
 *   window.__startRegionPicker(opts)   进入点选模式，Promise 在用户点选 / Esc 后 resolve
 */
(function () {
  'use strict';

  // 噪音节点（导航 / 侧栏 / 页脚）识别：标签、role、常见类名三层兜底。
  // 很多站点的页脚是普通 <div class="copyright"> 之类，光靠 <footer> 标签抓不住。
  var NOISE_CLASS = /(^|[\s_-])(related|footer|site-footer|page-footer|copyright|legal|fine-?print|pagination|pager|prev-?next|post-?nav(igation)?|paging|doc-footer)([\s_-]|$)/;

  function isNoise(node) {
    if (!node || node.nodeType !== 1) return false;
    var n = node.nodeName.toLowerCase();
    if (n === 'footer' || n === 'nav' || n === 'aside') return true;
    var role = node.getAttribute && node.getAttribute('role');
    if (role && /banner|navigation|contentinfo|complementary|doc-footer/.test(role)) return true;
    var cls = node.getAttribute && (node.getAttribute('class') || '');
    if (cls && NOISE_CLASS.test(cls)) return true;
    return false;
  }

  // 在候选正文容器里取“内容最多、噪音最少”的；找不到则退回 body。
  function findMain() {
    var selectors = [
      'article',
      '[role="main"]',
      'main',
      '#main-content',
      '.main-content',
      '.document',
      '.document .body',
      '.content',
      '.post',
      '#content'
    ];
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < selectors.length; i++) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var score = scoreMain(nodes[j]);
        if (score > bestScore) {
          bestScore = score;
          best = nodes[j];
        }
      }
    }
    return best || findMainFallback();
  }

  // 页面没有语义容器时的兜底：找“散文块最多、最紧凑”的区块，
  // 避免「主要内容」与「整个页面」都退化成 document.body。
  function findMainFallback() {
    var proseSel = 'p,h1,h2,h3,h4,h5,h6,pre,table,blockquote';
    var proseNodes = document.querySelectorAll(proseSel);
    if (!proseNodes.length) return document.body;

    // 自底向上统计每个元素的散文后代数。
    // 页脚 / 导航里的散文不算（否则会把页脚带进选中的正文容器）。
    var counts = new Map();
    for (var i = 0; i < proseNodes.length; i++) {
      var insideNoise = false;
      for (var anc = proseNodes[i].parentNode; anc && anc !== document.body; anc = anc.parentNode) {
        if (isNoise(anc)) { insideNoise = true; break; }
      }
      if (insideNoise) continue;
      for (var anc2 = proseNodes[i].parentNode; anc2 && anc2 !== document.body; anc2 = anc2.parentNode) {
        counts.set(anc2, (counts.get(anc2) || 0) + 1);
      }
    }
    if (!counts.size) return document.body;

    var max = 0;
    counts.forEach(function (v) { if (v > max) max = v; });

    // 同样多的散文块里，选文本最短、链接最少的（最紧凑的区块）
    var bestEl = null;
    var bestCost = Infinity;
    counts.forEach(function (cnt, el) {
      if (cnt < max) return;
      var cost = (el.textContent || '').length + el.getElementsByTagName('a').length * 10;
      if (cost < bestCost) { bestCost = cost; bestEl = el; }
    });
    return bestEl || document.body;
  }

  // 正文容器评分：文本多、段落/链接/表格多 ⇒ 像正文；
  // 内含 footer / 导航 / banner 等 ⇒ 扣分（这种多半是包了整个页面的容器）。
  function scoreMain(el) {
    var text = (el.textContent || '').trim();
    if (text.length <= 30) return 0; // 内容太少不算正文
    var links = el.querySelectorAll('a').length;
    var blocks = el.querySelectorAll('p, h1, h2, h3, h4, li, pre, table, blockquote').length;
    // 与兜底、turndown 过滤同一套噪音判定：<footer>/<nav>/<aside>、role、常见页脚类名
    var noise = 0;
    var all = el.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (isNoise(all[i])) noise++;
    return text.length + links * 8 + blocks * 5 - noise * 150;
  }

  function absolutize(ref, base) {
    if (!ref) return ref;
    try {
      return new URL(ref, base).href;
    } catch (e) {
      return ref;
    }
  }

  // 检测网页主题（亮/暗）：看 html / body 的有效背景色亮度。
  // 预览时让背景跟随网页本身的配色。
  function detectPageTheme() {
    var candidates = [document.documentElement, document.body];
    var bg = '';
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      var c = (getComputedStyle(candidates[i]).backgroundColor || '').trim();
      if (c && c !== 'transparent' && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\)/.test(c)) { bg = c; break; }
    }
    var m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    var lum = m ? 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] : 255;
    return lum < 128 ? 'dark' : 'light';
  }

  function isHeaderlink(node) {
    var cls = node.getAttribute('class') || '';
    var id = node.getAttribute('id') || '';
    return /(^|\s)headerlink(\s|$)/.test(cls) || /headerlink/.test(id);
  }

  function convert(opts) {
    opts = opts || {};
    var cfg = {
      scope: opts.scope === 'page' ? 'page' : 'main',
      images: opts.images !== false,
      links: opts.links !== false,
      header: opts.header !== false
    };
    try {
      // 指定了 root（区域转换 / 选中内容）时直接用；否则按范围自动找
      var root = opts.root || (cfg.scope === 'main' ? findMain() : document.body);

      var td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
        strongDelimiter: '**',
        hr: '---'
      });
      if (window.turndownPluginGfm && window.turndownPluginGfm.gfm) {
        td.use(window.turndownPluginGfm.gfm);
      }

      // 噪音元素（addRule 会把规则 unshift 到最前，remove 规则在数组规则之后生效）
      td.remove(['script', 'style', 'noscript', 'template', 'iframe', 'svg']);
      // 自动识别正文时才过滤导航 / 页脚；用户指定的区域（opts.root）原样转换。
      // 与 findMainFallback / scoreMain 共用 isNoise（标签 + role + 常见页脚类名）。
      if (cfg.scope === 'main' && !opts.root) {
        td.remove(function (node) { return isNoise(node); });
      }

      // 代码块：识别 language-* 或 Sphinx 的 highlight-* 作为围栏语言。
      // Sphinx 结构是 <pre><span></span><code>…</code></pre>，不能用 firstChild 判断。
      td.addRule('codeBlock', {
        filter: function (node, options) {
          return options.codeBlockStyle === 'fenced' &&
            node.nodeName === 'PRE' &&
            node.getElementsByTagName('code').length > 0;
        },
        replacement: function (content, node, options) {
          // 不直接用 content：turndown 会先把 <code> 当行内代码加上反引号，
          // 这里从 code 元素取原始文本。
          var code = node.getElementsByTagName('code')[0];
          var cls = code.getAttribute('class') || '';
          var m = cls.match(/language-(\S+)/);
          var lang = m ? m[1] : '';
          if (!lang) {
            // 向上找 Sphinx 的 highlight-xxx 类
            for (var p = node.parentNode; p && p !== document.body; p = p.parentNode) {
              var pc = p.getAttribute && (p.getAttribute('class') || '');
              var m2 = pc && pc.match(/highlight-([\w-]+)/);
              if (m2) { lang = m2[1]; break; }
            }
          }
          var codeText = (code.textContent || '').replace(/^\n+/, '').replace(/\n+$/, '');
          // 若代码里有 ```，围栏相应加长
          var fence = '```';
          var maxRun = (codeText.match(/`{3,}/g) || [])
            .reduce(function (m2, s) { return Math.max(m2, s.length); }, 0);
          while (fence.length <= maxRun) fence += '`';
          return '\n\n' + fence + lang + '\n' + codeText + '\n' + fence + '\n\n';
        }
      });

      // 链接：相对地址绝对化；标题中的 ¶ 锚点剥掉
      td.addRule('inlineLink', {
        filter: function (node) {
          return node.nodeName === 'A' && !isHeaderlink(node);
        },
        replacement: function (content, node) {
          if (!cfg.links) return content; // 不保留链接：只留文字
          var href = node.getAttribute('href');
          if (!href) return content;
          var title = (node.getAttribute('title') || '').replace(/"/g, '');
          return '[' + content + '](' + absolutize(href, location.href) +
            (title ? ' "' + title + '"' : '') + ')';
        }
      });

      td.addRule('stripHeaderlink', {
        filter: function (node) {
          return node.nodeName === 'A' && isHeaderlink(node);
        },
        replacement: function () { return ''; }
      });

      // 图片：相对地址绝对化；兼容懒加载（data-src / data-original / srcset）
      td.addRule('inlineImage', {
        filter: function (node) {
          return node.nodeName === 'IMG';
        },
        replacement: function (content, node) {
          if (!cfg.images) return ''; // 不保留图片
          var src = node.getAttribute('src') || '';
          // 常见懒加载库的占位属性：src 缺失或是 data: 占位图时换真实地址
          var lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-original-src'];
          var lazySrc = '';
          for (var li = 0; li < lazyAttrs.length; li++) {
            var v = node.getAttribute(lazyAttrs[li]);
            if (v) { lazySrc = v; break; }
          }
          if (lazySrc && (!src || src.indexOf('data:') === 0)) src = lazySrc;
          if (!src) {
            var ss = node.getAttribute('srcset') || node.getAttribute('data-srcset');
            if (ss) src = ss.trim().split(/\s+/)[0]; // 取 srcset 里的第一张
          }
          if (!src) return '';
          var alt = node.getAttribute('alt') || '';
          return '![' + alt + '](' + absolutize(src, location.href) + ')';
        }
      });

      var markdown = td.turndown(root)
        .replace(/[ \t]+\n/g, '\n')   // 去行尾空白
        .replace(/\n{3,}/g, '\n\n')   // 压缩多余空行
        .trim();

      var title = (document.title || '').trim() || (location.hostname + location.pathname);
      var source = location.href;

      var prefix = '';
      if (cfg.header) {
        var sourceLine = '> 来源：<' + source + '>\n';
        if (/^#{1,6}\s+\S/.test(markdown)) {
          // 正文已自带标题，则不再重复加 H1
          prefix = sourceLine + '\n\n';
        } else {
          prefix = '# ' + title + '\n\n' + sourceLine + '\n\n---\n\n';
        }
      }

      return { ok: true, markdown: prefix + markdown, title: title, url: source, theme: detectPageTheme(), scope: cfg.scope };
    } catch (e) {
      return {
        ok: false,
        error: (e && e.message) ? e.message : String(e),
        title: document.title || '',
        url: location.href
      };
    }
  }

  // 转换当前选中的内容（右键菜单「将选中内容转换为 Markdown」用）
  function convertSelection(opts) {
    opts = opts || {};
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return {
        ok: false,
        error: '请先在页面上选中要转换的内容',
        title: document.title || '',
        url: location.href
      };
    }
    var wrapper = document.createElement('div');
    wrapper.appendChild(sel.getRangeAt(0).cloneContents());
    // 选中内容恰好是一个元素时，直接用它（保留表格 / 代码块等结构）
    if (wrapper.childNodes.length === 1 && wrapper.firstChild.nodeType === 1) {
      return convert(Object.assign({}, opts, { root: wrapper.firstChild }));
    }
    return convert(Object.assign({}, opts, { root: wrapper }));
  }

  // 区域选取模式：返回一个 Promise，用户点击页面某区域后 resolve 转换结果。
  // 高亮悬停元素，Esc 取消。由 background 通过 executeScript(func) 注入调用。
  function startRegionPicker(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var doc = document;
      var hint = null, styleEl = null, current = null, active = true;

      // 顶部提示条
      hint = doc.createElement('div');
      hint.className = 'md-picker-hint';
      hint.textContent = '点击要转换的区域 · Esc 取消';
      doc.body.appendChild(hint);

      styleEl = doc.createElement('style');
      styleEl.id = 'md-picker-style';
      styleEl.textContent =
        '.md-picker-active{outline:2px solid #4c8bf5!important;outline-offset:-2px!important}' +
        '.md-picker-hint{position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);' +
        'background:#1e1f26;color:#e6e7ee;border:1px solid #4c8bf5;border-radius:6px;' +
        'padding:8px 16px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
        'pointer-events:none;user-select:none;white-space:nowrap}';
      doc.head.appendChild(styleEl);

      function cleanup() {
        active = false;
        if (current) current.classList.remove('md-picker-active');
        if (hint) hint.remove();
        if (styleEl) styleEl.remove();
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('keydown', onKey);
      }

      function pickable(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node === doc.body || node === doc.documentElement) return false;
        if (node.classList && node.classList.contains('md-picker-hint')) return false;
        return true;
      }

      function onMove(e) {
        if (!active) return;
        var t = e.target;
        while (t && !pickable(t)) t = t.parentNode;
        if (t !== current) {
          if (current) current.classList.remove('md-picker-active');
          current = t;
          if (current) current.classList.add('md-picker-active');
        }
      }

      function onClick(e) {
        if (!active) return;
        var t = e.target;
        while (t && !pickable(t)) t = t.parentNode;
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        resolve(convert({
          root: t,
          images: opts.images,
          links: opts.links,
          header: opts.header
        }));
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          cleanup();
          resolve({
            ok: false,
            error: '已取消区域选取',
            title: document.title || '',
            url: location.href
          });
        }
      }

      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('keydown', onKey);
    });
  }

  window.__mdConvert = convert;
  window.__mdConvertSelection = convertSelection;
  window.__startRegionPicker = startRegionPicker;
})();
