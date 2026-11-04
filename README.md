# dsh-xiumi · 秀米图文排版自动化（DSH 插件 / Skill）

用 **Playwright + CDP** 操作你**已登录**浏览器里的[秀米（XIUMI）](https://xiumi.us)图文编辑器，把"批量排版"从手工点击变成脚本：批量多选、插入横滑图集、逐页换图、改页数、删组件、保存并核对分享页审核状态。

> 本项目只包含**秀米排版**能力，不含任何 API 路由/模型代理；脚本只连本机 CDP 端口，不向外发数据。

[English](README.en.md)

## 为什么需要它

- 系统级鼠标注入（`SetCursorPos + mouse_event`、`SendInput`）在 Chromium 系浏览器上经常完全无效，只能走 CDP/Playwright。
- 秀米画布是 AngularJS 组件树 + 虚拟列表：`img` 数量会随滚动变化，常规"点点点"脚本很容易误判。
- "把一组竖排照片改成横滑图集"在秀米里是**模板插入 + 逐页换图 + 改页数**，没有任何一键入口；本项目把这条链路固化成 CLI。

## 功能

- **滑动图集转换**：选中一组照片 → 插入「滑动图片」组件 → 改成 N 页 → 逐页换成原图 → 删掉旧竖排照片
- **页数任意改**：绕过点不到的「设置滑动序列」面板，直接改 Angular 模型（`cellGroupItems`），保存可持久化
- **批量换图**：按图片 URL 里的 `-sz_<字节数>` 指纹精确匹配图库缩略图
- **画布快照 / 校验**：组件数、每个滑动组件的页数与图片指纹，用来判断操作是否真的生效
- **保存 + 审核**：保存草稿；引导点「申请审核」并用分享页核对是否已更新

## 安装

### 方式 A：作为 DSH 插件（推荐）

```bash
dsh plugin add https://github.com/<owner>/dsh-xiumi
# 本地目录也可以：
dsh plugin add /path/to/dsh-xiumi
```

安装后重启（或新开会话）即可在 skill 列表里看到 `xiumi-editor-automation`。

### 方式 B：当普通 skill 用

把 `skill/` 目录复制到 `~/.dsh/skills/xiumi-editor-automation/`（或项目内 `.dsh/skills/`）。

### 依赖

- Node.js ≥ 18
- `playwright-core`（**不会下载浏览器**，复用你已装的 Edge/Chrome）：

```bash
cd skill/scripts && npm i playwright-core
```

## 快速开始

```bash
cd skill/scripts

# 1) 起一个带调试口（9222）的 Edge/Chrome，并把日常 profile 的登录态复制过去
node launch-browser.mjs

# 2) 在弹出来的浏览器里打开草稿编辑页
#    https://xiumi.us/studio/v5#/paper/for/<草稿id>/cube/0

# 3) 看当前画布状态
node xiumi-gallery.mjs status

# 4) 上传照片到「我的图库」，拿到每张图的 -sz_ 指纹
node xiumi-gallery.mjs upload --files ./photos/a.jpg,./photos/b.jpg

# 5) 转换一组（先 dry-run 打印 PLAN，确认后加 --yes 执行）
node xiumi-gallery.mjs convert --art <原图指纹列表> --gal <图库指纹列表>

# 6) 保存（保存后到「预览 → 分享」点「申请审核」，分享页才会更新）
node xiumi-gallery.mjs save

# 7) 核对分享页
node xiumi-gallery.mjs verify --share https://v.xiumius.cn/board/v5/<x>/<id>
```

`convert` 的 `--art` 是画布上竖排照片的 `-sz_` 指纹（从上到下），`--gal` 是图库里对应照片的 `-sz_` 指纹（= 本地文件字节数，顺序一致），两者数量必须相等 = 页数。

## 目录结构

```
dsh-xiumi/
├── lib/index.js            # DSH 插件入口：把 skill/ 注册成运行时 skill
├── cordis.patch.yml        # DSH bundle patch（插入插件行）
├── skill/
│   ├── SKILL.md            # 模型可读的 skill 正文（含核心不变量）
│   ├── references/         # 详细手册：浏览器启动 / DOM 手册 / 图集配方
│   └── scripts/
│       ├── launch-browser.mjs   # 跨平台启动调试口浏览器 + 复制登录态
│       ├── xiumi-lib.mjs        # 可复用函数库
│       ├── xiumi-gallery.mjs    # CLI：status/upload/convert/save/verify
│       └── cdp.mjs              # 零依赖裸 CDP 小工具
└── test/smoke.mjs          # 冒烟测试（文件完整性 + 语法 + frontmatter）
```

## 已知限制

- 秀米是闭源 SaaS，页面结构随时可能改版；选择器集中在 `xiumi-lib.mjs` 与 `references/dom-playbook.md`，改版后按手册更新。
- 只支持 Chromium 系浏览器（Edge/Chrome）的 CDP 调试口。
- 浏览器 ≥136 不允许默认 profile 开调试口，必须用复制出来的 profile（脚本已处理）；复制时若源浏览器在运行，`Cookies` 可能被锁定，需退出源浏览器或直接在调试窗口登录一次。
- 秀米「我的图库」有容量上限（常见 100 张）。
- 本项目不绕过任何平台限制，仅自动化你本来就能在界面上完成的操作；使用需遵守秀米服务条款。

## 测试

```bash
node test/smoke.mjs
```

## License

MIT
