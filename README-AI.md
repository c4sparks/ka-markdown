# Ka — 网页转 Markdown(AI 版)

> 本仓库的 **AI 版**:把网页转 Markdown 的转换引擎打包成 npm 包,提供 **CLI** 和 **MCP** 两种入口,面向脚本 / 批处理 / AI 调用场景。
> 原始浏览器扩展的使用见 [README.md](README.md)。两者互不影响。

转换逻辑与浏览器扩展**同源**:内置同一套 content.js + Turndown,支持正文识别、导航/页脚过滤、代码围栏、表格、懒加载图片、相对链接绝对化。默认 **jsdom** 引擎(轻快),可选 **Playwright** 引擎(JS 渲染页面高保真),`--engine auto` 自动降级。

- 纯 JS、零构建,Node >= 18
- 纯本地处理,不上传任何内容

## 目录结构

```
ka-markdown/
├─ README.md            原始版(浏览器扩展)文档
├─ README-AI.md         本文件(AI 版)
└─ packages/ka-markdown/  AI 版 npm 包
   ├─ bin/ka.js           CLI 入口(命令名 ka)
   ├─ bin/ka-mcp.js       MCP server 入口
   ├─ lib/                转换核心(vendor 副本,与扩展解耦)
   └─ src/                core(引擎)/ cli / mcp
```

## 快速开始

```bash
cd packages/ka-markdown
npm install
node bin/ka.js https://example.com/   # 直接跑
# 或全局装成命令:
npm link
ka https://example.com/               # 之后任意目录可用
```

## CLI 用法

```bash
ka <url>                      # 转好的 Markdown 打到 stdout(可管道)
ka <url> -o article.md        # 输出到文件
ka mcp                        # 启动 MCP server(stdin/stdout)
cat urls.txt | ka --batch -d ./out   # 批量:每行一个 URL,# 开头为注释
ka <url> --engine playwright  # 需要 JS 渲染的页面(需先装 playwright)
ka <本地.html文件>             # 也可直接转本地 HTML 文件
```

选项:

| 选项 | 说明 |
|---|---|
| `--scope main\|page` | 正文区域(默认 main)/ 整个页面 |
| `--no-images` | 不保留图片 |
| `--no-links` | 不保留链接(只留文字) |
| `--no-header` | 不添加来源说明 |
| `--engine auto\|jsdom\|playwright` | 转换引擎(auto=jsdom 优先、可疑时自动升级,默认) |
| `--base-url <url>` | 本地 HTML 文件转换时的基准地址(默认 `file://` 当前文件路径) |
| `--wait-until <load\|networkidle\|domcontentloaded\|commit>` | Playwright 引擎页面加载等待策略(默认 load) |
| `-o, --output <file>` | 输出到文件 |
| `-d, --dir <dir>` | 批量输出目录(文件名带秒级时间戳,同标题不覆盖) |
| `--batch` | 批量模式(也自动从 stdin 识别) |
| `--timeout <ms>` | 抓取超时(默认 20000) |
| `-v, --version` / `-h, --help` | 版本 / 帮助 |

## MCP 用法

提供两个工具,供 AI 助手等 MCP 客户端调用:

- **convert_url(url, opts)** — 抓取网页并转成干净 Markdown
- **convert_html(html, opts)** — 把已有 HTML 片段就地转换

本仓库已配置项目级 MCP(`.mcp.json`):启动后批准即可使用。手动配置:

```json
{
  "mcpServers": {
    "ka-markdown": {
      "command": "node",
      "args": ["packages/ka-markdown/bin/ka-mcp.js"]
    }
  }
}
```

## 引擎说明

| 引擎 | 说明 | 何时用 |
|---|---|---|
| jsdom(默认) | 解析原始 HTML,不执行 JS,毫秒级 | 静态页 / 文档站(90% 场景) |
| playwright | 真实浏览器,JS 渲染后内容,保真度最高 | SPA / JS 重度渲染页面 |
| auto(默认引擎) | jsdom 优先,结果可疑(空 / 正文过短且 HTML 过大 / SPA 标记)自动升级 playwright;未装或失败自动回落 | 大多数情况直接用它 |

安装 Playwright(可选):

```bash
npm install playwright
npx playwright install chromium
ka <url> --engine playwright
```

## 开发与测试

```bash
cd packages/ka-markdown
npm install
npm test          # core 转换断言 + MCP 协议冒烟 + 引擎实测(未装 playwright 自动跳过)
```

