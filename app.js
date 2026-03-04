// app.js
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];

const state = {
  tool: '',
  file: null,
  name: 'image',
  ext: 'png',
  img: null,
  w: 0,
  h: 0,
  baseCanvas: null,
  baseCtx: null,
  canvas: $('#canvas'),
  ctx: $('#canvas').getContext('2d', { willReadFrequently: true }),
  overlay: $('#overlay'),
  octx: $('#overlay').getContext('2d'),
  applied: {
    rotation: 0,
    flipH: false,
    flipV: false,
    filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0, sharpen: 0 },
    watermark: { mode: 'text', text: 'NEON', size: 42, opacity: 0.45, pos: 'br', img: null, scale: 0.28 },
    crop: null,
    resize: null,
    export: { format: 'png', quality: 0.92 }
  },
  ui: {
    home: $('#home'),
    tool: $('#tool'),
    controls: $('#controls'),
    toolTitle: $('#toolTitle'),
    toolSubtitle: $('#toolSubtitle'),
    miniInfo: $('#miniInfo'),
    toast: $('#toast'),
    chipDim: $('#chipDim'),
    chipFmt: $('#chipFmt'),
    dropzone: $('#dropzone'),
    fileInput: $('#fileInput')
  },
  cropUI: {
    active: false,
    rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    drag: null,
    handle: null
  },
  mp: { loaded: false, selfie: null }
};

const toolMeta = {
  crop: { title: 'Crop', sub: 'Drag the crop box, resize handles, then export.' },
  resize: { title: 'Resize', sub: 'Set width/height, lock aspect, then export.' },
  convert: { title: 'Convert', sub: 'Choose a format and export.' },
  compress: { title: 'Compress', sub: 'Adjust quality, preview, then export.' },
  bgremove: { title: 'Remove Background', sub: 'In-browser segmentation, then export PNG/WebP.' },
  rotate: { title: 'Rotate & Flip', sub: 'Rotate, flip, then export.' },
  watermark: { title: 'Watermark', sub: 'Add text or image watermark, then export.' },
  filters: { title: 'Filters', sub: 'Adjust sliders with live preview, then export.' },
  metadata: { title: 'Metadata', sub: 'View EXIF, strip, add PNG text metadata.' },
  editor: { title: 'Editor', sub: 'All-in-one adjustments with live preview and export.' }
};

function setRoute(hash) {
  const t = (hash || location.hash || '#').replace('#', '').trim();
  if (!t) return showHome();
  if (!toolMeta[t]) return showHome();
  state.tool = t;
  showTool(t);
}

function showHome() {
  state.ui.home.style.display = 'block';
  state.ui.tool.style.display = 'none';
  state.ui.miniInfo.textContent = '';
}

function showTool(t) {
  state.ui.home.style.display = 'none';
  state.ui.tool.style.display = 'block';
  state.ui.toolTitle.textContent = toolMeta[t].title;
  state.ui.toolSubtitle.textContent = toolMeta[t].sub;
  renderControls(t);
  resizeCanvasesToWrap();
  renderPreview();
}

