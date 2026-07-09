const express = require('express');
const pool = require('../db');
const { loadFullSchedule, itemsForProject } = require('./projects');
const VENDOR_LIST = require('../data/vendors');

const router = express.Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CATEGORIES = ["Upholstery", "Case Goods", "Lighting", "Rugs", "Accessories", "Window Treatments", "Other"];
const STATUSES = ["Considering", "Proposed", "Approved", "Ordered", "Order Confirmed", "Backordered", "Shipped", "Received", "Installed", "Returned"];

// Claude's web_search results rarely include a direct image URL, and when they do
// it's sometimes a stale/hallucinated link (404s). Fetching the product page's own
// Open Graph image reflects what's actually live on the page right now, so callers
// should prefer this over whatever imageUrl the model reported and only fall back
// to the model's guess if the page can't be scraped (bot-blocked, JS-rendered, etc).
async function fetchOgImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EPStudioSuite/1.0)' }
    });
    clearTimeout(timeout);
    if (!response.ok) return '';
    const html = await response.text();
    const match = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
    if (!match) return '';
    try { return new URL(match[1], url).href; } catch (e) { return match[1]; }
  } catch (err) {
    return '';
  }
}

async function ensureRoom(projectId, name) {
  const clean = (name || '').trim() || 'General';
  const existing = await pool.query(
    'SELECT id FROM rooms WHERE project_id = $1 AND lower(name) = lower($2)',
    [projectId, clean]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const created = await pool.query(
    'INSERT INTO rooms (project_id, name) VALUES ($1, $2) RETURNING id',
    [projectId, clean]
  );
  return created.rows[0].id;
}

async function insertItem(roomId, raw, sourceUrlOverride) {
  await pool.query(
    `INSERT INTO items (room_id, category, item, vendor, sku, finish, dims, qty,
       trade_cost, markup_pct, lead_time, status, image_url, source_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      roomId,
      CATEGORIES.includes(raw.category) ? raw.category : 'Other',
      raw.item || '',
      raw.vendor || 'TBD',
      raw.sku || 'TBD',
      raw.finish || 'TBD',
      raw.dims || 'TBD',
      Number(raw.qty) || 1,
      Number(raw.tradeCost) || 0,
      Number(raw.markupPct) || 0,
      raw.leadTime || 'TBD',
      STATUSES.includes(raw.status) ? raw.status : 'Considering',
      raw.imageUrl || '',
      sourceUrlOverride !== undefined ? sourceUrlOverride : (raw.sourceUrl || ''),
      raw.notes || ''
    ]
  );
}

const SYSTEM_PROMPT = `You are an FF&E schedule assistant for interior designers. Given the raw input below (a messy product list, mood board description, notes, or URLs), extract distinct furniture/fixture/equipment items into a JSON array.

Return ONLY valid minified JSON, no markdown fences, no commentary. Schema per item:
{"room":string,"category":one of ["Upholstery","Case Goods","Lighting","Rugs","Accessories","Window Treatments","Other"],"item":string,"vendor":string,"sku":string,"finish":string,"dims":string,"qty":number,"tradeCost":number,"markupPct":number,"leadTime":string,"status":one of ["Considering","Proposed","Approved","Ordered","Order Confirmed","Backordered","Shipped","Received","Installed","Returned"],"imageUrl":string,"sourceUrl":string}

If a field is unknown use "TBD" for strings, 0 for tradeCost/markupPct, 1 for qty, and "" for imageUrl/sourceUrl. If the raw input contains an actual product URL, capture it as sourceUrl for that item. Group items under sensible room names mentioned or implied (default "General" if none). Limit to at most 12 items. Output the JSON array and nothing else.`;

const CLIP_PROMPT = (url, room) => `You are a product-clipping assistant for an interior designer's FF&E schedule. Search for this product URL and extract its details for a single schedule line item. Do not explain your reasoning or describe your search process — search efficiently, then respond with ONLY the JSON object below and nothing else.

URL: "${url}"
${room ? `Use this room: ${room}` : 'Infer a sensible room name from context, or use "General" if unclear.'}

JSON schema (output exactly this shape, no markdown fences, no commentary before or after):
{"room":string,"category":one of ["Upholstery","Case Goods","Lighting","Rugs","Accessories","Window Treatments","Other"],"item":string,"vendor":string,"sku":string,"finish":string,"dims":string,"qty":number,"tradeCost":number,"markupPct":number,"leadTime":string,"status":"Considering","imageUrl":string}
Use "TBD" for unknown string fields, 0 for unknown prices, and "" for imageUrl if none found.`;

router.post('/generate-schedule', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  const { projectId, rawText } = req.body;
  if (!projectId || !rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: 'Missing "projectId" or "rawText" in request body.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: SYSTEM_PROMPT + '\n\nRAW INPUT:\n' + rawText }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errText}` });
    }
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const items = JSON.parse(clean);

    for (const raw of items) {
      if (raw.sourceUrl) raw.imageUrl = (await fetchOgImage(raw.sourceUrl)) || raw.imageUrl || '';
      const roomId = await ensureRoom(projectId, raw.room);
      await insertItem(roomId, raw);
    }

    const schedule = await loadFullSchedule(projectId);
    if (!schedule) return res.status(404).json({ error: 'Project not found.' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: "Couldn't draft the schedule from that — try trimming it down or being a bit more specific, then generate again. (" + err.message + ")" });
  }
});

