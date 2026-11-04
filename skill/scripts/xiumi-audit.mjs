#!/usr/bin/env node
/**
 * 秀米排版质检（xiumi-audit）
 *
 * 思路借鉴 15369577595/xiumi-editor-checker 的规则库（字号/行距/图注/图片比例），
 * 但实现走本项目自己的路径：直接用 Playwright 打开**已渲染**的分享页/编辑页，
 * 读 DOM 的 computedStyle，而不是解析秀米私有 JSON —— 免逆向、跟真实渲染一致。
 *
 * 用法：
 *   node xiumi-audit.mjs --share https://v.xiumius.cn/board/v5/xxx/123456
 *   node xiumi-audit.mjs --url https://xiumi.us/studio/v5#/paper/for/123456/cube/0   # 编辑器画布
 *   node xiumi-audit.mjs --share <url> --json report.json --md report.md
 *   node xiumi-audit.mjs --share <url> --preset strict|standard|loose
 *
 * 退出码：有 error 级问题 = 1，否则 0（方便接 CI）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './xiumi-lib.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return !v || v.startsWith('--') ? true : v;
};

const SHARE = flag('share');
const URL_ARG = flag('url') || SHARE;
const PRESET = String(flag('preset', 'standard'));
const OUT_JSON = flag('json');
const OUT_MD = flag('md');
const PORT = Number(flag('port', 9222));
if (!URL_ARG) {
  console.error('用法: node xiumi-audit.mjs --share <分享链接> | --url <页面地址> [--preset strict|standard|loose] [--json out.json] [--md out.md]');
  process.exit(2);
}

/** 规则预设：阈值参考秀米常见排版规范（strict 更严） */
const PRESETS = {
  strict: {
    bodySize: [14, 15], bodyLineHeight: [1.8, 2.0], bodyIndent: 2,
    captionSize: [12, 12], captionColor: [157, 157, 157], captionTolerance: 8, captionItalic: true,
    headingSize: [15, 16], headingBold: true, headingColorMax: 0,
    imageRatios: [16 / 9], imageRatioTolerance: 0.06,
  },
  standard: {
    bodySize: [14, 15], bodyLineHeight: [1.6, 2.2], bodyIndent: null,
    captionSize: [12, 14], captionColor: [157, 157, 157], captionTolerance: 20, captionItalic: false,
    headingSize: [15, 17], headingBold: true, headingColorMax: 0,
    imageRatios: [16 / 9, 4 / 3], imageRatioTolerance: 0.08,
  },
  loose: {
    bodySize: [13, 16], bodyLineHeight: [1.5, 2.4], bodyIndent: null,
    captionSize: [11, 16], captionColor: [157, 157, 157], captionTolerance: 40, captionItalic: false,
    headingSize: [14, 18], headingBold: false, headingColorMax: 1,
    imageRatios: [16 / 9, 4 / 3, 1],
    imageRatioTolerance: 0.12,
  },
};
const R = PRESETS[PRESET] || PRESETS.standard;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rgbToArr(s) {
  const m = String(s || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** 在页面里采集"可检查的文本块 + 图片" */
async function collect(page) {
  const isEditorPage = /studio\/v5/.test(page.url());
  return page.evaluate((isEditorPage) => {
    const isEditor = isEditorPage || !!document.querySelector('.tn-page');
    const root = isEditor ? (document.querySelector('.tn-page') || document.body) : (document.querySelector('#js_content') || document.body);
    const out = { mode: isEditorPage ? 'editor' : 'share', blocks: [], images: [] };

    const seen = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      if (el.closest('script,style,noscript')) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // 只收集"自身直接承载文本"的元素，避免容器重复计数
      const hasTextChild = [...el.children].some((c) => (c.textContent || '').trim() === text);
      if (hasTextChild) continue;
      if (text.length > 600) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      out.blocks.push({
        text: text.slice(0, 80),
        len: text.length,
        fontSize: parseFloat(cs.fontSize),
        lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
        fontWeight: Number(cs.fontWeight) || 400,
        color: cs.color,
        fontStyle: cs.fontStyle,
        textIndent: cs.textIndent,
        tag: el.tagName,
      });
    }

    const imgs = root.querySelectorAll('img');
    imgs.forEach((im) => {
      const src = im.currentSrc || im.getAttribute('src') || '';
      const rect = im.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return;
      // 秀米 CDN 的裁剪参数：...,crop,h_336,w_596
      let crop = null;
      const m = src.match(/,crop,h_(\d+),w_(\d+)/);
      if (m) crop = { h: Number(m[1]), w: Number(m[2]) };
      out.images.push({
        src: src.slice(0, 120),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        ratio: rect.width / rect.height,
        crop,
      });
    });
    return out;
  }, isEditorPage);
}

function classify(block) {
  const gray = rgbToArr(block.color);
  const isGray = gray && Math.max(gray[0], gray[1], gray[2]) - Math.min(gray[0], gray[1], gray[2]) < 12 && gray[0] > 120 && gray[0] < 200;
  const isBold = block.fontWeight >= 600;
  if (block.len <= 24 && isGray && block.fontSize <= 16) return 'caption';
  if (block.len <= 30 && isBold && block.fontSize >= 15) return 'heading';
  if (block.len <= 12 && !isGray) return 'short';
  if (block.len >= 25) return 'body';
  return 'other';
}

function audit(data) {
  const issues = [];
  const add = (level, kind, msg, extra = {}) => issues.push({ level, kind, msg, ...extra });

  const blocks = data.blocks;
  const captions = [], headings = [], bodies = [];
  for (const b of blocks) {
    b.kind = classify(b);
    if (b.kind === 'caption') captions.push(b);
    else if (b.kind === 'heading') headings.push(b);
    else if (b.kind === 'body') bodies.push(b);
  }

  // 1) 正文字号/行距
  if (bodies.length) {
    const sizes = [...new Set(bodies.map((b) => b.fontSize))].sort((a, b) => a - b);
    const badSize = sizes.filter((s) => s < R.bodySize[0] || s > R.bodySize[1]);
    if (badSize.length) add('warn', 'body.size', `正文字号 ${badSize.join('/')}px 不在 ${R.bodySize[0]}~${R.bodySize[1]}px 规范内`);
    else add('info', 'body.size', `正文字号统一为 ${sizes.join('/')}px`);
    const lh = bodies.map((b) => (b.lineHeight ? b.lineHeight / b.fontSize : null)).filter((v) => v && v > 0.5);
    if (lh.length) {
      const min = Math.min(...lh), max = Math.max(...lh);
      if (min < R.bodyLineHeight[0] - 0.001 || max > R.bodyLineHeight[1] + 0.001) {
        add('warn', 'body.lineHeight', `正文行距 ${min.toFixed(2)}~${max.toFixed(2)} 倍，建议 ${R.bodyLineHeight.join('~')}`);
      } else add('info', 'body.lineHeight', `正文行距 ${min.toFixed(2)}~${max.toFixed(2)} 倍，符合规范`);
    }
  }

  // 2) 图注：字号/颜色/斜体一致性
  if (captions.length) {
    const sizes = [...new Set(captions.map((c) => c.fontSize))];
    if (sizes.length > 1) add('error', 'caption.size', `图注字号不一致：${sizes.map((s) => s + 'px').join(' / ')}`, { samples: captions.slice(0, 3).map((c) => c.text) });
    else if (sizes[0] < R.captionSize[0] || sizes[0] > R.captionSize[1]) add('warn', 'caption.size', `图注字号 ${sizes[0]}px 不在 ${R.captionSize[0]}~${R.captionSize[1]}px 规范内`);
    else add('info', 'caption.size', `图注字号统一 ${sizes[0]}px`);

    const colors = [...new Set(captions.map((c) => c.color))];
    if (colors.length > 1) add('error', 'caption.color', `图注颜色不一致：${colors.join(' / ')}`);
    else {
      const c = rgbToArr(colors[0]);
      if (c && dist(c, R.captionColor) > R.captionTolerance) add('warn', 'caption.color', `图注颜色 ${colors[0]} 偏离规范灰 ${R.captionColor.join(',')}`);
      else add('info', 'caption.color', `图注颜色统一 ${colors[0]}`);
    }
    if (R.captionItalic) {
      const notItalic = captions.filter((c) => c.fontStyle !== 'italic');
      if (notItalic.length) add('warn', 'caption.italic', `${notItalic.length}/${captions.length} 条图注未斜体`);
    }
  }

  // 3) 小标题
  if (headings.length) {
    const sizes = [...new Set(headings.map((h) => h.fontSize))];
    const out = sizes.filter((s) => s < R.headingSize[0] || s > R.headingSize[1]);
    if (out.length) add('warn', 'heading.size', `小标题字号 ${out.join('/')}px 不在 ${R.headingSize.join('~')}px 规范内`);
    if (R.headingBold && headings.some((h) => h.fontWeight < 600)) add('warn', 'heading.bold', '存在未加粗的小标题');
  }

  // 4) 图片比例
  const ratios = data.images.filter((i) => i.w > 60 && i.h > 60);
  if (ratios.length) {
    const nonStd = ratios.filter((i) => !R.imageRatios.some((r) => Math.abs(i.ratio - r) <= R.imageRatioTolerance));
    if (nonStd.length) add('info', 'image.ratio', `${nonStd.length}/${ratios.length} 张图比例不是标准比例（${R.imageRatios.map((r) => r.toFixed(2)).join(' / ')}）`, { samples: nonStd.slice(0, 3).map((i) => `${i.w}x${i.h}`) });
    else add('info', 'image.ratio', `图片比例全部符合标准（${R.imageRatios.map((r) => r.toFixed(2)).join(' / ')}）`);
  }

  return { preset: PRESET, mode: data.mode, stats: { blocks: blocks.length, captions: captions.length, headings: headings.length, bodies: bodies.length, images: data.images.length }, issues, captions: captions.map((c) => ({ text: c.text, size: c.fontSize, color: c.color })) };
}

function toMarkdown(report, url) {
  const icon = { error: '❌', warn: '⚠️', info: 'ℹ️' };
  const lines = [
    '# 秀米排版质检报告',
    '',
    `- 页面：${url}`,
    `- 模式：${report.mode}    预设：${report.preset}`,
    `- 统计：文本块 ${report.stats.blocks} · 正文 ${report.stats.bodies} · 小标题 ${report.stats.headings} · 图注 ${report.stats.captions} · 图片 ${report.stats.images}`,
    '',
    '| 级别 | 检查项 | 结论 |',
    '|---|---|---|',
  ];
  for (const i of report.issues) lines.push(`| ${icon[i.level] || ''} ${i.level} | ${i.kind} | ${i.msg.replace(/\|/g, '\\|')} |`);
  if (report.captions.length) {
    lines.push('', '## 图注清单', '', '| # | 文字 | 字号 | 颜色 |', '|---|---|---|---|');
    report.captions.forEach((c, k) => lines.push(`| ${k + 1} | ${c.text} | ${c.size}px | ${c.color} |`));
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  try {
    await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 分享页是异步渲染：等一等，滚动一遍触发懒加载
    await sleep(3500);
    for (let k = 0; k < 6; k++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
      await sleep(400);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    const data = await collect(page);
    const report = audit(data);
    const md = toMarkdown(report, URL_ARG);
    if (OUT_JSON) { fs.mkdirSync(path.dirname(path.resolve(String(OUT_JSON))), { recursive: true }); fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n'); }
    if (OUT_MD) { fs.mkdirSync(path.dirname(path.resolve(String(OUT_MD))), { recursive: true }); fs.writeFileSync(OUT_MD, md); }
    console.log(md);
    const errs = report.issues.filter((i) => i.level === 'error').length;
    const warns = report.issues.filter((i) => i.level === 'warn').length;
    console.log(`\n结果：${errs} error / ${warns} warn${OUT_JSON ? ` → ${OUT_JSON}` : ''}${OUT_MD ? ` → ${OUT_MD}` : ''}`);
    process.exitCode = errs > 0 ? 1 : 0;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