function toast(title, msg) {
  const el = state.ui.toast;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong> <span>${escapeHtml(msg)}</span>`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

function baseName(name) {
  const p = name.split('/').pop();
  const dot = p.lastIndexOf('.');
  if (dot <= 0) return p || 'image';
  return p.slice(0, dot);
}

function extFromType(type) {
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return 'png';
}

function bindGlobalUI() {
  $('#goHome').addEventListener('click', () => { location.hash = ''; showHome(); });
  $('#btnBack').addEventListener('click', () => { location.hash = ''; showHome(); });
  $('#btnOpenFile').addEventListener('click', () => state.ui.fileInput.click());
  $('#btnReset').addEventListener('click', () => resetAdjustments());
  state.ui.fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) await loadFile(f);
    e.target.value = '';
  });

  window.addEventListener('hashchange', () => setRoute(location.hash));
  window.addEventListener('resize', () => { resizeCanvasesToWrap(); renderPreview(); });

  const dz = state.ui.dropzone;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) await loadFile(f);
  });

  $('#btnExport').addEventListener('click', () => exportImage());

  bindCropOverlay();
}

function resetAdjustments() {
  state.applied.rotation = 0;
  state.applied.flipH = false;
  state.applied.flipV = false;
  state.applied.filters = { brightness: 100, contrast: 100, saturation: 100, blur: 0, sharpen: 0 };
  state.applied.watermark = { mode: 'text', text: 'NEON', size: 42, opacity: 0.45, pos: 'br', img: null, scale: 0.28 };
  state.applied.crop = null;
  state.applied.resize = null;
  state.applied.export = { format: 'png', quality: 0.92 };
  state.cropUI.rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  toast('Reset', 'Adjustments cleared.');
  renderControls(state.tool);
  renderPreview();
}

async function loadFile(file) {
  if (!file.type.startsWith('image/')) { toast('Upload', 'Please choose an image file.'); return; }
  state.file = file;
  state.name = baseName(file.name || 'image');
  state.ext = extFromType(file.type);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = rej; img.src = url;
  }).catch(() => null);
  URL.revokeObjectURL(url);
  if (!img.naturalWidth || !img.naturalHeight) { toast('Upload', 'Could not read the image.'); return; }

  state.img = img;
  state.w = img.naturalWidth;
  state.h = img.naturalHeight;

  state.baseCanvas = document.createElement('canvas');
  state.baseCanvas.width = state.w;
  state.baseCanvas.height = state.h;
  state.baseCtx = state.baseCanvas.getContext('2d', { willReadFrequently: true });
  state.baseCtx.drawImage(img, 0, 0);

  state.applied.crop = null;
  state.applied.resize = null;

  state.ui.chipDim.textContent = `${state.w}×${state.h}`;
  state.ui.chipFmt.textContent = (file.type || 'image/*').replace('image/', '').toUpperCase();

  toast('Loaded', `${state.w}×${state.h} ready.`);
  renderControls(state.tool);
  renderPreview();
}

function resizeCanvasesToWrap() {
  const wrap = state.canvas.parentElement;
  const r = wrap.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const w = Math.max(320, Math.floor(r.width * dpr));
  const h = Math.max(200, Math.floor(r.height * dpr));
  if (state.canvas.width !== w || state.canvas.height !== h) {
    state.canvas.width = w; state.canvas.height = h;
    state.overlay.width = w; state.overlay.height = h;
  }
}

function renderControls(tool) {
  const c = state.ui.controls;
  c.innerHTML = '';
  if (!tool) return;

  if (!state.img) {
    c.appendChild(group('Status', [
      infoLine('No image loaded', 'Upload or drop an image to start.')
    ]));
    return;
  }

  if (tool === 'crop') c.appendChild(ctrlCrop());
  if (tool === 'resize') c.appendChild(ctrlResize());
  if (tool === 'convert') c.appendChild(ctrlConvert(false));
  if (tool === 'compress') c.appendChild(ctrlConvert(true));
  if (tool === 'bgremove') c.appendChild(ctrlBgRemove());
  if (tool === 'rotate') c.appendChild(ctrlRotateFlip());
  if (tool === 'watermark') c.appendChild(ctrlWatermark());
  if (tool === 'filters') c.appendChild(ctrlFilters());
  if (tool === 'metadata') c.appendChild(ctrlMetadata());
  if (tool === 'editor') c.appendChild(ctrlEditor());

  c.appendChild(group('Export', [
    exportFormatRow(tool),
    exportQualityRow(tool)
  ]));
}

function group(title, nodes) {
  const g = document.createElement('div');
  g.className = 'group';
  const h = document.createElement('div');
  h.className = 'groupTitle';
  h.innerHTML = `<span>${escapeHtml(title)}</span><span class="badge">Live</span>`;
  g.appendChild(h);
  nodes.filter(Boolean).forEach(n => g.appendChild(n));
  return g;
}

function infoLine(a, b) {
  const d = document.createElement('div');
  d.className = 'small';
  d.innerHTML = `<div><span class="mono">${escapeHtml(a)}</span></div><div>${escapeHtml(b)}</div>`;
  return d;
}

function field(label, el) {
  const f = document.createElement('div');
  f.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  f.appendChild(l);
  f.appendChild(el);
  return f;
}

function row2(a, b) {
  const r = document.createElement('div');
  r.className = 'row';
  r.appendChild(a);
  r.appendChild(b);
  return r;
}

function toggle(text, on, cb) {
  const t = document.createElement('div');
  t.className = 'tgl' + (on ? ' on' : '');
  t.innerHTML = `<span class="tiny">${escapeHtml(text)}</span>`;
  t.addEventListener('click', () => { cb(!t.classList.contains('on')); });
  return t;
}

function slider(labelText, min, max, step, value, cb, suffix = '') {
  const wrap = document.createElement('div');
  const s = document.createElement('input');
  s.type = 'range';
  s.min = min; s.max = max; s.step = step;
  s.value = value;
  const v = document.createElement('div');
  v.className = 'sval';
  v.textContent = `${value}${suffix}`;
  s.addEventListener('input', () => {
    v.textContent = `${s.value}${suffix}`;
    cb(parseFloat(s.value));
  });
  wrap.className = 'slider';
  wrap.appendChild(s);
  wrap.appendChild(v);
  return field(labelText, wrap);
}

function btn(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ` ${cls}` : '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function btnRow(...buttons) {
  const r = document.createElement('div');
  r.className = 'btnRow';
  buttons.forEach(b => r.appendChild(b));
  return r;
}

function ctrlCrop() {
  state.cropUI.active = true;

  const apply = btn('Apply Crop', 'primary', () => {
    const r = state.cropUI.rect;
    state.applied.crop = { ...r };
    toast('Crop', 'Crop applied to export.');
    renderPreview();
  });

  const reset = btn('Reset Box', '', () => {
    state.cropUI.rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    state.applied.crop = null;
    toast('Crop', 'Crop box reset.');
    renderPreview();
  });

  const snap = btn('Center 1:1', '', () => {
    const ar = 1;
    let w = 0.6, h = w / ar;
    if (h > 0.8) { h = 0.8; w = h * ar; }
    state.cropUI.rect = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    toast('Crop', 'Centered square.');
    renderPreview();
  });

  const note = infoLine('Drag & resize', 'Use corners/edges. Export uses applied crop.');

  return group('Crop', [note, btnRow(apply, reset, snap)]);
}

function ctrlResize() {
  state.cropUI.active = false;
  const wIn = document.createElement('input');
  wIn.type = 'number';
  wIn.min = 1;
  wIn.value = state.applied.resize?.w || state.w;

  const hIn = document.createElement('input');
  hIn.type = 'number';
  hIn.min = 1;
  hIn.value = state.applied.resize?.h || state.h;

  const lock = document.createElement('div');
  const isLocked = state.applied.resize?.lock ?? true;
  lock.appendChild(toggle('Lock aspect ratio', isLocked, (v) => {
    lock.querySelector('.tgl').classList.toggle('on', v);
    if (!state.applied.resize) state.applied.resize = { w: parseInt(wIn.value, 10), h: parseInt(hIn.value, 10), lock: v };
    state.applied.resize.lock = v;
    if (v) {
      const ar = state.w / state.h;
      hIn.value = Math.max(1, Math.round(parseInt(wIn.value, 10) / ar));
      state.applied.resize.h = parseInt(hIn.value, 10);
    }
    renderPreview();
  }));

  const applyNow = () => {
    const w = Math.max(1, parseInt(wIn.value || '1', 10));
    const h = Math.max(1, parseInt(hIn.value || '1', 10));
    const lockOn = lock.querySelector('.tgl').classList.contains('on');
    state.applied.resize = { w, h, lock: lockOn };
    renderPreview();
  };

  const ar = state.w / state.h;
  wIn.addEventListener('input', () => {
    const lockOn = lock.querySelector('.tgl').classList.contains('on');
    if (lockOn) hIn.value = Math.max(1, Math.round(parseInt(wIn.value || '1', 10) / ar));
    applyNow();
  });
  hIn.addEventListener('input', () => {
    const lockOn = lock.querySelector('.tgl').classList.contains('on');
    if (lockOn) wIn.value = Math.max(1, Math.round(parseInt(hIn.value || '1', 10) * ar));
    applyNow();
  });

  const presetHalf = btn('50%', '', () => {
    wIn.value = Math.max(1, Math.round(state.w * 0.5));
    hIn.value = Math.max(1, Math.round(state.h * 0.5));
    applyNow();
    toast('Resize', 'Set to 50%.');
  });
  const preset1080 = btn('Fit 1080p', '', () => {
    const maxW = 1920, maxH = 1080;
    const s = Math.min(maxW / state.w, maxH / state.h, 1);
    wIn.value = Math.max(1, Math.round(state.w * s));
    hIn.value = Math.max(1, Math.round(state.h * s));
    applyNow();
    toast('Resize', 'Fit within 1920×1080.');
  });
  const reset = btn('Reset', '', () => {
    wIn.value = state.w; hIn.value = state.h;
    state.applied.resize = null;
    renderPreview();
    toast('Resize', 'Reset to original.');
  });

  const note = infoLine('Resize', 'Live preview reflects resize for export.');
  return group('Resize', [
    note,
    row2(field('Width', wIn), field('Height', hIn)),
    lock,
    btnRow(presetHalf, preset1080, reset)
  ]);
}

function ctrlConvert(showSize) {
  state.cropUI.active = false;

  const sel = document.createElement('select');
  const opts = [
    { v: 'png', t: 'PNG (lossless)' },
    { v: 'jpg', t: 'JPG (lossy)' },
    { v: 'webp', t: 'WebP (lossy)' }
  ];
  opts.forEach(o => {
    const op = document.createElement('option');
    op.value = o.v; op.textContent = o.t;
    sel.appendChild(op);
  });
  sel.value = state.applied.export.format || 'png';
  sel.addEventListener('change', () => {
    state.applied.export.format = sel.value;
    renderControls(state.tool);
    renderPreview();
  });

  const q = slider('Quality', 0.2, 1, 0.01, state.applied.export.quality ?? 0.92, (v) => {
    state.applied.export.quality = v;
    renderPreview();
    if (showSize) estimateSize();
  });

  const note = infoLine(showSize ? 'Compress' : 'Convert', showSize ? 'Adjust quality and export.' : 'Pick a format and export.');
  const sline = showSize ? infoLine('Estimate', 'Export size updates after changes.') : null;

  const box = group(showSize ? 'Compress' : 'Convert', [
    note,
    field('Format', sel),
    (state.applied.export.format !== 'png') ? q : infoLine('Quality', 'Lossless PNG ignores quality.'),
    sline
  ]);

  if (showSize) setTimeout(() => estimateSize(), 50);
  return box;
}

function ctrlRotateFlip() {
  state.cropUI.active = false;

  const rL = btn('Rotate -90°', '', () => { state.applied.rotation = (state.applied.rotation - 90 + 360) % 360; renderPreview(); });
  const rR = btn('Rotate +90°', '', () => { state.applied.rotation = (state.applied.rotation + 90) % 360; renderPreview(); });
  const fh = btn('Flip Horizontal', '', () => { state.applied.flipH = !state.applied.flipH; renderPreview(); });
  const fv = btn('Flip Vertical', '', () => { state.applied.flipV = !state.applied.flipV; renderPreview(); });
  const reset = btn('Reset', '', () => { state.applied.rotation = 0; state.applied.flipH = false; state.applied.flipV = false; renderPreview(); toast('Rotate', 'Reset.'); });

  return group('Rotate & Flip', [
    infoLine('Transforms', 'Preview matches export.'),
    btnRow(rL, rR, fh, fv, reset)
  ]);
}

function ctrlWatermark() {
  state.cropUI.active = false;

  const modeWrap = document.createElement('div');
  modeWrap.className = 'toggleRow';
  const tText = toggle('Text', state.applied.watermark.mode === 'text', (on) => {
    if (on) { state.applied.watermark.mode = 'text'; renderControls(state.tool); renderPreview(); }
  });
  const tImg = toggle('Image', state.applied.watermark.mode === 'image', (on) => {
    if (on) { state.applied.watermark.mode = 'image'; renderControls(state.tool); renderPreview(); }
  });
  modeWrap.appendChild(tText);
  modeWrap.appendChild(tImg);

  const controls = [];

  if (state.applied.watermark.mode === 'text') {
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.value = state.applied.watermark.text || 'NEON';
    txt.addEventListener('input', () => { state.applied.watermark.text = txt.value; renderPreview(); });

    const size = slider('Text size', 10, 180, 1, state.applied.watermark.size || 42, (v) => {
      state.applied.watermark.size = v; renderPreview();
    }, 'px');

    controls.push(field('Text', txt), size);
  } else {
    const up = btn('Upload watermark image', 'primary', async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.decoding = 'async';
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; }).catch(() => null);
      URL.revokeObjectURL(url);
      if (!im.naturalWidth) return;
      state.applied.watermark.img = im;
      toast('Watermark', 'Image watermark loaded.');
      renderPreview();
    });
    const sc = slider('Watermark scale', 0.05, 0.7, 0.01, state.applied.watermark.scale ?? 0.28, (v) => {
      state.applied.watermark.scale = v; renderPreview();
    });
    controls.push(up, sc);
  }

  const op = slider('Opacity', 0.05, 1, 0.01, state.applied.watermark.opacity ?? 0.45, (v) => {
    state.applied.watermark.opacity = v; renderPreview();
  });

  const pos = document.createElement('select');
  [
    ['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'], ['c', 'Center']
  ].forEach(([v, t]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; pos.appendChild(o);
  });
  pos.value = state.applied.watermark.pos || 'br';
  pos.addEventListener('change', () => { state.applied.watermark.pos = pos.value; renderPreview(); });

  const onOff = toggle('Enable watermark', !!state.applied.watermark.enabled, (v) => {
    state.applied.watermark.enabled = v;
    renderPreview();
  });

  const reset = btn('Reset', '', () => {
    state.applied.watermark = { mode: 'text', text: 'NEON', size: 42, opacity: 0.45, pos: 'br', img: null, scale: 0.28, enabled: true };
    renderControls(state.tool);
    renderPreview();
    toast('Watermark', 'Reset.');
  });

  return group('Watermark', [
    infoLine('Overlay', 'Text or image watermark on export.'),
    onOff,
    modeWrap,
    ...controls,
    op,
    field('Position', pos),
    btnRow(reset)
  ]);
}

function ctrlFilters() {
  state.cropUI.active = false;
  const f = state.applied.filters;

  const b = slider('Brightness', 0, 200, 1, f.brightness, (v) => { f.brightness = v; renderPreview(); });
  const c = slider('Contrast', 0, 200, 1, f.contrast, (v) => { f.contrast = v; renderPreview(); });
  const s = slider('Saturation', 0, 200, 1, f.saturation, (v) => { f.saturation = v; renderPreview(); });
  const bl = slider('Blur', 0, 18, 0.1, f.blur, (v) => { f.blur = v; renderPreview(); }, 'px');
  const sh = slider('Sharpen', 0, 100, 1, f.sharpen, (v) => { f.sharpen = v; renderPreview(); });

  const reset = btn('Reset', '', () => {
    state.applied.filters = { brightness: 100, contrast: 100, saturation: 100, blur: 0, sharpen: 0 };
    renderControls(state.tool);
    renderPreview();
    toast('Filters', 'Reset.');
  });

  return group('Filters', [
    infoLine('Adjustments', 'Applies to preview and export.'),
    b, c, s, bl, sh,
    btnRow(reset)
  ]);
}

function ctrlBgRemove() {
  state.cropUI.active = false;

  const note = infoLine('Background removal', 'Best on portraits; exports with transparency.');

  const go = btn('Remove Background', 'primary', async () => {
    await ensureSelfieSegmentation();
    if (!state.mp.selfie) { toast('BG Remove', 'Segmentation not available.'); return; }
    toast('BG Remove', 'Processing…');
    await removeBackground();
    toast('BG Remove', 'Done. Export PNG/WebP for transparency.');
  });

  const hint = infoLine('Tip', 'If result looks rough, try a higher-resolution image.');

  return group('Remove Background', [note, btnRow(go), hint]);
}

function ctrlMetadata() {
  state.cropUI.active = false;

  const exifBox = document.createElement('div');
  exifBox.className = 'group';
  exifBox.innerHTML = `<div class="groupTitle"><span>EXIF</span><span class="badge">View</span></div><div class="small" id="exifOut">Loading…</div>`;

  const strip = btn('Strip metadata (re-encode)', 'primary', async () => {
    state.applied.export.format = 'png';
    state.applied.export.quality = 0.92;
    renderControls(state.tool);
    toast('Metadata', 'Exporting a clean PNG removes EXIF.');
    await exportImage({ forceFormat: 'png', forceName: `${state.name}_clean` });
  });

  const tTitle = document.createElement('input');
  tTitle.type = 'text';
  tTitle.value = '';
  const tAuthor = document.createElement('input');
  tAuthor.type = 'text';
  tAuthor.value = '';

  const addPngText = btn('Export PNG with text metadata', '', async () => {
    const title = tTitle.value.trim();
    const author = tAuthor.value.trim();
    const blob = await renderToBlob('png', 0.92);
    const withText = await addPngTextChunks(blob, { Title: title, Author: author });
    downloadBlob(withText, `${state.name}_meta.png`);
    toast('Metadata', 'PNG exported with text chunks.');
  });

  const wrap = group('Metadata', [
    infoLine('Change metadata', 'Viewing EXIF, stripping by re-encoding, and adding PNG text fields.'),
    btnRow(strip),
    document.createElement('div')
  ]);

  const metaFields = document.createElement('div');
  metaFields.className = 'row';
  metaFields.appendChild(field('Title (PNG)', tTitle));
  metaFields.appendChild(field('Author (PNG)', tAuthor));
  wrap.appendChild(metaFields);
  wrap.appendChild(btnRow(addPngText));

  setTimeout(() => loadExifInto(exifBox.querySelector('#exifOut')), 40);
  const outer = document.createElement('div');
  outer.appendChild(wrap);
  outer.appendChild(exifBox);
  return outer;
}

function ctrlEditor() {
  state.cropUI.active = false;

  const pick = document.createElement('select');
  const modes = [
    ['quick', 'Quick: Filters + Watermark'],
    ['transform', 'Transform: Rotate/Flip + Resize'],
    ['crop', 'Crop: Draggable crop box'],
    ['all', 'All: Everything enabled']
  ];
  modes.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; pick.appendChild(o); });
  pick.value = state._editorMode || 'all';
  pick.addEventListener('change', () => {
    state._editorMode = pick.value;
    state.cropUI.active = (pick.value === 'crop' || pick.value === 'all');
    renderControls(state.tool);
    renderPreview();
  });

  const modeBox = group('Editor Mode', [
    infoLine('All-in-one', 'Use the editor mode selector plus tool controls below.'),
    field('Mode', pick)
  ]);

  const blocks = [modeBox];

  const mode = state._editorMode || 'all';
  if (mode === 'quick' || mode === 'all') {
    blocks.push(ctrlFilters(), ctrlWatermark());
  }
  if (mode === 'transform' || mode === 'all') {
    blocks.push(ctrlRotateFlip(), ctrlResize());
  }
  if (mode === 'crop' || mode === 'all') {
    blocks.push(ctrlCrop());
  }

  const wrap = document.createElement('div');
  blocks.forEach(b => wrap.appendChild(b));
  return wrap;
}

function exportFormatRow(tool) {
  const sel = document.createElement('select');
  const allowAlpha = (state.tool === 'bgremove' || state.tool === 'watermark' || state.tool === 'filters' || state.tool === 'crop' || state.tool === 'editor' || state.tool === 'metadata' || state.tool === 'rotate' || state.tool === 'resize' || state.tool === 'convert' || state.tool === 'compress');
  const opts = [
    { v: 'png', t: 'PNG' },
    { v: 'jpg', t: 'JPG' },
    { v: 'webp', t: 'WebP' }
  ];
  opts.forEach(o => {
    const op = document.createElement('option');
    op.value = o.v; op.textContent = o.t;
    sel.appendChild(op);
  });
  sel.value = state.applied.export.format || 'png';
  sel.addEventListener('change', () => {
    state.applied.export.format = sel.value;
    renderControls(state.tool);
    renderPreview();
  });

  const info = document.createElement('div');
  info.className = 'small';
  if (!allowAlpha) info.textContent = '';
  else info.textContent = (sel.value === 'jpg') ? 'JPG has no transparency.' : 'PNG/WebP can keep transparency.';

  const wrap = document.createElement('div');
  wrap.appendChild(field('Export format', sel));
  wrap.appendChild(info);
  return wrap;
}

function exportQualityRow(tool) {
  const f = state.applied.export.format || 'png';
  if (f === 'png') return infoLine('Quality', 'Lossless PNG ignores quality.');

  return slider('Export quality', 0.2, 1, 0.01, state.applied.export.quality ?? 0.92, (v) => {
    state.applied.export.quality = v;
    renderPreview();
  });
}

async function estimateSize() {
  if (!state.img) return;
  const f = state.applied.export.format || 'jpg';
  const q = (f === 'png') ? 0.92 : (state.applied.export.quality ?? 0.92);
  const blob = await renderToBlob(f, q).catch(() => null);
  if (!blob) return;
  state.ui.miniInfo.textContent = `Estimated export: ${fmtBytes(blob.size)}`;
}

function bindCropOverlay() {
  const ov = state.overlay;
  const pointer = (e) => {
    const r = ov.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return { x, y };
  };

  const hit = (p) => {
    const r = state.cropUI.rect;
    const pad = 0.02;
    const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;

    const near = (a, b) => Math.abs(a - b) <= pad;
    const inside = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

    const handles = [
      { id: 'tl', x: x0, y: y0 },
      { id: 'tr', x: x1, y: y0 },
      { id: 'bl', x: x0, y: y1 },
      { id: 'br', x: x1, y: y1 },
      { id: 'l', x: x0, y: (y0 + y1) / 2 },
      { id: 'r', x: x1, y: (y0 + y1) / 2 },
      { id: 't', x: (x0 + x1) / 2, y: y0 },
      { id: 'b', x: (x0 + x1) / 2, y: y1 }
    ];
    for (const h of handles) {
      if (near(p.x, h.x) && near(p.y, h.y)) return { type: 'handle', id: h.id };
    }
    if (inside) return { type: 'move' };
    return { type: 'none' };
  };

  const clampRect = () => {
    let r = state.cropUI.rect;
    r.w = Math.max(0.05, Math.min(0.98, r.w));
    r.h = Math.max(0.05, Math.min(0.98, r.h));
    r.x = Math.max(0.01, Math.min(0.99 - r.w, r.x));
    r.y = Math.max(0.01, Math.min(0.99 - r.h, r.y));
  };

  const onDown = (e) => {
    if (!state.cropUI.active || !state.img) return;
    ov.setPointerCapture(e.pointerId);
    const p = pointer(e);
    const h = hit(p);
    state.cropUI.drag = { start: p, rect: { ...state.cropUI.rect } };
    state.cropUI.handle = h.type === 'handle' ? h.id : null;
    state.cropUI.moving = (h.type === 'move');
    state.cropUI.resizing = (h.type === 'handle');
  };

  const onMove = (e) => {
    if (!state.cropUI.active || !state.img) return;
    const p = pointer(e);
    const r0 = state.cropUI.drag?.rect;
    const s0 = state.cropUI.drag?.start;
    if (!r0 || !s0) {
      renderOverlay();
      return;
    }
    const dx = p.x - s0.x;
    const dy = p.y - s0.y;

    let r = { ...r0 };

    if (state.cropUI.moving) {
      r.x += dx;
      r.y += dy;
    } else if (state.cropUI.resizing) {
      const id = state.cropUI.handle;
      const x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;

      let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
      if (id.includes('l') || id === 'l') nx0 = x0 + dx;
      if (id.includes('r') || id === 'r') nx1 = x1 + dx;
      if (id.includes('t') || id === 't') ny0 = y0 + dy;
      if (id.includes('b') || id === 'b') ny1 = y1 + dy;

      const min = 0.05;
      nx0 = Math.min(nx0, nx1 - min);
      ny0 = Math.min(ny0, ny1 - min);
      nx1 = Math.max(nx1, nx0 + min);
      ny1 = Math.max(ny1, ny0 + min);

      r.x = nx0; r.y = ny0; r.w = nx1 - nx0; r.h = ny1 - ny0;
    }

    state.cropUI.rect = r;
    clampRect();
    renderOverlay();
  };

  const onUp = (e) => {
    if (!state.cropUI.active || !state.img) return;
    state.cropUI.drag = null;
    state.cropUI.handle = null;
    state.cropUI.moving = false;
    state.cropUI.resizing = false;
    renderOverlay();
  };

  ov.addEventListener('pointerdown', onDown);
  ov.addEventListener('pointermove', onMove);
  ov.addEventListener('pointerup', onUp);
  ov.addEventListener('pointercancel', onUp);
}

function renderOverlay() {
  const ctx = state.octx;
  const w = state.overlay.width;
  const h = state.overlay.height;
  ctx.clearRect(0, 0, w, h);

  if (!state.img) return;

  const showCrop = state.cropUI.active && (state.tool === 'crop' || state.tool === 'editor');
  if (!showCrop) return;

  const r = state.cropUI.rect;
  const x = r.x * w;
  const y = r.y * h;
  const rw = r.w * w;
  const rh = r.h * h;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, h);
  ctx.clearRect(x, y, rw, rh);

  ctx.strokeStyle = 'rgba(181,108,255,0.9)';
  ctx.lineWidth = Math.max(2, Math.floor(w / 600));
  ctx.shadowColor = 'rgba(181,108,255,0.6)';
  ctx.shadowBlur = 18;
  ctx.strokeRect(x, y, rw, rh);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(245,240,255,0.25)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + rw / 3, y); ctx.lineTo(x + rw / 3, y + rh);
  ctx.moveTo(x + 2 * rw / 3, y); ctx.lineTo(x + 2 * rw / 3, y + rh);
  ctx.moveTo(x, y + rh / 3); ctx.lineTo(x + rw, y + rh / 3);
  ctx.moveTo(x, y + 2 * rh / 3); ctx.lineTo(x + rw, y + 2 * rh / 3);
  ctx.stroke();
  ctx.setLineDash([]);

  const handle = (hx, hy) => {
    const s = Math.max(10, Math.floor(w / 70));
    ctx.fillStyle = 'rgba(181,108,255,0.95)';
    ctx.shadowColor = 'rgba(181,108,255,0.65)';
    ctx.shadowBlur = 18;
    ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(245,240,255,0.65)';
    ctx.strokeRect(hx - s / 2, hy - s / 2, s, s);
  };

  handle(x, y);
  handle(x + rw, y);
  handle(x, y + rh);
  handle(x + rw, y + rh);
  handle(x, y + rh / 2);
  handle(x + rw, y + rh / 2);
  handle(x + rw / 2, y);
  handle(x + rw / 2, y + rh);

  ctx.restore();
}

function renderPreview() {
  const ctx = state.ctx;
  const cw = state.canvas.width;
  const ch = state.canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  renderOverlay();

  if (!state.img) {
    ctx.save();
    ctx.fillStyle = 'rgba(201,185,255,0.85)';
    ctx.font = `${Math.max(14, Math.floor(cw / 34))}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Upload an image to preview', cw / 2, ch / 2);
    ctx.restore();
    return;
  }

  const src = buildRenderSource();
  const dst = fitRect(src.w, src.h, cw, ch);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const filterStr = `brightness(${state.applied.filters.brightness}%) contrast(${state.applied.filters.contrast}%) saturate(${state.applied.filters.saturation}%) blur(${state.applied.filters.blur}px)`;
  ctx.filter = filterStr;

  ctx.translate(dst.x + dst.w / 2, dst.y + dst.h / 2);
  const rot = (state.applied.rotation || 0) * Math.PI / 180;
  ctx.rotate(rot);
  ctx.scale(state.applied.flipH ? -1 : 1, state.applied.flipV ? -1 : 1);

  const drawW = dst.w;
  const drawH = dst.h;
  ctx.drawImage(src.canvas, -drawW / 2, -drawH / 2, drawW, drawH);

  ctx.restore();

  if (state.applied.filters.sharpen > 0) {
    const imgData = ctx.getImageData(dst.x, dst.y, dst.w, dst.h);
    const sharpened = sharpenImageData(imgData, state.applied.filters.sharpen / 100);
    ctx.putImageData(sharpened, dst.x, dst.y);
  }

  if (state.applied.watermark.enabled) {
    drawWatermark(ctx, dst);
  }

  state.ui.miniInfo.textContent = `${state.tool ? toolMeta[state.tool].title : 'Tool'} • ${state.w}×${state.h}`;
  state.ui.chipDim.textContent = `${src.w}×${src.h}`;
  state.ui.chipFmt.textContent = (state.file?.type ? state.file.type.replace('image/', '').toUpperCase() : 'IMAGE');
}

