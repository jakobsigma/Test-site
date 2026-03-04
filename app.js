// app.js
const $ = (q, el = document) => el.querySelector(q);

const toolMeta = {
  crop: { title: 'Crop', sub: 'Drag the crop box, resize handles, then export.' },
  resize: { title: 'Resize', sub: 'Set width/height, lock aspect, then export.' },
  convert: { title: 'Convert', sub: 'Choose a format and export.' },
  compress: { title: 'Compress', sub: 'Adjust quality, preview, then export.' },
  bgremove: { title: 'Remove Background', sub: 'In-browser segmentation, then export PNG/WebP.' },
  rotate: { title: 'Rotate & Flip', sub: 'Rotate, flip, then export.' },
  watermark: { title: 'Watermark', sub: 'Add text or image watermark, then export.' },
  filters: { title: 'Filters', sub: 'Adjust sliders with live preview, then export.' },
  metadata: { title: 'Metadata', sub: 'View EXIF + strip on export.' },
  editor: { title: 'Editor', sub: 'All-in-one preview + export.' }
};

const state = {
  tool: '',
  file: null,
  name: 'image',
  img: null,
  w: 0,
  h: 0,
  baseCanvas: null,
  canvas: $('#canvas'),
  overlay: $('#overlay'),
  ctx: $('#canvas').getContext('2d', { willReadFrequently: true }),
  octx: $('#overlay').getContext('2d'),
  cropUI: { active: false, rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, drag: null, handle: null, moving: false, resizing: false },
  mp: { loaded: false, selfie: null },
  applied: {
    crop: null,
    resize: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0 },
    watermark: { enabled: false, mode: 'text', text: 'NEON', size: 42, opacity: 0.45, pos: 'br', img: null, scale: 0.28 },
    export: { format: 'png', quality: 0.92 }
  },
  perf: { scheduled: false, needPreview: true, needOverlay: true, lastSliderAt: 0, estTimer: null },
  ui: {
    home: $('#home'),
    tool: $('#tool'),
    toolTitle: $('#toolTitle'),
    toolSubtitle: $('#toolSubtitle'),
    miniInfo: $('#miniInfo'),
    controls: $('#controls'),
    chipDim: $('#chipDim'),
    chipFmt: $('#chipFmt'),
    dropzone: $('#dropzone'),
    toast: $('#toast'),
    fileInput: $('#fileInput'),
    logoInput: $('#logoInput'),
    brandLogo: $('#brandLogo'),
    logoBox: $('#logoBox'),
    goHome: $('#goHome'),
    btnBack: $('#btnBack'),
    btnUpload: $('#btnUpload'),
    btnExport: $('#btnExport'),
    btnReset: $('#btnReset'),
    btnSetLogo: $('#btnSetLogo')
  }
};

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))}
function toast(t,m){
  const el=state.ui.toast;
  el.innerHTML=`<strong>${escapeHtml(t)}</strong> <span>${escapeHtml(m)}</span>`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),2500);
}
function fmtBytes(n){
  if(!Number.isFinite(n)||n<=0)return'—';
  const u=['B','KB','MB','GB'];let i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++}
  return `${n.toFixed(i===0?0:2)} ${u[i]}`;
}
function baseName(name){
  const p=(name||'').split('/').pop();
  const dot=p.lastIndexOf('.');
  if(dot<=0)return p||'image';
  return p.slice(0,dot);
}
function scheduleRender(preview=true,overlay=true){
  if(preview) state.perf.needPreview=true;
  if(overlay) state.perf.needOverlay=true;
  if(state.perf.scheduled) return;
  state.perf.scheduled=true;
  requestAnimationFrame(()=>{
    state.perf.scheduled=false;
    if(state.perf.needPreview) renderPreview();
    if(state.perf.needOverlay) renderOverlay();
    state.perf.needPreview=false;
    state.perf.needOverlay=false;
  });
}

function showHome(){
  state.ui.home.style.display='block';
  state.ui.tool.style.display='none';
  state.ui.miniInfo.textContent='';
}
function showTool(t){
  state.ui.home.style.display='none';
  state.ui.tool.style.display='block';
  state.ui.toolTitle.textContent=toolMeta[t].title;
  state.ui.toolSubtitle.textContent=toolMeta[t].sub;
  renderControls();
  resizeCanvasesToWrap();
  scheduleRender(true,true);
}
function setRoute(){
  const t=(location.hash||'#').replace('#','').trim();
  if(!t){ state.tool=''; showHome(); return; }
  if(!toolMeta[t]){ state.tool=''; showHome(); return; }
  state.tool=t;
  showTool(t);
}

function resizeCanvasesToWrap(){
  const wrap=state.canvas.parentElement;
  const r=wrap.getBoundingClientRect();
  const dpr=Math.max(1, Math.min(1.6, window.devicePixelRatio||1));
  const w=Math.max(320, Math.floor(r.width*dpr));
  const h=Math.max(200, Math.floor(r.height*dpr));
  if(state.canvas.width!==w||state.canvas.height!==h){
    state.canvas.width=w; state.canvas.height=h;
    state.overlay.width=w; state.overlay.height=h;
  }
}

