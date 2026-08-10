'use strict';

const fs = require('fs');
const path = require('path');
const { urlToMarkdown, htmlToMarkdown } = require('../core/convert');

const pkg = require('../../package.json');

const USAGE = [
  'ka-markdown (ka) — 网页转 Markdown(AI 版)',
  '',
  '用法:',
  '  ka <url|html文件> [选项]       转换单个页面,Markdown 输出到 stdout',
  '  cat urls.txt | ka --batch      批量转换(stdin 每行一个 URL,# 开头为注释)',
  '  ka <url> -o out.md             输出到文件',
  '',
  '选项:',
  '  --scope <main|page>   转换范围:正文区域(默认 main)/ 整个页面',
  '  --no-images           不保留图片',
  '  --no-links            不保留链接(只留文字)',
  '  --no-header           不添加来源说明',
  '  --engine <jsdom|playwright>  转换引擎(默认 jsdom;playwright 需另行安装)',
  '  -o, --output <file>   输出到文件(默认 stdout)',
  '  -d, --dir <dir>       批量模式输出目录(默认当前目录)',
  '  --batch               批量模式',
  '  --timeout <ms>        抓取超时毫秒数(默认 20000)',
  '  -q, --quiet           静默(只输出结果/错误,不打印进度日志)',
  '  -v, --version         显示版本号',
  '  -h, --help            显示帮助',
  ''
].join('\n');

function parseArgs(argv) {
  const opts = {
    scope: 'main',
    images: true,
    links: true,
    header: true,
    engine: 'jsdom',
    timeoutMs: 20000,
    quiet: false,
    batch: false,
    urls: [],
    error: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      case '--batch': opts.batch = true; break;
      case '-q': case '--quiet': opts.quiet = true; break;
      case '--no-images': opts.images = false; break;
      case '--no-links': opts.links = false; break;
      case '--no-header': opts.header = false; break;
      case '--scope': opts.scope = argv[++i] || 'main'; break;
      case '--engine': opts.engine = argv[++i] || 'jsdom'; break;
      case '--timeout': opts.timeoutMs = Number(argv[++i]) || 20000; break;
      case '-o': case '--output': opts.output = argv[++i]; break;
      case '-d': case '--dir': opts.dir = argv[++i]; break;
      default:
        if (a.length > 1 && a.charAt(0) === '-') opts.error = '未知选项: ' + a;
        else opts.urls.push(a);
    }
  }
  if (opts.scope !== 'main' && opts.scope !== 'page') opts.error = 'scope 只支持 main / page';
  if (opts.engine !== 'jsdom' && opts.engine !== 'playwright') opts.error = 'engine 只支持 jsdom / playwright';
  return opts;
}

// 本地文件则按 HTML 读入;否则当 URL 抓取
async function convertOne(target, opts) {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    const html = fs.readFileSync(target, 'utf8');
    return htmlToMarkdown(html, {
      baseUrl: opts.baseUrl || 'file://' + path.resolve(target).replace(/\\/g, '/'),
      scope: opts.scope,
      images: opts.images,
      links: opts.links,
      header: opts.header
    });
  }
  return urlToMarkdown(target, {
    scope: opts.scope,
    images: opts.images,
    links: opts.links,
    header: opts.header,
    engine: opts.engine,
    timeoutMs: opts.timeoutMs
  });
}

function log(opts, msg) {
  if (!opts.quiet) process.stderr.write(msg + '\n');
}

function collectStdin() {
  return new Promise(function (resolve) {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (chunk) { data += chunk; });
    process.stdin.on('end', function () { resolve(data); });
  });
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { process.stdout.write(USAGE); return 0; }
  if (opts.version) { process.stdout.write('ka-markdown ' + pkg.version + '\n'); return 0; }
  if (opts.error) {
    process.stderr.write('错误:' + opts.error + '\n\n' + USAGE);
    return 2;
  }

  const targets = opts.urls.length ? opts.urls : null;
  const stdinPiped = !process.stdin.isTTY;

  // 批量模式:显式 --batch,或没有位置参数但 stdin 被管道
  if (opts.batch || (!targets && stdinPiped)) {
    const data = await collectStdin();
    const lines = data.split(/\r?\n/)
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l && l.charAt(0) !== '#'; });
    if (!lines.length) {
      process.stderr.write('错误:没有可转换的 URL\n' + USAGE);
      return 2;
    }
    const outDir = opts.dir || '.';
    let okCount = 0, failCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const target = lines[i];
      try {
        log(opts, '[' + (i + 1) + '/' + lines.length + '] ' + target);
        const res = await convertOne(target, opts);
        if (!res.ok) { failCount++; log(opts, '  失败:' + res.error); continue; }
        const fname = sanitizeFilename(res.title) + '.md';
        const fpath = path.join(outDir, fname);
        fs.writeFileSync(fpath, res.markdown, 'utf8');
        okCount++;
        log(opts, '  -> ' + fpath);
      } catch (e) {
        failCount++;
        log(opts, '  失败:' + (e.message || e));
      }
    }
    log(opts, '完成:成功 ' + okCount + ',失败 ' + failCount);
    return failCount ? 1 : 0;
  }

  // 单个转换
  const target = targets && targets[0];
  if (!target) {
    process.stderr.write('错误:缺少 URL。\n\n' + USAGE);
    return 2;
  }
  try {
    const res = await convertOne(target, opts);
    if (!res.ok) {
      process.stderr.write('转换失败:' + res.error + '\n');
      return 1;
    }
    if (opts.output) {
      fs.writeFileSync(opts.output, res.markdown, 'utf8');
      log(opts, '已写入 ' + opts.output);
    } else {
      process.stdout.write(res.markdown + '\n');
    }
    return 0;
  } catch (e) {
    process.stderr.write('错误:' + (e.message || e) + '\n');
    return 1;
  }
}

function sanitizeFilename(name) {
  return String(name || 'page')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80) || 'page';
}

module.exports = { run, parseArgs, sanitizeFilename };
