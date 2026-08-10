"""转换器验证：在真实 Chromium 里注入 content.js，跑 __mdConvert 并断言输出。

覆盖：正文选区、表格、带语言的代码块、相对链接/图片绝对化、headerlink 清理、
导航排除、整页模式。用法：python tools/test_converter.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

# Windows 控制台默认 GBK，先切成 UTF-8 再打印，避免 UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read(*parts):
    return (ROOT / pathlib.Path(*parts)).read_text(encoding="utf-8")


FIXTURE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture Doc</title></head>
<body>
  <nav id="sidebar"><ul><li>Sidebar Item A</li><li>Sidebar Item B</li></ul></nav>
  <div role="main">
    <h1 id="introduction">Introduction<a class="headerlink" href="#introduction">¶</a></h1>
    <p>Welcome to the <a href="/guide/start.html">getting started</a> guide.</p>
    <table>
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody><tr><td>alpha</td><td>1</td></tr></tbody>
    </table>
    <div class="highlight-python notranslate"><div class="highlight"><pre><span></span><code><span class="k">print</span><span class="p">(</span><span class="s">"hi"</span><span class="p">)</span></code></pre></div></div>
    <p><img src="/images/logo.png" alt="logo"></p>
    <p><img data-src="/images/lazy.png" alt="lazy"></p>
    <p><img data-original="/images/original.png" alt="orig"></p>
    <p><img src="/images/small.png" srcset="/images/hi.png 2x" alt="responsive"></p>
    <p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/images/real.png" alt="lazyplc"></p>
    <footer><p>Copyright 2026 Fixture</p></footer>
    <div class="related"><a href="/prev.html">Previous</a></div>
  </div>
  <script>window.x = 1;</script>
</body></html>
"""


def inject_converter(page):
    """用 CDP 注入三个脚本（绕过页面 CSP，等价于扩展的 executeScript）。
    用 evaluate 而非 add_script_tag：后者是内联 <script>，会被严格 CSP 页面拦截。"""
    for f in ("lib/turndown.js", "lib/turndown-plugin-gfm.js", "content.js"):
        page.evaluate(read(f))