router.post('/quick-add', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  const { projectId, url, room } = req.body;
  if (!projectId || !url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Missing "projectId" or "url" in request body.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: CLIP_PROMPT(url, room) }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errText}` });
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
    if (!text.trim()) throw new Error('empty response — likely truncated by the search, or the page could not be read');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found in response: ' + text.slice(0, 120));
    let raw;
    try {
      raw = JSON.parse(match[0]);
    } catch (parseErr) {
      throw new Error('response was cut off before valid JSON completed — try again, the page may be slow to search');
    }

    raw.imageUrl = (await fetchOgImage(url)) || raw.imageUrl || '';

    const roomId = await ensureRoom(projectId, room || raw.room);
    await insertItem(roomId, raw, url);

    const schedule = await loadFullSchedule(projectId);
    if (!schedule) return res.status(404).json({ error: 'Project not found.' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: "Couldn't pull details from that link (" + err.message + "). Try again, or add the item by hand." });
  }
});

router.post('/sourcing-search', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  const { query, budget, lead, category, tier } = req.body;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Missing "query" in request body.' });
  }

  let constraints = query;
  if (budget) constraints += `. Max budget: $${budget}.`;
  if (lead) constraints += ` Max lead time: ${lead} weeks.`;
  if (category) constraints += ` Category: ${category}.`;

  let vendorConstraint = '';
  if (tier) {
    const allowedVendors = VENDOR_LIST.filter(v => v[1] === String(tier)).map(v => v[0]);
    vendorConstraint = `\n\nIMPORTANT VENDOR RESTRICTION: Only suggest products from these approved vendors (Tier ${tier}) — do not suggest any vendor not on this list, even if it seems like a good fit:\n${allowedVendors.join(", ")}`;
  }

  const prompt = `You are a product sourcing assistant for interior designers. Search the web for real, currently available products matching this request:

"${constraints}"${vendorConstraint}

Find up to 8 strong candidate products from real retailers or trade vendors${tier ? ' — strictly from the approved vendor list above' : ''}. Be efficient with searching — use at most 4-5 web searches total, and pull several different candidate products out of each search's results rather than running a separate search per item. Fewer than 8 results is fine if you genuinely can't find that many good matches. For each, return a JSON object with:
{"name":string,"vendor":string,"price":string (e.g. "$2,450" or "Price on request"),"dims":string (key dimensions, e.g. 31"W x 31"D x 36"H),"leadTime":string (e.g. "8-10 wks" or "In stock"),"url":string (the real product page URL found via search),"imageUrl":string (a direct image URL if one appears in the search results, else empty string),"fitNotes":string (under 15 words on why it fits the brief)}
${tier ? '\nIf you cannot find enough real products from the approved vendor list, return fewer results rather than including a vendor not on the list.' : ''}
Return ONLY a valid minified JSON array of these objects, no markdown fences, no commentary, no text before or after.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      const msg = errBody && errBody.error && errBody.error.message;
      return res.status(response.status).json({ error: msg || `Anthropic API error (HTTP ${response.status})` });
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const raw = jsonMatch ? jsonMatch[0] : text.replace(/```json|```/g, '').trim();
    const items = JSON.parse(raw).map((it, i) => ({ ...it, id: 'sp' + Date.now() + '_' + i }));
    await Promise.all(items.map(async it => {
      if (it.url) it.imageUrl = (await fetchOgImage(it.url)) || it.imageUrl || '';
    }));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: "That search didn't come back cleanly — this is usually a transient hiccup, not your query. Try searching again. (" + err.message + ")" });
  }
});