async function loadFile(file){
  if(!file || !file.type.startsWith('image/')){ toast('Upload','Please choose an image file.'); return; }
  state.file=file;
  state.name=baseName(file.name||'image');
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.decoding='async';
  img.crossOrigin='anonymous';
  const ok=await new Promise(res=>{
    img.onload=()=>res(true);
    img.onerror=()=>res(false);
    img.src=url;
  });
  URL.revokeObjectURL(url);
  if(!ok || !img.naturalWidth || !img.naturalHeight){ toast('Upload','Could not read the image.'); return; }

  state.img=img;
  state.w=img.naturalWidth;
  state.h=img.naturalHeight;

  state.baseCanvas=document.createElement('canvas');
  state.baseCanvas.width=state.w;
  state.baseCanvas.height=state.h;
  state.baseCanvas.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0);

  state.applied.crop=null;
  state.applied.resize=null;

  state.ui.chipDim.textContent=`${state.w}×${state.h}`;
  state.ui.chipFmt.textContent=(file.type||'image/*').replace('image/','').toUpperCase();

  if(!state.tool){
    location.hash='#editor';
    return;
  }

  renderControls();
  scheduleRender(true,true);
  toast('Loaded',`${state.w}×${state.h} ready.`);
}

function group(title, nodes){
  const g=document.createElement('div');
  g.className='group';
  const h=document.createElement('div');
  h.className='groupTitle';
  h.innerHTML=`<span>${escapeHtml(title)}</span><span class="badge">Live</span>`;
  g.appendChild(h);
  nodes.filter(Boolean).forEach(n=>g.appendChild(n));
  return g;
}
function infoLine(a,b){
  const d=document.createElement('div');
  d.className='small';
  d.innerHTML=`<div><span class="mono">${escapeHtml(a)}</span></div><div>${escapeHtml(b)}</div>`;
  return d;
}
function field(label, el){
  const f=document.createElement('div');
  f.className='field';
  const l=document.createElement('label');
  l.textContent=label;
  f.appendChild(l);
  f.appendChild(el);
  return f;
}
function row2(a,b){
  const r=document.createElement('div');
  r.className='row';
  r.appendChild(a); r.appendChild(b);
  return r;
}
function toggle(text,on,cb){
  const t=document.createElement('div');
  t.className='tgl'+(on?' on':'');
  t.innerHTML=`<span class="tiny">${escapeHtml(text)}</span>`;
  t.addEventListener('click',()=>cb(!t.classList.contains('on')));
  return t;
}
function slider(labelText,min,max,step,value,cb,suffix=''){
  const wrap=document.createElement('div');
  const s=document.createElement('input');
  s.type='range'; s.min=min; s.max=max; s.step=step; s.value=value;
  const v=document.createElement('div');
  v.className='sval'; v.textContent=`${value}${suffix}`;
  s.addEventListener('input',()=>{
    v.textContent=`${s.value}${suffix}`;
    state.perf.lastSliderAt=performance.now();
    cb(parseFloat(s.value));
  });
  wrap.className='slider';
  wrap.appendChild(s); wrap.appendChild(v);
  return field(labelText, wrap);
}
function btn(text, cls, onClick){
  const b=document.createElement('button');
  b.className='btn'+(cls?` ${cls}`:'');
  b.textContent=text;
  b.addEventListener('click',onClick);
  return b;
}
function btnRow(...buttons){
  const r=document.createElement('div');
  r.className='btnRow';
  buttons.forEach(b=>r.appendChild(b));
  return r;
}

function renderControls(){
  const c=state.ui.controls;
  c.innerHTML='';

  if(!state.img){
    c.appendChild(group('Status',[infoLine('No image loaded','Click the drop box or Upload.')]));
    c.appendChild(group('Export',[exportFormatRow(), exportQualityRow()]));
    return;
  }

  if(state.tool==='crop') c.appendChild(ctrlCrop());
  if(state.tool==='resize') c.appendChild(ctrlResize());
  if(state.tool==='convert') c.appendChild(ctrlConvert(false));
  if(state.tool==='compress') c.appendChild(ctrlConvert(true));
  if(state.tool==='bgremove') c.appendChild(ctrlBgRemove());
  if(state.tool==='rotate') c.appendChild(ctrlRotate());
  if(state.tool==='watermark') c.appendChild(ctrlWatermark());
  if(state.tool==='filters') c.appendChild(ctrlFilters());
  if(state.tool==='metadata') c.appendChild(ctrlMetadata());
  if(state.tool==='editor') c.appendChild(ctrlEditor());

  c.appendChild(group('Export',[exportFormatRow(), exportQualityRow()]));
}

function ctrlCrop(){
  state.cropUI.active=true;

  const apply=btn('Apply Crop','primary',()=>{
    state.applied.crop={...state.cropUI.rect};
    toast('Crop','Applied to export.');
    scheduleRender(true,true);
  });

  const reset=btn('Reset Box','',()=>{
    state.cropUI.rect={x:0.1,y:0.1,w:0.8,h:0.8};
    state.applied.crop=null;
    toast('Crop','Reset.');
    scheduleRender(true,true);
  });

  const snap=btn('Center 1:1','',()=>{
    let w=0.6,h=0.6;
    state.cropUI.rect={x:(1-w)/2,y:(1-h)/2,w,h};
    toast('Crop','Centered square.');
    scheduleRender(true,true);
  });

  return group('Crop',[infoLine('Drag & resize','Use handles. Export uses applied crop.'), btnRow(apply, reset, snap)]);
}

