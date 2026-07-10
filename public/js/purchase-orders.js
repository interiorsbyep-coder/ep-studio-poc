(function(){
  let groups = {};
  let history = [];

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
  function money(n){ return '$' + (Math.round((n||0)*100)/100).toLocaleString(undefined,{minimumFractionDigits:0, maximumFractionDigits:2}); }
  function costTotal(it){
    const tradeLineTotal = (it.tradeCost||0) * (it.qty||0);
    const tradeTax = tradeLineTotal * (it.tradeTaxPct||0)/100;
    return tradeLineTotal + tradeTax + (it.shippingCost||0) + (it.receivingCost||0) * (it.qty||0);
  }

  async function pullFromSchedule(){
    const msg = document.getElementById('po-status-msg');
    if(!window.EPCurrentProject){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = "Can't tell which project is active — open the Schedule tab at least once this session, then come back.";
      return;
    }
    msg.style.display='none';
    document.getElementById('po-project-label').textContent = 'Project: ' + window.EPCurrentProject.name;
    try{
      const { items } = await api('/api/projects/' + window.EPCurrentProject.id + '/po-candidates');
      groups = {};
      items.forEach(it=>{
        const v = it.vendor && it.vendor !== 'TBD' ? it.vendor : 'Unspecified Vendor';
        if(!groups[v]) groups[v] = [];
        groups[v].push({...it, _checked:true});
      });
      history = await api('/api/projects/' + window.EPCurrentProject.id + '/purchase-orders');
      render();
    }catch(err){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = err.message;
    }
  }

  function render(){
    const wrap = document.getElementById('po-groups-wrap');
    const empty = document.getElementById('po-empty');
    const vendorNames = Object.keys(groups);
    empty.style.display = vendorNames.length ? 'none' : 'block';
    wrap.innerHTML = '';

    vendorNames.forEach(vendor=>{
      const items = groups[vendor];
      const rows = items.map((it, idx) => `
        <tr class="${it._checked?'':'excluded'}">
          <td style="text-align:center;"><input type="checkbox" class="po-check" data-vendor="${escapeHtml(vendor)}" data-idx="${idx}" ${it._checked?'checked':''}/></td>
          <td>${escapeHtml(it.room)}</td>
          <td>${escapeHtml(it.item)}</td>
          <td class="po-mono">${escapeHtml(it.sku||'TBD')}</td>
          <td class="po-mono">${it.qty}</td>
          <td class="po-mono">${money(it.tradeCost)}</td>
          <td class="po-mono">${money(it.shippingCost)}</td>
          <td class="po-mono"><b>${money(costTotal(it))}</b></td>
          <td class="po-mono">${escapeHtml(it.invoicedId)}</td>
        </tr>`).join('');

      const included = items.filter(it=>it._checked);
      const vendorTotal = included.reduce((s,it)=>s+costTotal(it),0);

      const groupEl = document.createElement('div');
      groupEl.className = 'po-vendor-group';
      groupEl.innerHTML = `
        <div class="po-vendor-head">
          <div class="po-vendor-name">${escapeHtml(vendor)}</div>
          <div class="po-vendor-meta">${items.length} item${items.length===1?'':'s'} ready</div>
        </div>
        <table class="po-table">
          <thead><tr><th></th><th>Room</th><th>Item</th><th>SKU</th><th>Qty</th><th>Trade Cost</th><th>Shipping</th><th>Line Cost</th><th>Invoice</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="po-vendor-footer">
          <div class="po-vendor-total">PO TOTAL <b>${money(vendorTotal)}</b></div>
          <button class="po-btn po-btn-sm" data-action="create-po" data-vendor="${escapeHtml(vendor)}" ${included.length?'':'disabled'}>Create PO for ${escapeHtml(vendor)}</button>
        </div>
      `;
      wrap.appendChild(groupEl);
    });

    wrap.querySelectorAll('.po-check').forEach(cb=>{
      cb.addEventListener('change', e=>{
        const v = e.target.dataset.vendor;
        groups[v][+e.target.dataset.idx]._checked = e.target.checked;
        render();
      });
    });
    wrap.querySelectorAll('[data-action="create-po"]').forEach(btn=>{
      btn.addEventListener('click', ()=>createPO(btn.dataset.vendor));
    });

    renderHistory();
  }

  function renderHistory(){
    const wrap = document.getElementById('po-history-wrap');
    const empty = document.getElementById('po-history-empty');
    empty.style.display = history.length ? 'none' : 'block';
    wrap.innerHTML = history.slice().reverse().map(po => `
      <div class="po-history-item" data-po="${escapeHtml(po.poNumber)}" style="cursor:pointer;flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
          <div><div class="po-history-id">${escapeHtml(po.poNumber)}</div><div class="po-history-meta">${escapeHtml(po.vendor)} · ${escapeHtml(po.date)} · ${po.itemCount} item${po.itemCount===1?'':'s'} · click to view items</div></div>
          <div class="po-mono" style="font-weight:700;">${money(po.total)}</div>
        </div>
        <div class="po-history-detail" style="display:none;margin-top:10px;"></div>
      </div>`).join('');
  }

  document.getElementById('po-history-wrap').addEventListener('click', async e=>{
    const row = e.target.closest('.po-history-item');
    if(!row) return;
    const detail = row.querySelector('.po-history-detail');
    if(detail.style.display === 'block'){ detail.style.display = 'none'; return; }
    detail.style.display = 'block';
    if(detail.dataset.loaded) return;
    detail.textContent = 'Loading…';
    try{
      const { items } = await api('/api/projects/' + window.EPCurrentProject.id + '/purchase-orders/' + row.dataset.po + '/items');
      detail.innerHTML = `<table class="po-table"><thead><tr><th>Room</th><th>Item</th><th>SKU</th><th>Qty</th><th>Line Cost</th></tr></thead><tbody>
        ${items.map(it=>`<tr><td>${escapeHtml(it.room)}</td><td>${escapeHtml(it.item)}</td><td class="po-mono">${escapeHtml(it.sku||'TBD')}</td><td class="po-mono">${it.qty}</td><td class="po-mono">${money(it.costTotal)}</td></tr>`).join('')}
      </tbody></table>`;
      detail.dataset.loaded = '1';
    }catch(err){
      detail.textContent = err.message;
    }
  });

  async function createPO(vendor){
    const items = groups[vendor].filter(it=>it._checked);
    if(!items.length || !window.EPCurrentProject) return;
    const msg = document.getElementById('po-status-msg');
    try{
      const { po } = await api('/api/projects/' + window.EPCurrentProject.id + '/purchase-orders', {
        method:'POST', body: JSON.stringify({ vendor, itemIds: items.map(it=>it.id) })
      });
      msg.style.display='block'; msg.style.color='var(--success)';
      msg.textContent = `${po.poNumber} created for ${vendor} — ${po.itemCount} item(s) marked as on order.`;
      await pullFromSchedule();
    }catch(err){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = err.message;
    }
  }

  document.getElementById('po-refresh').addEventListener('click', pullFromSchedule);
  window.addEventListener('ep:project-changed', pullFromSchedule);

  setTimeout(pullFromSchedule, 300);
})();
