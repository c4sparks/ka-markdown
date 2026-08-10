'use strict';

// MCP server 协议级冒烟测试:
// spawn bin/ka-mcp.js,走 initialize -> notifications/initialized -> tools/list -> tools/call(convert_html)
// 用法: node test/mcp.test.js

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BIN = path.join(__dirname, '..', 'bin', 'ka-mcp.js');
const SAMPLE = fs.readFileSync(path.join(__dirname, 'sample-doc.html'), 'utf8');

const child = spawn(process.execPath, [BIN], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let buf = '';
const inbox = [];
let resolvers = [];

child.stdout.setEncoding('utf8');
child.stdout.on('data', function (chunk) {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'notifications/initialized') continue;
    const r = resolvers.shift();
    if (r) r(msg);
  }
});

child.stderr.on('data', function (d) { process.stderr.write('[server] ' + d); });

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

function next() {
  return new Promise(function (resolve) { resolvers.push(resolve); });
}

async function main() {
  // 1. initialize
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ka-mcp-test', version: '0.0.0' }
    }
  });
  const init = await next();
  console.log('initialize  → server 名称:', init.result.serverInfo.name,
    '| 协议版本:', init.result.protocolVersion);

  // 2. initialized 通知
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

  // 3. tools/list
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = await next();
  const names = tools.result.tools.map(function (t) { return t.name; });
  console.log('tools/list   →', names.join(', '));

  // 4. tools/call convert_html
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'convert_html',
      arguments: {
        html: SAMPLE,
        baseUrl: 'https://example.com/docs/intro.html',
        scope: 'main',
        header: false
      }
    }
  });
  const call = await next();
  const text = call.result.content[0].text;
  console.log('convert_html → 成功:', !call.result.isError);
  console.log('--- 输出 ---');
  console.log(text.slice(0, 200) + (text.length > 200 ? '\n…' : ''));
  console.log('--- 结束 ---');

  const ok = text.includes('# 简介') && text.includes('print("hello")');
  console.log(ok ? '✅ MCP 冒烟测试通过' : '❌ 输出不符合预期');
  child.kill();
  process.exit(ok ? 0 : 1);
}

main().catch(function (e) {
  console.error('测试出错:', e);
  child.kill();
  process.exit(1);
});