function ctrlResize(){
  state.cropUI.active=false;

  const wIn=document.createElement('input');
  wIn.type='number'; wIn.min=1; wIn.value=state.applied.resize?.w || state.w;

  const hIn=document.createElement('input');
  hIn.type='number'; hIn.min=1; hIn.value=state.applied.resize?.h || state.h;

  const lockWrap=document.createElement('div');
  lockWrap.className='toggleRow';
  const isLocked=state.applied.resize?.lock ?? true;
  const lockT=toggle('Lock aspect ratio', isLocked, (v)=>{
    lockT.classList.toggle('on',v);
    if(state.applied.resize){
      state.applied.resize.lock=v;
    }else{
      state.applied.resize={w:parseInt(wIn.value,10),h:parseInt(hIn.value,10),lock:v};
    }
    if(v){
      const ar=state.w/state.h;
      hIn.value=Math.max(1,Math.round(parseInt(wIn.value||'1',10)/ar));
      state.applied.resize.h=parseInt(hIn.value,10);
    }
    scheduleRender(true,false);
  });
  lockWrap.appendChild(lockT);

  const applyNow=()=>{
    const w=Math.max(1,parseInt(wIn.value||'1',10));
    const h=Math.max(1,parseInt(hIn.value||'1',10));
    const lockOn=lockT.classList.contains('on');
    state.applied.resize={w,h,lock:lockOn};
    scheduleRender(true,false);
  };

  const ar=state.w/state.h;
  wIn.addEventListener('input',()=>{
    if(lockT.classList.contains('on')) hIn.value=Math.max(1,Math.round(parseInt(wIn.value||'1',10)/ar));
    applyNow();
  });
  hIn.addEventListener('input',()=>{
    if(lockT.classList.contains('on')) wIn.value=Math.max(1,Math.round(parseInt(hIn.value||'1',10)*ar));
    applyNow();
  });

  const half=btn('50%','',()=>{
    wIn.value=Math.max(1,Math.round(state.w*0.5));
    hIn.value=Math.max(1,Math.round(state.h*0.5));
    applyNow();
    toast('Resize','50% set.');
  });

  const reset=btn('Reset','',()=>{
    state.applied.resize=null;
    wIn.value=state.w; hIn.value=state.h;
    scheduleRender(true,false);
    toast('Resize','Reset.');
  });

  return group('Resize',[
    infoLine('Resize','Live preview matches export.'),
    row2(field('Width',wIn), field('Height',hIn)),
    lockWrap,
    btnRow(half, reset)
  ]);
}

function ctrlConvert(showSize){
  state.cropUI.active=false;

  const sel=document.createElement('select');
  [['png','PNG (lossless)'],['jpg','JPG (lossy)'],['webp','WebP (lossy)']].forEach(([v,t])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o);
  });
  sel.value=state.applied.export.format || 'png';
  sel.addEventListener('change',()=>{
    state.applied.export.format=sel.value;
    renderControls();
    scheduleRender(true,false);
    if(showSize) estimateSizeDebounced();
  });

  const q=slider('Quality',0.2,1,0.01,state.applied.export.quality ?? 0.92,(v)=>{
    state.applied.export.quality=v;
    scheduleRender(true,false);
    if(showSize) estimateSizeDebounced();
  });

  const nodes=[infoLine(showSize?'Compress':'Convert', showSize?'Adjust quality then export.':'Pick format then export.'), field('Format',sel)];
  if((state.applied.export.format||'png')!=='png') nodes.push(q); else nodes.push(infoLine('Quality','Lossless PNG ignores quality.'));
  if(showSize) nodes.push(infoLine('Estimate','Shown in header shortly after changes.'));
  if(showSize) estimateSizeDebounced();
  return group(showSize?'Compress':'Convert', nodes);
}

function ctrlRotate(){
  state.cropUI.active=false;

  const rL=btn('Rotate -90°','',()=>{state.applied.rotation=(state.applied.rotation-90+360)%360; scheduleRender(true,false);});
  const rR=btn('Rotate +90°','',()=>{state.applied.rotation=(state.applied.rotation+90)%360; scheduleRender(true,false);});
  const fh=btn('Flip Horizontal','',()=>{state.applied.flipH=!state.applied.flipH; scheduleRender(true,false);});
  const fv=btn('Flip Vertical','',()=>{state.applied.flipV=!state.applied.flipV; scheduleRender(true,false);});
  const reset=btn('Reset','',()=>{state.applied.rotation=0; state.applied.flipH=false; state.applied.flipV=false; scheduleRender(true,false);});

  return group('Rotate & Flip',[infoLine('Transforms','Preview matches export.'), btnRow(rL,rR,fh,fv,reset)]);
}

function ctrlFilters(){
  state.cropUI.active=false;
  const f=state.applied.filters;
  const b=slider('Brightness',0,200,1,f.brightness,(v)=>{f.brightness=v; scheduleRender(true,false);});
  const c=slider('Contrast',0,200,1,f.contrast,(v)=>{f.contrast=v; scheduleRender(true,false);});
  const s=slider('Saturation',0,200,1,f.saturation,(v)=>{f.saturation=v; scheduleRender(true,false);});
  const bl=slider('Blur',0,18,0.1,f.blur,(v)=>{f.blur=v; scheduleRender(true,false);},'px');
  const reset=btn('Reset','',()=>{
    state.applied.filters={brightness:100,contrast:100,saturation:100,blur:0};
    renderControls();
    scheduleRender(true,false);
  });
  return group('Filters',[infoLine('Adjustments','Fast GPU filters for smooth preview.'), b,c,s,bl, btnRow(reset)]);
}