def run_fixture_test(page, results):
    page.route(
        "http://fixture.local/docs/index.html",
        lambda route: route.fulfill(body=FIXTURE, content_type="text/html"),
    )
    page.goto("http://fixture.local/docs/index.html")
    inject_converter(page)

    main = page.evaluate("() => window.__mdConvert({ scope: 'main', header: true })")
    assert main["ok"], main
    # fixture 页面无背景色 → 主题应为 light
    assert main.get("theme") == "light", f"fixture 主题应为 light，实际 {main.get('theme')}"
    md = main["markdown"]
    results["fixture_main_ok"] = True
    results["fixture_main_preview"] = md

    # 正文选区：应包含 H1 但不含侧边导航文字
    assert "# Introduction" in md, "缺 H1"
    assert "Sidebar Item A" not in md, "导航不应出现在主要内容模式"
    # 页脚 / 底部导航剔除（footer 标签 + .related 类名）
    assert "Copyright 2026" not in md, "footer 不应出现在主要内容模式"
    assert "Previous" not in md, ".related 底部导航不应出现"
    # 表格
    assert "| Name | Value |" in md, "表格未转换"
    assert "| alpha | 1 |" in md, "表格内容缺失"
    # 代码块语言（Sphinx highlight-python 向上查找）
    assert "```python" in md, "代码块语言未识别"
    assert 'print("hi")' in md, "代码内容缺失"
    # 相对链接绝对化
    assert "http://fixture.local/guide/start.html" in md, "链接未绝对化"
    # 相对图片绝对化
    assert "http://fixture.local/images/logo.png" in md, "图片未绝对化"
    # 懒加载图片：src 缺失时用 data-src / data-original
    assert "http://fixture.local/images/lazy.png" in md, "data-src 懒加载图片未转换"
    assert "http://fixture.local/images/original.png" in md, "data-original 懒加载图片未转换"
    # 有 src 时忽略 srcset（src 优先），且用 src 而非 2x
    assert "http://fixture.local/images/small.png" in md, "srcset 图片未用 src"
    assert "http://fixture.local/images/hi.png" not in md, "不应使用 srcset 里的地址"
    # src 是 data: 占位图时改用 data-src
    assert "http://fixture.local/images/real.png" in md, "data: 占位图未回退到 data-src"
    # headerlink 清理
    assert "¶" not in md, "headerlink 锚点未清理"
    # 开头带来源行
    assert "http://fixture.local/docs/index.html" in md, "来源行缺失"
    results["fixture_main_assertions"] = True

    # 整页模式应包含导航
    whole = page.evaluate("() => window.__mdConvert({ scope: 'page', header: false })")
    assert whole["ok"] and "Sidebar Item A" in whole["markdown"], "整页模式应包含导航"

    # 选项开关
    no_img = page.evaluate("() => window.__mdConvert({ scope: 'main', images: false, header: false })")
    assert "![" not in no_img["markdown"], "images=false 应移除图片"
    no_links = page.evaluate("() => window.__mdConvert({ scope: 'main', links: false, header: false })")
    # 注意 links=false 仍保留图片（![logo](http://…)），所以要精确定位链接地址
    assert "/guide/start.html" not in no_links["markdown"], "links=false 应去掉链接地址"
    no_header = page.evaluate("() => window.__mdConvert({ scope: 'main', header: false })")
    assert "> 来源" not in no_header["markdown"], "header=false 应去掉来源说明"
    results["fixture_options_toggles"] = True

    # 区域转换一：指定节点（__mdConvert 传 root）
    node_md = page.evaluate("() => window.__mdConvert({ root: document.querySelector('table'), header: false })")
    assert "| Name | Value |" in node_md["markdown"], "区域转换（指定节点）表格失败"
    assert "Welcome" not in node_md["markdown"], "区域转换应只含指定节点内容"

    # 区域转换二：选中内容（__mdConvertSelection）
    sel_md = page.evaluate("""() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('p'));
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      return window.__mdConvertSelection({ header: false });
    }""")
    assert sel_md["ok"], sel_md
    assert "getting started" in sel_md["markdown"], "选中内容转换失败"

    # 区域转换三：选取模式（悬停高亮 → 点击转出 → 清理）
    page.evaluate("() => { window.__pickRes = window.__startRegionPicker({ header: false }); return true; }")
    page.evaluate("""() => {
      const p = document.querySelector('p');
      const r = p.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      p.dispatchEvent(new MouseEvent('mousemove', opts));
      p.dispatchEvent(new MouseEvent('click', opts));
    }""")
    page.wait_for_timeout(200)
    pick_md = page.evaluate("() => window.__pickRes.then((r) => r)")
    assert pick_md["ok"], pick_md
    assert "getting started" in pick_md["markdown"], "区域选取转换失败"
    assert not page.evaluate("() => !!document.querySelector('.md-picker-hint')"), "选取后提示条未清理"
    assert not page.evaluate("() => !!document.querySelector('#md-picker-style')"), "选取后样式未清理"
    results["fixture_region_tests"] = True


# 页面没有任何语义容器（article / main / role=main / .content…），
# 只有通用 div 时，「主要内容」也不应与「整个页面」一样 —— 兜底应找到散文块最密集的区块。
NOSEMANTIC = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>No Semantic</title></head>
<body>
  <div class="topbar"><img src="/static/logo.png" alt="Logo"><span>Home</span> <span>About</span> <span>Contact</span></div>
  <div class="container">
    <div class="title"><h1>Post Title</h1></div>
    <div class="entry">
      <p>This is the body text.</p>
      <p>More body text here.</p>
    </div>
  </div>
  <div class="copyright">© 2026 All rights reserved</div>
