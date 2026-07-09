(function(){
  const LS_RESULTS_KEY = 'ep-sourcing-results';
  const LS_SHORTLIST_KEY = 'ep-sourcing-shortlist';

  function loadLS(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e){ return fallback; }
  }
  function saveLS(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ /* storage unavailable */ }
  }

  let shortlist = loadLS(LS_SHORTLIST_KEY, []);
  let lastResults = loadLS(LS_RESULTS_KEY, []);

  async function api(path, options){
    const res = await fetch(path, Object.assign({ headers: {'Content-Type':'application/json'} }, options));
    let data = null;
    try{ data = await res.json(); }catch(e){ /* empty body */ }
    if(!res.ok){
      throw new Error((data && data.error) || res.statusText || 'Request failed');
    }
    return data;
  }

  function domainFrom(url){
    try{ return new URL(url).hostname.replace('www.',''); }catch(e){ return ''; }
  }

  function escapeHtml(s){ return (s===undefined||s===null?'':String(s)).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function escapeAttr(s){ return escapeHtml(s); }
  function proxiedImg(url){
    if(!url) return '';
    if(!/^https?:\/\//i.test(url)) return url;
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&n=-1';
  }

  function renderAddingTo(){
    const el = document.getElementById('sp-adding-to');
    const p = window.EPCurrentProject;
    el.textContent = p ? ('Adding to: ' + p.name) : 'Open Schedule Builder first to pick a project.';
  }
  window.addEventListener('ep:project-changed', renderAddingTo);
  renderAddingTo();

  function renderResults(items, skipSave){
    lastResults = items;
    if(!skipSave) saveLS(LS_RESULTS_KEY, lastResults);
    const grid = document.getElementById('sp-results');
    const empty = document.getElementById('sp-empty');
    grid.innerHTML = '';
    if(!items.length){ empty.style.display='block'; return; }
    empty.style.display='none';
    items.forEach(it=>{
      const alreadySaved = shortlist.some(s=>s.id===it.id);
      const card = document.createElement('div');
      card.className = 'sp-card';
      const imgHtml = it.imageUrl
        ? `<img src="${escapeAttr(proxiedImg(it.imageUrl))}" alt="${escapeAttr(it.name)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;sp-placeholder&quot;>No image available —<br/>see product page</div>'"/>`
        : `<div class="sp-placeholder">No image available —<br/>see product page</div>`;
      card.innerHTML = `
        <div class="sp-card-img">${imgHtml}</div>
        <div class="sp-card-body">
          <div class="sp-card-vendor">${escapeHtml(it.vendor || domainFrom(it.url) || 'Unknown vendor')}</div>
          <div class="sp-card-name">${escapeHtml(it.name)}</div>
          <div class="sp-card-meta">
            ${it.price ? `<span><b>${escapeHtml(it.price)}</b></span>`:''}
            ${it.dims ? `<span>${escapeHtml(it.dims)}</span>`:''}
            ${it.leadTime ? `<span>Lead time: ${escapeHtml(it.leadTime)}</span>`:''}
          </div>
          ${it.fitNotes ? `<div class="sp-card-notes">${escapeHtml(it.fitNotes)}</div>`:''}
          <div class="sp-card-actions">
            ${it.url ? `<a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">View</a>` : ''}
            <button class="sp-save ${alreadySaved ? 'saved' : ''}" data-id="${it.id}">${alreadySaved ? 'Saved' : 'Save'}</button>
            <button class="sp-add-schedule" data-id="${it.id}">+ Schedule</button>
          </div>
        </div>`;
      grid.appendChild(card);
      card.querySelector('.sp-save').addEventListener('click', (e)=>{
        addToShortlist(it);
        e.target.textContent = 'Saved';
        e.target.classList.add('saved');
      });
      card.querySelector('.sp-add-schedule').addEventListener('click', (e)=>{
        addToSchedule(it, e.target);
      });
    });
  }

  async function addToSchedule(it, btn){
    if(!window.EPCurrentProject){
      btn.textContent = 'Open Schedule first';
      setTimeout(()=>{ btn.textContent = '+ Schedule'; }, 1800);
      return;
    }
    btn.disabled = true;
    try{
      await api('/api/ai/add-to-schedule', {
        method:'POST',
        body: JSON.stringify({ projectId: window.EPCurrentProject.id, item: it })
      });
      btn.textContent = 'Added ✓';
      btn.classList.add('saved');
    }catch(err){
      btn.textContent = 'Failed — retry';
      btn.disabled = false;
    }
  }

  function addToShortlist(it){
    if(shortlist.find(s=>s.id===it.id)) return;
    shortlist.push(it);
    saveLS(LS_SHORTLIST_KEY, shortlist);
    renderShortlist();
  }

  function renderShortlist(){
    const ul = document.getElementById('sp-shortlist');
    const empty = document.getElementById('sp-shortlist-empty');
    ul.innerHTML = '';
    empty.style.display = shortlist.length ? 'none':'block';
    shortlist.forEach(it=>{
      const li = document.createElement('li');
      li.innerHTML = `
        ${it.imageUrl ? `<img class="sp-sl-thumb" src="${escapeAttr(proxiedImg(it.imageUrl))}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"/>` : `<div class="sp-sl-thumb"></div>`}
        <span class="sp-sl-name">${escapeHtml(it.name)}</span>
        <span class="sp-sl-meta">${escapeHtml(it.vendor||'')} ${it.price?('· '+escapeHtml(it.price)):''}</span>
        <button data-id="${it.id}" title="Remove">×</button>`;
      li.querySelector('button').addEventListener('click', ()=>{
        shortlist = shortlist.filter(s=>s.id!==it.id);
        saveLS(LS_SHORTLIST_KEY, shortlist);
        renderShortlist();
      });
      ul.appendChild(li);
    });
  }

  document.getElementById('sp-copy').addEventListener('click', ()=>{
    const text = shortlist.map(it => `${it.name} — ${it.vendor||domainFrom(it.url)} — ${it.price||'price TBD'} — ${it.dims||''} — ${it.leadTime||''} — ${it.url||''}`).join('\n');
    navigator.clipboard.writeText(text).then(()=>{
      const btn = document.getElementById('sp-copy');
      const old = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(()=>btn.textContent=old, 1400);
    });
  });
  document.getElementById('sp-clear').addEventListener('click', ()=>{
    shortlist = [];
    saveLS(LS_SHORTLIST_KEY, shortlist);
    renderShortlist();
  });

  document.getElementById('sp-search').addEventListener('click', async ()=>{
    const query = document.getElementById('sp-query').value.trim();
    const budget = document.getElementById('sp-budget').value;
    const lead = document.getElementById('sp-lead').value;
    const category = document.getElementById('sp-category').value;
    const tier = document.getElementById('sp-tier').value;
    const errEl = document.getElementById('sp-error');
    errEl.style.display = 'none';
    if(!query){
      errEl.textContent = 'Describe what you need first.';
      errEl.style.display = 'block';
      return;
    }
    const btn = document.getElementById('sp-search');
    const loading = document.getElementById('sp-loading');
    btn.disabled = true;
    loading.style.display = 'inline';
    try{
      const { items } = await api('/api/ai/sourcing-search', {
        method:'POST',
        body: JSON.stringify({ query, budget, lead, category, tier })
      });
      renderResults(items);
    }catch(err){
      errEl.textContent = "Couldn't complete that search — try rephrasing with fewer constraints and search again. (" + err.message + ")";
      errEl.style.display = 'block';
    }finally{
      btn.disabled = false;
      loading.style.display = 'none';
    }
  });

  renderShortlist();
  if(lastResults.length) renderResults(lastResults, true);
})();