function ctrlWatermark(){
  state.cropUI.active=false;
  const wm=state.applied.watermark;

  const onOff=toggle('Enable watermark', !!wm.enabled, (v)=>{
    wm.enabled=v;
    scheduleRender(true,false);
  });

  const modeWrap=document.createElement('div');
  modeWrap.className='toggleRow';
  const tText=toggle('Text', wm.mode==='text', (on)=>{
    if(on){wm.mode='text'; renderControls(); scheduleRender(true,false);}
  });
  const tImg=toggle('Image', wm.mode==='image', (on)=>{
    if(on){wm.mode='image'; renderControls(); scheduleRender(true,false);}
  });
  modeWrap.appendChild(tText);
  modeWrap.appendChild(tImg);

  const nodes=[infoLine('Watermark','Text or image overlay on export.'), onOff, modeWrap];

  if(wm.mode==='text'){
    const txt=document.createElement('input');
    txt.type='text';
    txt.value=wm.text||'NEON';
    txt.addEventListener('input',()=>{wm.text=txt.value; scheduleRender(true,false);});
    nodes.push(field('Text',txt));
    nodes.push(slider('Text size',10,180,1,wm.size||42,(v)=>{wm.size=v; scheduleRender(true,false);},'px'));
  }else{
    const up=btn('Upload watermark image','primary', async ()=>{
      const f=await pickFile('image/*');
      if(!f) return;
      const url=URL.createObjectURL(f);
      const im=new Image();
      im.decoding='async';
      const ok=await new Promise(res=>{im.onload=()=>res(true); im.onerror=()=>res(false); im.src=url;});
      URL.revokeObjectURL(url);
      if(!ok||!im.naturalWidth) return;
      wm.img=im;
      toast('Watermark','Image loaded.');
      scheduleRender(true,false);
    });
    nodes.push(up);
    nodes.push(slider('Scale',0.05,0.7,0.01,wm.scale ?? 0.28,(v)=>{wm.scale=v; scheduleRender(true,false);}));
  }

  const pos=document.createElement('select');
  [['tl','Top-left'],['tr','Top-right'],['bl','Bottom-left'],['br','Bottom-right'],['c','Center']].forEach(([v,t])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=t; pos.appendChild(o);
  });
  pos.value=wm.pos||'br';
  pos.addEventListener('change',()=>{wm.pos=pos.value; scheduleRender(true,false);});
  nodes.push(slider('Opacity',0.05,1,0.01,wm.opacity ?? 0.45,(v)=>{wm.opacity=v; scheduleRender(true,false);}));
  nodes.push(field('Position',pos));

  const reset=btn('Reset','',()=>{
    state.applied.watermark={enabled:false,mode:'text',text:'NEON',size:42,opacity:0.45,pos:'br',img:null,scale:0.28};
    renderControls();
    scheduleRender(true,false);
  });
  nodes.push(btnRow(reset));

  return group('Watermark', nodes);
}

function ctrlBgRemove(){
  state.cropUI.active=false;
  const go=btn('Remove Background','primary', async ()=>{
    await ensureSelfieSegmentation();
    if(!state.mp.selfie){toast('BG Remove','Segmentation not available.'); return;}
    toast('BG Remove','Processing…');
    await removeBackground();
    toast('BG Remove','Done. Export PNG/WebP for transparency.');
  });
  return group('Remove Background',[infoLine('Background removal','Best on portraits.'), btnRow(go)]);
}

function ctrlMetadata(){
  state.cropUI.active=false;

  const view=btn('View EXIF','', async ()=>{
    toast('EXIF','Loading…');
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/exif-js@2.3.0/exif.min.js').catch(()=>null);
    if(!window.EXIF || !state.file){ toast('EXIF','Viewer unavailable.'); return; }
    const url=URL.createObjectURL(state.file);
    const im=new Image();
    const ok=await new Promise(res=>{im.onload=()=>res(true); im.onerror=()=>res(false); im.src=url;});
    if(!ok){ URL.revokeObjectURL(url); toast('EXIF','Could not read.'); return; }
    const tags=await new Promise(res=>{
      try{
        window.EXIF.getData(im,function(){ res(window.EXIF.getAllTags(this)||{}); });
      }catch{ res({}); }
    });
    URL.revokeObjectURL(url);
    const keys=Object.keys(tags||{});
    if(!keys.length){ toast('EXIF','No EXIF found.'); return; }
    const top=keys.sort().slice(0,10).map(k=>`${k}: ${String(tags[k])}`).join(' • ');
    toast('EXIF', top.length>220 ? top.slice(0,220)+'…' : top);
  });

  const strip=btn('Strip metadata (export clean PNG)','primary', async ()=>{
    await exportImage({ forceFormat:'png', forceName:`${state.name}_clean` });
  });

  return group('Metadata',[infoLine('Metadata','Exporting/re-encoding removes most metadata.'), btnRow(view, strip)]);
}