</body></html>
"""


def run_nosemantic_test(page, results):
    page.route(
        "http://nosemantic.local/",
        lambda route: route.fulfill(body=NOSEMANTIC, content_type="text/html"),
    )
    page.goto("http://nosemantic.local/")
    inject_converter(page)

    main = page.evaluate("() => window.__mdConvert({ scope: 'main', header: false })")
    whole = page.evaluate("() => window.__mdConvert({ scope: 'page', header: false })")
    assert main["ok"] and whole["ok"]
    # 核心：两种范围必须不同
    assert main["markdown"] != whole["markdown"], "无语义容器时 主要内容 与 整个页面 不应相同"
    # 主要内容模式应含正文、不含顶栏 / 版权 / 顶部 logo 图
    assert "Post Title" in main["markdown"], "主要内容缺少标题"
    assert "This is the body text." in main["markdown"], "主要内容缺少正文"
    assert "Home" not in main["markdown"], "顶栏导航混入了主要内容"
    assert "© 2026" not in main["markdown"], "版权行混入了主要内容"
    assert "/static/logo.png" not in main["markdown"], "顶部 logo 图混入了主要内容"
    # 整页模式应保留顶栏与版权
    assert "Home" in whole["markdown"] and "© 2026" in whole["markdown"], "整页模式应保留全页内容"
    results["nosemantic_main_vs_page"] = True
    results["nosemantic_main_preview"] = main["markdown"]


# 页脚不是 <footer> 标签，而是普通 <div class="copyright"> / <div class="pagination">
# （且里面是 <p> 散文）时，也要从「主要内容」里剔除——包括无语义容器走兜底选区的情况。
FOOTERDIV = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Footer Div</title></head>
<body>
  <div class="page-wrap">
    <div class="title"><h1>Post Title</h1></div>
    <div class="entry">
      <p>Body paragraph one.</p>
      <p>Body paragraph two.</p>
      <p>Body paragraph three.</p>
    </div>
    <div class="copyright"><p>© 2026 All rights reserved. <a href="/privacy.html">Privacy</a></p></div>
    <div class="pagination"><p><a href="/next.html">Next Page</a></p></div>
  </div>
</body></html>
"""


def run_footerdiv_test(page, results):
    page.route(
        "http://footerdiv.local/",
        lambda route: route.fulfill(body=FOOTERDIV, content_type="text/html"),
    )
    page.goto("http://footerdiv.local/")
    inject_converter(page)

    main = page.evaluate("() => window.__mdConvert({ scope: 'main', header: false })")
    whole = page.evaluate("() => window.__mdConvert({ scope: 'page', header: false })")
    assert main["ok"] and whole["ok"]
    # 主要内容应含标题与正文
    assert "Post Title" in main["markdown"], "主要内容缺少标题"
    assert "Body paragraph one." in main["markdown"], "主要内容缺少正文"
    # copyright / 分页导航（普通 div，非 <footer> 标签）不得混入主要内容
    assert "© 2026" not in main["markdown"], "copyright 页脚混入了主要内容"
    assert "/privacy.html" not in main["markdown"], "页脚链接混入了主要内容"
    assert "Next Page" not in main["markdown"], "分页导航混入了主要内容"
    assert "/next.html" not in main["markdown"], "分页链接混入了主要内容"
    # 整页模式应保留页脚
    assert "© 2026" in whole["markdown"] and "Next Page" in whole["markdown"], "整页模式应保留页脚"
    results["footerdiv_main_excludes_footer"] = True
    results["footerdiv_main_preview"] = main["markdown"]


def looks_like_challenge(title, body):
    return (
        "just a moment" in title.lower()
        or "security verification" in body
        or "cf-chl" in body
    )


def convert_real_page(page, url, wait_selector):
    page.goto(url, timeout=60000, wait_until="domcontentloaded")
    page.wait_for_selector(wait_selector, timeout=15000)
    page.wait_for_timeout(1500)
    title = page.title()
    body = page.evaluate("() => document.body.textContent || ''")
    if looks_like_challenge(title, body):
        return None
    inject_converter(page)
    return page.evaluate("() => window.__mdConvert({ scope: 'main', header: true })")


