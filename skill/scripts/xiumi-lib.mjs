/**
 * 秀米（XIUMI）编辑器自动化核心库 —— 2026-11 实测可用（Playwright 连已开的 CDP 浏览器）。
 *
 * 依赖：playwright-core（不下载浏览器）。解析顺序：
 *   1) 普通 import('playwright-core')（放在本项目/工作目录的 node_modules 里即可）；
 *   2) 环境变量 XIUMI_PW_CORE = node_modules/playwright-core 的绝对路径（或它的上一级 node_modules）；
 *   3) 常见安装位置 ~/.dsh/xiumi/playwright/node_modules/playwright-core。
 *
 * 用法：
 *   import * as X from './xiumi-lib.mjs';
 *   const { page } = await X.connect();
 *   await X.insertSwipe(page);                 // 在当前位置插入 4 页干净滑动组件
 *   await X.setSlideCount(page, c, 6);         // 改页数（走 Angular 模型）
 *   await X.replaceSlideImage(page, c, 0, 93691); // 第 0 页换成图库里字节数 93691 的照片
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** playwright-core 的加载兜底（Open Source 版：不依赖作者机器路径） */
export async function loadPlaywright() {
  const tried = [];
  try { return await import('playwright-core'); } catch (e) { tried.push('bare import: ' + (e.code || e.message)); }

  const candidates = [];
  if (process.env.XIUMI_PW_CORE) candidates.push(process.env.XIUMI_PW_CORE);
  candidates.push(
    path.join(os.homedir(), '.dsh', 'xiumi', 'playwright', 'node_modules', 'playwright-core'),
    path.resolve(process.cwd(), 'node_modules', 'playwright-core'),
  );
  for (const c of candidates) {
    const p = c.endsWith('playwright-core') ? c : path.join(c, 'playwright-core');
    if (!fs.existsSync(p)) { tried.push(p + ' (missing)'); continue; }
    const entry = path.join(p, 'index.js');
    const url = 'file:///' + entry.replace(/\\/g, '/');
    try { return await import(url); } catch (e) { tried.push(p + ': ' + e.message.slice(0, 100)); }
  }
  throw new Error(
    '找不到 playwright-core。任选一种：\n' +
    '  A) 在本目录执行 `npm i playwright-core`（不下载浏览器，秒装）；\n' +
    '  B) 安装到 ~/.dsh/xiumi/playwright 后设置 XIUMI_PW_CORE 指向其 node_modules/playwright-core。\n' +
    '尝试过：\n' + tried.join('\n'),
  );
}

/**
 * 连上已用 --remote-debugging-port 启动的 Edge，返回秀米编辑页。
 * @param {{port?:number, urlIncludes?:string, bringToFront?:boolean}} opts
 */
export async function connect(opts = {}) {
  const { chromium } = await loadPlaywright();
  const port = opts.port || 9222;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes(opts.urlIncludes || 'xiumi.us'))
    || ctx.pages().find((p) => p.url().includes('studio/v5'));
  if (!page) throw new Error('没找到秀米页面：先打开 https://xiumi.us/studio/v5#/paper/for/<草稿id>/cube/0');
  if (opts.bringToFront !== false) await page.bringToFront().catch(() => {});
  return { browser, ctx, page };
}

/* ---------------- 画布快照 ---------------- */

/** 顶层组件快照：[{i, h, txt, imgs:[{sz,w}]}]，sz 是图片 URL 里的 -sz_<字节数>（模板图记 'tmpl'） */
export async function snapshot(page) {
  return page.evaluate(() => [...document.querySelectorAll('.tn-page div.tn-comp-top-level')].map((c, i) => {
    const r = c.getBoundingClientRect();
    return {
      i,
      y: Math.round(r.top),
      h: Math.round(r.height),
      txt: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      imgs: [...c.querySelectorAll('img')].map((im) => {
        const src = im.getAttribute('src') || '';
        const m = src.match(/-sz_(\d+)/);
        return { sz: m ? m[1] : (/statics\.xiumi|_sz-/.test(src) ? 'tmpl' : 'deco'), w: Math.round(im.getBoundingClientRect().width) };
      }),
    };
  }));
}

/** 滑动组件：返回 [{idx, pages:[sz...]}]（含模板图 'tmpl'） */
export async function listSwipes(page) {
  return page.evaluate(() => {
    const cs = [...document.querySelectorAll('.tn-page div.tn-comp-top-level')];
    return cs
      .filter((x) => x.querySelector('.tn-group-horizontal-box') && x.querySelectorAll('img').length >= 2)
      .map((x) => ({
        idx: cs.indexOf(x),
        pages: [...x.querySelectorAll('img')].map((im) => (im.getAttribute('src') || '').match(/-sz_(\d+)/)?.[1] || 'tmpl'),
      }));
  });
}