function ctrlEditor(){
  state.cropUI.active=false;
  const note=infoLine('Editor','Use Filters + Watermark + Rotate + Resize, then export.');
  const openFilters=btn('Open Filters','',()=>{location.hash='#filters'});
  const openWatermark=btn('Open Watermark','',()=>{location.hash='#watermark'});
  const openRotate=btn('Open Rotate','',()=>{location.hash='#rotate'});
  const openResize=btn('Open Resize','',()=>{location.hash='#resize'});
  const openCrop=btn('Open Crop','',()=>{location.hash='#crop'});
  return group('Editor',[note, btnRow(openFilters, openWatermark, openRotate, openResize, openCrop)]);
}

function exportFormatRow(){
  const sel=document.createElement('select');
  [['png','PNG'],['jpg','JPG'],['webp','WebP']].forEach(([v,t])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o);
  });
  sel.value=state.applied.export.format||'png';
  sel.addEventListener('change',()=>{
    state.applied.export.format=sel.value;
    renderControls();
    scheduleRender(true,false);
    if(state.tool==='compress') estimateSizeDebounced();
  });
  const info=document.createElement('div');
  info.className='small';
  info.textContent = sel.value==='jpg' ? 'JPG has no transparency.' : 'PNG/WebP can keep transparency.';
  const wrap=document.createElement('div');
  wrap.appendChild(field('Export format', sel));
  wrap.appendChild(info);
  return wrap;
}
function exportQualityRow(){
  const f=state.applied.export.format||'png';
  if(f==='png') return infoLine('Quality','Lossless PNG ignores quality.');
  return slider('Export quality',0.2,1,0.01,state.applied.export.quality ?? 0.92,(v)=>{
    state.applied.export.quality=v;
    scheduleRender(true,false);
    if(state.tool==='compress') estimateSizeDebounced();
  });
}

function estimateSizeDebounced(){
  clearTimeout(state.perf.estTimer);
  state.perf.estTimer=setTimeout(async ()=>{
    if(!state.img) return;
    const fmt=state.applied.export.format||'jpg';
    const q=(fmt==='png')?0.92:(state.applied.export.quality ?? 0.92);
    const blob=await renderToBlob(fmt,q).catch(()=>null);
    if(!blob) return;
    state.ui.miniInfo.textContent=`Estimated export: ${fmtBytes(blob.size)}`;
  },220);
}

function fitRect(sw,sh,dw,dh){
  const s=Math.min(dw/sw, dh/sh);
  const w=Math.floor(sw*s), h=Math.floor(sh*s);
  const x=Math.floor((dw-w)/2), y=Math.floor((dh-h)/2);
  return {x,y,w,h};
}

function buildRenderSource(){
  let canvas=state.baseCanvas;
  let w=state.w, h=state.h;

  if(state.applied.crop){
    const r=state.applied.crop;
    const x=Math.max(0,Math.floor(r.x*w));
    const y=Math.max(0,Math.floor(r.y*h));
    const cw=Math.max(1,Math.floor(r.w*w));
    const ch=Math.max(1,Math.floor(r.h*h));
    const out=document.createElement('canvas');
    out.width=cw; out.height=ch;
    out.getContext('2d').drawImage(canvas,x,y,cw,ch,0,0,cw,ch);
    canvas=out; w=cw; h=ch;
  }else if(state.cropUI.active && (state.tool==='crop') && state.img){
    const r=state.cropUI.rect;
    const x=Math.max(0,Math.floor(r.x*w));
    const y=Math.max(0,Math.floor(r.y*h));
    const cw=Math.max(1,Math.floor(r.w*w));
    const ch=Math.max(1,Math.floor(r.h*h));
    const out=document.createElement('canvas');
    out.width=cw; out.height=ch;
    out.getContext('2d').drawImage(canvas,x,y,cw,ch,0,0,cw,ch);
    canvas=out; w=cw; h=ch;
  }

  if(state.applied.resize){
    const rw=Math.max(1,state.applied.resize.w);
    const rh=Math.max(1,state.applied.resize.h);
    const out=document.createElement('canvas');
    out.width=rw; out.height=rh;
    const c=out.getContext('2d');
    c.imageSmoothingEnabled=true;
    c.imageSmoothingQuality='high';
    c.drawImage(canvas,0,0,rw,rh);
    canvas=out; w=rw; h=rh;
  }

  return {canvas,w,h};
}

