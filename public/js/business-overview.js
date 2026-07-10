(function(){
  let buckets = [];

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

  async function pull(){
    const errEl = document.getElementById('bo-error');
    errEl.style.display = 'none';
    try{
      const [overview, bucketData] = await Promise.all([
        api('/api/business-overview'),
        api('/api/budget-buckets')
      ]);
      renderOverview(overview);
      buckets = bucketData.buckets;
      renderBuckets();
    }catch(err){
      errEl.style.display = 'block';
      errEl.textContent = err.message;
    }
  }

  function renderOverview(o){
    document.getElementById('bo-active-projects').textContent = o.activeProjects;
    document.getElementById('bo-pipeline').textContent = money(o.totalPipelineBudget);
    document.getElementById('bo-invoiced').textContent = money(o.totalInvoicedAllTime);
    document.getElementById('bo-received').textContent = money(o.totalReceivedValue);
    document.getElementById('bo-spent').textContent = money(o.totalSpent);
    const netEl = document.getElementById('bo-net');
    netEl.textContent = money(o.netCashPosition);
    netEl.className = 'bo-stat-value ' + (o.netCashPosition >= 0 ? 'pos' : 'neg');
  }

  function renderBuckets(){
    const wrap = document.getElementById('bo-buckets-wrap');
    const empty = document.getElementById('bo-buckets-empty');
    empty.style.display = buckets.length ? 'none' : 'block';
    wrap.innerHTML = buckets.map(b => {
      const pctOfTarget = b.target ? Math.min(100, (b.actual / b.target) * 100) : 0;
      const over = b.actual > b.target;
      return `
      <div class="bo-bucket" data-id="${b.id}">
        <div class="bo-bucket-head">
          <div><span class="bo-bucket-name">${escapeHtml(b.name)}</span> <span class="bo-bucket-pct">${b.percentage}% of income</span></div>
          <button class="bo-bucket-del" data-action="del-bucket" data-id="${b.id}" title="Remove bucket">×</button>
        </div>
        <div class="bo-bucket-bar"><div class="bo-bucket-bar-fill ${over?'over':''}" style="width:${pctOfTarget}%;"></div></div>
        <div class="bo-bucket-figures">
          <span>TARGET <b>${money(b.target)}</b></span>
          <span>ACTUAL <b>${money(b.actual)}</b></span>
          <span>${over ? 'OVER BY ' : 'REMAINING '}<b>${money(Math.abs(b.target - b.actual))}</b></span>
        </div>
      </div>`;
    }).join('');
  }

  document.getElementById('bo-refresh').addEventListener('click', pull);
  document.querySelector('.app-tab[data-tab="business-overview"]').addEventListener('click', pull);

  document.getElementById('bo-buckets-wrap').addEventListener('click', async e=>{
    const btn = e.target.closest('[data-action="del-bucket"]');
    if(!btn) return;
    try{
      await api('/api/budget-buckets/' + btn.dataset.id, { method:'DELETE' });
      await pull();
    }catch(err){
      document.getElementById('bo-error').style.display = 'block';
      document.getElementById('bo-error').textContent = err.message;
    }
  });

  document.getElementById('bo-bucket-add').addEventListener('click', async ()=>{
    const name = document.getElementById('bo-bucket-name').value.trim();
    const pct = parseFloat(document.getElementById('bo-bucket-pct').value) || 0;
    const errEl = document.getElementById('bo-error');
    if(!name){
      errEl.style.display = 'block';
      errEl.textContent = 'Name the bucket first (e.g. "Marketing").';
      return;
    }
    try{
      await api('/api/budget-buckets', { method:'POST', body: JSON.stringify({ name, percentage: pct }) });
      document.getElementById('bo-bucket-name').value = '';
      document.getElementById('bo-bucket-pct').value = '';
      await pull();
    }catch(err){
      errEl.style.display = 'block';
      errEl.textContent = err.message;
    }
  });

  async function pullQuickbooksStatus(){
    const statusEl = document.getElementById('bo-qb-status');
    const connectBtn = document.getElementById('bo-qb-connect');
    const disconnectBtn = document.getElementById('bo-qb-disconnect');
    try{
      const status = await api('/api/quickbooks/status');
      if(!status.configured){
        statusEl.textContent = 'Not set up yet — add QB_CLIENT_ID / QB_CLIENT_SECRET on the server to enable this.';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'none';
      } else if(status.connected){
        statusEl.textContent = 'Connected' + (status.companyName ? ' to ' + status.companyName : '') + '. Invoice payments sync from here.';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'inline-block';
      } else {
        statusEl.textContent = 'Not connected — connect to send invoices to QuickBooks and pull payment status back automatically.';
        connectBtn.style.display = 'inline-block';
        disconnectBtn.style.display = 'none';
      }
    }catch(err){
      statusEl.textContent = 'Could not check QuickBooks connection status.';
    }
  }
  document.getElementById('bo-qb-connect').addEventListener('click', ()=>{
    location.href = '/api/quickbooks/connect';
  });
  document.getElementById('bo-qb-disconnect').addEventListener('click', async ()=>{
    await api('/api/quickbooks/disconnect', { method:'POST' });
    pullQuickbooksStatus();
  });
  if(new URLSearchParams(location.search).get('qb') === 'connected'){
    history.replaceState(null, '', location.pathname);
  }

  setTimeout(pull, 300);
  setTimeout(pullQuickbooksStatus, 300);
})();
