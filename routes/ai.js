const express = require('express');
const pool = require('../db');
const { loadFullSchedule } = require('./projects');

const router = express.Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CATEGORIES = ["Upholstery", "Case Goods", "Lighting", "Rugs", "Accessories", "Window Treatments", "Other"];
const STATUSES = ["Considering", "Proposed", "Approved", "Ordered", "Order Confirmed", "Backordered", "Shipped", "Received", "Installed", "Returned"];

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
       trade_cost, markup_pct, lead_time, status, image_url, source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
      sourceUrlOverride !== undefined ? sourceUrlOverride : (raw.sourceUrl || '')
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

    const roomId = await ensureRoom(projectId, room || raw.room);
    await insertItem(roomId, raw, url);

    const schedule = await loadFullSchedule(projectId);
    if (!schedule) return res.status(404).json({ error: 'Project not found.' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: "Couldn't pull details from that link (" + err.message + "). Try again, or add the item by hand." });
  }
});

module.exports = router;
