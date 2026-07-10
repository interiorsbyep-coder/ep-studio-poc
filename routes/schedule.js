const express = require('express');
const pool = require('../db');
const { loadFullSchedule } = require('./projects');
const asyncHandler = require('./asyncHandler');
const RECEIVING_RATES = require('../data/receiving-rates');

const router = express.Router();

router.get('/receiving-rates', (req, res) => {
  res.json(RECEIVING_RATES.map(([itemType, rate]) => ({ itemType, rate })));
});

// camelCase field name -> DB column, and whether it's numeric (for coercion).
const ITEM_FIELDS = {
  category: { col: 'category' },
  item: { col: 'item' },
  vendor: { col: 'vendor' },
  sku: { col: 'sku' },
  finish: { col: 'finish' },
  dims: { col: 'dims' },
  qty: { col: 'qty', numeric: true },
  tradeCost: { col: 'trade_cost', numeric: true },
  markupPct: { col: 'markup_pct', numeric: true },
  markupAmt: { col: 'markup_amt', numeric: true },
  tradeTaxPct: { col: 'trade_tax_pct', numeric: true },
  clientTaxPct: { col: 'client_tax_pct', numeric: true },
  shippingCost: { col: 'shipping_cost', numeric: true },
  shippingMarkupPct: { col: 'shipping_markup_pct', numeric: true },
  shippingMarkupAmt: { col: 'shipping_markup_amt', numeric: true },
  receivingCost: { col: 'receiving_cost', numeric: true },
  receivingMarkupPct: { col: 'receiving_markup_pct', numeric: true },
  leadTime: { col: 'lead_time' },
  status: { col: 'status' },
  imageUrl: { col: 'image_url' },
  sourceUrl: { col: 'source_url' },
  notes: { col: 'notes' },
  includeOnInvoice: { col: 'include_on_invoice', bool: true },
  invoicedId: { col: 'invoiced_id' },
  poId: { col: 'po_id' }
};

// project_id lookup helper — rooms/items routes are addressed by their own id,
// but every mutation needs to know which project to re-fetch and return.
async function projectIdForRoom(roomId) {
  const r = await pool.query('SELECT project_id FROM rooms WHERE id = $1', [roomId]);
  return r.rows.length ? r.rows[0].project_id : null;
}
async function projectIdForItem(itemId) {
  const r = await pool.query(
    'SELECT rooms.project_id AS project_id FROM items JOIN rooms ON rooms.id = items.room_id WHERE items.id = $1',
    [itemId]
  );
  return r.rows.length ? r.rows[0].project_id : null;
}

router.post('/projects/:projectId/rooms', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const result = await pool.query(
    'INSERT INTO rooms (project_id, name) VALUES ($1, $2) RETURNING id',
    [req.params.projectId, name || 'New Room']
  );
  const schedule = await loadFullSchedule(req.params.projectId);
  if (!schedule) return res.status(404).json({ error: 'Project not found.' });
  res.status(201).json({ roomId: result.rows[0].id, schedule });
}));

router.patch('/rooms/:id', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing "name" string in request body.' });
  }
  const projectId = await projectIdForRoom(req.params.id);
  if (!projectId) return res.status(404).json({ error: 'Room not found.' });
  await pool.query('UPDATE rooms SET name = $1 WHERE id = $2', [name, req.params.id]);
  res.json(await loadFullSchedule(projectId));
}));

router.delete('/rooms/:id', asyncHandler(async (req, res) => {
  const projectId = await projectIdForRoom(req.params.id);
  if (!projectId) return res.status(404).json({ error: 'Room not found.' });
  await pool.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
  res.json(await loadFullSchedule(projectId));
}));

router.post('/rooms/:roomId/items', asyncHandler(async (req, res) => {
  const projectId = await projectIdForRoom(req.params.roomId);
  if (!projectId) return res.status(404).json({ error: 'Room not found.' });
  const result = await pool.query(
    'INSERT INTO items (room_id) VALUES ($1) RETURNING id',
    [req.params.roomId]
  );
  const schedule = await loadFullSchedule(projectId);
  res.status(201).json({ itemId: result.rows[0].id, schedule });
}));

router.patch('/items/:id', asyncHandler(async (req, res) => {
  const projectId = await projectIdForItem(req.params.id);
  if (!projectId) return res.status(404).json({ error: 'Item not found.' });

  const sets = [];
  const values = [];
  Object.entries(req.body || {}).forEach(([key, value]) => {
    const field = ITEM_FIELDS[key];
    if (!field) return;
    let v = value;
    if (field.numeric) v = Number(v) || 0;
    if (field.bool) v = Boolean(v);
    values.push(v);
    sets.push(`${field.col} = $${values.length}`);
  });
  if (sets.length === 0) {
    return res.status(400).json({ error: 'No recognized fields in request body.' });
  }
  values.push(req.params.id);
  await pool.query(`UPDATE items SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  res.json(await loadFullSchedule(projectId));
}));

router.delete('/items/:id', asyncHandler(async (req, res) => {
  const projectId = await projectIdForItem(req.params.id);
  if (!projectId) return res.status(404).json({ error: 'Item not found.' });
  await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  res.json(await loadFullSchedule(projectId));
}));

// Moves an item into a different room by name, creating that room if it doesn't
// already exist in the project — lets items sourced into "General" get sorted later.
router.patch('/items/:id/room', asyncHandler(async (req, res) => {
  const projectId = await projectIdForItem(req.params.id);
  if (!projectId) return res.status(404).json({ error: 'Item not found.' });
  const roomName = (req.body.roomName || '').trim() || 'General';

  const existing = await pool.query(
    'SELECT id FROM rooms WHERE project_id = $1 AND lower(name) = lower($2)',
    [projectId, roomName]
  );
  let roomId;
  if (existing.rows.length) {
    roomId = existing.rows[0].id;
  } else {
    const created = await pool.query(
      'INSERT INTO rooms (project_id, name) VALUES ($1, $2) RETURNING id',
      [projectId, roomName]
    );
    roomId = created.rows[0].id;
  }
  await pool.query('UPDATE items SET room_id = $1 WHERE id = $2', [roomId, req.params.id]);
  res.json(await loadFullSchedule(projectId));
}));

module.exports = router;