function fitRect(sw, sh, dw, dh) {
  const s = Math.min(dw / sw, dh / sh);
  const w = Math.floor(sw * s);
  const h = Math.floor(sh * s);
  const x = Math.floor((dw - w) / 2);
  const y = Math.floor((dh - h) / 2);
  return { x, y, w, h, s };
}

function buildRenderSource() {
  let canvas = state.baseCanvas;
  let w = state.w, h = state.h;

  if (state.applied.crop && (state.tool !== 'crop' ? true : true)) {
    const r = state.applied.crop;
    const x = Math.max(0, Math.floor(r.x * w));
    const y = Math.max(0, Math.floor(r.y * h));
    const cw = Math.max(1, Math.floor(r.w * w));
    const ch = Math.max(1, Math.floor(r.h * h));
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
    canvas = out;
    w = cw; h = ch;
  } else if (state.tool === 'crop' || (state.tool === 'editor' && state.cropUI.active)) {
    const r = state.cropUI.rect;
    const x = Math.max(0, Math.floor(r.x * w));
    const y = Math.max(0, Math.floor(r.y * h));
    const cw = Math.max(1, Math.floor(r.w * w));
    const ch = Math.max(1, Math.floor(r.h * h));
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
    canvas = out; w = cw; h = ch;
  }

  if (state.applied.resize) {
    const rw = Math.max(1, state.applied.resize.w);
    const rh = Math.max(1, state.applied.resize.h);
    const out = document.createElement('canvas');
    out.width = rw; out.height = rh;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, rw, rh);
    canvas = out; w = rw; h = rh;
  }

  return { canvas, w, h };
}

