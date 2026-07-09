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
    wrap.innerHTML = '';
    empty.style.display = sheets.length ? 'none' : 'block';
    footer.style.display = sheets.length ? 'flex' : 'none';

    const project = document.getElementById('tb-project').value || 'Untitled Residence';
    const date = document.getElementById('tb-date').value;

    sheets.forEach(s => {
      const controls = document.createElement('div');
      controls.className = 'tb-sheet-controls tb-noprint';
      controls.innerHTML = `<button class="tb-btn tb-btn-ghost tb-btn-sm" data-action="del" data-id="${s.id}">Remove</button>`;
      wrap.appendChild(controls);

      const card = document.createElement('div');
      card.className = 'tb-sheet';
      const imgHtml = s.imageUrl
        ? `<img src="${proxiedImg(s.imageUrl)}" alt="${escapeHtml(s.itemName)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;tb-ph&quot;>No image found —<br/>reference product page</div>'"/>`
        : `<div class="tb-ph">No image found —<br/>reference product page</div>`;
      card.innerHTML = `
        <div class="tb-sheet-head">
          <div class="tb-sheet-brand">
            <img src="/assets/crest.png" alt="E.P. Interiors"/>
            <div>
              <div class="tb-sheet-brand-text">E.P. INTERIORS</div>
              <div class="tb-sheet-brand-sub">Thoughtful Spaces, Intentional Living</div>
            </div>
          </div>
          <div class="tb-sheet-meta-r">${escapeHtml(date)}<br/>${escapeHtml(project)}</div>
        </div>
        <div class="tb-sheet-eyebrow">${escapeHtml(s.room || 'General')} / ${escapeHtml(s.category || 'Item')}</div>
        <div class="tb-sheet-name" contenteditable="true">${escapeHtml(s.itemName)}</div>
        <div class="tb-sheet-img">${imgHtml}</div>
        <div class="tb-sheet-specs">
          <div class="tb-spec-row"><div class="tb-spec-label">Project / Room</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(project)} — ${escapeHtml(s.room||'')}</div></div>
          <div class="tb-spec-row"><div class="tb-spec-label">Install Location</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(s.installLocation||'TBD')}</div></div>
          <div class="tb-spec-row"><div class="tb-spec-label">Dimensions</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(s.dimensions||'TBD')}</div></div>
          <div class="tb-spec-row"><div class="tb-spec-label">Material / Finish</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(s.materialFinish||'TBD')}</div></div>
          <div class="tb-spec-row"><div class="tb-spec-label">Quantity</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(s.quantity||'1')}</div></div>
          <div class="tb-spec-row"><div class="tb-spec-label">Investment</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(s.investment||'Pricing on request')}</div></div>
          <div class="tb-spec-row"><div class="tb-spec-label">Lead Time</div><div class="tb-spec-value" contenteditable="true">${escapeHtml(s.leadTime||'TBD')}</div></div>
        </div>
        <div class="tb-sheet-notes" contenteditable="true">${escapeHtml(s.designerNotes || 'Designer notes — click to add context on why this piece was selected.')}</div>
        <div class="tb-sheet-approval">
          <div class="tb-approval-line"><div class="line"></div><div class="cap">Client Approval</div></div>
          <div class="tb-approval-line"><div class="line"></div><div class="cap">Date</div></div>
        </div>
      `;
      wrap.appendChild(card);
    });
  }

  document.getElementById('tb-sheets').addEventListener('click', e=>{
    if(e.target.dataset.action === 'del'){
      sheets = sheets.filter(s => s.id !== e.target.dataset.id);
      render();
    }
  });
  document.getElementById('tb-project').addEventListener('input', (e)=>{ e.target.dataset.touched = '1'; render(); });
  document.getElementById('tb-date').addEventListener('input', render);
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
  });
  document.getElementById('tb-schedule-refresh').addEventListener('click', populateScheduleSelect);

  document.getElementById('tb-schedule-generate').addEventListener('click', ()=>{
    const idx = document.getElementById('tb-schedule-select').value;
    if(idx === '' || !scheduleItems[idx]) return;
    const it = scheduleItems[idx];
    const loc = document.getElementById('tb-schedule-loc').value.trim();
    const clientPrice = (it.tradeCost||0) + (it.markupAmt||0);
    sheets.push({
      id: uid(),
      itemName: it.item,
      room: it.room,
      category: it.category,
      installLocation: loc || 'TBD',
      dimensions: it.dims || 'TBD',
      materialFinish: it.finish || 'TBD',
      quantity: String(it.qty || 1),
      investment: clientPrice ? ('$' + clientPrice.toLocaleString(undefined,{maximumFractionDigits:0})) : 'Pricing on request',
      leadTime: it.leadTime || 'TBD',
      designerNotes: it.notes || '',
      imageUrl: it.imageUrl || ''
    });
    render();
  });

  setTimeout(populateScheduleSelect, 300);
  render();
})();
