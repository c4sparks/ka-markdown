'use strict';

// fetch 重试逻辑测试
// 用法: node test/fetch.test.js

const http = require('http');
const { fetchHtml } = require('../src/core/fetch');

async function main() {
  let hits = 0;
  const server = http.createServer(function (req, res) {
    hits++;
    const n = hits;
    if (req.url === '/flaky') {
      if (n <= 2) { res.writeHead(503); res.end('busy'); return; } // 前两次 503
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>ok</h1></body></html>');
      return;
    }
    if (req.url === '/never') {
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });

  await new Promise(function (resolve) { server.listen(0, resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let pass = 0, fail = 0;

  function check(label, cond) {
    process.stdout.write((cond ? '✅ ' : '❌ ') + label + '\n');
    if (cond) pass++; else fail++;
  }

  try {
    // 1. retries=0:503 直接失败,只请求 1 次
    hits = 0;
    try {
      await fetchHtml(base + '/flaky', { retries: 0, timeoutMs: 3000 });
      check('retries=0 时 503 抛错', false);
    } catch (e) {
      check('retries=0 时 503 抛错', e.status === 503);
      check('retries=0 只请求 1 次', hits === 1);
    }

    // 2. retries=2:503 重试后成功,共请求 3 次
    hits = 0;
    const ok = await fetchHtml(base + '/flaky', { retries: 2, retryDelayMs: 10, timeoutMs: 3000 });
    check('retries=2 时 503 重试后成功', ok.status === 200 && ok.html.includes('ok'));
    check('retries=2 请求 3 次(1 初始 + 2 重试)', hits === 3);

    // 3. 404 是永久性失败,不重试,只请求 1 次
    hits = 0;
    try {
      await fetchHtml(base + '/never', { retries: 3, retryDelayMs: 10, timeoutMs: 3000 });
      check('404 抛错', false);
    } catch (e) {
      check('404 抛错且不重试', e.status === 404);
      check('404 只请求 1 次', hits === 1);
    }

    process.stdout.write('结果:' + pass + ' 通过 / ' + fail + ' 失败\n');
    process.exit(fail ? 1 : 0);
  } finally {
    server.close();
  }
}

main().catch(function (e) {
  console.error('❌ 测试出错:', e);
  process.exit(1);
});