function drawWatermark(ctx, dst){
  const wm=state.applied.watermark;
  if(!wm.enabled) return;

  const pad=Math.max(10, Math.floor(Math.min(dst.w,dst.h)*0.03));
  let x=dst.x+pad, y=dst.y+pad;
  if(wm.pos==='tr'){x=dst.x+dst.w-pad;y=dst.y+pad}
  if(wm.pos==='bl'){x=dst.x+pad;y=dst.y+dst.h-pad}
  if(wm.pos==='br'){x=dst.x+dst.w-pad;y=dst.y+dst.h-pad}
  if(wm.pos==='c'){x=dst.x+dst.w/2;y=dst.y+dst.h/2}

  ctx.save();
  ctx.globalAlpha=Math.max(0,Math.min(1,wm.opacity ?? 0.45));
  ctx.shadowColor='rgba(181,108,255,0.55)';
  ctx.shadowBlur=16;

  if(wm.mode==='image' && wm.img){
    const s=Math.max(0.05,Math.min(0.7,wm.scale ?? 0.28));
    const ww=dst.w*s;
    const hh=ww*(wm.img.naturalHeight/wm.img.naturalWidth);
    let dx=x, dy=y;
    if(wm.pos==='tr') dx-=ww;
    if(wm.pos==='bl') dy-=hh;
    if(wm.pos==='br'){dx-=ww;dy-=hh}
    if(wm.pos==='c'){dx-=ww/2;dy-=hh/2}
    ctx.drawImage(wm.img, dx, dy, ww, hh);
  }else{
    const text=wm.text||'NEON';
    const size=Math.max(10, wm.size||42);
    ctx.font=`900 ${size}px ui-sans-serif, system-ui`;
    ctx.fillStyle='rgba(245,240,255,0.95)';
    const m=ctx.measureText(text);
    let tx=x, ty=y;
    if(wm.pos==='tr') tx-=m.width;
    if(wm.pos==='br') tx-=m.width;
    if(wm.pos==='c'){tx-=m.width/2;ty+=size/2}
    if(wm.pos==='tl'||wm.pos==='tr') ty+=size;
    if(wm.pos==='bl'||wm.pos==='br') ty-=8;
    ctx.fillText(text, tx, ty);
  }

  ctx.restore();
}

function renderPreview(){
  const ctx=state.ctx;
  const cw=state.canvas.width, ch=state.canvas.height;
  ctx.clearRect(0,0,cw,ch);

  if(!state.img){
    ctx.save();
    ctx.fillStyle='rgba(201,185,255,0.85)';
    ctx.font=`${Math.max(14,Math.floor(cw/34))}px ui-sans-serif, system-ui`;
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText('Upload an image to preview', cw/2, ch/2);
    ctx.restore();
    return;
  }

  const src=buildRenderSource();
  const dst=fitRect(src.w, src.h, cw, ch);

  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';

  const f=state.applied.filters;
  ctx.filter=`brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px)`;

  ctx.translate(dst.x+dst.w/2, dst.y+dst.h/2);
  const rot=((state.applied.rotation||0)%360)*Math.PI/180;
  ctx.rotate(rot);
  ctx.scale(state.applied.flipH?-1:1, state.applied.flipV?-1:1);
  ctx.drawImage(src.canvas, -dst.w/2, -dst.h/2, dst.w, dst.h);
  ctx.restore();

  drawWatermark(ctx, dst);

  state.ui.chipDim.textContent=`${src.w}×${src.h}`;
  state.ui.chipFmt.textContent=(state.file?.type ? state.file.type.replace('image/','').toUpperCase() : 'IMAGE');
  if(state.tool==='compress'){}
  else state.ui.miniInfo.textContent=`${toolMeta[state.tool]?.title||'Tool'} • ${state.w}×${state.h}`;
}

function renderOverlay(){
  const ctx=state.octx;
  const w=state.overlay.width, h=state.overlay.height;
  ctx.clearRect(0,0,w,h);

  if(!state.img) return;
  if(!(state.tool==='crop' && state.cropUI.active)) return;

  const r=state.cropUI.rect;
  const x=r.x*w, y=r.y*h, rw=r.w*w, rh=r.h*h;

  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.45)';
  ctx.fillRect(0,0,w,h);
  ctx.clearRect(x,y,rw,rh);

  ctx.strokeStyle='rgba(181,108,255,0.9)';
  ctx.lineWidth=Math.max(2,Math.floor(w/700));
  ctx.shadowColor='rgba(181,108,255,0.6)';
  ctx.shadowBlur=16;
  ctx.strokeRect(x,y,rw,rh);

  ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(245,240,255,0.22)';
  ctx.setLineDash([8,8]);
  ctx.beginPath();
  ctx.moveTo(x+rw/3,y); ctx.lineTo(x+rw/3,y+rh);
  ctx.moveTo(x+2*rw/3,y); ctx.lineTo(x+2*rw/3,y+rh);
  ctx.moveTo(x,y+rh/3); ctx.lineTo(x+rw,y+rh/3);
  ctx.moveTo(x,y+2*rh/3); ctx.lineTo(x+rw,y+2*rh/3);
  ctx.stroke();
  ctx.setLineDash([]);

  const handle=(hx,hy)=>{
    const s=Math.max(10,Math.floor(w/80));
    ctx.fillStyle='rgba(181,108,255,0.95)';
    ctx.shadowColor='rgba(181,108,255,0.65)';
    ctx.shadowBlur=14;
    ctx.fillRect(hx-s/2, hy-s/2, s, s);
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(245,240,255,0.65)';
    ctx.strokeRect(hx-s/2, hy-s/2, s, s);
  };
  handle(x,y); handle(x+rw,y); handle(x,y+rh); handle(x+rw,y+rh);
  handle(x,y+rh/2); handle(x+rw,y+rh/2); handle(x+rw/2,y); handle(x+rw/2,y+rh);

  ctx.restore();
}

