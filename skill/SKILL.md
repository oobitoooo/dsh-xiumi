---
name: xiumi-editor-automation
description: 用 Playwright/CDP 操作已登录浏览器里的秀米（XIUMI）图文编辑器：批量多选、插入「滑动图片」组件、逐页换图、改页数、删除组件、保存草稿并核对分享页审核状态。适用于系统级鼠标注入点不动浏览器、需要批量排版而非一两次点击的场景。含带调试口浏览器的启动与登录态迁移、秀米画布 DOM 选择器、虚拟列表判据与实战踩坑。
---

# 秀米（XIUMI）编辑器自动化

本 skill 自带可执行脚本，命令里的 `scripts/...`、`references/...` 都相对于**本 skill 目录**。

## 安装

**方式 A：作为 DSH 插件安装（推荐）**

```bash
dsh plugin add <本仓库目录或 npm 包名>
```

插件会在启动时把本 skill 注册进当前 profile，跨会话可用。

**方式 B：手动当普通 skill**

把 `skill/` 目录复制到 `~/.dsh/skills/xiumi-editor-automation/`（或项目内 `.dsh/skills/`）即可。

**依赖**：Node.js 18+；`playwright-core`（**不下载浏览器**）：

```bash
cd <本 skill>/scripts && npm i playwright-core
# 或者装到 ~/.dsh/xiumi/playwright 并设置 XIUMI_PW_CORE 指向其 node_modules/playwright-core
```

## 什么时候用

- 要在**用户已登录**的浏览器里批量操作秀米（多选、插入组件、批量换图、保存）
- 系统级鼠标注入（`SetCursorPos+mouse_event` / `SendInput`）对浏览器无效，只能走 CDP/Playwright
- 任务形如：「把一组竖排照片做成横滑图集」「批量换图 / 删组件 / 改页数」「保存并确认分享链接最新」

## 快速开始

```bash
# 1) 启动一个带调试口（默认 9222）的 Edge/Chrome，并把日常 profile 的登录态复制过去
node scripts/launch-browser.mjs
#    然后在弹出的浏览器里打开草稿编辑页：
#    https://xiumi.us/studio/v5#/paper/for/<草稿id>/cube/0

# 2) 只读查看画布现状（组件数 / 滑动组件页数）
node scripts/xiumi-gallery.mjs status

# 3) 上传照片到「我的图库」，拿到每张图的 -sz_<字节数> 指纹
node scripts/xiumi-gallery.mjs upload --files a.jpg,b.jpg

# 4) 把一组竖排照片转成一个滑动图集（先 dry-run，确认后加 --yes）
node scripts/xiumi-gallery.mjs convert --art 36759,39683 --gal 93691,100113

# 5) 全部改完后统一保存（保存后还要在「预览→分享」里点「申请审核」）
node scripts/xiumi-gallery.mjs save

# 6) 核对已保存的分享页
node scripts/xiumi-gallery.mjs verify --share https://v.xiumius.cn/board/v5/<x>/<id>

# 7) 排版质检（字号/行距/图注一致性/图片比例），输出 Markdown + JSON
node scripts/xiumi-audit.mjs --share https://v.xiumius.cn/board/v5/<x>/<id> --md report.md

# 8) 登录态轻量迁移：把已登录浏览器的会话导出，之后注入到任意调试浏览器（免复制整个 profile）
node scripts/xiumi-session.mjs export
node scripts/xiumi-session.mjs apply --open "https://xiumi.us/studio/v5#/paper/for/<草稿id>/cube/0"

# 9) 装到本机其它 AI 助手（Claude Code / Cursor / Codex …）
node scripts/install-harnesses.mjs --list
node scripts/install-harnesses.mjs
```

## 核心不变量（实测，别绕路）

1. **默认 profile 开不了调试口**（Chrome/Edge 136+）；必须复制 profile 到独立目录再启动，登录态靠 `Local Storage` 而不只是 Cookies（`launch-browser.mjs` 已处理）。
2. 复制登录态时若源浏览器在运行，`Cookies` 可能被独占锁定复制失败——先退出源浏览器重跑 `--fresh`，或直接在调试窗口扫码登录一次。
3. 画布是**虚拟列表**：别用 `img` 数量判断成功，用「顶层组件数 + 组件内 `-sz_<字节数>` 指纹集合」判断。
4. 多选 = 点第一张 + `Shift+ArrowDown` ×(n-1)；Shift/Ctrl+点击不可靠。
5. 删除组件 = 点组件中心 → 点工具栏里 **rect 非 0** 的红色删除按钮；滑动组件会留空壳，要再删一次。键盘 Delete 无效。
6. **滑动组件改页数只能改 Angular 模型**：UI 的「设置滑动序列」按钮点不到（水平容器被子页盖住）。改 `scope.cellGroupItems` 后 `$applyAsync()`，保存可持久化。
7. **换图** = 选中组件里的图片 → 左栏「我的图库」→ 点缩略图；缩略图**必须先 `scrollIntoView`**，否则超出视口点击无效。**按 `-sz_` 匹配必须「提取数字后全等」，不能用 `includes`**（1002 是 10022 的前缀，会点错图）。
8. 插入样式**只 JS click `.tn-tpl-comp-item` 根节点一次**；点内层节点会连插多份。
9. 保存 ≠ 分享页更新：保存后到「预览 → 分享」，若显示「内容有修改，需要再次申请审核」，必须点绿色 **申请审核**（用 JS `.click()` 最稳），状态变「审核已通过，分享内容是最新的了」分享页才更新。

