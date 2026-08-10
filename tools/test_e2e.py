"""端到端验证：把扩展真实加载进 Chromium（new headless）。

验证：
  1. 扩展 service worker 注册成功
  2. 右键菜单「将本页转换为 Markdown」已创建
  3. 走扩展真实路径（chrome.scripting 注入 → content.js）转换页面得到正确 Markdown
  4. 弹窗页面 popup.html 能正常加载
用法：python tools/test_e2e.py
"""
import pathlib
import re
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

FIXTURE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>E2E Fixture</title></head>
<body>
  <nav><ul><li>Sidebar Menu</li></ul></nav>
  <div role="main">
    <h1 id="intro">End to End<a class="headerlink" href="#intro">¶</a></h1>
    <p>A <a href="/more.html">link</a>.</p>
    <pre><code class="language-js">const ok = true;</code></pre>
  </div>
</body></html>
"""


def main():
    failures = []
    with sync_playwright() as p:
        user_data_dir = tempfile.mkdtemp(prefix="mdext-e2e-")
        ext_path = str(ROOT)
        ctx = None
        try:
            ctx = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                channel="chromium",
                headless=True,
                ignore_default_args=["--disable-extensions"],
                args=[
                    "--disable-extensions-except=" + ext_path,
                    "--load-extension=" + ext_path,
                ],
            )
        except Exception as e:  # noqa: BLE001
            print("❌ 无法以扩展模式启动 Chromium:", repr(e))
            print("   本环境可能不支持 headless 加载扩展；核心逻辑已由转换器测试覆盖。")
            sys.exit(1)

        # 1) service worker（MV3 SW 在 onInstalled 时注册，用事件方式获取）
        sw = None
        try:
            sw = ctx.wait_for_event("serviceworker", timeout=30000)
        except Exception:  # noqa: BLE001
            workers = ctx.service_workers
            sw = workers[0] if workers else None
        if not sw:
            failures.append("扩展 service worker 未注册")
            print("❌", failures[-1])
            ctx.close()
            sys.exit(1)
        print("✅ service worker 已注册:", sw.url)
        ext_id = sw.url.split("/")[2]

        # 2) 右键菜单（该版本无 getAll，用 update 探测：菜单存在则 update 成功）
        try:
            checks = {
                'md-page-menu': '将本页转换为 Markdown',
                'md-convert-main': '转换主要内容',
                'md-convert-page': '转换整页',
            }
            for mid, title in checks.items():
                ok = sw.evaluate(
                    """async (arg) => {
                      try {
                        await chrome.contextMenus.update(arg.id, { title: arg.title });
                        return true;
                      } catch (e) {
                        return false;
                      }
                    }""",
                    {'id': mid, 'title': title},
                )
                assert ok, f"右键菜单 {mid} 不存在"
            print("✅ 右键菜单「将本页转换为 Markdown」二级菜单（主要内容 / 整页）已创建")
        except Exception as e:  # noqa: BLE001
            failures.append(f"右键菜单检查失败: {e!r}")

        # 3) 真实注入路径转换
        try:
            page = ctx.new_page()
            page.route(
                "http://e2e.local/page.html",
                lambda route: route.fulfill(body=FIXTURE, content_type="text/html"),
            )
            page.goto("http://e2e.local/page.html")
            result = sw.evaluate(
                """async () => {
                  const tabs = await chrome.tabs.query({});
                  const tab = tabs.find(t => (t.url || '').startsWith('http://e2e.local/'));
                  if (!tab) return { ok: false, error: '找不到目标标签页' };
                  await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['lib/turndown.js', 'lib/turndown-plugin-gfm.js', 'content.js']
                  });
                  const [res] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (o) => window.__mdConvert(o),
                    args: [{ scope: 'main' }]
                  });
                  return res.result;
                }"""
            )
            assert result["ok"], result
            md = result["markdown"]
            assert "# End to End" in md, "缺少 H1"
            assert "```js" in md, "缺少代码块围栏"
            assert "Sidebar Menu" not in md, "导航混入正文"
            assert "¶" not in md, "headerlink 未清理"
            assert "http://e2e.local/more.html" in md, "链接未绝对化"
            print("✅ 通过 SW 真实注入路径转换成功，长度", len(md))
        except Exception as e:  # noqa: BLE001
            failures.append(f"转换验证失败: {e!r}")

        # 3b) SW 里的 downloadMarkdown 不应抛错（回归：MV3 Service Worker 没有
        #     URL.createObjectURL，必须回退到 data URL，否则右键菜单自动下载失效）
        try:
            dl = sw.evaluate("""async () => {
              const orig = chrome.downloads.download.bind(chrome.downloads);
              let called = null;
              chrome.downloads.download = (opt) => { called = opt; return Promise.resolve(123); };
              try {
                await downloadMarkdown('# test', 'sw-download-test.md');
                return { thrown: false, called };
              } catch (e) {
                return { thrown: true, err: String(e) };
              } finally {
                chrome.downloads.download = orig;
              }
            }""")
            assert not dl["thrown"], f"SW 中 downloadMarkdown 抛错: {dl.get('err')}"
            assert dl["called"] and dl["called"]["url"], "downloadMarkdown 未调用 chrome.downloads.download"
            assert dl["called"]["url"].startswith("data:text/markdown"), \
                f"SW 中应回退到 data URL，实际: {dl['called']['url'][:40]}"
            print("✅ SW 中 downloadMarkdown 可用（回退 data URL）")
        except Exception as e:  # noqa: BLE001
            failures.append(f"SW 下载回归检查失败: {e!r}")

        # 3b2) downloadFilename 生成带时间戳的文件名（文章名-YYYYMMDD-HHMM.md）
        try:
            fn = sw.evaluate("() => downloadFilename('测试文章')")
            assert re.fullmatch(r"测试文章-\d{8}-\d{4}\.md", fn), f"文件名格式异常: {fn}"
            print("✅ downloadFilename 带时间戳:", fn)
        except Exception as e:  # noqa: BLE001
            failures.append(f"downloadFilename 检查失败: {e!r}")

        # 3c) 主题检测：深色背景页面 → theme=dark（预览背景跟随源网页）
        try:
            dark_page = ctx.new_page()
            dark_page.route(
                "http://e2e.local/dark.html",
                lambda route: route.fulfill(
                    body="<html><body style='background:#111;color:#eee'><main><h1>Dark</h1><p>x</p></main></body></html>",
                    content_type="text/html",
                ),
            )
            dark_page.goto("http://e2e.local/dark.html")
            dark_res = sw.evaluate("""async () => {
              const tabs = await chrome.tabs.query({});
              const tab = tabs.find(t => (t.url || '').startsWith('http://e2e.local/dark.html'));
              if (!tab) return { ok: false, error: '找不到目标标签页' };
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['lib/turndown.js', 'lib/turndown-plugin-gfm.js', 'content.js']
              });
              const [r] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (o) => window.__mdConvert(o),
                args: [{ scope: 'main' }]
              });
              return r.result;
            }""")
            assert dark_res["ok"] and dark_res.get("theme") == "dark", dark_res
            print("✅ 主题检测：深色页面 → theme=dark")
            dark_page.close()
        except Exception as e:  # noqa: BLE001
            failures.append(f"主题检测失败: {e!r}")

        # 4) 弹窗页面可加载
        try:
            popup = ctx.new_page()
            errors = []
            popup.on("pageerror", lambda e: errors.append(str(e)))
            popup.goto(f"chrome-extension://{ext_id}/popup.html")
            popup.wait_for_selector("#markdown", timeout=10000)
            title = popup.title()
            assert title, "popup 无标题"
            assert not errors, f"popup 页面 JS 错误: {errors}"
            print("✅ 弹窗页面正常加载，标题:", title)
        except Exception as e:  # noqa: BLE001
            failures.append(f"弹窗加载失败: {e!r}")

        # 5) 区域转换
        try:
            # 5a) 选中内容的右键菜单项存在
            ok = sw.evaluate("""async () => {
              try {
                await chrome.contextMenus.update('md-convert-selection', { title: '将选中内容转换为 Markdown' });
                return true;
              } catch (e) { return false; }
            }""")
            assert ok, "右键菜单 md-convert-selection 不存在"
            print("✅ 右键菜单「将选中内容转换为 Markdown」已创建")
        except Exception as e:  # noqa: BLE001
            failures.append(f"选中内容菜单检查失败: {e!r}")

        try:
            # 5b) 完整区域选取流程：弹窗发消息 → 页面出提示条 → 点选 → 自动打开编辑器
            sw.evaluate("""() => chrome.storage.local.set({ md_settings: {
              scope: 'main', images: true, links: true, header: true,
              autoCopy: false, autoDownload: false, showPreview: true
            }})""")
            # 打开弹窗页（作为标签页），再把 fixture 页设为活动页，最后从弹窗页发消息
            pick_popup = ctx.new_page()
            pick_popup.goto(f"chrome-extension://{ext_id}/popup.html")
            pick_popup.wait_for_selector("#region", timeout=10000)
            page.bring_to_front()
            pick_popup.evaluate("() => chrome.runtime.sendMessage({ type: 'md-start-pick' })")

            # 等待页面出现选取提示条
            page.wait_for_selector(".md-picker-hint", timeout=10000)
            # 点选段落元素
            box = page.locator("p").bounding_box()
            assert box, "fixture 没有 <p> 元素"
            with ctx.expect_page(timeout=12000) as new_page_info:
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            editor = new_page_info.value
            editor.wait_for_selector("#md-editor", timeout=10000)
            content = editor.evaluate("() => document.getElementById('md-editor').value")
            assert "link" in content, f"区域选取结果异常: {content[:120]}"
            assert not page.evaluate("() => !!document.querySelector('.md-picker-hint')"), "选取后提示条未清理"
            print("✅ 区域选取流程完整走通（点选 → 转换 → 打开编辑器）")
            editor.close()
        except Exception as e:  # noqa: BLE001
            failures.append(f"区域选取流程失败: {e!r}")

        # 6) 预览渲染（编辑器默认预览视图 + 弹窗视图切换 + <img> 渲染）
        try:
            # 6a) 编辑器：有内容且 showPreview=true 时，打开即进入预览视图并渲染出图片
            sw.evaluate("""async () => {
              await chrome.storage.local.set({ md_settings: {
                scope: 'main', images: true, links: true, header: false,
                autoCopy: false, autoDownload: false, showPreview: true
              }});
              await chrome.storage.local.set({ md_editor_data: {
                markdown: '# 标题\\n\\n![图](http://e2e.local/logo.png)\\n\\n正文段落',
                title: '测试页', url: 'http://e2e.local/', theme: 'light'
              }});
            }""")
            pv = ctx.new_page()
            pv.goto(f"chrome-extension://{ext_id}/editor.html")
            pv.wait_for_function(
                "() => document.getElementById('editor-wrap').dataset.view === 'preview'",
                timeout=10000,
            )
            assert pv.evaluate("() => document.getElementById('view-preview').classList.contains('active')"), \
                "预览按钮应处于激活态"
            # 渲染走 rAF：等预览 iframe 真正填充出内容再断言
            pv.wait_for_function(
                "() => document.getElementById('md-preview').srcdoc.includes('http://e2e.local/logo.png')",
                timeout=10000,
            )
            srcdoc = pv.evaluate("() => document.getElementById('md-preview').srcdoc")
            assert "<h1" in srcdoc and "标题" in srcdoc, "预览未渲染标题"
            # 主题为 light 时预览背景应为白色（跟随源网页）
            assert "background:#ffffff" in srcdoc, "预览背景未跟随 light 主题"
            # 安全：预览 iframe 必须 sandbox 且不允许脚本
            assert not pv.evaluate("() => document.getElementById('md-preview').sandbox.contains('allow-scripts')"), \
                "预览 iframe 不应允许脚本"
            # 切到编辑 / 分屏
            pv.click("#view-edit")
            assert pv.evaluate("() => document.getElementById('editor-wrap').dataset.view") == "edit", "编辑视图未生效"
            pv.click("#view-split")
            assert pv.evaluate("() => document.getElementById('editor-wrap').dataset.view") == "split", "分屏未生效"
            # 6a2) 实时预览：分屏下编辑内容 → 右侧预览跟着更新（防抖 150ms）
            pv.evaluate("""() => {
              const ta = document.getElementById('md-editor');
              ta.value = ta.value + '\\n\\n> 实时预览验证';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            }""")
            pv.wait_for_function(
                "() => document.getElementById('md-preview').srcdoc.includes('实时预览验证')",
                timeout=5000,
            )
            print("    分屏编辑 → 预览实时更新 OK")
            pv.close()

            # 6b) 弹窗：让 fixture（亮色）成为活动页并重载弹窗，自动转换命中 fixture →
            #     current.theme=light，预览背景应为白色；再手工填内容点「预览」渲染图片
            pp = ctx.new_page()
            pp.goto(f"chrome-extension://{ext_id}/popup.html")
            pp.wait_for_selector("#preview", state="attached", timeout=10000)
            page.bring_to_front()
            pp.reload()
            pp.wait_for_function(
                "() => (document.getElementById('status').textContent || '').trim() !== '…'",
                timeout=10000,
            )
            pp.wait_for_function(
                "() => document.getElementById('md-wrap').dataset.view === 'preview'",
                timeout=10000,
            )
            # 渲染走 rAF：等预览背景填充出来再断言
            pp.wait_for_function(
                "() => document.getElementById('preview').srcdoc.includes('background:#ffffff')",
                timeout=10000,
            )
            srcdoc2 = pp.evaluate("() => document.getElementById('preview').srcdoc")
            pp.evaluate("""() => {
              const ta = document.getElementById('markdown');
              ta.value = '# 弹窗标题\\n\\n![图](http://e2e.local/p.png)';
              document.getElementById('view-preview').click();
            }""")
            assert pp.evaluate("() => document.getElementById('md-wrap').dataset.view") == "preview", \
                "弹窗未切换到预览视图"
            pp.wait_for_function(
                "() => document.getElementById('preview').srcdoc.includes('http://e2e.local/p.png')",
                timeout=10000,
            )
            srcdoc2 = pp.evaluate("() => document.getElementById('preview').srcdoc")
            assert "background:#ffffff" in srcdoc2, "弹窗预览背景未跟随 light 主题"
            pp.close()
            print("✅ 预览渲染：编辑器默认预览 + 视图切换 + <img> 渲染")
        except Exception as e:  # noqa: BLE001
            failures.append(f"预览渲染验证失败: {e!r}")

        ctx.close()

    print("=" * 60)
    if failures:
        print("❌ 失败:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("✅ 端到端全部通过")


if __name__ == "__main__":
    main()