function sharpenImageData(imgData, amount) {
  const { data, width, height } = imgData;
  const out = new ImageData(width, height);
  const o = out.data;

  const a = Math.max(0, Math.min(1, amount));
  const kCenter = 1 + 4 * a;
  const kSide = -a;

  const idx = (x, y) => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);

      const get = (xx, yy) => {
        xx = Math.max(0, Math.min(width - 1, xx));
        yy = Math.max(0, Math.min(height - 1, yy));
        const j = idx(xx, yy);
        return [data[j], data[j + 1], data[j + 2], data[j + 3]];
      };

      const c = get(x, y);
      const l = get(x - 1, y);
      const r = get(x + 1, y);
      const t = get(x, y - 1);
      const b = get(x, y + 1);

      for (let ch = 0; ch < 3; ch++) {
        const v = c[ch] * kCenter + (l[ch] + r[ch] + t[ch] + b[ch]) * kSide;
        o[i + ch] = Math.max(0, Math.min(255, v));
      }
      o[i + 3] = c[3];
    }
  }
  return out;
}

function drawWatermark(ctx, dst) {
  const wm = state.applied.watermark;
  if (!wm || (!wm.text && !wm.img)) return;
  const pad = Math.max(10, Math.floor(Math.min(dst.w, dst.h) * 0.03));

  let x = dst.x + pad, y = dst.y + pad;
  if (wm.pos === 'tr') { x = dst.x + dst.w - pad; y = dst.y + pad; }
  if (wm.pos === 'bl') { x = dst.x + pad; y = dst.y + dst.h - pad; }
  if (wm.pos === 'br') { x = dst.x + dst.w - pad; y = dst.y + dst.h - pad; }
  if (wm.pos === 'c') { x = dst.x + dst.w / 2; y = dst.y + dst.h / 2; }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, wm.opacity ?? 0.45));
  ctx.shadowColor = 'rgba(181,108,255,0.65)';
  ctx.shadowBlur = 18;

  if (wm.mode === 'image' && wm.img) {
    const s = Math.max(0.05, Math.min(0.7, wm.scale ?? 0.28));
    const w = dst.w * s;
    const h = w * (wm.img.naturalHeight / wm.img.naturalWidth);
    let dx = x, dy = y;
    if (wm.pos === 'tr') { dx -= w; }
    if (wm.pos === 'bl') { dy -= h; }
    if (wm.pos === 'br') { dx -= w; dy -= h; }
    if (wm.pos === 'c') { dx -= w / 2; dy -= h / 2; }
    ctx.drawImage(wm.img, dx, dy, w, h);
  } else {
    const text = wm.text || 'NEON';
    const size = Math.max(10, wm.size || 42);
    ctx.font = `900 ${size}px ui-sans-serif, system-ui`;
    ctx.fillStyle = 'rgba(245,240,255,0.95)';
    ctx.textBaseline = 'alphabetic';

    const m = ctx.measureText(text);
    let tx = x, ty = y;
    if (wm.pos === 'tr') tx -= m.width;
    if (wm.pos === 'bl') ty += 0;
    if (wm.pos === 'br') { tx -= m.width; }
    if (wm.pos === 'c') { tx -= m.width / 2; ty += size / 2; }

    if (wm.pos === 'bl' || wm.pos === 'br') ty -= 0;
    if (wm.pos === 'tl' || wm.pos === 'tr') ty += size;
    if (wm.pos === 'bl' || wm.pos === 'br') ty -= 8;

    ctx.fillText(text, tx, ty);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = (wm.opacity ?? 0.45) * 0.7;
    ctx.strokeStyle = 'rgba(181,108,255,0.65)';
    ctx.lineWidth = Math.max(2, Math.floor(size / 18));
    ctx.strokeText(text, tx, ty);
  }

  ctx.restore();
}

