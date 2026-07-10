(function(){
  let entries = [];
  let totalReceivingCost = 0;

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

  function buildEntries(bundle){
    const list = [];
    (bundle.invoices || []).forEach(inv => {
      list.push({ category:'Product Sale', description: `Invoice ${inv.invoiceNumber}`, type:'Income', amount: Number(inv.total), date: inv.date, source:'Invoice' });
    });
    (bundle.purchaseOrders || []).forEach(po => {
      list.push({ category:'Vendor Cost', description: `${po.poNumber} (${po.vendor})`, type:'Expense', amount: Number(po.total), date: po.date, source:'Purchase Order' });
    });
    (bundle.manualEntries || []).forEach(m => list.push({ ...m, amount: Number(m.amount), source:'Manual' }));
    return list;
  }

  async function pull(){
    const errEl = document.getElementById('ie-error');
    if(!window.EPCurrentProject){
      errEl.style.display='block';
      errEl.textContent = "Can't tell which project is active — open the Schedule tab at least once this session, then come back.";
      return;
    }
    errEl.style.display = 'none';
    document.getElementById('ie-project-label').textContent = 'Project: ' + window.EPCurrentProject.name;
    try{
      const bundle = await api('/api/projects/' + window.EPCurrentProject.id + '/finance');
      entries = buildEntries(bundle);
      totalReceivingCost = Number(bundle.totalReceivingCost) || 0;
      render();
    }catch(err){
      errEl.style.display='block';
      errEl.textContent = err.message;
    }
  }

  function render(){
    const income = entries.filter(e=>e.type==='Income').reduce((s,e)=>s+(e.amount||0),0);
    const expense = entries.filter(e=>e.type==='Expense').reduce((s,e)=>s+(e.amount||0),0);
    const net = income - expense;
    const margin = income ? (net/income*100) : 0;

    document.getElementById('ie-total-income').textContent = money(income);
    document.getElementById('ie-total-expense').textContent = money(expense);
    const netEl = document.getElementById('ie-net');
    netEl.textContent = money(net);
    netEl.className = 'ie-stat-value ' + (net>=0?'pos':'neg');
    document.getElementById('ie-margin').textContent = Math.round(margin*10)/10 + '%';
    document.getElementById('ie-total-receiving').textContent = money(totalReceivingCost);

    const empty = document.getElementById('ie-empty');
    const wrap = document.getElementById('ie-table-wrap');
    empty.style.display = entries.length ? 'none' : 'block';
    if(!entries.length){ wrap.innerHTML=''; return; }

    const sorted = entries.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    const rows = sorted.map(e => `
      <tr>
        <td>${escapeHtml(e.category)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td>${escapeHtml(e.type)}</td>
        <td class="ie-mono ${e.type==='Income'?'ie-amt-income':'ie-amt-expense'}">${e.type==='Income'?'+':'-'}${money(Math.abs(e.amount||0))}</td>
        <td class="ie-mono">${escapeHtml(e.date||'')}</td>
        <td class="ie-mono">${escapeHtml(e.source)}</td>
      </tr>`).join('');

    wrap.innerHTML = `<table class="ie-table">
      <thead><tr><th>Category</th><th>Description</th><th>Type</th><th>Amount</th><th>Date</th><th>Source</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  document.getElementById('ie-refresh').addEventListener('click', pull);
  window.addEventListener('ep:project-changed', pull);

  document.getElementById('ie-manual-add').addEventListener('click', async ()=>{
    const type = document.getElementById('ie-manual-type').value;
    const desc = document.getElementById('ie-manual-desc').value.trim();
    const category = document.getElementById('ie-manual-category').value.trim();
    const amount = parseFloat(document.getElementById('ie-manual-amount').value)||0;
    const errEl = document.getElementById('ie-error');
    if(!desc || !amount){
      errEl.style.display='block';
      errEl.textContent = 'Add a description and a non-zero amount first.';
      return;
    }
    if(!window.EPCurrentProject) return;
    try{
      const bundle = await api('/api/projects/' + window.EPCurrentProject.id + '/finance-entries', {
        method:'POST',
        body: JSON.stringify({
          category: category || (type==='Income' ? 'Other Income' : 'Other Expense'),
          description: desc, type, amount,
          date: new Date().toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})
        })
      });
      entries = buildEntries(bundle);
      totalReceivingCost = Number(bundle.totalReceivingCost) || 0;
      document.getElementById('ie-manual-desc').value = '';
      document.getElementById('ie-manual-category').value = '';
      document.getElementById('ie-manual-amount').value = '';
      render();
    }catch(err){
      errEl.style.display='block';
      errEl.textContent = err.message;
    }
  });

  setTimeout(pull, 300);
})();
