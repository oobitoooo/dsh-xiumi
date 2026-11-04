/**
 * 秀米原生组件构造器（paper.comp）
 *
 * 移植自 gih10012/xiumi-native-clipboard 的 `scripts/xiumi_components.py`
 * (MIT License, https://github.com/gih10012/xiumi-native-clipboard)，
 * 取其最小可用子集并改为本项目的 JS 风格：text / image / wrapper / row1 / row2 / document。
 * 原始版权：Copyright (c) gih10012 contributors.
 *
 * 这些组件可以直接通过「Chromium 原生剪贴板」塞进秀米编辑器，
 * 粘贴后是**可继续编辑**的原生组件，而不是图片截图。
 */
import crypto from 'node:crypto';

export const COMPS_MIME = 'application/xiumi-comps; category=paper.comp';
export const LABEL_MIME = 'application/xiumi-label; origin=studio';
export const SCHEMA_URL = 'https://gih10012.github.io/xiumi-native-clipboard/schema/xiumi-document.schema.json';
export const VIEWPORT = {
  WIDTH: 415,
  _BACKVIEW: '260533738:1721120895:18565098:78383942:1744288605:24',
  _FRONTVIEW: '255256073:1721183486:69042341:69042341:2000398190:4',
};

const uuid = (prefix = 'comp') => `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 文本组件：html 里用 <p>/<strong>/<span style>，字号用 % 相对基准 */
export function text(html, style = {}, componentStyle = {}) {
  return {
    _comp: {
      constraint: { opMenu: { 'text-merged': true }, pose: { resize: 'h' } },
      pose: {},
      style: clone(componentStyle),
      tplId: 'paper-cp:header/1-txt-normal',
      _$uuid: uuid('text'),
    },
    txt1: { type: 'text', text: html, style: clone(style), constraint: {} },
  };
}

/** 图片组件：src 可以是 秀米 CDN 永久地址，也可以是 data URI（内嵌图需走两轮上传流程） */
export function image(src, { width = '100%', componentStyle = {}, imageStyle = {} } = {}) {
  const outer = {
    textAlign: 'center', marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0', lineHeight: '0',
    ...clone(componentStyle),
  };
  const inner = { width, height: 'auto', maxWidth: '100%', ...clone(imageStyle) };
  return {
    _comp: {
      tplId: 'paper-cp:image/img-autowidth',
      constraint: { opMenu: { 'crop-image-merged': true }, pose: { resize: 'h' } },
      style: outer,
      pose: { position: 'static', width: null, height: null, zIndex: 1 },
      _$uuid: uuid('image'),
    },
    img1: { type: 'image', src, style: inner, constraint: {} },
  };
}

/** 弹性单列容器 */
export function wrapper(items, style = {}, cellStyle = {}) {
  return {
    _comp: {
      constraint: { pose: { resize: 'h' } },
      pose: {},
      style: clone(style),
      tplId: 'paper-cp:layout/wrapper-flex',
      _$uuid: uuid('wrapper'),
      _viewport: clone(VIEWPORT),
    },
    col1: { type: 'container', constraint: { childLayout: 'static', containerUsage: 'flex-box' }, items: [...items], style: clone(cellStyle) },
  };
}

/** 一行一列（带背景/圆角的卡片） */
export function row1(items, style = {}, cellStyle = {}) {
  const rootStyle = { textAlign: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', ...clone(style) };
  const contentStyle = { width: '100%', verticalAlign: 'top', alignSelf: 'flex-start', flex: '0 0 auto', height: 'auto', ...clone(cellStyle) };
  return {
    _comp: {
      constraint: { pose: { resize: 'h' }, opMenu: { 'group-cell-merged': true } },
      style: rootStyle,
      tplId: 'paper-cp:layout/row1-r1c1',
      pose: { position: 'static', width: null, height: null },
      _$uuid: uuid('row1'),
      _viewport: clone(VIEWPORT),
    },
    col1: { type: 'group', constraint: { childLayout: 'static' }, items: [...items], style: contentStyle },
  };
}

/** 两列并排 */
export function row2(leftItems, rightItems, { leftStyle = {}, rightStyle = {}, style = {}, gap = '6px' } = {}) {
  const base = { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' };
  return {
    _comp: {
      constraint: { pose: { resize: 'h' }, opMenu: { 'group-cell-merged': true } },
      style: { ...base, ...clone(style) },
      tplId: 'paper-cp:layout/row1-r1c2',
      pose: { position: 'static', width: null, height: null },
      _$uuid: uuid('row2'),
      _viewport: clone(VIEWPORT),
    },
    col1: { type: 'group', constraint: { childLayout: 'static' }, style: { width: '50%', flex: '1 1 0%', marginRight: gap, ...clone(leftStyle) }, items: [...leftItems] },
    col2: { type: 'group', constraint: { childLayout: 'static' }, style: { width: '50%', flex: '1 1 0%', marginLeft: gap, ...clone(rightStyle) }, items: [...rightItems] },
  };
}

/** 组装成可粘贴的文档（clipboard 里就是秀米要的 paper.comp JSON） */
export function document(title, slices, { labelUid = null, meta = {} } = {}) {
  const metadata = { title, previewWidth: 415, createdAt: new Date().toISOString(), generator: 'dsh-xiumi/clip', ...clone(meta) };
  const formats = [{
    mime: COMPS_MIME,
    encoding: 'json',
    data: {
      version: 5, deskVersion: 5, type: 'paper', category: 'comp', pageRuntimeKey: -1,
      _comp: { style: null },
      slices: [...slices],
    },
  }];
  if (labelUid) formats.push({ mime: LABEL_MIME, encoding: 'json', data: { timestamp: '$now', user: { unique_uid: labelUid } } });
  return {
    $schema: SCHEMA_URL,
    format: 'xiumi-native-clipboard',
    formatVersion: 1,
    meta: metadata,
    clipboard: { refreshLabelTimestamp: true, formats },
  };
}

/**
 * 把「简单 spec」编译成文档。
 * spec = { title, blocks: [ {type:'heading'|'text'|'image'|'card'|'row2', ...} ] }
 */
export function compileSpec(spec) {
  const slices = [];
  for (const b of spec.blocks || []) {
    if (b.type === 'heading') {
      slices.push(wrapper([text(`<p><strong>${escapeHtml(b.text)}</strong></p>`, { textAlign: 'center', fontSize: '150%', lineHeight: '1.6', letterSpacing: '1px', color: b.color || 'rgb(74,124,89)' })], { padding: b.padding || '24px 18px 6px' }));
    } else if (b.type === 'text') {
      const html = b.html || `<p>${escapeHtml(b.text || '')}</p>`;
      slices.push(wrapper([text(html, { fontSize: b.size || '100%', lineHeight: b.lineHeight || '1.8', color: b.color || 'rgb(62,62,62)', letterSpacing: b.letterSpacing || '0.5px', textAlign: b.align || 'justify', textIndent: b.indent || '0' })], { padding: b.padding || '8px 18px' }));
    } else if (b.type === 'image') {
      slices.push(image(b.src, { componentStyle: { margin: b.margin || '14px 18px' } }));
    } else if (b.type === 'card') {
      slices.push(row1([text(b.html || `<p><strong>${escapeHtml(b.title || '')}</strong></p><p>${escapeHtml(b.text || '')}</p>`, { textAlign: 'center', fontSize: '105%', lineHeight: '1.8', color: b.color || 'rgb(74,124,89)' })], { margin: b.margin || '12px 18px 20px' }, { padding: b.padding || '18px 14px', backgroundColor: b.bg || 'rgb(248,251,248)', borderRadius: b.radius || '14px' }));
    } else if (b.type === 'row2') {
      const mk = (c) => text(c.html || `<p><strong>${escapeHtml(c.title || '')}</strong></p><p>${escapeHtml(c.text || '')}</p>`, { textAlign: 'center', fontSize: '100%', lineHeight: '1.7', color: c.color || 'rgb(74,124,89)' });
      slices.push(row2([mk(b.left || {})], [mk(b.right || {})], {
        style: { margin: b.margin || '12px 18px 20px' },
        leftStyle: { padding: '14px 10px', backgroundColor: (b.left && b.left.bg) || 'rgb(248,251,248)', borderRadius: '12px' },
        rightStyle: { padding: '14px 10px', backgroundColor: (b.right && b.right.bg) || 'rgb(232,244,236)', borderRadius: '12px' },
      }));
    }
  }
  return document(spec.title || '未命名', slices, { labelUid: spec.labelUid || null, meta: spec.meta || {} });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
