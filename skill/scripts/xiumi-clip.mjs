#!/usr/bin/env node
/**
 * 秀米「原生组件」剪贴板注入（xiumi-clip）
 *
 * 移植自 gih10012/xiumi-native-clipboard（MIT）的思路：
 * 把一份 paper.comp JSON 写进 Chromium 的原生剪贴板（MIME:
 * `application/xiumi-comps; category=paper.comp`），粘到秀米编辑器里直接生成
 * **可继续编辑的原生组件**，比"截图/图片"高级，也比逐个组件换图快。
 *
 * 与上游的差异（按本项目路径）：
 *   - 全 Node 实现，复用同一个 CDP 浏览器（不需要另开服务/手动拖拽文件）；
 *   - 复制用 Playwright 真实按键触发（浏览器只接受 trusted copy 事件）；
 *   - 粘贴后自动用「顶层组件数」核对是否真的生效。
 *
 * 用法：
 *   node xiumi-clip.mjs demo  [--out demo.xiumi.json]
 *   node xiumi-clip.mjs build --spec spec.json --out doc.xiumi.json
 *   node xiumi-clip.mjs push  --spec spec.json --draft 123456789 [--save]
 *   node xiumi-clip.mjs push  --doc doc.xiumi.json --draft https://xiumi.us/studio/v5#/paper/for/123456789/cube/0
 *
 * spec.json 形如：
 *   {
 *     "title": "文章标题",
 *     "blocks": [
 *       {"type":"heading","text":"小节标题"},
 *       {"type":"text","text":"第一段正文…"},
 *       {"type":"image","src":"https://png.xiumi.us/…"},
 *       {"type":"card","title":"卡片标题","text":"卡片正文"},
 *       {"type":"row2","left":{"title":"左"},"right":{"title":"右"}}
 *     ]
 *   }
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSpec } from './xiumi-components.mjs';
import { loadPlaywright } from './xiumi-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '..', 'assets');
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n, d = null) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; return !v || v.startsWith('--') ? true : v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = Number(flag('port', 9222));

function readDoc() {
  const specFile = flag('spec');
  const docFile = flag('doc');
  if (specFile) return compileSpec(JSON.parse(fs.readFileSync(String(specFile), 'utf8')));
  if (docFile) return JSON.parse(fs.readFileSync(String(docFile), 'utf8'));
  throw new Error('需要 --spec <spec.json> 或 --doc <doc.xiumi.json>');
}

function demoSpec() {
  return {
    title: 'dsh-xiumi 原生组件演示',
    blocks: [
      { type: 'heading', text: '原生组件粘贴演示' },
      { type: 'text', text: '这段文字、下面的图片和卡片，都是粘进秀米后仍可继续编辑的原生组件，不是截图。' },
      { type: 'card', title: '为什么这么做', text: '整篇一次粘贴成型，比逐个组件换图快得多，也能真正“换模板”。' },
    ],
  };
}

/** 极简静态服务：复制页 + 文档 JSON */
function startServer(doc) {
  const html = fs.readFileSync(path.join(ASSETS, 'clip-copy.html'), 'utf8');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/clip-copy.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } else if (url.pathname === '/doc.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(doc));
    } else {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function push() {
  const draft = flag('draft');
  if (!draft) throw new Error('需要 --draft <草稿id 或 编辑页URL>');
  const doc = readDoc();
  const server = await startServer(doc);
  const port = server.address().port;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const copyPage = await ctx.newPage();
  let pastedOk = false;
  try {
    await copyPage.goto(`http://127.0.0.1:${port}/clip-copy.html`, { waitUntil: 'domcontentloaded' });
    await copyPage.waitForFunction(() => window.__docReady === true, { timeout: 15000 });
    await copyPage.bringToFront();
    await copyPage.evaluate(() => document.body.focus());
    await sleep(400);
    // 真实按键才会产生 trusted copy 事件
    await copyPage.keyboard.press('Control+C');
    await sleep(800);
    const copied = await copyPage.evaluate(() => window.__lastCopy);
    if (!copied || !copied.ok) throw new Error('复制失败：' + JSON.stringify(copied));
    console.log(`已写入剪贴板（${doc.clipboard.formats.length} 个格式）`);

    // 打开草稿编辑器
    const draftUrl = String(draft).startsWith('http')
      ? String(draft)
      : `https://xiumi.us/studio/v5#/paper/for/${draft}/cube/0`;
    let page = ctx.pages().find((p) => p.url().includes(`/paper/for/${(String(draft).match(/(\d{6,})/) || [])[1] || 'x'}`));
    if (!page) { page = await ctx.newPage(); await page.goto(draftUrl, { waitUntil: 'domcontentloaded' }); }
    else { await page.goto(draftUrl, { waitUntil: 'domcontentloaded' }).catch(() => {}); }
    await page.bringToFront();
    // 等画布渲染
    for (let i = 0; i < 40; i++) {
      const ok = await page.evaluate(() => !!document.querySelector('.tn-page div.tn-comp-top-level')).catch(() => false);
      if (ok) break;
      await sleep(800);
    }
    const before = await countComps(page);
    // 点到画布底部空白处，再粘贴
    await page.evaluate(() => {
      const cs = [...document.querySelectorAll('.tn-page div.tn-comp-top-level')];
      const last = cs[cs.length - 1];
      if (last) { last.scrollIntoView({ block: 'center' }); window.scrollBy(0, 120); }
    });
    await sleep(700);
    const pt = await page.evaluate(() => {
      const pageEl = document.querySelector('.tn-page');
      const r = pageEl.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 30) };
    });
    await page.mouse.click(pt.x, pt.y);
    await sleep(500);
    await page.keyboard.press('Control+V');
    await sleep(4000);
    const after = await countComps(page);
    console.log(`组件数：${before} → ${after}（${after > before ? '+' + (after - before) : '没有变化'}）`);
    pastedOk = after > before;
    if (!pastedOk) console.log('⚠️ 粘贴后组件数没增加：确认编辑器已聚焦、剪贴板有内容、当前账号可编辑。');
    if (pastedOk && flag('save')) {
      const { saveDraft } = await import('./xiumi-lib.mjs');
      await saveDraft(page);
      console.log('已保存草稿（记得去「预览→分享」点申请审核）');
    }
    process.exitCode = pastedOk ? 0 : 1;
  } finally {
    await copyPage.close().catch(() => {});
    server.close();
    await browser.close().catch(() => {});
  }
}

async function countComps(page) {
  return page.evaluate(() => document.querySelectorAll('.tn-page div.tn-comp-top-level').length).catch(() => -1);
}

(async () => {
  if (cmd === 'demo') {
    const out = String(flag('out', 'demo.xiumi.json'));
    fs.writeFileSync(out, JSON.stringify(compileSpec(demoSpec()), null, 2) + '\n', 'utf8');
    console.log('已生成 demo：' + path.resolve(out));
    return;
  }
  if (cmd === 'build') {
    const out = flag('out');
    if (!out) throw new Error('需要 --out <doc.xiumi.json>');
    fs.writeFileSync(String(out), JSON.stringify(readDoc(), null, 2) + '\n', 'utf8');
    console.log('已生成文档：' + path.resolve(String(out)));
    return;
  }
  if (cmd === 'push') return push();
  if (cmd === 'serve') {
    const doc = readDoc();
    const server = await startServer(doc);
    const port = server.address().port;
    console.log(`复制页：http://127.0.0.1:${port}/clip-copy.html （按 Ctrl+C，然后去秀米粘贴）`);
    return;
  }
  console.error('用法: node xiumi-clip.mjs <demo|build|push|serve> [--spec file] [--doc file] [--draft id] [--save]');
  process.exit(2);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
