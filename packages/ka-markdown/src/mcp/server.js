'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { urlToMarkdown, htmlToMarkdown } = require('../core/convert');

const pkg = require('../../package.json');

// 统一把转换结果包成 MCP 工具返回格式
function resultText(text, isError) {
  return { content: [{ type: 'text', text: text }], isError: !!isError };
}

function createServer() {
  const server = new McpServer({
    name: 'ka-markdown',
    version: pkg.version
  });

  server.registerTool(
    'convert_url',
    {
      title: '抓取网页并转成 Markdown',
      description:
        '抓取指定 URL 并转换为干净的 Markdown 正文。scope=main 只取正文区域(自动过滤导航/页脚),scope=page 取整个页面。可控制是否保留图片/链接/来源说明。',
      inputSchema: {
        url: z.string().describe('要转换的网页地址'),
        scope: z.enum(['main', 'page']).optional().describe('main=正文区域(默认), page=整个页面'),
        images: z.boolean().optional().describe('是否保留图片(默认 true)'),
        links: z.boolean().optional().describe('是否保留链接(默认 true)'),
        header: z.boolean().optional().describe('是否添加来源说明(默认 true)'),
        engine: z.enum(['auto', 'jsdom', 'playwright']).optional().describe('转换引擎(auto=jsdom 优先,结果可疑时自动升级 playwright;playwright 需另行安装)'),
        timeoutMs: z.number().optional().describe('抓取超时毫秒数(默认 20000)')
      }
    },
    async function (args) {
      try {
        const res = await urlToMarkdown(args.url, {
          scope: args.scope,
          images: args.images,
          links: args.links,
          header: args.header,
          engine: args.engine,
          timeoutMs: args.timeoutMs
        });
        if (!res.ok) return resultText('转换失败:' + res.error, true);
        return resultText(res.markdown);
      } catch (e) {
        return resultText('错误:' + ((e && e.message) || e), true);
      }
    }
  );

  server.registerTool(
    'convert_html',
    {
      title: '把 HTML 片段转成 Markdown',
      description:
        '把已有的 HTML 字符串就地转换为 Markdown,无需抓取。baseUrl 用于把相对链接/图片补全为绝对地址。',
      inputSchema: {
        html: z.string().describe('HTML 内容'),
        baseUrl: z.string().optional().describe('基准地址,用于补全相对链接/图片'),
        scope: z.enum(['main', 'page']).optional().describe('main=正文区域(默认), page=整个页面'),
        images: z.boolean().optional().describe('是否保留图片(默认 true)'),
        links: z.boolean().optional().describe('是否保留链接(默认 true)'),
        header: z.boolean().optional().describe('是否添加来源说明(默认 true)')
      }
    },
    async function (args) {
      try {
        const res = await htmlToMarkdown(args.html, {
          baseUrl: args.baseUrl,
          scope: args.scope,
          images: args.images,
          links: args.links,
          header: args.header
        });
        if (!res.ok) return resultText('转换失败:' + res.error, true);
        return resultText(res.markdown);
      } catch (e) {
        return resultText('错误:' + ((e && e.message) || e), true);
      }
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

module.exports = { createServer, main };