/** 顶层组件里第一个包含该图片指纹的 index（sz = -sz_<字节数>），没有返回 -1。
 *  注意：必须用「提取数字后全等」而不是 includes —— 1002 是 10022 的前缀，includes 会误中。 */
export async function findCompByImage(page, sz) {
  return page.evaluate((sz) => [...document.querySelectorAll('.tn-page div.tn-comp-top-level')]
    .findIndex((c) => [...c.querySelectorAll('img')].some((im) => {
      const m = (im.getAttribute('src') || '').match(/-sz_(\d+)/);
      return !!m && m[1] === String(sz);
    })), String(sz));
}

/* ---------------- 左栏面板 ---------------- */

async function openRail(page, name) {
  await page.locator('.x3-tab-item').filter({ hasText: name }).first().click({ timeout: 5000 });
  await sleep(900);
}

/** 打开「图片 → 滑动图片」样式面板 */
export async function openSwipePanel(page) {
  await openRail(page, '图文模板');
  await page.locator('a.tn-tpl-tag-lv1-child').filter({ hasText: '图片' }).first().click({ timeout: 5000 });
  await sleep(800);
  await page.locator('.dropdown-menu li:visible, .dropdown-menu a:visible').filter({ hasText: '滑动图片' }).last().click({ timeout: 5000 });
  await sleep(1600);
}

/** 打开「我的图库」（换图前必须） */
export async function openGallery(page) {
  await openRail(page, '我的图库');
  await sleep(900);
}

/**
 * 插入一个滑动组件（默认选"干净 4 页"样式：4 张 229±3px 图 + 只含「左右滑动查看更多」）。
 * 注意：只点样式根节点一次 —— 点内层多个节点会连插多份。
 * @returns {{before:number, after:number, styleIndex:number|null}}
 */
export async function insertSwipe(page, opts = {}) {
  const before = (await snapshot(page)).length;
  await openSwipePanel(page);
  const picked = await page.evaluate((want) => {
    const items = [...document.querySelectorAll('.tn-tpl-comp-item')];
    const cands = items.map((e, i) => {
      const ws = [...e.querySelectorAll('img')].map((im) => Math.round(im.getBoundingClientRect().width));
      return { e, i, n: ws.length, ws, txt: (e.textContent || '').replace(/\s+/g, ' ').trim() };
    });
    const clean = cands.find((o) => o.n === 4 && o.ws.every((w) => w > 226 && w < 232) && /左右滑动查看更多/.test(o.txt));
    const t = want === 'first' ? cands.find((o) => o.n >= 3) : clean;
    if (!t) return null;
    t.e.click(); // 只能 JS click；真实鼠标点外层无效
    return t.i;
  }, opts.style || 'clean');
  await sleep(2800);
  const after = (await snapshot(page)).length;
  return { before, after, styleIndex: picked };
}

/* ---------------- 页数：Angular 模型 ---------------- */

/** 设置某滑动组件的页数（增页=深拷贝末页并重写所有 _$uuid；减页=splice）。 */
export async function setSlideCount(page, swipeIdx, n) {
  return page.evaluate(([idx, N]) => {
    const c = document.querySelectorAll('.tn-page div.tn-comp-top-level')[idx];
    if (!c) return 'no comp';
    const box = c.querySelector('.tn-group-horizontal-box');
    const sc = window.angular.element(box).scope();
    if (!sc || !sc.cellGroupItems) return 'no scope';
    const regen = (o) => {
      if (Array.isArray(o)) o.forEach(regen);
      else if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          if (k === '_$uuid') o[k] = 'comp-' + Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
          else regen(o[k]);
        }
      }
    };
    while (sc.cellGroupItems.length < N) {
      const cl = JSON.parse(JSON.stringify(sc.cellGroupItems[sc.cellGroupItems.length - 1]));
      delete cl.$$hashKey; regen(cl); sc.cellGroupItems.push(cl);
    }
    while (sc.cellGroupItems.length > N) sc.cellGroupItems.splice(N, sc.cellGroupItems.length - N);
    try { sc.$applyAsync(); } catch (e) { try { sc.$apply(); } catch (e2) { return 'apply err ' + e2.message; } }
    return 'pages=' + sc.cellGroupItems.length;
  }, [swipeIdx, n]);
}

/* ---------------- 逐页换图 ---------------- */

