# 配方：竖排照片 → 滑动图片图集（秀米）

> 场景：一篇文章里有 N 张竖排（单列）照片，编辑要求改成"多图右滑"的横滑图集，保留图注。
> 本配方在 2026-11-01 实战跑通：3 组（6/5/2 页）、18 张图、33 个顶层组件、保存后分享链接自动过审。

## 0. 前置

- 调试口 Edge 已开、目标草稿编辑页已打开（见 `references/edge-cdp-setup.md`）
- 照片已上传到「我的图库」（`xiumi-gallery.mjs upload --files ...`）
- 先 `status` 存一份基线：`node scripts/xiumi-gallery.mjs status`

## 1. 一键命令（推荐）

```bash
cd <本 skill>/scripts   # 或插件安装后 skill 目录下的 scripts

# 只读状态
node xiumi-gallery.mjs status

# 上传本组原图，拿到 -sz_ 指纹
node xiumi-gallery.mjs upload --files "./photos/a.jpg,./photos/b.jpg"

# 转换一组（先 dry-run 看 PLAN，再 --yes）
node xiumi-gallery.mjs convert --art 36759,39683 --gal 93691,100113 --yes
# 多组都做完再保存（保存后还要去「预览→分享」点申请审核）
node xiumi-gallery.mjs save

# 核对已保存的分享页
node xiumi-gallery.mjs verify --share https://v.xiumius.cn/board/v5/<x>/<id>
```

参数说明：
- `--art`：画布里竖排照片的 `-sz_` 指纹（按**从上到下**顺序）；用来定位/多选/最后删除。
- `--gal`：图库里对应照片的 `-sz_` 指纹（= 本地 web43 文件字节数，顺序同上）；也可以用 `--gal-files a.jpg,b.jpg` 自动取字节数。
- 两者数量必须相等 = 页数。

## 2. 手工流程（CLI 不适用时，6 步）

```js
import * as X from './xiumi-lib.mjs';
const { ctx, page } = await X.connect();

// 1) 选中 N 张照片（点第一张 + Shift+ArrowDown ×(N-1)）
const first = await X.findCompByImage(page, art[0]);
await X.selectComponents(page, first, N);

// 2) 插入滑动组件（"干净 4 页"样式：4 张 229±3px 图 + 只有「左右滑动查看更多」）
const { after } = await X.insertSwipe(page);

// 3) 找到新组件并改成 N 页（UI 面板点不到，走 Angular 模型）
const swipes = await X.listSwipes(page);
const fresh = swipes.filter(s => s.idx > first && s.pages.every(p => p === 'tmpl')).sort((a,b) => b.idx - a.idx)[0];
await X.setSlideCount(page, fresh.idx, N);

// 4) 逐页换图（缩略图会先滚进视口）
await X.openGallery(page);
for (let k = 0; k < N; k++) await X.replaceSlideImage(page, fresh.idx, k, gal[k]);

// 5) 删掉被替换的 N 个竖排照片
for (const sz of art) { const i = await X.findCompByImage(page, sz); if (i >= 0) await X.deleteComponent(page, i); }

// 6) 保存（会顺带提交分享审核）
await X.saveDraft(page);
```

## 3. 页数只能改模型（核心突破，别再去点「设置滑动序列」）

按钮存在但不可点：它只在"选中水平容器单元格"时可见，而容器被每页子组件完全覆盖，布局模式/边距/滚动条都点不到。直接改数据：

```js
const c = document.querySelectorAll('.tn-page div.tn-comp-top-level')[idx];
const box = c.querySelector('.tn-group-horizontal-box');
const sc = window.angular.element(box).scope();   // sc.cellGroupItems = 每页一个对象

// 增页：深拷贝最后一页，删掉 $$hashKey（Angular 的 track by $id 会重新发号），
//       并递归重写所有 '_$uuid'（重复 uuid 会让编辑/保存出问题）
const cl = JSON.parse(JSON.stringify(sc.cellGroupItems.at(-1)));
delete cl.$$hashKey;
regenUuid(cl);
sc.cellGroupItems.push(cl);

// 减页：sc.cellGroupItems.splice(N, len - N);
sc.$applyAsync();     // 立即重渲染；之后正常保存，服务端会持久化
```

要点：
- 克隆出来的页**内容与末页完全相同**（同一张图），后面逐页 `replaceSlideImage` 覆盖成正式照片。
- 只改模型不加脏标记不行 —— **必须 `$applyAsync()`**，并且用编辑器自己的「保存」按钮落盘（实测保存后分享页页数正确）。
- 想减到 2 页（如活动现场）也是同一套：`setSlideCount(page, idx, 2)`。

## 4. 样式选择（很重要，选错样式 = 白干）

滑动图片面板里每个样式是"模板插入"，页数和装饰都不一样：

| 判定 | 结论 |
|---|---|
| 4 张预览图宽度都 ≈229px，文本只有「左右滑动查看更多」 | ✅ 干净样式（本配方默认，index ≈18） |
| 预览文本含「2025年中总结回顾」、带红色拱形/装饰块 | ❌ 每页有装饰与图注，替换图片后装饰仍在 |
| 3 张预览图、文本「年中总结回顾」 | ❌ 同上（旧会话踩过的坑） |
| 页数 3 或 4 非固定 | 页数一律用模型改，不要靠挑样式凑页数 |

判定表达式（`insertSwipe` 内部同款）：
```js
const ws = [...e.querySelectorAll('img')].map(im => Math.round(im.getBoundingClientRect().width));
const clean = ws.length === 4 && ws.every(w => w > 226 && w < 232) && /左右滑动查看更多/.test(e.textContent);
```

## 5. 校验清单（做完必须过）

编辑器侧（`status` 可看）：
- 顶层组件数 = 原数 - 13（被替换照片）+ 3（三组滑动组件）
- `listSwipes()`：每组 pages 序列 = 该组 `--gal` 顺序，且**没有 `tmpl`**
- 模板残留文字「2025年中总结回顾」= 0；旧空提示「← 向左滑动查看更多图片」= 0
- 图注/正文/立牌照片数量不变

分享页侧（`verify --share`）：
- `slideHints` = 组数（3）
- `oldEmptyHints` = 0，`templateText` = 0
- `photos` ≈ 18 张（4:3 图）+ 装饰图
- 编辑器「预览」→「分享」标签页看审核状态：
  - 显示「内容有修改，需要再次申请审核」+ 绿色 **申请审核** 按钮时，必须点它（`locator.click` 有时失效，用 `page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '申请审核').click())` 最稳）；
  - 点完等 3~4 秒重开面板，变为 **「审核已通过，分享内容是最新的了」** 才算完成；
  - 分享页（v.xiumius.cn）在审核通过前一直显示旧版本，所以"分享页没更新"基本就是没点申请审核。
  - 可用 `verify --share <url>` 抽查分享页里新装饰图的 `-sz_<bytes>` 是否出现，确认不是旧缓存。

## 6. 本配方已知局限

- 图库上限 100 张（本账号），13 张/篇没问题，长期用要注意清空。
- 一次 `convert` 只处理一组；组与组之间互相独立，可以逐组做、最后统一 `save`。
- 如果照片在画布里**不连续**（中间夹了图注/装饰），`Shift+ArrowDown` 会多选；CLI 会检测并中止，需要手工先拆开或改 `--art` 顺序。
