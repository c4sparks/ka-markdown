'use strict';

// 统一测试入口:core 转换 + MCP 协议冒烟
// 用法: npm test

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { htmlToMarkdown } = require('../src/core/convert');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'sample-doc.html'), 'utf8');

function check(label, cond) {
  process.stdout.write((cond ? '✅ ' : '❌ ') + label + '\n');
  if (!cond) process.exitCode = 1;
}

async function main() {
  // 1. core:htmlToMarkdown
  const res = await htmlToMarkdown(SAMPLE, {
    baseUrl: 'https://example.com/docs/intro.html',
    header: false
  });
  check('core 转换成功', res.ok);
  if (res.ok) {
    check('标题/正文', res.markdown.includes('# 简介'));
    check('代码围栏', res.markdown.includes('```python') && res.markdown.includes('print("hello")'));
    check('表格', res.markdown.includes('| 名称 | 值 |'));
    check('懒加载图片绝对化', res.markdown.includes('![懒加载图](https://example.com/img/pic.png)'));
    check('噪音过滤(无版权信息)', !res.markdown.includes('版权信息'));
  }

  // 2. MCP 协议冒烟(子进程)
  const r = spawnSync(process.execPath, [path.join(__dirname, 'mcp.test.js')], {
    encoding: 'utf8'
  });
  process.stdout.write(r.stdout);
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = 1;
  }
}

main().catch(function (e) {
  console.error('❌ 测试出错:', e);
  process.exit(1);
});
