# ka-markdown — 网页转 Markdown(AI 版)

同一套转换引擎的 **CLI + MCP**。转换逻辑与浏览器扩展[ka-markdown](https://github.com/c4sparks/ka-markdown)同源:内置 content.js + Turndown,支持正文识别、导航/页脚过滤、代码围栏、表格、懒加载图片、相对链接绝对化。

- 纯 JS、零构建,Node >= 18
- 默认 **jsdom** 引擎(轻、快);可选 **Playwright** 引擎(高保真,JS 渲染页面)

## 安装

```bash
npm install -g ka-markdown        # 全局安装 CLI
# 或零安装使用:npx ka-markdown <url>
```

## CLI

```bash
ka <url>                      # 转好的 Markdown 打到 stdout(可管道)
ka <url> -o article.md        # 输出到文件
ka mcp                        # 启动 MCP server(stdin/stdout)
cat urls.txt | ka --batch -d ./out   # 批量:每行一个 URL,# 开头为注释
ka <url> --engine playwright  # 需要 JS 渲染的页面(需先安装 playwright)
ka <本地.html文件>             # 也可直接转本地 HTML 文件
```

选项:

| 选项 | 说明 |
|---|---|
| `--scope main\|page` | 正文区域(默认)/ 整个页面 |
| `--no-images` | 不保留图片 |
| `--no-links` | 不保留链接(只留文字) |
| `--no-header` | 不添加来源说明 |
| `--engine auto\|jsdom\|playwright` | 转换引擎:auto=jsdom 优先、结果可疑时自动升级 playwright(默认) |
| `--base-url <url>` | 本地 HTML 文件转换时的基准地址(默认 `file://` 当前文件路径) |
| `--wait-until <load\|networkidle\|domcontentloaded\|commit>` | Playwright 引擎页面加载等待策略(默认 load) |
| `-o, --output <file>` | 输出到文件 |
| `-d, --dir <dir>` | 批量输出目录(文件名带秒级时间戳,同标题不覆盖) |
| `--batch` | 批量模式(也从 stdin 自动识别) |
| `--timeout <ms>` | 抓取超时(默认 20000) |

## MCP Server

提供两个工具,供 Claude / Claude Code / Cursor 等客户端调用:

- `convert_url(url, opts)` — 抓取网页并转成干净 Markdown
- `convert_html(html, opts)` — 把已有 HTML 片段就地转换

Claude Desktop / Claude Code 配置(发布到 npm 后):

```json
{
  "mcpServers": {
    "ka-markdown": {
      "command": "npx",
      "args": ["ka-mcp"]
    }
  }
}
```

本地仓库直接跑:`node packages/ka-markdown/bin/ka-mcp.js`,或等价子命令 `ka mcp`。

## Playwright 可选引擎(JS 渲染页面)

```bash
npm install playwright
npx playwright install chromium
ka <url> --engine playwright
```

安装后 `--engine auto`(默认)会自动检测:jsdom 结果可疑时(正文过短且 HTML 很大、或检测到 Next/Nuxt/React 等 SPA 标记)升级到 Playwright 重抓;未安装 Playwright 或升级失败时自动回落 jsdom 结果。

## 开发

```bash
npm install
npm test          # core 转换 + MCP 协议冒烟测试
node bin/ka.js <url>          # 本地跑 CLI
node bin/ka-mcp.js            # 本地跑 MCP server
```