async function exportImage(opts={}){
  if(!state.img){ toast('Export','Upload an image first.'); return; }
  const fmt=opts.forceFormat || state.applied.export.format || 'png';
  const q=(fmt==='png')?0.92:(opts.forceQuality ?? state.applied.export.quality ?? 0.92);
  const blob=await renderToBlob(fmt,q).catch(()=>null);
  if(!blob){ toast('Export','Export failed.'); return; }
  const name=opts.forceName || `${state.name}_${state.tool||'tool'}`;
  const ext=(fmt==='jpg')?'jpg':fmt;
  downloadBlob(blob, `${name}.${ext}`);
  toast('Export', `${ext.toUpperCase()} • ${fmtBytes(blob.size)}`);
}

function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1200);
}

async function renderToBlob(format, quality){
  const src=buildRenderSource();
  const out=document.createElement('canvas');

  const rot=(state.applied.rotation||0)%360;
  const rotated=(rot===90||rot===270);
  const ow=rotated?src.h:src.w;
  const oh=rotated?src.w:src.h;

  out.width=ow; out.height=oh;

  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';

  if(format==='jpg'){
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,out.width,out.height);
  }

  const f=state.applied.filters;
  ctx.filter=`brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px)`;

  ctx.save();
  ctx.translate(out.width/2, out.height/2);
  ctx.rotate(rot*Math.PI/180);
  ctx.scale(state.applied.flipH?-1:1, state.applied.flipV?-1:1);
  ctx.drawImage(src.canvas, -src.w/2, -src.h/2, src.w, src.h);
  ctx.restore();
  ctx.filter='none';

  drawWatermark(ctx,{x:0,y:0,w:out.width,h:out.height});

  const mime=format==='png'?'image/png':format==='webp'?'image/webp':'image/jpeg';
  const blob=await new Promise(res=>out.toBlob(res,mime,quality));
  if(!blob) throw new Error('toBlob failed');
  return blob;
}

