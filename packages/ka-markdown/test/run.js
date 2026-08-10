'use strict';

// 统一测试入口:core 转换 + MCP 协议冒烟
// 用法: npm test

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { htmlToMarkdown, shouldUpgrade } = require('../src/core/convert');

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

  // 1.5 core:shouldUpgrade 启发式
  check('升级判定:空结果', shouldUpgrade('<html><body>大</body></html>', { ok: true, markdown: '' }) === true);
  check(
    '升级判定:HTML 大但正文短',
    shouldUpgrade('x'.repeat(40000), { ok: true, markdown: '# 标题' }) === true
  );
  check(
    '升级判定:SPA 标记且正文少',
    shouldUpgrade('<div id="root"></div><script>window.__NEXT_DATA__=1</script>', { ok: true, markdown: '很短' }) === true
  );
  check(
    '升级判定:正常页面不升级',
    shouldUpgrade('<html><body><article><p>' + '好'.repeat(500) + '</p></article></body></html>', { ok: true, markdown: '好'.repeat(500) }) === false
  );
  check(
    '升级判定:显式 jsdom 不升级',
    shouldUpgrade('x'.repeat(40000), { ok: true, markdown: '# 标题' }, { engine: 'jsdom' }) === false
  );

  // 2. MCP 协议冒烟(子进程)
  const r = spawnSync(process.execPath, [path.join(__dirname, 'mcp.test.js')], {
    encoding: 'utf8'
  });
  process.stdout.write(r.stdout);
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = 1;
  }

  // 3. 引擎实测:jsdom / playwright / auto(子进程,playwright 缺失时跳过相关断言)
  const a = spawnSync(process.execPath, [path.join(__dirname, 'auto.test.js')], {
    encoding: 'utf8'
  });
  process.stdout.write(a.stdout);
  if (a.status !== 0) {
    if (a.stderr) process.stderr.write(a.stderr);
    process.exitCode = 1;
  }

  // 4. fetch 重试逻辑(子进程)
  const f = spawnSync(process.execPath, [path.join(__dirname, 'fetch.test.js')], {
    encoding: 'utf8'
  });
  process.stdout.write(f.stdout);
  if (f.status !== 0) {
    if (f.stderr) process.stderr.write(f.stderr);
    process.exitCode = 1;
  }
}

main().catch(function (e) {
  console.error('❌ 测试出错:', e);
  process.exit(1);
});
