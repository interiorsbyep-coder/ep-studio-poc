(function(){
  let pending = [];
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
      const { items } = await api('/api/projects/' + window.EPCurrentProject.id + '/invoice-candidates');
      pending = items.map(it => ({...it, _checked:true}));
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
    wrap.innerHTML = history.slice().reverse().map(inv => `
      <div class="iv-history-item">
        <div><div class="iv-history-id">${escapeHtml(inv.invoiceNumber)}</div><div class="iv-history-meta">${escapeHtml(inv.date)} · ${inv.itemCount} item${inv.itemCount===1?'':'s'}</div></div>
        <div class="iv-mono" style="font-weight:700;">${money(inv.total)}</div>
      </div>`).join('');
  }

  document.getElementById('iv-refresh').addEventListener('click', pullFromSchedule);
  window.addEventListener('ep:project-changed', pullFromSchedule);

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