function pickFile(accept){
  return new Promise(res=>{
    const inp=document.createElement('input');
    inp.type='file';
    inp.accept=accept;
    inp.onchange=()=>res(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}

async function loadScriptOnce(src){
  return new Promise((res,rej)=>{
    if([...document.scripts].some(s=>s.src===src)) return res();
    const s=document.createElement('script');
    s.src=src;
    s.onload=()=>res();
    s.onerror=rej;
    document.head.appendChild(s);
  });
}

async function ensureSelfieSegmentation(){
  if(state.mp.loaded) return;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
  state.mp.loaded=true;
  state.mp.selfie=new SelfieSegmentation({ locateFile:(f)=>`https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}` });
  state.mp.selfie.setOptions({ modelSelection: 1 });
}

async function removeBackground(){
  const src=buildRenderSource();
  const w=src.w, h=src.h;

  const inCanvas=document.createElement('canvas');
  inCanvas.width=w; inCanvas.height=h;
  inCanvas.getContext('2d',{willReadFrequently:true}).drawImage(src.canvas,0,0);

  const out=document.createElement('canvas');
  out.width=w; out.height=h;
  const octx=out.getContext('2d',{willReadFrequently:true});

  const seg=state.mp.selfie;
  const result=await new Promise(res=>{
    seg.onResults((r)=>res(r));
    seg.send({ image: inCanvas });
  });

  octx.clearRect(0,0,w,h);
  octx.drawImage(result.segmentationMask,0,0,w,h);

  const mask=octx.getImageData(0,0,w,h);
  const ictx=inCanvas.getContext('2d',{willReadFrequently:true});
  const img=ictx.getImageData(0,0,w,h);

  const m=mask.data, d=img.data;
  for(let i=0;i<d.length;i+=4) d[i+3]=m[i];

  octx.putImageData(img,0,0);

  state.baseCanvas=out;
  state.w=w; state.h=h;
  state.applied.export.format='png';
  state.ui.chipDim.textContent=`${w}×${h}`;
  state.ui.chipFmt.textContent='RGBA';
  renderControls();
  scheduleRender(true,false);
}

function bindCropOverlay(){
  const ov=state.overlay;

  const pointer=(e)=>{
    const r=ov.getBoundingClientRect();
    return { x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height };
  };

  const hit=(p)=>{
    const r=state.cropUI.rect;
    const pad=0.02;
    const x0=r.x,y0=r.y,x1=r.x+r.w,y1=r.y+r.h;
    const near=(a,b)=>Math.abs(a-b)<=pad;
    const inside=p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1;

    const hs=[
      {id:'tl',x:x0,y:y0},{id:'tr',x:x1,y:y0},{id:'bl',x:x0,y:y1},{id:'br',x:x1,y:y1},
      {id:'l',x:x0,y:(y0+y1)/2},{id:'r',x:x1,y:(y0+y1)/2},
      {id:'t',x:(x0+x1)/2,y:y0},{id:'b',x:(x0+x1)/2,y:y1}
    ];
    for(const h of hs) if(near(p.x,h.x)&&near(p.y,h.y)) return {type:'handle', id:h.id};
    if(inside) return {type:'move'};
    return {type:'none'};
  };

  const clamp=()=>{
    let r=state.cropUI.rect;
    r.w=Math.max(0.05,Math.min(0.98,r.w));
    r.h=Math.max(0.05,Math.min(0.98,r.h));
    r.x=Math.max(0.01,Math.min(0.99-r.w,r.x));
    r.y=Math.max(0.01,Math.min(0.99-r.h,r.y));
  };

  ov.addEventListener('pointerdown',(e)=>{
    if(!(state.tool==='crop' && state.img)) return;
    ov.setPointerCapture(e.pointerId);
    const p=pointer(e);
    const h=hit(p);
    state.cropUI.drag={start:p, rect:{...state.cropUI.rect}};
    state.cropUI.handle=h.type==='handle'?h.id:null;
    state.cropUI.moving=(h.type==='move');
    state.cropUI.resizing=(h.type==='handle');
  });

  ov.addEventListener('pointermove',(e)=>{
    if(!(state.tool==='crop' && state.img)) return;
    const d=state.cropUI.drag;
    if(!d) return;
    const p=pointer(e);
    const dx=p.x-d.start.x;
    const dy=p.y-d.start.y;
    let r={...d.rect};

    if(state.cropUI.moving){
      r.x+=dx; r.y+=dy;
    }else if(state.cropUI.resizing){
      const id=state.cropUI.handle;
      const x0=d.rect.x, y0=d.rect.y, x1=d.rect.x+d.rect.w, y1=d.rect.y+d.rect.h;
      let nx0=x0, ny0=y0, nx1=x1, ny1=y1;

      if(id.includes('l')||id==='l') nx0=x0+dx;
      if(id.includes('r')||id==='r') nx1=x1+dx;
      if(id.includes('t')||id==='t') ny0=y0+dy;
      if(id.includes('b')||id==='b') ny1=y1+dy;

      const min=0.05;
      nx0=Math.min(nx0, nx1-min);
      ny0=Math.min(ny0, ny1-min);
      nx1=Math.max(nx1, nx0+min);
      ny1=Math.max(ny1, ny0+min);

      r.x=nx0; r.y=ny0; r.w=nx1-nx0; r.h=ny1-ny0;
    }

    state.cropUI.rect=r;
    clamp();
    scheduleRender(false,true);
  });

  const end=()=>{
    state.cropUI.drag=null;
    state.cropUI.handle=null;
    state.cropUI.moving=false;
    state.cropUI.resizing=false;
    scheduleRender(false,true);
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);
}

function setLogoDataUrl(d){
  if(!d){
    localStorage.removeItem('neon_logo');
    state.ui.brandLogo.src='';
    state.ui.logoBox.classList.remove('hasImg');
    return;
  }
  localStorage.setItem('neon_logo', d);
  state.ui.brandLogo.src=d;
  state.ui.logoBox.classList.add('hasImg');
}

async function setLogoFromFile(file){
  if(!file || !file.type.startsWith('image/')) return;
  const dataUrl=await new Promise(res=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.readAsDataURL(file);
  });
  setLogoDataUrl(dataUrl);
  toast('Logo','Updated.');
}

function resetAll(){
  state.applied.crop=null;
  state.applied.resize=null;
  state.applied.rotation=0;
  state.applied.flipH=false;
  state.applied.flipV=false;
  state.applied.filters={brightness:100,contrast:100,saturation:100,blur:0};
  state.applied.watermark={enabled:false,mode:'text',text:'NEON',size:42,opacity:0.45,pos:'br',img:null,scale:0.28};
  state.applied.export={format:'png',quality:0.92};
  state.cropUI.rect={x:0.1,y:0.1,w:0.8,h:0.8};
  renderControls();
  scheduleRender(true,true);
  toast('Reset','Cleared.');
}

function bindUI(){
  state.ui.goHome.addEventListener('click',()=>{location.hash='';});
  state.ui.btnBack.addEventListener('click',()=>{location.hash='';});
  state.ui.btnUpload.addEventListener('click',()=>state.ui.fileInput.click());
  state.ui.dropzone.addEventListener('click',()=>state.ui.fileInput.click());
  state.ui.btnExport.addEventListener('click',()=>exportImage());
  state.ui.btnReset.addEventListener('click',()=>resetAll());

  state.ui.fileInput.addEventListener('change',async (e)=>{
    const f=e.target.files && e.target.files[0];
    if(f) await loadFile(f);
    e.target.value='';
  });

  const dz=state.ui.dropzone;
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,(e)=>{e.preventDefault();e.stopPropagation();dz.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,(e)=>{e.preventDefault();e.stopPropagation();dz.classList.remove('drag');}));
  dz.addEventListener('drop',async (e)=>{
    const f=e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) await loadFile(f);
  });

  state.ui.btnSetLogo.addEventListener('click',()=>state.ui.logoInput.click());
  state.ui.logoBox.addEventListener('click',()=>state.ui.logoInput.click());
  state.ui.logoInput.addEventListener('change',async (e)=>{
    const f=e.target.files && e.target.files[0];
    if(f) await setLogoFromFile(f);
    e.target.value='';
  });
  state.ui.goHome.addEventListener('dblclick',()=>{setLogoDataUrl(null); toast('Logo','Cleared.');});

  window.addEventListener('hashchange', setRoute);
  window.addEventListener('resize',()=>{resizeCanvasesToWrap(); scheduleRender(true,true);});
}

(function init(){
  bindUI();
  bindCropOverlay();
  const d=localStorage.getItem('neon_logo');
  if(d) setLogoDataUrl(d);
  setRoute();
  resizeCanvasesToWrap();
  scheduleRender(true,true);
})();
