(function(){
  const token = location.pathname.split('/').filter(Boolean).pop();

  function escapeHtml(s){ return (s===undefined||s===null?'':String(s)).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function proxiedImg(url){
    if(!url) return '';
    if(!/^https?:\/\//i.test(url)) return url;
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&n=-1';
  }

  async function api(path, options){
    const res = await fetch(path, Object.assign({ headers: {'Content-Type':'application/json'} }, options));
    let data = null;
    try{ data = await res.json(); }catch(e){ /* empty body */ }
    if(!res.ok){
      throw new Error((data && data.error) || res.statusText || 'Request failed');
    }
    return data;
  }

  let record = null;

  function renderGrid(items, signed){
    document.getElementById('ts-share-grid').innerHTML = items.map((it, i) => `
      <div class="ts-share-card">
        <div class="ts-share-card-img">${it.imageUrl
          ? `<img src="${proxiedImg(it.imageUrl)}" alt="${escapeHtml(it.itemName)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;ts-share-ph&quot;>No image available</div>'"/>`
          : `<div class="ts-share-ph">No image available</div>`}</div>
        <div class="ts-share-card-body">
          <div class="ts-share-card-eyebrow">${escapeHtml(it.room || 'General')}${it.category ? ' / ' + escapeHtml(it.category) : ''}</div>
          <div class="ts-share-card-name">${escapeHtml(it.itemName)}</div>
          <div class="ts-share-card-row"><span>Investment</span><b>${escapeHtml(it.investment || 'Pricing on request')}</b></div>
          <div class="ts-share-card-row"><span>Dimensions</span><b>${escapeHtml(it.dimensions || 'TBD')}</b></div>
          <div class="ts-share-card-row"><span>Lead Time</span><b>${escapeHtml(it.leadTime || 'TBD')}</b></div>
          <div class="ts-share-card-desc">${escapeHtml(it.designerNotes || '')}</div>
          <label class="ts-share-approve ts-noprint">
            <input type="checkbox" data-approve-idx="${i}" ${it.approved ? 'checked' : ''} ${signed ? 'disabled' : ''}/>
            Approved
          </label>
        </div>
      </div>`).join('');
  }

  function renderSigned(rec){
    document.getElementById('ts-share-sign-block').style.display = 'none';
    const signedBlock = document.getElementById('ts-share-signed-block');
    signedBlock.style.display = 'block';
    document.getElementById('ts-share-signed-meta').textContent =
      `Signed by ${rec.signerName || 'client'} on ${new Date(rec.signedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}`;
    document.getElementById('ts-share-signature-img').src = rec.signature;
  }

  async function load(){
    try{
      record = await api('/api/tear-sheet-shares/' + token);
      document.getElementById('ts-share-loading').style.display = 'none';
      document.getElementById('ts-share-content').style.display = 'block';
      document.getElementById('ts-share-project-name').textContent = record.projectName || 'Your Selections';
      renderGrid(record.items, !!record.signedAt);
      if(record.signedAt) renderSigned(record);
    }catch(err){
      document.getElementById('ts-share-loading').style.display = 'none';
      const errEl = document.getElementById('ts-share-error');
      errEl.style.display = 'block';
      errEl.textContent = err.message;
    }
  }

  // --- Signature pad ---
  const canvas = document.getElementById('ts-sig-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#584435';
  let drawing = false, hasSignature = false;

  function canvasPos(e){
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
  }
  function startDraw(e){ drawing = true; hasSignature = true; const p = canvasPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
  function moveDraw(e){ if(!drawing) return; const p = canvasPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
  function endDraw(){ drawing = false; }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  window.addEventListener('mouseup', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive:false });
  canvas.addEventListener('touchmove', moveDraw, { passive:false });
  canvas.addEventListener('touchend', endDraw);

  document.getElementById('ts-sig-clear').addEventListener('click', ()=>{
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
  });

  document.getElementById('ts-share-submit').addEventListener('click', async ()=>{
    const errEl = document.getElementById('ts-share-sign-error');
    errEl.style.display = 'none';
    const signerName = document.getElementById('ts-share-signer-name').value.trim();
    if(!signerName){
      errEl.style.display = 'block';
      errEl.textContent = 'Please enter your name.';
      return;
    }
    if(!hasSignature){
      errEl.style.display = 'block';
      errEl.textContent = 'Please sign in the box above.';
      return;
    }
    const approvedIndexes = Array.from(document.querySelectorAll('[data-approve-idx]:checked')).map(el => Number(el.dataset.approveIdx));
    try{
      const rec = await api('/api/tear-sheet-shares/' + token + '/sign', {
        method:'POST',
        body: JSON.stringify({ signerName, signature: canvas.toDataURL('image/png'), approvedIndexes })
      });
      record = rec;
      renderGrid(rec.items, true);
      renderSigned(rec);
    }catch(err){
      errEl.style.display = 'block';
      errEl.textContent = err.message;
    }
  });

  document.getElementById('ts-share-print').addEventListener('click', ()=> window.print());

  load();
})();
