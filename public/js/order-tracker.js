(function(){
  const STATUSES = ["Considering","Proposed","Approved","Ordered","Order Confirmed","Backordered","Shipped","Received","Installed","Returned"];
  const STATUS_COLOR = {
    "Considering":"#E9E9EC;color:#55565B","Proposed":"#6B4FA0;color:#FFFFFF","Approved":"#DDF3E4;color:#2F855A",
    "Ordered":"#1F6F4A;color:#FFFFFF","Order Confirmed":"#DCEEFB;color:#2B6CB0","Backordered":"#FCE9C9;color:#92600B",
    "Shipped":"#FBDCE0;color:#B23A48","Received":"#E6DFF7;color:#6B4FA0","Installed":"#CFE8F5;color:#1B5E82","Returned":"#FBE1D3;color:#A6491F"
  };

  let items = []; // {id, poId, item, vendor, room, status, source}
  let lastFlags = [];
  let lastUpdatedIds = new Set();

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

  async function pullFromSchedule(){
    const errEl = document.getElementById('ot-error');
    if(!window.EPCurrentProject){
      errEl.style.display='block';
      errEl.textContent = "Can't tell which project is active — open the Schedule tab at least once this session, then come back.";
      return;
    }
    errEl.style.display='none';
    document.getElementById('ot-project-label').textContent = 'Project: ' + window.EPCurrentProject.name;
    try{
      const { items: fetched } = await api('/api/projects/' + window.EPCurrentProject.id + '/tracked-items');
      items = fetched.map(it => ({
        id: it.id, poId: it.poId, item: it.item, vendor: it.vendor, room: it.room, status: it.status, source: 'Schedule'
      }));
      lastUpdatedIds = new Set();
      renderStats(0);
      renderTable();
    }catch(err){
      errEl.style.display='block';
      errEl.textContent = err.message;
    }
  }

  function renderStats(updatedCount){
    const statsEl = document.getElementById('ot-stats');
    statsEl.style.display = items.length ? 'flex' : 'none';
    document.getElementById('ot-stat-total').textContent = items.length;
    document.getElementById('ot-stat-updated').textContent = updatedCount;
    document.getElementById('ot-stat-flags').textContent = lastFlags.length;
  }

  function renderFlags(){
    const wrap = document.getElementById('ot-flags-wrap');
    if(!lastFlags.length){ wrap.innerHTML=''; return; }
    wrap.innerHTML = `<div class="ot-section-label">Flags</div><ul class="ot-flags">${lastFlags.map(f=>`<li>△ ${escapeHtml(f)}</li>`).join('')}</ul>`;
  }

  function renderTable(){
    const wrap = document.getElementById('ot-table-wrap');
    document.getElementById('ot-empty').style.display = items.length ? 'none' : 'block';
    if(!items.length){ wrap.innerHTML=''; return; }
    const rows = items.map(it => {
      const colors = (STATUS_COLOR[it.status]||STATUS_COLOR['Considering']).split(';color:');
      return `
      <tr>
        <td class="ot-mono">${escapeHtml(it.poId)}</td>
        <td>${escapeHtml(it.room)}</td>
        <td>${escapeHtml(it.item)}</td>
        <td>${escapeHtml(it.vendor)}</td>
        <td>
          <select class="ot-status-select" data-id="${it.id}" style="background:${colors[0]};color:${colors[1]}">
            ${STATUSES.map(s=>`<option ${s===it.status?'selected':''}>${s}</option>`).join('')}
          </select>
          ${lastUpdatedIds.has(it.id) ? '<div class="ot-updated-flag">updated</div>' : ''}
        </td>
        <td class="ot-mono">${escapeHtml(it.source)}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `
      <div class="ot-section-label">Tracked Items</div>
      <table class="ot-table">
        <thead><tr><th>PO</th><th>Room</th><th>Item</th><th>Vendor</th><th>Status</th><th>Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll('.ot-status-select').forEach(sel=>{
      sel.addEventListener('change', async e=>{
        const id = Number(e.target.dataset.id);
        const newStatus = e.target.value;
        const it = items.find(i=>i.id===id);
        if(it){ it.status = newStatus; it.source = 'Manual'; }
        try{ await api('/api/items/' + id, { method:'PATCH', body: JSON.stringify({ status: newStatus }) }); }
        catch(err){ document.getElementById('ot-error').style.display='block'; document.getElementById('ot-error').textContent = err.message; }
        renderTable();
      });
    });
  }

  function renderDraft(text){
    const wrap = document.getElementById('ot-draft-wrap');
    if(!text){ wrap.innerHTML=''; return; }
    wrap.innerHTML = `
      <div class="ot-section-label">Client Update — Draft</div>
      <div class="ot-draft">
        <div class="ot-draft-label">Edit freely, then copy into your email client</div>
        <textarea id="ot-draft-text">${escapeHtml(text)}</textarea>
        <div class="ot-toolbar" style="margin-top:10px;margin-bottom:0;">
          <button class="ot-btn ot-btn-ghost ot-btn-sm" id="ot-copy-draft">Copy draft</button>
        </div>
      </div>`;
    document.getElementById('ot-copy-draft').addEventListener('click', ()=>{
      navigator.clipboard.writeText(document.getElementById('ot-draft-text').value).then(()=>{
        const b = document.getElementById('ot-copy-draft');
        const old = b.textContent; b.textContent='Copied!'; setTimeout(()=>b.textContent=old,1400);
      });
    });
  }

  document.getElementById('ot-refresh').addEventListener('click', pullFromSchedule);
  window.addEventListener('ep:project-changed', pullFromSchedule);

  document.getElementById('ot-scan').addEventListener('click', async ()=>{
    const raw = document.getElementById('ot-input').value.trim();
    const errEl = document.getElementById('ot-error');
    errEl.style.display = 'none';
    if(!raw){
      errEl.textContent = 'Paste in some updates to scan first.';
      errEl.style.display = 'block';
      return;
    }
    if(!items.length){
      errEl.textContent = "Nothing tracked yet — refresh from Schedule first so there's something to match updates against.";
      errEl.style.display = 'block';
      return;
    }
    const btn = document.getElementById('ot-scan');
    const loading = document.getElementById('ot-loading');
    btn.disabled = true;
    loading.style.display = 'inline';
    try{
      const result = await api('/api/ai/order-tracker-scan', {
        method:'POST',
        body: JSON.stringify({ projectId: window.EPCurrentProject.id, projectName: window.EPCurrentProject.name, rawText: raw })
      });
      lastUpdatedIds = new Set((result.updates||[]).map(u=>Number(u.id)));
      (result.updates||[]).forEach(u=>{
        const it = items.find(i=>i.id===Number(u.id));
        if(it){ it.status = u.newStatus; it.source = 'Scan'; }
      });
      lastFlags = result.flags || [];

      renderTable();
      renderStats((result.updates||[]).length);
      renderFlags();
      renderDraft(result.clientEmailDraft || '');
      document.getElementById('ot-input').value = '';
    }catch(err){
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }finally{
      btn.disabled = false;
      loading.style.display = 'none';
    }
  });

  setTimeout(pullFromSchedule, 300);
})();
