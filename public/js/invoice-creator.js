(function(){
  let pending = [];
  let history = [];
  let clientName = '';

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

  function clientPrice(it){ return (it.tradeCost||0) + (it.markupAmt||0); }
  function clientShipping(it){ return (it.shippingCost||0) + (it.shippingMarkupAmt||0); }
  function clientReceiving(it){ return (it.receivingCost||0) * (it.qty||0) * (1 + (it.receivingMarkupPct||0)/100); }
  function lineTotalClient(it){ return clientPrice(it) * (it.qty||0); }
  function clientTaxAmt(it){ return lineTotalClient(it) * (it.clientTaxPct||0)/100; }
  function lineTotal(it){ return lineTotalClient(it) + clientTaxAmt(it) + clientShipping(it) + clientReceiving(it); }

  async function pullFromSchedule(){
    const msg = document.getElementById('iv-status-msg');
    if(!window.EPCurrentProject){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = "Can't tell which project is active — open the Schedule tab at least once this session, then come back.";
      return;
    }
    msg.style.display='none';
    document.getElementById('iv-project-label').textContent = 'Project: ' + window.EPCurrentProject.name;
    try{
      const [{ items }, schedule] = await Promise.all([
        api('/api/projects/' + window.EPCurrentProject.id + '/invoice-candidates'),
        api('/api/projects/' + window.EPCurrentProject.id + '/schedule')
      ]);
      pending = items.map(it => ({...it, _checked:true}));
      clientName = (schedule.project && schedule.project.clientName) || window.EPCurrentProject.name;
      await loadHistory();
      render();
    }catch(err){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = err.message;
    }
  }

  async function loadHistory(){
    if(!window.EPCurrentProject) return;
    history = await api('/api/projects/' + window.EPCurrentProject.id + '/invoices');
  }

  function render(){
    const empty = document.getElementById('iv-empty');
    const wrap = document.getElementById('iv-table-wrap');
    const summaryWrap = document.getElementById('iv-summary-wrap');
    const createBtn = document.getElementById('iv-create');

    empty.style.display = pending.length ? 'none' : 'block';
    if(!pending.length){
      wrap.innerHTML = ''; summaryWrap.innerHTML = ''; createBtn.style.display = 'none';
      renderHistory();
      return;
    }

    const rows = pending.map((it, idx) => `
      <tr class="${it._checked ? '' : 'excluded'}">
        <td style="text-align:center;"><input type="checkbox" class="iv-check" data-idx="${idx}" ${it._checked?'checked':''}/></td>
        <td>${escapeHtml(it.room)}</td>
        <td>${escapeHtml(it.item)}</td>
        <td>${escapeHtml(it.vendor)}</td>
        <td class="iv-mono">${it.qty}</td>
        <td class="iv-mono">${money(clientPrice(it))}</td>
        <td class="iv-mono">${money(clientShipping(it))}</td>
        <td class="iv-mono">${money(clientTaxAmt(it))}</td>
        <td class="iv-mono"><b>${money(lineTotal(it))}</b></td>
      </tr>`).join('');

    wrap.innerHTML = `<table class="iv-table">
      <thead><tr><th></th><th>Room</th><th>Item</th><th>Vendor</th><th>Qty</th><th>Client Price</th><th>Client Shipping</th><th>Client Tax</th><th>Line Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    wrap.querySelectorAll('.iv-check').forEach(cb=>{
      cb.addEventListener('change', e=>{
        pending[+e.target.dataset.idx]._checked = e.target.checked;
        render();
      });
    });

    const included = pending.filter(it=>it._checked);
    const grandTotal = included.reduce((sum,it)=>sum+lineTotal(it), 0);
    summaryWrap.innerHTML = `<div class="iv-summary">
      <span>ITEMS INCLUDED <b>${included.length}</b></span>
      <span>INVOICE TOTAL <b>${money(grandTotal)}</b></span>
    </div>`;
    createBtn.style.display = included.length ? 'inline-block' : 'none';

    renderHistory();
  }

  function renderHistory(){
    const wrap = document.getElementById('iv-history-wrap');
    const empty = document.getElementById('iv-history-empty');
    empty.style.display = history.length ? 'none' : 'block';
    wrap.innerHTML = history.slice().reverse().map(inv => {
      const paid = Number(inv.paidAmount) || 0;
      const remaining = Math.max(0, inv.total - paid);
      const paidInFull = paid >= inv.total && inv.total > 0;
      const qbLinked = !!inv.qbInvoiceId;
      return `
      <div class="iv-history-item" data-id="${inv.id}" data-invoice="${escapeHtml(inv.invoiceNumber)}" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%;flex-wrap:wrap;gap:8px;">
          <div class="iv-expand-toggle" style="cursor:pointer;"><div class="iv-history-id">${escapeHtml(inv.invoiceNumber)}</div><div class="iv-history-meta">${escapeHtml(inv.date)} · ${inv.itemCount} item${inv.itemCount===1?'':'s'} · click to view items</div></div>
          <div style="text-align:right;">
            <div class="iv-mono" style="font-weight:700;">${money(inv.total)}</div>
            <div class="iv-mono" style="font-size:11px;color:${paidInFull?'var(--success)':'var(--muted)'};">${paidInFull ? 'Paid in full' : 'Paid ' + money(paid) + ' · ' + money(remaining) + ' due'}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">
          ${qbLinked
            ? `<span class="sb-invoiced-badge" style="background:var(--brass);">Synced to QuickBooks</span>`
            : `<button class="iv-btn iv-btn-ghost iv-btn-sm" data-action="qb-toggle" data-id="${inv.id}" type="button">Send to QuickBooks</button>`}
          ${!paidInFull && !qbLinked ? `
          <input type="number" class="iv-payment-amount" min="0" step="0.01" placeholder="Amount" style="width:110px;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;"/>
          <button class="iv-btn iv-btn-ghost iv-btn-sm" data-action="record-payment" data-id="${inv.id}" type="button">Record payment</button>` : ''}
        </div>
        <div class="iv-qb-picker" style="display:none;margin-top:10px;background:var(--ink);border:1px solid var(--border);border-radius:3px;padding:12px 14px;"></div>
        <div class="iv-history-detail" style="display:none;margin-top:10px;"></div>
      </div>`;
    }).join('');
  }

  async function openQbPicker(row, invoiceId){
    const picker = row.querySelector('.iv-qb-picker');
    if(picker.style.display === 'block'){ picker.style.display = 'none'; return; }
    picker.style.display = 'block';
    picker.innerHTML = 'Searching QuickBooks for "' + escapeHtml(clientName) + '"…';
    try{
      const { candidates } = await api('/api/invoices/' + invoiceId + '/quickbooks-customers?name=' + encodeURIComponent(clientName));
      picker.innerHTML = `
        <div style="font-size:12px;margin-bottom:8px;">Match to a QuickBooks customer:</div>
        ${candidates.map(c => `<label style="display:block;font-size:12.5px;margin-bottom:4px;"><input type="radio" name="qb-customer-${invoiceId}" value="${escapeHtml(c.id)}"/> ${escapeHtml(c.name)}</label>`).join('')}
        <label style="display:block;font-size:12.5px;margin:8px 0 4px;"><input type="radio" name="qb-customer-${invoiceId}" value="new" ${candidates.length?'':'checked'}/> Create new customer:</label>
        <input type="text" class="iv-qb-new-name" value="${escapeHtml(clientName)}" style="width:100%;box-sizing:border-box;font-family:'Montserrat',sans-serif;font-size:12.5px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;margin-bottom:10px;"/>
        <div style="display:flex;gap:8px;">
          <button class="iv-btn iv-btn-sm" data-action="qb-confirm" data-id="${invoiceId}" type="button">Send</button>
          <button class="iv-btn iv-btn-ghost iv-btn-sm" data-action="qb-cancel" type="button">Cancel</button>
        </div>
        <div class="iv-mono" style="font-size:11px;color:var(--danger);margin-top:6px;display:none;" class="iv-qb-error"></div>
      `;
    }catch(err){
      picker.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('iv-history-wrap').addEventListener('click', async e=>{
    if(e.target.dataset.action === 'record-payment'){
      const row = e.target.closest('.iv-history-item');
      const input = row.querySelector('.iv-payment-amount');
      const amount = parseFloat(input.value) || 0;
      const msg = document.getElementById('iv-status-msg');
      if(amount <= 0){
        msg.style.display='block'; msg.style.color='var(--danger)';
        msg.textContent = 'Enter an amount greater than zero.';
        return;
      }
      try{
        await api('/api/invoices/' + e.target.dataset.id + '/payments', { method:'POST', body: JSON.stringify({ amount }) });
        await loadHistory();
        render();
      }catch(err){
        msg.style.display='block'; msg.style.color='var(--danger)';
        msg.textContent = err.message;
      }
      return;
    }
    if(e.target.dataset.action === 'qb-toggle'){
      const row = e.target.closest('.iv-history-item');
      openQbPicker(row, e.target.dataset.id);
      return;
    }
    if(e.target.dataset.action === 'qb-cancel'){
      e.target.closest('.iv-qb-picker').style.display = 'none';
      return;
    }
    if(e.target.dataset.action === 'qb-confirm'){
      const invoiceId = e.target.dataset.id;
      const picker = e.target.closest('.iv-qb-picker');
      const selected = picker.querySelector(`input[name="qb-customer-${invoiceId}"]:checked`);
      const errEl = picker.querySelector('.iv-qb-error');
      if(!selected){
        errEl.style.display = 'block'; errEl.textContent = 'Pick or create a customer first.';
        return;
      }
      const body = selected.value === 'new'
        ? { newCustomerName: picker.querySelector('.iv-qb-new-name').value.trim() }
        : { customerId: selected.value };
      picker.innerHTML = 'Sending to QuickBooks…';
      try{
        await api('/api/invoices/' + invoiceId + '/send-to-quickbooks', { method:'POST', body: JSON.stringify(body) });
        await loadHistory();
        render();
      }catch(err){
        picker.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${escapeHtml(err.message)}</div>`;
      }
      return;
    }
    const toggle = e.target.closest('.iv-expand-toggle');
    if(!toggle) return;
    const row = toggle.closest('.iv-history-item');
    const detail = row.querySelector('.iv-history-detail');
    if(detail.style.display === 'block'){ detail.style.display = 'none'; return; }
    detail.style.display = 'block';
    if(detail.dataset.loaded) return;
    detail.textContent = 'Loading…';
    try{
      const { items } = await api('/api/projects/' + window.EPCurrentProject.id + '/invoices/' + row.dataset.invoice + '/items');
      detail.innerHTML = `<table class="iv-table"><thead><tr><th>Room</th><th>Item</th><th>Vendor</th><th>Qty</th><th>Line Total</th></tr></thead><tbody>
        ${items.map(it=>`<tr><td>${escapeHtml(it.room)}</td><td>${escapeHtml(it.item)}</td><td>${escapeHtml(it.vendor)}</td><td class="iv-mono">${it.qty}</td><td class="iv-mono">${money(it.lineTotal)}</td></tr>`).join('')}
      </tbody></table>`;
      detail.dataset.loaded = '1';
    }catch(err){
      detail.textContent = err.message;
    }
  });

  document.getElementById('iv-refresh').addEventListener('click', pullFromSchedule);
  window.addEventListener('ep:project-changed', pullFromSchedule);

  document.getElementById('iv-qb-sync').addEventListener('click', async ()=>{
    const msg = document.getElementById('iv-status-msg');
    try{
      await api('/api/quickbooks/sync-payments', { method:'POST' });
      await loadHistory();
      render();
      msg.style.display='block'; msg.style.color='var(--success)';
      msg.textContent = 'Synced payment status from QuickBooks.';
    }catch(err){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = err.message;
    }
  });

  document.getElementById('iv-create').addEventListener('click', async ()=>{
    const included = pending.filter(it=>it._checked);
    if(!included.length || !window.EPCurrentProject) return;
    const msg = document.getElementById('iv-status-msg');
    try{
      const { invoice } = await api('/api/projects/' + window.EPCurrentProject.id + '/invoices', {
        method:'POST', body: JSON.stringify({ itemIds: included.map(it=>it.id) })
      });
      msg.style.display='block'; msg.style.color='var(--success)';
      msg.textContent = `${invoice.invoiceNumber} created — ${invoice.itemCount} item(s) marked invoiced in the Schedule.`;
      await pullFromSchedule();
    }catch(err){
      msg.style.display='block'; msg.style.color='var(--danger)';
      msg.textContent = err.message;
    }
  });

  setTimeout(pullFromSchedule, 300);
})();