async function exportImage(opts = {}) {
  if (!state.img) { toast('Export', 'Upload an image first.'); return; }
  const fmt = opts.forceFormat || state.applied.export.format || 'png';
  const q = (fmt === 'png') ? 0.92 : (opts.forceQuality ?? state.applied.export.quality ?? 0.92);
  const blob = await renderToBlob(fmt, q).catch(() => null);
  if (!blob) { toast('Export', 'Export failed.'); return; }

  const name = opts.forceName || `${state.name}_${state.tool || 'tool'}`;
  const ext = (fmt === 'jpg') ? 'jpg' : fmt;
  downloadBlob(blob, `${name}.${ext}`);
  toast('Export', `${ext.toUpperCase()} • ${fmtBytes(blob.size)}`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderToBlob(format, quality) {
  const src = buildRenderSource();
  const out = document.createElement('canvas');

  const rot = (state.applied.rotation || 0) % 360;
  const rotated = (rot === 90 || rot === 270);
  const ow = rotated ? src.h : src.w;
  const oh = rotated ? src.w : src.h;

  out.width = ow;
  out.height = oh;

  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (format === 'jpg') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
  }

  const filterStr = `brightness(${state.applied.filters.brightness}%) contrast(${state.applied.filters.contrast}%) saturate(${state.applied.filters.saturation}%) blur(${state.applied.filters.blur}px)`;
  ctx.filter = filterStr;

  ctx.save();
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(state.applied.flipH ? -1 : 1, state.applied.flipV ? -1 : 1);
  ctx.drawImage(src.canvas, -src.w / 2, -src.h / 2, src.w, src.h);
  ctx.restore();

  ctx.filter = 'none';

  if (state.applied.filters.sharpen > 0) {
    const imgData = ctx.getImageData(0, 0, out.width, out.height);
    const sharpened = sharpenImageData(imgData, state.applied.filters.sharpen / 100);
    ctx.putImageData(sharpened, 0, 0);
  }

  if (state.applied.watermark.enabled) {
    drawWatermark(ctx, { x: 0, y: 0, w: out.width, h: out.height });
  }

  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise((res) => out.toBlob(res, mime, quality));
  if (!blob) throw new Error('toBlob failed');
  return blob;
}

function pickFile(accept) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => res(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}

async function ensureSelfieSegmentation() {
  if (state.mp.loaded) return;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
  state.mp.loaded = true;
  state.mp.selfie = new SelfieSegmentation({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}` });
  state.mp.selfie.setOptions({ modelSelection: 1 });
}

async function removeBackground() {
  const src = buildRenderSource();
  const w = src.w, h = src.h;

  const inCanvas = document.createElement('canvas');
  inCanvas.width = w; inCanvas.height = h;
  const ictx = inCanvas.getContext('2d', { willReadFrequently: true });
  ictx.drawImage(src.canvas, 0, 0);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true });

  const seg = state.mp.selfie;

  const result = await new Promise((res) => {
    seg.onResults((r) => res(r));
    seg.send({ image: inCanvas });
  });

  octx.clearRect(0, 0, w, h);
  octx.drawImage(result.segmentationMask, 0, 0, w, h);

  const mask = octx.getImageData(0, 0, w, h);
  const img = ictx.getImageData(0, 0, w, h);
  const m = mask.data, d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    const a = m[i];
    d[i + 3] = a;
  }

  octx.putImageData(img, 0, 0);

  state.baseCanvas = out;
  state.baseCtx = out.getContext('2d', { willReadFrequently: true });
  state.w = w;
  state.h = h;
  state.ui.chipDim.textContent = `${w}×${h}`;
  state.ui.chipFmt.textContent = 'RGBA';
  state.applied.export.format = 'png';
  renderControls(state.tool);
  renderPreview();
}

function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function loadExifInto(outEl) {
  outEl.textContent = 'Loading…';
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/exif-js@2.3.0/exif.min.js').catch(() => null);

  if (!window.EXIF || !state.file) {
    outEl.textContent = 'EXIF viewer unavailable.';
    return;
  }

  const file = state.file;
  const reader = new FileReader();
  const buf = await new Promise((res) => {
    reader.onload = () => res(reader.result);
    reader.readAsArrayBuffer(file);
  });

  let tags = null;
  try {
    const view = new DataView(buf);
    const blob = new Blob([view], { type: file.type });
    const img = new Image();
    const url = URL.createObjectURL(blob);
    await new Promise((r) => { img.onload = r; img.src = url; });
    URL.revokeObjectURL(url);

    EXIF.getData(img, function () {
      tags = EXIF.getAllTags(this);
    });
  } catch { tags = null; }

  if (!tags || Object.keys(tags).length === 0) {
    outEl.textContent = 'No EXIF metadata found (or not supported for this file).';
    return;
  }

  const entries = Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 60)
    .map(([k, v]) => `${k}: ${String(v)}`);

  outEl.innerHTML = `<div class="mono">${escapeHtml(entries.join('\n'))}</div><div class="hr"></div><div class="small">Showing up to 60 tags.</div>`;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 255;
  b[1] = (n >>> 16) & 255;
  b[2] = (n >>> 8) & 255;
  b[3] = n & 255;
  return b;
}

function ascii(s) {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
  return a;
}

function concatBytes(...arrs) {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function addPngTextChunks(pngBlob, dict) {
  const buf = new Uint8Array(await pngBlob.arrayBuffer());
  const sig = buf.slice(0, 8);
  const chunks = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    const crcEnd = dataEnd + 4;
    const chunk = buf.slice(off, crcEnd);
    chunks.push({ type, chunk, off, len });
    off = crcEnd;
    if (type === 'IEND') break;
  }

  const beforeIEND = [];
  const iend = chunks.find(c => c.type === 'IEND')?.chunk;

  for (const c of chunks) {
    if (c.type === 'IEND') break;
    beforeIEND.push(c.chunk);
  }

  const textChunks = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!v) continue;
    const keyword = k.trim().slice(0, 79);
    const text = String(v).slice(0, 2048);
    const data = concatBytes(ascii(keyword), new Uint8Array([0]), new TextEncoder().encode(text));
    const type = ascii('tEXt');
    const len = u32(data.length);
    const crc = u32(crc32(concatBytes(type, data)));
    const chunk = concatBytes(len, type, data, crc);
    textChunks.push(chunk);
  }

  const out = concatBytes(sig, ...beforeIEND, ...textChunks, iend || new Uint8Array());
  return new Blob([out], { type: 'image/png' });
}

function setToolActiveFlags(tool) {
  state.cropUI.active = (tool === 'crop' || (tool === 'editor' && (state._editorMode === 'crop' || state._editorMode === 'all')));
}

setInterval(() => renderOverlay(), 140);

(function init() {
  bindGlobalUI();
  setRoute(location.hash);
  showHome();
})();