router.post('/add-to-schedule', async (req, res) => {
  const { projectId, item } = req.body;
  if (!projectId || !item || typeof item !== 'object') {
    return res.status(400).json({ error: 'Missing "projectId" or "item" in request body.' });
  }
  try {
    const priceNum = parseFloat(String(item.price || '').replace(/[^0-9.]/g, '')) || 0;
    const roomId = await ensureRoom(projectId, 'General');
    await insertItem(roomId, {
      category: 'Other',
      item: item.name || '',
      vendor: item.vendor || '',
      dims: item.dims || '',
      leadTime: item.leadTime || '',
      tradeCost: priceNum,
      markupPct: 0,
      imageUrl: item.imageUrl || '',
      sourceUrl: item.url || '',
      notes: item.fitNotes || ''
    }, item.url || '');

    const schedule = await loadFullSchedule(projectId);
    if (!schedule) return res.status(404).json({ error: 'Project not found.' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const TEAR_SHEET_PROMPT = (raw, room, loc) => `You are a tear sheet assistant for an interior design studio. Given the input below (a product URL, or a row/description from an FF&E schedule), produce the content for one client-facing tear sheet. If it's a URL, search the web for the real product details.

INPUT: "${raw}"
${room ? `ROOM (use this if given): ${room}` : ''}
${loc ? `INSTALL LOCATION (use this if given): ${loc}` : ''}

Return ONLY a single valid minified JSON object, no markdown fences, no commentary:
{"itemName":string,"room":string,"category":one of ["Upholstery","Case Goods","Lighting","Rugs","Accessories","Window Treatments","Other"],"installLocation":string,"dimensions":string,"materialFinish":string,"quantity":string,"investment":string (e.g. "$3,760" or "Pricing on request"),"leadTime":string,"designerNotes":string (2-3 sentences, warm and specific, in a designer's voice explaining why this piece was selected),"imageUrl":string (a direct image URL if one appears in search results, else empty string)}

Use "TBD" for unknown string fields. Output the JSON object and nothing else.`;

router.post('/tear-sheet', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  const { raw, room, loc } = req.body;
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return res.status(400).json({ error: 'Missing "raw" in request body.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: TEAR_SHEET_PROMPT(raw, room, loc) }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errText}` });
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : text.replace(/```json|```/g, '').trim();
    const item = JSON.parse(jsonStr);
    if (/^https?:\/\//i.test(raw.trim())) item.imageUrl = (await fetchOgImage(raw.trim())) || item.imageUrl || '';
    res.json({ item: { ...item, room: room || item.room, installLocation: loc || item.installLocation } });
  } catch (err) {
    res.status(500).json({ error: "Couldn't build that tear sheet — try a more specific product link or description, then generate again. (" + err.message + ")" });
  }
});

const TRACKER_PROMPT = (raw, currentItems, project) => `You are a procurement status tracker for an interior design studio. You're given the CURRENTLY TRACKED items (each already has a status) and a batch of raw updates (vendor emails, shipping notices, portal screenshots described in text). Match each update to the closest tracked item, classify its new status into the fixed list below, flag anything at risk, and draft a short client update email.

PROJECT: ${project}

FIXED STATUS LIST (use exactly one of these for newStatus, nothing else):
${STATUSES.join(", ")}

CURRENTLY TRACKED ITEMS:
${JSON.stringify(currentItems.map(i => ({ id: i.id, item: i.item, vendor: i.vendor, status: i.status })))}

RAW UPDATES TO SCAN:
"${raw}"

Return ONLY a single valid minified JSON object, no markdown fences, no commentary:
{
"updates": [{"id":number (the exact id of the matching tracked item from the list above — only include items you can confidently match),"newStatus":one of the fixed statuses above}],
"flags": [string] (short, specific warnings — possible delays, missing tracking, anything needing a follow-up call),
"clientEmailDraft": string (a warm, concise client update email in a designer's voice referencing the specific items and statuses, 3-5 sentences, no subject line, sign off as "warmly," with no name after)
}`;

router.post('/order-tracker-scan', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  const { projectId, rawText, projectName } = req.body;
  if (!projectId || !rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: 'Missing "projectId" or "rawText" in request body.' });
  }

  try {
    const trackedItems = await itemsForProject(projectId, "AND items.po_id != ''");
    if (!trackedItems.length) {
      return res.status(400).json({ error: "Nothing tracked yet — refresh from Schedule first so there's something to match updates against." });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: TRACKER_PROMPT(rawText, trackedItems, projectName || 'Untitled Residence') }]
      })
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      const msg = errBody && errBody.error && errBody.error.message;
      return res.status(response.status).json({ error: msg || `Anthropic API error (HTTP ${response.status})` });
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    const text = (data.content || []).map(b => b.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(jsonStr);

    const validUpdates = (result.updates || []).filter(u =>
      STATUSES.includes(u.newStatus) && trackedItems.some(it => it.id === Number(u.id))
    );
    for (const u of validUpdates) {
      await pool.query('UPDATE items SET status = $1 WHERE id = $2', [u.newStatus, Number(u.id)]);
    }

    res.json({
      updates: validUpdates,
      flags: result.flags || [],
      clientEmailDraft: result.clientEmailDraft || '',
      items: await itemsForProject(projectId, "AND items.po_id != ''")
    });
  } catch (err) {
    res.status(500).json({ error: "Couldn't process those updates — try pasting a smaller batch, then scan again. (" + err.message + ")" });
  }
});

module.exports = router;
