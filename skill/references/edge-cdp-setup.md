# 前置：带调试口的浏览器 + 登录态 + Playwright

> 只有"控制浏览器"这一步需要看；纯读代码可跳过。

## 1. 为什么不能直接连用户平时开的浏览器

Chrome/Edge 136+ 对**默认 profile** 开着 `--remote-debugging-port` 也不监听（安全策略）。
必须用一份**复制出来的 profile** 启动一个新的浏览器实例，登录态跟着复制体走。

## 2. 一键脚本（跨平台）

```bash
node scripts/launch-browser.mjs            # Edge（默认），端口 9222
node scripts/launch-browser.mjs --browser chrome --port 9223
node scripts/launch-browser.mjs --fresh    # 重新复制登录态（会覆盖复制体）
```

脚本做的事：
- 按平台找 Edge/Chrome 可执行文件与用户数据目录（Windows / macOS / Linux）
- 复制这些到 `~/.dsh/xiumi/browser-profile`：
  `Local State` + `Default/` 下的 `Local Storage`、`Session Storage`、`IndexedDB`、`Network`、`WebStorage`、`Preferences`、`Cookies`、`Login Data`、`Web Data`
  （**只复制 Cookies 不够**：秀米登录态主要在 Local Storage）
- 以 `--remote-debugging-port=<port> --user-data-dir=<复制体> --no-first-run about:blank` 启动
- 轮询 `http://127.0.0.1:<port>/json/version`，打印 `CDP OK`

再打开目标草稿的编辑页：
`https://xiumi.us/studio/v5#/paper/for/<草稿id>/cube/0`

## 3. 登录态复制失败的常见原因

源浏览器**正在运行**时，`Cookies`（`Default/Network/Cookies`）可能被独占锁定，复制不到。
表现：调试窗口里秀米提示「账户未登录」。
解法二选一：
1. 完全退出源浏览器 → `node scripts/launch-browser.mjs --fresh`；
2. 直接在调试窗口里扫码登录一次（登录态会保存在复制体里，下次复用）。

## 4. Playwright 依赖

`scripts/xiumi-lib.mjs` 用 `playwright-core`（**不要**下浏览器）。解析顺序：

1. 普通 `import('playwright-core')`（装在本目录或工作目录的 `node_modules` 里）；
2. 环境变量 `XIUMI_PW_CORE` = `.../node_modules/playwright-core`（或其上一级 `node_modules`）；
3. `~/.dsh/xiumi/playwright/node_modules/playwright-core`。

安装（不下载浏览器，秒装）：

```bash
cd scripts
npm i playwright-core
```

## 5. 裸 CDP（零依赖备选）

`scripts/cdp.mjs` 用 Node 内置 WebSocket 直接发 CDP 命令：
`targets` / `nav <url>` / `eval "<js>"` / `click x y` / `wheel dy` / `key z 2`（modifiers 2=Ctrl）/ `type <text>` / `shot`。
只适合探活、截图、单点调试；**批量流程用 `xiumi-lib.mjs` / `xiumi-gallery.mjs`**。
