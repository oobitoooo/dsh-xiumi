#!/usr/bin/env node
/**
 * 秀米「竖排照片 → 滑动图片图集」一键转换 CLI（2026-11 实测配方）
 *
 * 前置：Edge 已带调试口运行（scripts/launch-edge-cdp.ps1），并已打开目标草稿的编辑页；
 *      照片已上传到「我的图库」（或用 upload 子命令）。
 *
 * 子命令：
 *   status                              只读：打印画布组件/滑动组件当前状态
 *   upload   --files a.jpg,b.jpg        上传本地图片到「我的图库」，打印每个文件的 -sz_ 指纹
 *   convert  --art 36759,39683 --gal 93691,100113 [--yes] [--save]
 *                                       把一组竖排照片转成一个滑动图集（见下）
 *   save                                点顶栏「保存」
 *   verify   --share <url>              打开分享页核对已保存内容
 *
 * convert 做的事（顺序很重要，都是实测过的）：
 *   1. 找到 --art 里第一张照片所在组件，点选 + Shift+ArrowDown 选中 N 个组件
 *   2. 打开「图片 → 滑动图片」面板，插入"干净 4 页"样式（只点根节点一次）
 *   3. 用 Angular 模型把新组件的页数改成 N（UI 上的「设置滑动序列」点不到）
 *   4. 逐页换图：滚动到第 k 页 → 点该页图片 → 点图库里 -sz_ 匹配的缩略图
 *   5. 删除被替换的 N 个竖排原照片组件
 *   6. 可选 --save 保存（保存会自动提交分享审核）
 *
 * 安全闸：不带 --yes 只打印计划，不做任何修改。
 */
import fs from 'node:fs';
import * as X from './xiumi-lib.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'status';
const opt = (name, dflt = null) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
};
const need = (name) => {
  const v = opt(name);
  if (!v || v === true) { console.error('缺少 --' + name); process.exit(2); }
  return String(v);
};
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
const ok = (c) => (c ? 'OK ' : 'FAIL');

async function main() {
  const { browser, ctx, page } = await X.connect({ port: Number(opt('port', 9222)) });
  try {
    if (cmd === 'status') {
      const comps = await X.snapshot(page);
      const swipes = await X.listSwipes(page);
      console.log(JSON.stringify({ url: page.url(), comps: comps.length, swipes, tail: comps.slice(-8) }, null, 1));
      return;
    }

    if (cmd === 'upload') {
      const files = list(need('files')).map((f) => fs.realpathSync(f));
      const r = await X.uploadGallery(page, files);
      console.log(JSON.stringify(r, null, 1));
      return;
    }

    if (cmd === 'save') { await X.saveDraft(page); console.log('saved'); return; }

    if (cmd === 'verify') { console.log(JSON.stringify(await X.verifyShare(ctx, need('share')), null, 1)); return; }

    if (cmd === 'convert') {
      const art = list(need('art'));
      const gal = opt('gal') ? list(opt('gal')) : null;
      const galFiles = opt('gal-files') ? list(opt('gal-files')) : null;
      const gallery = gal || (galFiles ? galFiles.map((f) => String(fs.statSync(fs.realpathSync(f)).size)) : null);
      if (!gallery) { console.error('需要 --gal 或 --gal-files'); process.exit(2); }
      if (gallery.length !== art.length) { console.error(`页数不一致：art ${art.length} 张 vs gal ${gallery.length} 张`); process.exit(2); }
      const N = art.length;
      const yes = !!opt('yes');

      const before = await X.snapshot(page);
      const firstIdx = await X.findCompByImage(page, art[0]);
      if (firstIdx < 0) { console.error('找不到第一张照片组件（fingerprint -sz_' + art[0] + '）'); process.exit(2); }
      // 计划里顺手检查：这 N 张照片是否连续
      const idxs = [];
      for (const sz of art) idxs.push(await X.findCompByImage(page, sz));
      const contiguous = idxs.every((v, i) => v === idxs[0] + i);
      const plan = { comps: before.length, art, gallery, firstIdx, photoIdxs: idxs, contiguous };
      console.log('PLAN', JSON.stringify(plan, null, 1));
      if (!contiguous) { console.error('警告：照片组件不连续，Shift+ArrowDown 会多选；中止。请先确认 --art 顺序/是否夹了别的组件。'); process.exit(3); }
      if (!yes) { console.log('（dry-run；确认无误后加 --yes 执行）'); return; }

      // 1) 选中 N 张照片
      await X.selectComponents(page, firstIdx, N);
      // 2) 插入滑动组件
      const ins = await X.insertSwipe(page);
      console.log('insert', JSON.stringify(ins));
      // 3) 找新组件：所有页都是模板图、且位于照片之后的那个
      const swipes = await X.listSwipes(page);
      const fresh = swipes.filter((s) => s.idx > firstIdx && s.pages.every((p) => p === 'tmpl')).sort((a, b) => b.idx - a.idx)[0];
      if (!fresh) { console.error('插入后找不到模板滑动组件', JSON.stringify(swipes)); process.exit(4); }
      console.log('fresh swipe', JSON.stringify(fresh));
      // 4) 改页数
      console.log('pages', await X.setSlideCount(page, fresh.idx, N));
      await X.sleep(1400);
      // 5) 逐页换图
      await X.openGallery(page);
      let swapped = 0;
      for (let k = 0; k < N; k++) {
        const hit = await X.replaceSlideImage(page, fresh.idx, k, gallery[k]);
        console.log(`slide ${k} <- -sz_${gallery[k]}`, ok(hit));
        if (hit) swapped++;
      }
      // 6) 删原照片
      let removed = 0;
      for (const sz of art) {
        const i = await X.findCompByImage(page, sz);
        if (i < 0) { console.log('already gone', sz); continue; }
        const done = await X.deleteComponent(page, i);
        console.log('delete original', sz, ok(done));
        if (done) removed++;
      }
      // 7) 自检
      const afterComps = await X.snapshot(page);
      const afterSwipes = await X.listSwipes(page);
      const target = afterSwipes.find((s) => s.pages.length === N && s.pages.every((p, i) => p === gallery[i]));
      const artLeft = [];
      for (const sz of art) if (await X.findCompByImage(page, sz) >= 0) artLeft.push(sz);
      console.log('RESULT', JSON.stringify({ compsBefore: before.length, compsAfter: afterComps.length, swapped, removed, target, artLeft }, null, 1));
      if (opt('save')) { await X.saveDraft(page); console.log('saved'); }
      return;
    }

    console.error('未知子命令：' + cmd);
    process.exit(2);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
