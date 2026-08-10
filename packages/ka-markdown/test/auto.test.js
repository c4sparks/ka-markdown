'use strict';

// engine 实测:jsdom / playwright / auto 自动升级
// playwright 未安装时跳过相关断言(不 fail),保证 npm test 在任何环境可跑。
// 用法: node test/auto.test.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { urlToMarkdown } = require('../src/core/convert');
const { isPlaywrightAvailable } = require('../src/core/engines/playwright');

const TEST_DIR = __dirname;
const SPA = 'spa.html';
const DOC = 'sample-doc.html';

async function main() {
  const server = http.createServer(function (req, res) {
    fs.readFile(path.join(TEST_DIR, path.basename(req.url)), function (e, d) {
      if (e) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(d);
    });
  });

  await new Promise(function (resolve) { server.listen(0, resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const havePw = isPlaywrightAvailable();
  let pass = 0, fail = 0;

  function check(label, cond) {
    process.stdout.write((cond ? '✅ ' : '❌ ') + label + '\n');
    if (cond) pass++; else fail++;
  }

  try {
    // 1) jsdom:SPA 不执行 JS
    let r = await urlToMarkdown(base + '/' + SPA, { engine: 'jsdom', header: false });
    check('jsdom:SPA 不执行 JS(结果为空壳)', r.ok && r.engine === 'jsdom' && !r.markdown.includes('JS 渲染'));

    // 2) playwright:拿到 JS 渲染内容
    if (havePw) {
      r = await urlToMarkdown(base + '/' + SPA, { engine: 'playwright', header: false });
      check('playwright:拿到 JS 渲染内容', r.ok && r.engine === 'playwright' && r.markdown.includes('JS 渲染的标题'));
    } else {
      process.stdout.write('⏭ 跳过 playwright 断言(未安装)\n');
    }

    // 3) auto:SPA 自动升级
    if (havePw) {
      r = await urlToMarkdown(base + '/' + SPA, { engine: 'auto', header: false });
      check('auto:SPA 自动升级到 playwright', r.ok && r.engine === 'playwright' && r.upgraded === true && r.markdown.includes('JS 渲染的标题'));
    } else {
      process.stdout.write('⏭ 跳过 auto 升级断言(未安装)\n');
    }

    // 4) auto:静态页不升级
    r = await urlToMarkdown(base + '/' + DOC, { engine: 'auto', header: false });
    check('auto:静态页保持 jsdom 不升级', r.ok && r.engine === 'jsdom' && r.upgraded === undefined && r.markdown.includes('# 简介'));

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