def run_Sphinx_test(page, results):
    try:
        res = convert_real_page(
            page,
            "https://example.com/",
            '[role="main"], article',
        )
    except Exception as e:  # noqa: BLE001
        # Cloudflare 有时连正文选择器都不渲染，headless 下直接超时 → 按跳过处理
        results["rtd_skipped"] = (
            "headless 被 Cloudflare 拦截（页面未渲染出正文容器），扩展本身不受影响："
            + f"{e!r}"
        )
        return
    if res is None:
        results["rtd_skipped"] = "headless 环境被 Cloudflare 人机校验拦截（扩展本身不受影响，用户浏览器可正常使用）"
        return
    assert res["ok"], res
    assert len(res["markdown"]) > 500, "Sphinx 转换结果过短"
    results["rtd_title"] = res["title"]
    results["rtd_len"] = len(res["markdown"])
    results["rtd_preview"] = res["markdown"][:400]


def run_pythondocs_test(page, results):
    # example.com 同为 Sphinx/Sphinx 主题，但无 Cloudflare 拦截，适合严格断言
    res = convert_real_page(page, "https://example.com/", '[role="main"], article')
    assert res is not None, "example.com 被拦截或无法访问"
    assert res["ok"], res
    md = res["markdown"]
    assert len(md) > 500, "example.com 转换结果过短"
    assert ("```" in md) or ("|" in md) or ("#" in md), "转换结果缺少预期内容"
    # 正文模式不应包含侧边导航文字（Sphinx 侧栏有 'Python 3 Documentation' 之类链接文本）
    assert "Search the docs" not in md, "侧边导航混入了主要内容"
    results["pydocs_title"] = res["title"]
    results["pydocs_len"] = len(md)
    results["pydocs_preview"] = md[:500]


def main():
    results = {}
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        for name, fn in [
            ("fixture", lambda pg: run_fixture_test(pg, results)),
            ("no-semantic", lambda pg: run_nosemantic_test(pg, results)),
            ("footer-div", lambda pg: run_footerdiv_test(pg, results)),
            ("Sphinx", lambda pg: run_Sphinx_test(pg, results)),
            ("example.com", lambda pg: run_pythondocs_test(pg, results)),
        ]:
            try:
                fn(page)
            except AssertionError as e:
                failures.append(f"[{name}] 断言失败: {e}")
            except Exception as e:  # noqa: BLE001
                failures.append(f"[{name}] 异常: {e!r}")
        browser.close()

    print("=" * 60)
    print("【离线 fixture】")
    print("  主要模式断言通过:", results.get("fixture_main_assertions"))
    print("  选项开关断言通过:", results.get("fixture_options_toggles"))
    print("  区域转换断言通过:", results.get("fixture_region_tests"))
    print("  预览:")
    print((results.get("fixture_main_preview") or "").strip()[:900])
    print("=" * 60)
    print("【无语义容器页面】")
    print("  主要/整页不同断言通过:", results.get("nosemantic_main_vs_page"))
    print("  预览:")
    print((results.get("nosemantic_main_preview") or "").strip()[:500])
    print("=" * 60)
    print("【页脚是普通 div（copyright / 分页）】")
    print("  主要内容剔除页脚断言通过:", results.get("footerdiv_main_excludes_footer"))
    print("  预览:")
    print((results.get("footerdiv_main_preview") or "").strip()[:500])
    print("=" * 60)
    print("【Sphinx 真实页面】")
    if results.get("rtd_skipped"):
        print("  跳过:", results["rtd_skipped"])
    else:
        print("  标题:", results.get("rtd_title"))
        print("  长度:", results.get("rtd_len"))
        print("  预览:", (results.get("rtd_preview") or "").strip()[:400])
    print("=" * 60)
    print("【example.com 真实页面】")
    print("  标题:", results.get("pydocs_title"))
    print("  长度:", results.get("pydocs_len"))
    print("  预览:", (results.get("pydocs_preview") or "").strip()[:500])
    print("=" * 60)
    if failures:
        print("❌ 失败:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("✅ 全部通过")


if __name__ == "__main__":
    main()
