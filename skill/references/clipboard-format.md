# 秀米原生组件剪贴板格式（简版）

> 移植/改写自 [gih10012/xiumi-native-clipboard](https://github.com/gih10012/xiumi-native-clipboard)（MIT）。
> 上游有完整格式规范与 Python 实现；本文件只记录**跑通本项目所需**的最小集合。

## 1. 总体链路

```
spec.json ──(compileSpec)──▶ .xiumi.json ──(本地页 + 真实 Ctrl+C)──▶ 系统剪贴板
      ──(秀米编辑器 Ctrl+V)──▶ 可继续编辑的原生组件
```

剪贴板里必须有两种键：

| MIME | 内容 |
|---|---|
| `application/xiumi-comps; category=paper.comp` | JSON：`{version:5, deskVersion:5, type:'paper', category:'comp', pageRuntimeKey:-1, _comp:{style:null}, slices:[组件…]}` |
| `application/xiumi-label; origin=studio`（可选） | `{timestamp:'$now', user:{unique_uid}}`；**没有真实 UID 就不要放**，否则秀米可能判定为别人账号的数据而拒绝 |

> Chromium 只接受**真实按键**产生的 copy 事件（`event.isTrusted === true`）。
> 所以流程是：打开复制页 → 真实按 `Ctrl+C`（`xiumi-clip.mjs push` 用 Playwright 发真实按键）→ 切到编辑器按 `Ctrl+V`。

## 2. 组件最小结构

所有组件都是 `{"_comp": {...}, "<cell>": {...}}`：

```js
// 文本
{"_comp": {"tplId": "paper-cp:header/1-txt-normal", "_$uuid": "text-xxxx", "constraint": {"opMenu": {"text-merged": true}, "pose": {"resize": "h"}}, "pose": {}, "style": {}},
 "txt1": {"type": "text", "text": "<p><strong>标题</strong></p>", "style": {"fontSize": "150%", "lineHeight": "1.6", "color": "rgb(74,124,89)"}, "constraint": {}}}

// 图片（img-autowidth：宽 100%，高度按原图比例；不会裁切）
{"_comp": {"tplId": "paper-cp:image/img-autowidth", "pose": {"position": "static", "width": null, "height": null, "zIndex": 1}, "style": {"textAlign": "center", "lineHeight": "0"}, "_$uuid": "image-xxxx"},
 "img1": {"type": "image", "src": "https://png.xiumi.us/…", "style": {"width": "100%", "height": "auto", "maxWidth": "100%"}, "constraint": {}}}

// 容器：layout/wrapper-flex（col1.type=container） / layout/row1-r1c1（col1.type=group） / layout/row1-r1c2（col1+col2）
{"_comp": {"tplId": "paper-cp:layout/wrapper-flex", "_viewport": {"WIDTH": 415}, "_$uuid": "wrapper-xxxx", "constraint": {"pose": {"resize": "h"}}, "pose": {}, "style": {"padding": "10px 18px"}},
 "col1": {"type": "container", "constraint": {"childLayout": "static", "containerUsage": "flex-box"}, "items": [/* 组件 */], "style": {}}}
```

要点：
- 每个 `_comp` 必须有唯一 `_$uuid`。
- `_viewport.WIDTH = 415`，字号用百分比（相对基准字号）最稳。
- 卡片/并排用 `row1-r1c1` / `row1-r1c2`，单元格 `col1/col2` 是 `type: "group"`。
- 图片用秀米 CDN 的**永久地址**最省事：一次粘贴即完成；用 `data:` 内嵌图则要走"先只上传图片、再复制正文"的两轮流程（本项目的 CLI 暂不实现两轮）。

## 3. 本项目对应实现

| 文件 | 作用 |
|---|---|
| `scripts/xiumi-components.mjs` | `text / image / wrapper / row1 / row2 / document / compileSpec` |
| `scripts/xiumi-clip.mjs` | `demo / build / push / serve`：起本地复制页 → 真实 Ctrl+C → 切编辑器 Ctrl+V → 用组件数核对 |
| `assets/clip-copy.html` | 复制页：监听 `copy` 事件，把各 format 写进 `event.clipboardData` |

## 4. 已知限制

- 依赖秀米内部组件 schema，秀米改版可能失效（上游同样如此）。
- 只支持 Chromium 系浏览器（Edge/Chrome）。
- 两轮图片上传（`data:` 内嵌图 → 秀米转永久地址）尚未实现，当前建议直接给远程图片 URL。
