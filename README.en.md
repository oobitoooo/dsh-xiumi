# dsh-xiumi · Xiumi (秀米) layout automation — DSH plugin / skill

Drive a **logged-in** browser's [Xiumi](https://xiumi.us) article editor with **Playwright + CDP**: batch-select photos, insert swipe galleries, replace pages one by one, change page counts, delete components, save and verify the share link's review status.

> This repo contains **only** the Xiumi layout automation — no API router / model proxy. Scripts connect to a local CDP port and send nothing outbound.

[中文](README.md)

## Why

- OS-level mouse injection (`SetCursorPos + mouse_event`, `SendInput`) often does nothing in Chromium-based browsers — CDP/Playwright is the reliable path.
- Xiumi's canvas is an AngularJS component tree with **virtualized rendering**: image counts change while scrolling, so naive click scripts fail.
- Turning a stack of vertical photos into a swipe gallery is **template insertion + per-page image replacement + page-count editing**; Xiumi exposes no one-click API for that. This project fixes the pipeline as a CLI.

## Features

- **Gallery conversion**: select N photos → insert a swipe component → set page count to N → replace each page with the original photo → delete the old vertical photos.
- **Arbitrary page counts**: bypass the unreachable "slide sequence" panel by editing the Angular model (`cellGroupItems`); persists after save.
- **Batch image replacement**: match gallery thumbnails by the `-sz_<bytes>` fingerprint embedded in the image URL.
- **Canvas snapshots / checks**: component count, per-gallery page list and fingerprints, to prove an operation really applied.
- **Save + review**: save the draft, then click "申请审核" (apply for review) and verify the public share page.
- **Native component paste** (v0.3.0): compile an article into Xiumi `paper.comp` components and paste the whole thing at once through Chromium's native clipboard — still fully editable afterwards (approach ported from [xiumi-native-clipboard](https://github.com/gih10012/xiumi-native-clipboard), MIT).
- **Layout audit** (v0.2.0): open the rendered share/editor page, read computed styles, and check body font size / line height, headings, **caption size and color consistency**, and image aspect ratios; emits Markdown + JSON reports.
- **Lightweight session transfer** (v0.2.0): export cookies + localStorage to `session.json` and inject it into any CDP browser — no full profile copy needed.
- **Multi-harness install** (v0.2.0): one command installs the skill into Claude Code / Cursor / Codex / Gemini, etc.

## Install

### A. As a DSH plugin (recommended)

```bash
dsh plugin add https://github.com/oobitoooo/dsh-xiumi
# or a local checkout:
dsh plugin add /path/to/dsh-xiumi
```

The plugin registers the bundled skill as a runtime skill for the current profile.

### B. As a plain skill

Copy `skill/` to `~/.dsh/skills/xiumi-editor-automation/` (or `.dsh/skills/` in a project).

### Dependencies

- Node.js ≥ 18
- `playwright-core` (does **not** download a browser):

```bash
cd skill/scripts && npm i playwright-core
```

## Quick start

```bash
cd skill/scripts
node launch-browser.mjs          # Edge/Chrome with --remote-debugging-port=9222 + copied login profile
# open https://xiumi.us/studio/v5#/paper/for/<draft-id>/cube/0 in that window
node xiumi-gallery.mjs status
node xiumi-gallery.mjs upload --files ./a.jpg,./b.jpg
node xiumi-gallery.mjs convert --art 36759,39683 --gal 93691,100113   # dry-run; add --yes to apply
node xiumi-gallery.mjs save
node xiumi-gallery.mjs verify --share https://v.xiumius.cn/board/v5/<x>/<id>
```

## Layout

```
dsh-xiumi/
├── lib/index.js            # DSH plugin entry: registers skill/ as a runtime skill
├── cordis.patch.yml        # DSH bundle patch
├── skill/
│   ├── SKILL.md            # model-facing skill body (core invariants)
│   ├── references/         # browser setup / DOM playbook / gallery recipe
│   └── scripts/            # launch-browser, xiumi-lib, xiumi-gallery, cdp
└── test/smoke.mjs
```

## Limitations

- Xiumi is a closed SaaS; selectors may break on redesign. They are centralized in `xiumi-lib.mjs` and documented in `references/dom-playbook.md`.
- Chromium-based browsers only (CDP).
- Browsers ≥136 refuse a debug port on the default profile; use a copied profile (handled). If the source browser is running, `Cookies` may stay locked — quit it or log in once inside the debug window.
- The Xiumi gallery has a capacity limit (often 100 images).
- Automates only actions you could do manually; comply with Xiumi's terms of service.

## Test

```bash
node test/smoke.mjs
```

## License

MIT

## Credits

- Native clipboard format and component builders adapted from [gih10012/xiumi-native-clipboard](https://github.com/gih10012/xiumi-native-clipboard) (MIT).
- Audit rule set inspired by [15369577595/xiumi-editor-checker](https://github.com/15369577595/xiumi-editor-checker).