## 资源索引

| 文件 | 什么时候读 |
|---|---|
| `references/edge-cdp-setup.md` | 启动/登录态/`playwright-core` 安装、只想用裸 CDP 探活 |
| `references/dom-playbook.md` | 写新操作、调选择器、遇到"点不动/选不中/删不掉" |
| `references/gallery-recipe.md` | 竖排照片 → 滑动图集的完整配方、页数模型 hack、样式判定、验收清单 |
| `scripts/xiumi-gallery.mjs` | CLI：`status` / `upload` / `convert` / `save` / `verify` |
| `scripts/xiumi-lib.mjs` | 可复用函数：`connect/snapshot/listSwipes/findCompByImage/selectComponents/insertSwipe/setSlideCount/replaceSlideImage/deleteComponent/uploadGallery/saveDraft/verifyShare` |
| `scripts/launch-browser.mjs` | 跨平台启动带调试口的 Edge/Chrome + 复制登录态 |
| `scripts/xiumi-session.mjs` | 登录态 `export` / `apply` / `status`（cookie + localStorage，免整个 profile） |
| `scripts/xiumi-audit.mjs` | 排版质检：字号/行距/图注一致性/图片比例，`--preset strict\|standard\|loose`，输出 Markdown + JSON |
| `scripts/install-harnesses.mjs` | 把本 skill 装进本机其它 AI 助手（Claude Code / Cursor / Codex / Gemini …） |
| `scripts/cdp.mjs` | 零依赖裸 CDP：`targets/nav/eval/click/wheel/key/type/shot`，适合探活与截图 |

## 三个增量能力（v0.2.0）

### 排版质检（借鉴 xiumi-editor-checker 的规则，但不解析私有 JSON）

```bash
node scripts/xiumi-audit.mjs --share <分享链接> [--preset strict] [--json r.json] [--md r.md]
```

- 打开**已渲染**的分享页/编辑页，读 `computedStyle` —— 与肉眼看到的完全一致，免逆向。
- 检查：正文字号与行距、小标题字号/加粗、**图注字号与颜色是否统一**、图片宽高比（16:9 / 4:3）。
- 有 `error` 时退出码 1，可接 CI；`report.md` 可直接贴群里当交付证据。

### 登录态轻量迁移（借鉴 sid 会话思路，但我们只搬浏览器会话）

```bash
node scripts/xiumi-session.mjs export          # 从已登录的调试浏览器导出 → ~/.dsh/xiumi/session.json
node scripts/xiumi-session.mjs apply --open <草稿URL>  # 任何带调试口的浏览器都能注入
node scripts/xiumi-session.mjs status
```

比复制整个 profile 更轻：`sid` 有效期约 3 天，过期重新 export 即可；不碰账号密码。

### 装到别的 AI 助手

```bash
node scripts/install-harnesses.mjs --list   # 探测本机装了哪些 harness
node scripts/install-harnesses.mjs          # 装到所有探测到的用户级技能目录
node scripts/install-harnesses.mjs --dir <目录>
```

## 安全规则

- 动手前先 `status` 记基线（组件数、滑动组件页数）；每次批量操作后对数。
- `convert` 不带 `--yes` 只打印计划；照片组件不连续时 CLI 会中止，不要强行改。
- `Ctrl+Z` 撤销的是**整条编辑历史**（可能连上一位编辑早已保存的修改一起撤），别当"撤回上一步"用；误撤后立刻对数。
- 破坏性顺序：先插新组件并换完图，**再**删原照片；中途失败可逐个 `deleteComponent` 收尾。
- 想改"副本"不动原稿：编辑器 `更多 → 另存一个图文`，会自动生成新草稿并跳转。
- 调试浏览器是独立 profile，不影响用户日常浏览器；收工直接关窗口。

## 许可

MIT