/** 把第 k 页换成图库里 -sz_<gallerySz> 的照片。返回是否找到缩略图并点击。 */
export async function replaceSlideImage(page, swipeIdx, k, gallerySz) {
  await page.evaluate(([idx, kk]) => {
    const c = document.querySelectorAll('.tn-page div.tn-comp-top-level')[idx];
    c.scrollIntoView({ block: 'center' });
    const box = c.querySelector('.tn-group-horizontal-box');
    if (box) box.scrollLeft = kk * box.clientWidth;
  }, [swipeIdx, k]);
  await sleep(650);
  const pos = await page.evaluate(([idx, kk]) => {
    const c = document.querySelectorAll('.tn-page div.tn-comp-top-level')[idx];
    const im = [...c.querySelectorAll('img')][kk];
    if (!im) return null;
    const r = im.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, [swipeIdx, k]);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  await sleep(800);
  // 缩略图必须滚进视口再点（y 超出视口时点击无效——这是最容易误判"失败"的坑）
  // 指纹用「提取数字后全等」，不能用 includes（1002 是 10022 的前缀，会点错图）
  const th = await page.evaluate((sz) => {
    const t = [...document.querySelectorAll('img')].find((im) => {
      const r = im.getBoundingClientRect();
      if (!(r.left < 700 && r.width > 40 && r.top > 60)) return false;
      const m = (im.getAttribute('src') || '').match(/-sz_(\d+)/);
      return !!m && m[1] === String(sz);
    });
    if (!t) return null;
    t.scrollIntoView({ block: 'center' });
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, String(gallerySz));
  if (!th) return false;
  await page.mouse.click(th.x, th.y);
  await sleep(1500);
  return true;
}

/* ---------------- 图库上传 ---------------- */

/** 上传本地图片到「我的图库」，返回 [{name, bytes}]（bytes 就是之后 -sz_ 指纹） */
export async function uploadGallery(page, files) {
  await openGallery(page);
  const chooserP = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.getByText('上传图片(无水印)', { exact: false }).first().click({ timeout: 5000 });
  const fc = await chooserP;
  await fc.setFiles(files);
  await sleep(8000);
  return files.map((f) => ({ name: path.basename(f), bytes: fs.statSync(f).size }));
}

/* ---------------- 删除组件 ---------------- */

/** 点组件中心 → 点工具栏里"可见的"红色删除按钮（隐藏副本 rect=0，必须过滤）。 */
export async function deleteComponent(page, idx) {
  await page.evaluate((i) => document.querySelectorAll('.tn-page div.tn-comp-top-level')[i].scrollIntoView({ block: 'center' }), idx);
  await sleep(600);
  const pos = await page.evaluate((i) => {
    const r = document.querySelectorAll('.tn-page div.tn-comp-top-level')[i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, idx);
  await page.mouse.click(pos.x, pos.y);
  await sleep(800);
  const btn = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('button.btn-danger.op-bar-btn')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (!cs.length) return null;
    const r = cs[cs.length - 1];
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!btn) return false;
  await page.mouse.click(btn.x, btn.y);
  await sleep(1300);
  return true;
}

/** 选中从 fromIdx 开始的 count 个顶层组件（点第一个 + Shift+ArrowDown ×(count-1)） */
export async function selectComponents(page, fromIdx, count) {
  await page.evaluate((i) => document.querySelectorAll('.tn-page div.tn-comp-top-level')[i].scrollIntoView({ block: 'center' }), fromIdx);
  await sleep(700);
  const pos = await page.evaluate((i) => {
    const r = document.querySelectorAll('.tn-page div.tn-comp-top-level')[i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, fromIdx);
  await page.mouse.click(pos.x, pos.y);
  await sleep(700);
  for (let k = 0; k < count - 1; k++) { await page.keyboard.press('Shift+ArrowDown'); await sleep(240); }
}

/* ---------------- 保存 / 验证 ---------------- */

/** 点顶栏「保存」，等 3.5s（会顺带自动提交分享审核） */
export async function saveDraft(page) {
  await page.locator('span.op-btn-inset-desc').filter({ hasText: /^保存$/ }).first().click({ timeout: 5000 });
  await sleep(3500);
}

/** 打开分享页核对已保存内容：3 处滑动提示 = 3 组图集；旧模板残留应为 0 */
export async function verifyShare(ctx, shareUrl) {
  const p = await ctx.newPage();
  await p.goto(shareUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(7000);
  const r = await p.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      url: location.href,
      slideHints: (txt.match(/左右滑动查看更多/g) || []).length,
      oldEmptyHints: (txt.match(/← 向左滑动查看更多图片/g) || []).length,
      templateText: (txt.match(/2025年中总结回顾/g) || []).length,
      photos: [...document.querySelectorAll('img')].filter((im) => /-sz_\d+/.test(im.getAttribute('src') || '')).length,
    };
  });
  await p.close();
  return r;
}
