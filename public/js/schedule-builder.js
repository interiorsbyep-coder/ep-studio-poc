(function(){
  const CATEGORIES = ["Upholstery","Case Goods","Lighting","Rugs","Accessories","Window Treatments","Other"];
  const STATUSES = ["Considering","Proposed","Approved","Ordered","Order Confirmed","Backordered","Shipped","Received","Installed","Returned"];
  const STATUS_COLOR = {
    "Considering":"#E9E9EC;color:#55565B",
    "Proposed":"#6B4FA0;color:#FFFFFF",
    "Approved":"#DDF3E4;color:#2F855A",
    "Ordered":"#1F6F4A;color:#FFFFFF",
    "Order Confirmed":"#DCEEFB;color:#2B6CB0",
    "Backordered":"#FCE9C9;color:#92600B",
    "Shipped":"#FBDCE0;color:#B23A48",
    "Received":"#E6DFF7;color:#6B4FA0",
    "Installed":"#CFE8F5;color:#1B5E82",
    "Returned":"#FBE1D3;color:#A6491F"
  };

  let state = { rooms: [] };
  let expandedItems = new Set();
  let projects = []; // [{id, name}]
  let currentProjectId = null;
  const itemSaveTimers = new Map();

  async function api(path, options){
    const res = await fetch(path, Object.assign({ headers: {'Content-Type':'application/json'} }, options));
    let data = null;
    try{ data = await res.json(); }catch(e){ /* empty body, e.g. 204 */ }
    if(!res.ok){
      throw new Error((data && data.error) || res.statusText || 'Request failed');
    }
    return data;
  }

  function findRoom(roomId){ return (state.rooms||[]).find(r => String(r.id) === String(roomId)); }
  function findItem(room, itemId){ return room && (room.items||[]).find(i => String(i.id) === String(itemId)); }

  const LS_PROJECT_KEY = 'ep-current-project-id';

  async function initProjects(){
    projects = await api('/api/projects');
    if(projects.length === 0){
      const p = await api('/api/projects', { method:'POST', body: JSON.stringify({ name: 'Untitled Residence' }) });
      projects = [p];
    }
    const savedId = Number(localStorage.getItem(LS_PROJECT_KEY));
    currentProjectId = projects.find(p => p.id === savedId) ? savedId : projects[0].id;
    renderProjectSelect();
    await loadSchedule(currentProjectId);
  }

  async function loadSchedule(projectId){
    const schedule = await api('/api/projects/' + projectId + '/schedule');
    state = { rooms: schedule.rooms };
    populateClientInfo(schedule.project);
  }

  function populateClientInfo(project){
    document.getElementById('sb-client-name').value = project.clientName || '';
    document.getElementById('sb-client-email').value = project.clientEmail || '';
    document.getElementById('sb-client-phone').value = project.clientPhone || '';
    document.getElementById('sb-client-address').value = project.clientAddress || '';
  }

  const CLIENT_FIELD_MAP = { 'sb-client-name':'clientName', 'sb-client-email':'clientEmail', 'sb-client-phone':'clientPhone', 'sb-client-address':'clientAddress' };
  Object.keys(CLIENT_FIELD_MAP).forEach(id => {
    document.getElementById(id).addEventListener('change', async (e)=>{
      if(!currentProjectId) return;
      const statusEl = document.getElementById('sb-client-status');
      try{
        await api('/api/projects/' + currentProjectId, { method:'PATCH', body: JSON.stringify({ [CLIENT_FIELD_MAP[id]]: e.target.value }) });
        statusEl.style.display = 'inline';
        setTimeout(()=>statusEl.style.display='none', 1200);
      }catch(err){
        showError('sb-error', err.message);
      }
    });
  });

  function currentProjectName(){
    const p = (projects||[]).find(p=>p.id===currentProjectId);
    return p ? p.name : 'Untitled Residence';
  }

  function renderProjectSelect(){
    const sel = document.getElementById('sb-project-select');
    sel.innerHTML = (projects||[]).map(p=>`<option value="${p.id}" ${p.id===currentProjectId?'selected':''}>${p.name.replace(/</g,'&lt;')}</option>`).join('');
    broadcastCurrentProject();
  }

  // Other tool panels (e.g. Sourcing Specialist) need to know which project is active
  // to know where "+ Schedule" pushes items — this is the cheapest way to share that
  // without restructuring Schedule Builder's own UI.
  function broadcastCurrentProject(){
    window.EPCurrentProject = currentProjectId ? { id: currentProjectId, name: currentProjectName() } : null;
    if(currentProjectId) localStorage.setItem(LS_PROJECT_KEY, String(currentProjectId));
    window.dispatchEvent(new CustomEvent('ep:project-changed', { detail: window.EPCurrentProject }));
  }

  document.getElementById('sb-project-select').addEventListener('change', async (e)=>{
    currentProjectId = Number(e.target.value);
    await loadSchedule(currentProjectId);
    broadcastCurrentProject();
    render();
  });

  function showInlineForm(prefill, onSave){
    const form = document.getElementById('sb-project-form');
    const input = document.getElementById('sb-project-form-input');
    form.style.display = 'flex';
    input.value = prefill;
    input.focus();
    const save = document.getElementById('sb-project-form-save');
    const cancel = document.getElementById('sb-project-form-cancel');
    function cleanup(){ form.style.display='none'; save.onclick=null; cancel.onclick=null; }
    save.onclick = async ()=>{
      const v = input.value.trim();
      if(v){
        try{ await onSave(v); }
        catch(err){ showError('sb-error', err.message); }
      }
      cleanup();
    };
    cancel.onclick = cleanup;
  }

  function showError(elId, msg){
    const el = document.getElementById(elId);
    el.textContent = msg;
    el.style.display = 'block';
  }

  document.getElementById('sb-project-new').addEventListener('click', ()=>{
    showInlineForm('', async (name)=>{
      const p = await api('/api/projects', { method:'POST', body: JSON.stringify({ name }) });
      projects.push(p);
      currentProjectId = p.id;
      state = { rooms: [] };
      renderProjectSelect();
      render();
    });
  });
  document.getElementById('sb-project-rename').addEventListener('click', ()=>{
    showInlineForm(currentProjectName(), async (name)=>{
      const p = await api('/api/projects/' + currentProjectId, { method:'PATCH', body: JSON.stringify({ name }) });
      const idx = projects.findIndex(x=>x.id===currentProjectId);
      if(idx>=0) projects[idx] = p;
      renderProjectSelect();
    });
  });
  document.getElementById('sb-project-delete').addEventListener('click', ()=>{
    if(projects.length <= 1){
      showError('sb-error', "Can't delete your only project.");
      return;
    }
    document.getElementById('sb-project-delete-name').textContent = currentProjectName();
    document.getElementById('sb-project-delete-confirm').style.display = 'flex';
  });
  document.getElementById('sb-project-delete-no').addEventListener('click', ()=>{
    document.getElementById('sb-project-delete-confirm').style.display = 'none';
  });
  document.getElementById('sb-project-delete-yes').addEventListener('click', async ()=>{
    try{
      await api('/api/projects/' + currentProjectId, { method:'DELETE' });
      projects = projects.filter(p=>p.id!==currentProjectId);
      currentProjectId = projects[0].id;
      await loadSchedule(currentProjectId);
      renderProjectSelect();
      render();
    }catch(err){
      showError('sb-error', err.message);
    }
    document.getElementById('sb-project-delete-confirm').style.display = 'none';
  });

  document.getElementById('sb-date').value = new Date().toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'});

  function money(n){ return '$' + (Math.round((n||0)*100)/100).toLocaleString(undefined,{minimumFractionDigits:0, maximumFractionDigits:2}); }
  function round2(n){ return Math.round((n||0)*100)/100; }

  // Recomputes derived pricing fields on an item. `changed` is the field name just edited
  // by the person, if any — determines which side of each markup pair drives the other.
  function recomputePricing(it, changed){
    const tc = it.tradeCost||0, sc = it.shippingCost||0;
    if(changed==='markupAmt'){
      it.markupPct = tc ? (it.markupAmt/tc*100) : 0;
    } else {
      it.markupAmt = tc * (it.markupPct||0)/100;
    }
    if(changed==='shippingMarkupAmt'){
      it.shippingMarkupPct = sc ? (it.shippingMarkupAmt/sc*100) : 0;
    } else {
      it.shippingMarkupAmt = sc * (it.shippingMarkupPct||0)/100;
    }
  }
  function clientPrice(it){ return (it.tradeCost||0) + (it.markupAmt||0); }
  function clientShipping(it){ return (it.shippingCost||0) + (it.shippingMarkupAmt||0); }
  function receivingCostTotal(it){ return (it.receivingCost||0) * (it.qty||0); }
  function clientReceiving(it){ return receivingCostTotal(it) * (1 + (it.receivingMarkupPct||0)/100); }
  function lineTotalClient(it){ return clientPrice(it) * (it.qty||0); }
  function tradeTaxAmt(it){ return ((it.tradeCost||0)*(it.qty||0)) * (it.tradeTaxPct||0)/100; }
  function clientTaxAmt(it){ return lineTotalClient(it) * (it.clientTaxPct||0)/100; }
  function totalCostAllIn(it){ return (it.tradeCost||0)*(it.qty||0) + tradeTaxAmt(it) + (it.shippingCost||0) + receivingCostTotal(it); }
  function totalClientAllIn(it){ return lineTotalClient(it) + clientTaxAmt(it) + clientShipping(it) + clientReceiving(it); }
  function profitAmt(it){ return totalClientAllIn(it) - totalCostAllIn(it); }
  function profitMarginPct(it){ const t = totalClientAllIn(it); return t ? (profitAmt(it)/t*100) : 0; }

  function render(){
    const wrap = document.getElementById('sb-rooms');
    wrap.innerHTML = '';
    document.getElementById('sb-empty').style.display = state.rooms.reduce((a,r)=>a+r.items.length,0)===0 ? 'block':'none';

    let totalItems = 0, totalClient = 0;

    state.rooms.forEach(room => {
      totalItems += room.items.length;
      const roomEl = document.createElement('div');
      roomEl.className = 'sb-room';

      const head = document.createElement('div');
      head.className = 'sb-room-head';
      head.innerHTML = `
        <input class="sb-room-name" data-room="${room.id}" value="${escapeAttr(room.name)}"/>
        <div class="sb-room-tools">
          <button class="sb-btn sb-btn-ghost sb-btn-sm" data-action="add-item" data-room="${room.id}">+ Item</button>
          <button class="sb-btn sb-btn-ghost sb-btn-sm" data-action="del-room" data-room="${room.id}">Remove room</button>
        </div>`;
      roomEl.appendChild(head);

      const tableWrap = document.createElement('div');
      tableWrap.className = 'sb-table-wrap';
      const table = document.createElement('table');
      table.className = 'sb-table';
      table.innerHTML = `
        <thead><tr>
          <th>Image</th><th>Room</th><th>Category</th><th>Item</th><th>Vendor</th><th>SKU</th><th>Finish / Material</th>
          <th>Dimensions</th><th>Qty</th><th>Lead Time</th><th>Status</th><th>Invoice</th><th>Pricing</th><th></th>
        </tr></thead>`;
      const tbody = document.createElement('tbody');

      room.items.forEach(it => {
        totalClient += totalClientAllIn(it);
        const tr = document.createElement('tr');
        const isExpanded = expandedItems.has(String(it.id));
        tr.innerHTML = `
          <td>
            <div class="sb-thumb" data-thumb-for="${it.id}">${thumbHtml(it)}</div>
            <input class="sb-mono sb-url-mini" data-field="imageUrl" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.imageUrl)}" placeholder="image url" title="Saved for records/export — won't preview here, click 🔗 to view"/>
          </td>
          <td><input class="sb-mono" data-move-room="${it.id}" value="${escapeAttr(room.name)}" list="sb-room-options" title="Change which room this item belongs to" style="width:90px;"/></td>
          <td><select data-field="category" data-room="${room.id}" data-item="${it.id}">${CATEGORIES.map(c=>`<option ${c===it.category?'selected':''}>${c}</option>`).join('')}</select></td>
          <td>
            <div style="display:flex;align-items:center;gap:5px;">
              <input data-field="item" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.item)}" placeholder="Item name" style="flex:1;"/>
              <span data-link-for="${it.id}">${linkHtml(it)}</span>
            </div>
            <input class="sb-mono sb-url-mini" data-field="sourceUrl" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.sourceUrl)}" placeholder="product url" title="Paste the product page URL"/>
          </td>
          <td><input data-field="vendor" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.vendor)}" placeholder="Vendor"/></td>
          <td><input class="sb-mono" data-field="sku" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.sku)}" placeholder="TBD"/></td>
          <td><input data-field="finish" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.finish)}" placeholder="TBD"/></td>
          <td><input class="sb-mono" data-field="dims" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.dims)}" placeholder="TBD"/></td>
          <td><input class="sb-mono sb-num" type="number" min="0" data-field="qty" data-room="${room.id}" data-item="${it.id}" value="${it.qty}"/></td>
          <td><input class="sb-mono" data-field="leadTime" data-room="${room.id}" data-item="${it.id}" value="${escapeAttr(it.leadTime)}" placeholder="TBD" style="width:60px;"/></td>
          <td><select data-field="status" data-room="${room.id}" data-item="${it.id}" class="sb-status" style="background:${(STATUS_COLOR[it.status]||STATUS_COLOR['Considering']).split(';')[0]};color:${(STATUS_COLOR[it.status]||STATUS_COLOR['Considering']).split('color:')[1]}">${STATUSES.map(s=>`<option ${s===it.status?'selected':''}>${s}</option>`).join('')}</select></td>
          <td style="text-align:center;">
            <input type="checkbox" class="sb-invoice-check" data-field="includeOnInvoice" data-room="${room.id}" data-item="${it.id}" ${it.includeOnInvoice?'checked':''} title="Include on invoice"/>
            ${it.invoicedId ? `<div class="sb-invoiced-badge" title="Already invoiced">${escapeHtmlLite(it.invoicedId)}</div>` : ''}
            ${it.poId ? `<div class="sb-invoiced-badge" style="background:var(--brass);" title="Already on a PO">${escapeHtmlLite(it.poId)}</div>` : ''}
          </td>
          <td class="sb-mono sb-computed" data-total-cell="${it.id}"><span class="sb-row-total">${money(totalClientAllIn(it))}</span><br/><button class="sb-expand-btn" data-action="toggle-drawer" data-room="${room.id}" data-item="${it.id}">${isExpanded?'Hide':'Pricing'} ▾</button></td>
          <td><button class="sb-del" data-action="del-item" data-room="${room.id}" data-item="${it.id}" title="Remove item">×</button></td>
        `;
        tbody.appendChild(tr);

        if(isExpanded){
          const drawerTr = document.createElement('tr');
          drawerTr.className = 'sb-drawer-row';
          drawerTr.dataset.drawerFor = it.id;
          const profitCls = profitAmt(it) >= 0 ? 'profit-pos' : 'profit-neg';
          drawerTr.innerHTML = `<td colspan="14"><div class="sb-drawer">
            <div class="sb-drawer-group">
              <div class="sb-drawer-group-label">Product</div>
              <div class="sb-drawer-field"><label>Trade Cost</label><input class="sb-mono" type="number" min="0" step="0.01" data-field="tradeCost" data-room="${room.id}" data-item="${it.id}" value="${it.tradeCost}"/></div>
              <div class="sb-drawer-field"><label>Markup %</label><input class="sb-mono" type="number" step="0.1" data-field="markupPct" data-room="${room.id}" data-item="${it.id}" value="${round2(it.markupPct)}"/></div>
              <div class="sb-drawer-field"><label>Markup $</label><input class="sb-mono" type="number" step="0.01" data-field="markupAmt" data-room="${room.id}" data-item="${it.id}" value="${round2(it.markupAmt)}"/></div>
              <div class="sb-drawer-field"><label>Client Price</label><span class="sb-computed-val" data-computed="clientPrice">${money(clientPrice(it))}</span></div>
              <div class="sb-drawer-field"><label>Line Total (Client)</label><span class="sb-computed-val" data-computed="lineTotalClient">${money(lineTotalClient(it))}</span></div>
            </div>
            <div class="sb-drawer-group">
              <div class="sb-drawer-group-label">Tax</div>
              <div class="sb-drawer-field"><label>Trade Tax %</label><input class="sb-mono" type="number" step="0.1" data-field="tradeTaxPct" data-room="${room.id}" data-item="${it.id}" value="${it.tradeTaxPct}"/></div>
              <div class="sb-drawer-field"><label>Trade Tax $</label><span class="sb-computed-val" data-computed="tradeTaxAmt">${money(tradeTaxAmt(it))}</span></div>
              <div class="sb-drawer-field"><label>Client Tax %</label><input class="sb-mono" type="number" step="0.1" data-field="clientTaxPct" data-room="${room.id}" data-item="${it.id}" value="${it.clientTaxPct}"/></div>
              <div class="sb-drawer-field"><label>Client Tax $</label><span class="sb-computed-val" data-computed="clientTaxAmt">${money(clientTaxAmt(it))}</span></div>
            </div>
            <div class="sb-drawer-group">
              <div class="sb-drawer-group-label">Shipping</div>
              <div class="sb-drawer-field"><label>Shipping Cost</label><input class="sb-mono" type="number" min="0" step="0.01" data-field="shippingCost" data-room="${room.id}" data-item="${it.id}" value="${it.shippingCost}"/></div>
              <div class="sb-drawer-field"><label>Ship Markup %</label><input class="sb-mono" type="number" step="0.1" data-field="shippingMarkupPct" data-room="${room.id}" data-item="${it.id}" value="${round2(it.shippingMarkupPct)}"/></div>
              <div class="sb-drawer-field"><label>Ship Markup $</label><input class="sb-mono" type="number" step="0.01" data-field="shippingMarkupAmt" data-room="${room.id}" data-item="${it.id}" value="${round2(it.shippingMarkupAmt)}"/></div>
              <div class="sb-drawer-field"><label>Client Shipping</label><span class="sb-computed-val" data-computed="clientShipping">${money(clientShipping(it))}</span></div>
            </div>
            <div class="sb-drawer-group">
              <div class="sb-drawer-group-label">Receiving</div>
              <div class="sb-drawer-field"><label>Receiving Cost / Unit</label><input class="sb-mono" type="number" min="0" step="0.01" data-field="receivingCost" data-room="${room.id}" data-item="${it.id}" value="${it.receivingCost}"/></div>
              <div class="sb-drawer-field"><label>Receiving Markup %</label><input class="sb-mono" type="number" step="0.1" data-field="receivingMarkupPct" data-room="${room.id}" data-item="${it.id}" value="${round2(it.receivingMarkupPct)}"/></div>
              <div class="sb-drawer-field"><label>Client Receiving</label><span class="sb-computed-val" data-computed="clientReceiving">${money(clientReceiving(it))}</span></div>
            </div>
            <div class="sb-drawer-group">
              <div class="sb-drawer-group-label">Notes</div>
              <textarea data-field="notes" data-room="${room.id}" data-item="${it.id}" placeholder="Internal notes...">${escapeHtmlLite(it.notes)}</textarea>
            </div>
            <div class="sb-drawer-summary">
              <span>TOTAL COST (ALL-IN) <b data-computed="totalCostAllIn">${money(totalCostAllIn(it))}</b></span>
              <span>TOTAL CLIENT (ALL-IN) <b data-computed="totalClientAllIn">${money(totalClientAllIn(it))}</b></span>
              <span>PROFIT <span class="${profitCls}" data-computed="profitAmt">${money(profitAmt(it))}</span></span>
              <span>MARGIN <span class="${profitCls}" data-computed="profitMarginPct">${round2(profitMarginPct(it))}%</span></span>
            </div>
          </div></td>`;
          tbody.appendChild(drawerTr);
        }
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      roomEl.appendChild(tableWrap);

      const addRow = document.createElement('button');
      addRow.className = 'sb-add-row';
      addRow.textContent = '+ add line item';
      addRow.dataset.action = 'add-item';
      addRow.dataset.room = room.id;
      roomEl.appendChild(addRow);

      wrap.appendChild(roomEl);
    });

    document.getElementById('sb-count-rooms').textContent = state.rooms.length;
    document.getElementById('sb-count-items').textContent = totalItems;
    document.getElementById('sb-count-total').textContent = money(totalClient);

    document.getElementById('sb-room-options').innerHTML =
      state.rooms.map(r => `<option value="${escapeAttr(r.name)}"></option>`).join('');
  }

  function escapeAttr(s){ return (s===undefined||s===null?'':String(s)).replace(/"/g,'&quot;'); }
  function proxiedImg(url){
    if(!url) return '';
    if(!/^https?:\/\//i.test(url)) return url;
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&n=-1';
  }
  function escapeHtmlLite(s){ return (s===undefined||s===null?'':String(s)).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function thumbHtml(it){
    return it.imageUrl
      ? `<img src="${escapeAttr(proxiedImg(it.imageUrl))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.querySelector('.sb-thumb-ph').style.display='flex';this.style.display='none';"/><span class="sb-thumb-ph" style="display:none;">&mdash;</span>`
      : '<span class="sb-thumb-ph">&mdash;</span>';
  }
  function linkHtml(it){
    return it.sourceUrl
      ? `<a class="sb-link has-url" href="${escapeAttr(it.sourceUrl)}" target="_blank" rel="noopener" title="Open product page">🔗</a>`
      : `<span class="sb-link" title="Add a link below first">🔗</span>`;
  }

  // Updates just the read-only computed values for one row (and its pricing drawer, if
  // open) in place — used while typing so we never rebuild the table and steal focus
  // mid-keystroke the way a full render() would.
  function updateComputedDisplay(it){
    const totalEl = document.querySelector(`[data-total-cell="${it.id}"] .sb-row-total`);
    if(totalEl) totalEl.textContent = money(totalClientAllIn(it));

    const drawer = document.querySelector(`[data-drawer-for="${it.id}"]`);
    if(!drawer) return;
    const set = (key, val) => { const el = drawer.querySelector(`[data-computed="${key}"]`); if(el) el.textContent = val; };
    set('clientPrice', money(clientPrice(it)));
    set('lineTotalClient', money(lineTotalClient(it)));
    set('tradeTaxAmt', money(tradeTaxAmt(it)));
    set('clientTaxAmt', money(clientTaxAmt(it)));
    set('clientShipping', money(clientShipping(it)));
    set('clientReceiving', money(clientReceiving(it)));
    set('totalCostAllIn', money(totalCostAllIn(it)));
    set('totalClientAllIn', money(totalClientAllIn(it)));
    const profitCls = profitAmt(it) >= 0 ? 'profit-pos' : 'profit-neg';
    const profitEl = drawer.querySelector('[data-computed="profitAmt"]');
    if(profitEl){ profitEl.textContent = money(profitAmt(it)); profitEl.className = profitCls; }
    const marginEl = drawer.querySelector('[data-computed="profitMarginPct"]');
    if(marginEl){ marginEl.textContent = round2(profitMarginPct(it)) + '%'; marginEl.className = profitCls; }
  }

  function updateFooterTotals(){
    let totalItems = 0, totalClient = 0;
    state.rooms.forEach(room => {
      totalItems += room.items.length;
      room.items.forEach(it => totalClient += totalClientAllIn(it));
    });
    document.getElementById('sb-count-rooms').textContent = state.rooms.length;
    document.getElementById('sb-count-items').textContent = totalItems;
    document.getElementById('sb-count-total').textContent = money(totalClient);
  }

  const NUMERIC_FIELDS = ['qty','tradeCost','markupPct','markupAmt','tradeTaxPct','clientTaxPct',
    'shippingCost','shippingMarkupPct','shippingMarkupAmt','receivingCost','receivingMarkupPct'];
  const PRICING_TRIGGER_FIELDS = ['tradeCost','markupPct','markupAmt','shippingCost','shippingMarkupPct','shippingMarkupAmt','qty',
    'tradeTaxPct','clientTaxPct','receivingCost','receivingMarkupPct'];
  const MARKUP_PAIRS = { markupPct:'markupAmt', markupAmt:'markupPct', shippingMarkupPct:'shippingMarkupAmt', shippingMarkupAmt:'shippingMarkupPct' };

  function scheduleItemSave(itemId){
    clearTimeout(itemSaveTimers.get(itemId));
    const t = setTimeout(()=> saveItem(itemId), 500);
    itemSaveTimers.set(itemId, t);
  }

  async function saveItem(itemId){
    const room = state.rooms.find(r => (r.items||[]).some(i=>String(i.id)===String(itemId)));
    const it = findItem(room, itemId);
    if(!it) return;
    const statusEl = document.getElementById('sb-save-status');
    try{
      await api('/api/items/' + itemId, { method:'PATCH', body: JSON.stringify(it) });
      if(statusEl){ statusEl.style.display='inline'; statusEl.textContent='Saved'; setTimeout(()=>statusEl.style.display='none', 1200); }
    }catch(e){
      if(statusEl){ statusEl.style.display='inline'; statusEl.textContent='Save failed — ' + e.message; }
    }
  }

  document.getElementById('sb-rooms').addEventListener('input', e=>{
    const f = e.target.dataset.field, roomId = e.target.dataset.room, itemId = e.target.dataset.item;
    if(!f) return;
    const room = findRoom(roomId);
    if(!room) return;
    if(itemId){
      const it = findItem(room, itemId);
      if(!it) return;
      if(f === 'includeOnInvoice') return; // handled on 'change'
      it[f] = NUMERIC_FIELDS.includes(f) ? (parseFloat(e.target.value)||0) : e.target.value;
      // Deliberately not calling render() here — it rebuilds the whole table and
      // steals focus mid-keystroke, making it impossible to type multi-digit numbers.
      // Only patch the specific bits of the DOM that actually need to change.
      if(PRICING_TRIGGER_FIELDS.includes(f)){
        recomputePricing(it, f);
        updateComputedDisplay(it);
        updateFooterTotals();
        // The other half of a markup %/$ pair is itself an editable input showing a
        // derived value — keep it in sync without touching whichever field is focused.
        const pairField = MARKUP_PAIRS[f];
        if(pairField){
          const pairEl = document.querySelector(`[data-field="${pairField}"][data-item="${it.id}"]`);
          if(pairEl) pairEl.value = round2(it[pairField]);
        }
      } else if(f === 'imageUrl'){
        const thumb = document.querySelector(`[data-thumb-for="${it.id}"]`);
        if(thumb) thumb.innerHTML = thumbHtml(it);
      } else if(f === 'sourceUrl'){
        const link = document.querySelector(`[data-link-for="${it.id}"]`);
        if(link) link.innerHTML = linkHtml(it);
      }
      scheduleItemSave(itemId);
    }
  });
  document.getElementById('sb-rooms').addEventListener('change', async e=>{
    if(e.target.classList.contains('sb-room-name')){
      const roomId = e.target.dataset.room;
      const room = findRoom(roomId);
      if(room){
        room.name = e.target.value || 'Untitled Room';
        try{ await api('/api/rooms/' + roomId, { method:'PATCH', body: JSON.stringify({ name: room.name }) }); }
        catch(err){ showError('sb-error', err.message); }
      }
    }
    if(e.target.dataset.field === 'includeOnInvoice'){
      const room = findRoom(e.target.dataset.room);
      const it = findItem(room, e.target.dataset.item);
      if(it){
        it.includeOnInvoice = e.target.checked;
        try{ await api('/api/items/' + it.id, { method:'PATCH', body: JSON.stringify({ includeOnInvoice: it.includeOnInvoice }) }); }
        catch(err){ showError('sb-error', err.message); }
      }
    }
    if(e.target.dataset.moveRoom){
      const itemId = e.target.dataset.moveRoom;
      const roomName = e.target.value.trim();
      const room = state.rooms.find(r => (r.items||[]).some(i=>String(i.id)===String(itemId)));
      if(room && roomName && roomName.toLowerCase() === room.name.toLowerCase()) return; // unchanged
      try{
        const schedule = await api('/api/items/' + itemId + '/room', { method:'PATCH', body: JSON.stringify({ roomName }) });
        state.rooms = schedule.rooms;
        render();
      }catch(err){
        showError('sb-error', err.message);
      }
    }
  });
  document.getElementById('sb-rooms').addEventListener('click', async e=>{
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const action = el.dataset.action;
    const roomId = el.dataset.room;
    try{
      if(action==='add-item'){
        const { schedule } = await api('/api/rooms/' + roomId + '/items', { method:'POST' });
        state.rooms = schedule.rooms;
        render();
      } else if(action==='del-room'){
        const schedule = await api('/api/rooms/' + roomId, { method:'DELETE' });
        state.rooms = schedule.rooms;
        render();
      } else if(action==='del-item'){
        const schedule = await api('/api/items/' + el.dataset.item, { method:'DELETE' });
        state.rooms = schedule.rooms;
        render();
      } else if(action==='toggle-drawer'){
        const itemId = String(el.dataset.item);
        if(expandedItems.has(itemId)) expandedItems.delete(itemId); else expandedItems.add(itemId);
        render();
      }
    }catch(err){
      showError('sb-error', err.message);
    }
  });

  document.getElementById('sb-add-room').addEventListener('click', async ()=>{
    try{
      const { schedule } = await api('/api/projects/' + currentProjectId + '/rooms', { method:'POST', body: JSON.stringify({ name: 'New Room' }) });
      state.rooms = schedule.rooms;
      render();
    }catch(err){
      showError('sb-error', err.message);
    }
  });

  document.getElementById('sb-export').addEventListener('click', ()=>{
    const rows = [["Room","Category","Item","Vendor","SKU","Finish/Material","Dimensions","Qty",
      "Trade Cost","Markup %","Markup $","Client Price","Line Total (Client)",
      "Trade Tax %","Trade Tax $","Client Tax %","Client Tax $",
      "Shipping Cost","Shipping Markup %","Shipping Markup $","Client Shipping Price",
      "Receiving Cost / Unit","Receiving Markup %","Client Receiving Cost",
      "Total Cost (All-In)","Total Client Price (All-In)","Profit ($)","Profit Margin %",
      "Lead Time","Status","Notes","Include on Invoice","Invoiced (Invoice ID)","PO ID","Image URL","Source URL"]];
    state.rooms.forEach(room=>{
      room.items.forEach(it=>{
        rows.push([room.name,it.category,it.item,it.vendor,it.sku,it.finish,it.dims,it.qty,
          it.tradeCost,round2(it.markupPct),round2(it.markupAmt),round2(clientPrice(it)),round2(lineTotalClient(it)),
          it.tradeTaxPct,round2(tradeTaxAmt(it)),it.clientTaxPct,round2(clientTaxAmt(it)),
          it.shippingCost,round2(it.shippingMarkupPct),round2(it.shippingMarkupAmt),round2(clientShipping(it)),
          it.receivingCost,it.receivingMarkupPct,round2(clientReceiving(it)),
          round2(totalCostAllIn(it)),round2(totalClientAllIn(it)),round2(profitAmt(it)),round2(profitMarginPct(it)),
          it.leadTime,it.status,it.notes||'',it.includeOnInvoice?'Yes':'No',it.invoicedId||'',it.poId||'',it.imageUrl||'',it.sourceUrl||'']);
      });
    });
    const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const proj = currentProjectName().trim().replace(/\s+/g,'_') || 'Schedule';
    a.download = `${proj}_FFE_Schedule.csv`;
    a.click();
  });

  document.getElementById('sb-generate').addEventListener('click', async ()=>{
    const raw = document.getElementById('sb-input').value.trim();
    const errEl = document.getElementById('sb-error');
    errEl.style.display = 'none';
    if(!raw){
      showError('sb-error', 'Add some notes, a product list, or URLs first.');
      return;
    }
    const btn = document.getElementById('sb-generate');
    const loading = document.getElementById('sb-loading');
    btn.disabled = true;
    loading.style.display = 'inline';
    try{
      const schedule = await api('/api/ai/generate-schedule', { method:'POST', body: JSON.stringify({ projectId: currentProjectId, rawText: raw }) });
      state.rooms = schedule.rooms;
      document.getElementById('sb-input').value = '';
      render();
    }catch(err){
      showError('sb-error', err.message);
    }finally{
      btn.disabled = false;
      loading.style.display = 'none';
    }
  });

  document.getElementById('sb-clip').addEventListener('click', async ()=>{
    const url = document.getElementById('sb-clip-url').value.trim();
    const room = document.getElementById('sb-clip-room').value.trim();
    const errEl = document.getElementById('sb-clip-error');
    errEl.style.display = 'none';
    if(!url){
      showError('sb-clip-error', 'Paste a product URL first.');
      return;
    }
    const btn = document.getElementById('sb-clip');
    const loading = document.getElementById('sb-clip-loading');
    btn.disabled = true;
    loading.style.display = 'inline';
    try{
      const schedule = await api('/api/ai/quick-add', { method:'POST', body: JSON.stringify({ projectId: currentProjectId, url, room }) });
      state.rooms = schedule.rooms;
      document.getElementById('sb-clip-url').value = '';
      render();
    }catch(err){
      showError('sb-clip-error', err.message);
    }finally{
      btn.disabled = false;
      loading.style.display = 'none';
    }
  });

  initProjects().then(render).catch(err=>{
    console.error('Failed to load Schedule Builder:', err);
    showError('sb-error', 'Could not load your projects — ' + err.message);
  });
})();
