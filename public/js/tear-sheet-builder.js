(function(){
  const LS_SHEETS_KEY = 'ep-tear-sheets';

  function loadLS(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e){ return fallback; }
  }
  function saveLS(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ /* storage unavailable */ }
  }

  let sheets = loadLS(LS_SHEETS_KEY, []);
  let idSeed = 1;
  const uid = () => 't' + Date.now() + '_' + (idSeed++);
  let scheduleItems = []; // flattened {room, ...item} from the current project's schedule
  let shareHistory = [];

  async function api(path, options){
    const res = await fetch(path, Object.assign({ headers: {'Content-Type':'application/json'} }, options));
    let data = null;
    try{ data = await res.json(); }catch(e){ /* empty body */ }
    if(!res.ok){
      throw new Error((data && data.error) || res.statusText || 'Request failed');
    }
    return data;
  }

  function escapeHtml(s){ return (s===undefined||s===null?'':String(s)).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function proxiedImg(url){
    if(!url) return '';
    if(!/^https?:\/\//i.test(url)) return url;
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&n=-1';
  }

  document.getElementById('tb-date').value = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});

  function render(){
    saveLS(LS_SHEETS_KEY, sheets);
    const wrap = document.getElementById('tb-sheets');
    const empty = document.getElementById('tb-empty');
    const footer = document.getElementById('tb-footer');
    empty.style.display = sheets.length ? 'none' : 'block';
    footer.style.display = sheets.length ? 'flex' : 'none';

    wrap.innerHTML = sheets.map(s => {
      const imgHtml = s.imageUrl
        ? `<img src="${proxiedImg(s.imageUrl)}" alt="${escapeHtml(s.itemName)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;ts-share-ph&quot;>No image found</div>'"/>`
        : `<div class="ts-share-ph">No image found</div>`;
      return `
      <div class="ts-share-card" data-sheet-id="${s.id}">
        <div class="ts-share-card-img">${imgHtml}</div>
        <div class="ts-share-card-body">
          <div class="ts-share-card-eyebrow">${escapeHtml(s.room || 'General')}${s.category ? ' / ' + escapeHtml(s.category) : ''}</div>
          <div class="ts-share-card-name" contenteditable="true" data-sheet-field="itemName">${escapeHtml(s.itemName)}</div>
          <div class="ts-share-card-row"><span>Investment</span><b contenteditable="true" data-sheet-field="investment">${escapeHtml(s.investment || 'Pricing on request')}</b></div>
          <div class="ts-share-card-row"><span>Dimensions</span><b contenteditable="true" data-sheet-field="dimensions">${escapeHtml(s.dimensions || 'TBD')}</b></div>
          <div class="ts-share-card-row"><span>Lead Time</span><b contenteditable="true" data-sheet-field="leadTime">${escapeHtml(s.leadTime || 'TBD')}</b></div>
          <div class="ts-share-card-desc" contenteditable="true" data-sheet-field="designerNotes">${escapeHtml(s.designerNotes || '')}</div>
          <div class="ts-share-actions tb-noprint" style="margin-top:8px;">
            <button class="tb-btn tb-btn-ghost tb-btn-sm" data-action="del" data-id="${s.id}" type="button">Remove</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  document.getElementById('tb-sheets').addEventListener('click', e=>{
    if(e.target.dataset.action === 'del'){
      sheets = sheets.filter(s => s.id !== e.target.dataset.id);
      render();
    }
  });
  // contenteditable fields fire 'input' (and it bubbles), so one delegated listener
  // keeps every card's edits synced back into `sheets` — otherwise they'd vanish
  // the next time render() runs (e.g. on project/date change).
  document.getElementById('tb-sheets').addEventListener('input', e=>{
    const field = e.target.dataset.sheetField;
    if(!field) return;
    const card = e.target.closest('[data-sheet-id]');
    const s = sheets.find(x => x.id === card.dataset.sheetId);
    if(s){ s[field] = e.target.textContent; saveLS(LS_SHEETS_KEY, sheets); }
  });
  document.getElementById('tb-project').addEventListener('input', (e)=>{ e.target.dataset.touched = '1'; });
  document.getElementById('tb-print').addEventListener('click', ()=> window.print());

  document.getElementById('tb-generate').addEventListener('click', async ()=>{
    const raw = document.getElementById('tb-input').value.trim();
    const room = document.getElementById('tb-room').value.trim();
    const loc = document.getElementById('tb-loc').value.trim();
    const errEl = document.getElementById('tb-error');
    errEl.style.display = 'none';
    if(!raw){
      errEl.textContent = 'Paste a product URL or schedule row first.';
      errEl.style.display = 'block';
      return;
    }
    const btn = document.getElementById('tb-generate');
    const loading = document.getElementById('tb-loading');
    btn.disabled = true;
    loading.style.display = 'inline';
    try{
      const { item } = await api('/api/ai/tear-sheet', { method:'POST', body: JSON.stringify({ raw, room, loc }) });
      sheets.push({ id: uid(), ...item });
      document.getElementById('tb-input').value = '';
      render();
    }catch(err){
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }finally{
      btn.disabled = false;
      loading.style.display = 'none';
    }
  });

  async function populateScheduleSelect(){
    const sel = document.getElementById('tb-schedule-select');
    if(!window.EPCurrentProject){
      sel.innerHTML = '<option value="">Open Schedule Builder first</option>';
      scheduleItems = [];
      return;
    }
    const projInput = document.getElementById('tb-project');
    if(!projInput.dataset.touched){
      projInput.value = window.EPCurrentProject.name;
    }
    try{
      const schedule = await api('/api/projects/' + window.EPCurrentProject.id + '/schedule');
      scheduleItems = [];
      (schedule.rooms||[]).forEach(room=>{
        (room.items||[]).forEach(it=>{
          if(it.item) scheduleItems.push({ ...it, room: room.name });
        });
      });
      if(!scheduleItems.length){
        sel.innerHTML = '<option value="">No items in Schedule yet</option>';
        return;
      }
      sel.innerHTML = scheduleItems.map((it,i) => `<option value="${i}">${escapeHtml(it.room)} — ${escapeHtml(it.item)}</option>`).join('');
    }catch(err){
      sel.innerHTML = '<option value="">Couldn\'t load Schedule</option>';
      scheduleItems = [];
    }
  }
  window.addEventListener('ep:project-changed', ()=>{
    document.getElementById('tb-project').removeAttribute('data-touched');
    populateScheduleSelect();
    pullShareHistory();
  });
  document.getElementById('tb-schedule-refresh').addEventListener('click', populateScheduleSelect);

  document.getElementById('tb-schedule-generate').addEventListener('click', ()=>{
    const idx = document.getElementById('tb-schedule-select').value;
    if(idx === '' || !scheduleItems[idx]) return;
    const it = scheduleItems[idx];
    const clientPrice = (it.tradeCost||0) + (it.markupAmt||0);
    sheets.push({
      id: uid(),
      itemName: it.item,
      room: it.room,
      category: it.category,
      dimensions: it.dims || 'TBD',
      investment: clientPrice ? ('$' + clientPrice.toLocaleString(undefined,{maximumFractionDigits:0})) : 'Pricing on request',
      leadTime: it.leadTime || 'TBD',
      designerNotes: it.notes || '',
      imageUrl: it.imageUrl || ''
    });
    render();
  });

  // ---- Share for signature ----

  async function pullShareHistory(){
    if(!window.EPCurrentProject) return;
    try{
      shareHistory = await api('/api/projects/' + window.EPCurrentProject.id + '/tear-sheet-shares');
      renderShareHistory();
    }catch(err){ /* non-fatal — history just stays stale */ }
  }

  function renderShareHistory(){
    const wrap = document.getElementById('tb-share-history-wrap');
    const empty = document.getElementById('tb-share-history-empty');
    if(!wrap) return;
    empty.style.display = shareHistory.length ? 'none' : 'block';
    wrap.innerHTML = shareHistory.map(h => {
      const origin = location.origin;
      const url = origin + '/share/' + h.token;
      const signed = !!h.signedAt;
      return `
      <div class="iv-history-item" data-token="${escapeHtml(h.token)}" style="cursor:pointer;flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%;flex-wrap:wrap;gap:8px;">
          <div>
            <div class="iv-history-id">${escapeHtml(h.projectName || 'Proposal')} — ${h.items.length} item${h.items.length===1?'':'s'}</div>
            <div class="iv-history-meta">${new Date(h.createdAt).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})} · ${signed ? 'Signed by ' + escapeHtml(h.signerName) : 'Awaiting signature'} · click to view</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="sb-invoiced-badge" style="background:${signed?'var(--success)':'var(--muted)'};">${signed?'Signed':'Pending'}</span>
            <button class="tb-btn tb-btn-ghost tb-btn-sm" data-action="copy-link" data-url="${escapeHtml(url)}" type="button">Copy link</button>
          </div>
        </div>
        <div class="iv-history-detail" style="display:none;margin-top:12px;"></div>
      </div>`;
    }).join('');
  }

  document.getElementById('tb-share-history-wrap') && document.getElementById('tb-share-history-wrap').addEventListener('click', async e=>{
    if(e.target.dataset.action === 'copy-link'){
      navigator.clipboard.writeText(e.target.dataset.url).then(()=>{
        const old = e.target.textContent; e.target.textContent = 'Copied!'; setTimeout(()=>e.target.textContent = old, 1400);
      });
      return;
    }
    const row = e.target.closest('[data-token]');
    if(!row) return;
    const detail = row.querySelector('.iv-history-detail');
    if(detail.style.display === 'block'){ detail.style.display = 'none'; return; }
    detail.style.display = 'block';
    const h = shareHistory.find(x => x.token === row.dataset.token);
    if(!h) return;
    const signedHtml = h.signedAt
      ? `<div style="margin-top:10px;"><b>Signature:</b><br/><img src="${h.signature}" style="max-width:240px;border:1px solid var(--border);border-radius:3px;background:#fff;margin-top:6px;"/></div>`
      : '';
    detail.innerHTML = `<div class="ts-share-grid" style="margin-bottom:0;">${h.items.map(it => `
        <div class="ts-share-card">
          <div class="ts-share-card-img">${it.imageUrl ? `<img src="${proxiedImg(it.imageUrl)}" referrerpolicy="no-referrer"/>` : `<div class="ts-share-ph">No image</div>`}</div>
          <div class="ts-share-card-body">
            <div class="ts-share-card-name">${escapeHtml(it.itemName)}${it.approved ? ' ✓' : ''}</div>
            <div class="ts-share-card-row"><span>Investment</span><b>${escapeHtml(it.investment||'')}</b></div>
          </div>
        </div>`).join('')}</div>${signedHtml}`;
  });

  document.getElementById('tb-share').addEventListener('click', async ()=>{
    const errEl = document.getElementById('tb-share-error');
    const msgEl = document.getElementById('tb-share-msg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    if(!sheets.length){
      errEl.textContent = 'Add at least one item above before sharing.';
      errEl.style.display = 'block';
      return;
    }
    if(!window.EPCurrentProject){
      errEl.textContent = "Can't tell which project is active — open Schedule Builder first.";
      errEl.style.display = 'block';
      return;
    }
    try{
      const created = await api('/api/projects/' + window.EPCurrentProject.id + '/tear-sheet-shares', {
        method:'POST',
        body: JSON.stringify({ projectName: document.getElementById('tb-project').value || window.EPCurrentProject.name, items: sheets })
      });
      const url = location.origin + '/share/' + created.token;
      msgEl.style.display = 'block';
      msgEl.innerHTML = `Link created: <a href="${url}" target="_blank" rel="noopener">${url}</a>`;
      await pullShareHistory();
    }catch(err){
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  setTimeout(()=>{ populateScheduleSelect(); pullShareHistory(); }, 300);
  render();
})();
