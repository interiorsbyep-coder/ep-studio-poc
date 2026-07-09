const express = require('express');
const pool = require('../db');
const asyncHandler = require('./asyncHandler');

const router = express.Router();

// Maps a DB item row (snake_case) to the API/frontend shape (camelCase).
function mapItem(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    category: row.category,
    item: row.item,
    vendor: row.vendor,
    sku: row.sku,
    finish: row.finish,
    dims: row.dims,
    qty: Number(row.qty),
    tradeCost: Number(row.trade_cost),
    markupPct: Number(row.markup_pct),
    markupAmt: Number(row.markup_amt),
    tradeTaxPct: Number(row.trade_tax_pct),
    clientTaxPct: Number(row.client_tax_pct),
    shippingCost: Number(row.shipping_cost),
    shippingMarkupPct: Number(row.shipping_markup_pct),
    shippingMarkupAmt: Number(row.shipping_markup_amt),
    receivingCost: Number(row.receiving_cost),
    receivingMarkupPct: Number(row.receiving_markup_pct),
    leadTime: row.lead_time,
    status: row.status,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    notes: row.notes,
    includeOnInvoice: row.include_on_invoice,
    invoicedId: row.invoiced_id,
    poId: row.po_id
  };
}

async function loadFullSchedule(projectId) {
  const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (projectRes.rows.length === 0) return null;
  const project = projectRes.rows[0];

  const roomsRes = await pool.query(
    'SELECT * FROM rooms WHERE project_id = $1 ORDER BY sort_order, id',
    [projectId]
  );
  const itemsRes = await pool.query(
    `SELECT items.* FROM items
     JOIN rooms ON rooms.id = items.room_id
     WHERE rooms.project_id = $1
     ORDER BY items.sort_order, items.id`,
    [projectId]
  );

  const itemsByRoom = new Map();
  itemsRes.rows.forEach(row => {
    const list = itemsByRoom.get(row.room_id) || [];
    list.push(mapItem(row));
    itemsByRoom.set(row.room_id, list);
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      clientName: project.client_name,
      clientAddress: project.client_address,
      clientEmail: project.client_email,
      clientPhone: project.client_phone
    },
    rooms: roomsRes.rows.map(r => ({
      id: r.id,
      name: r.name,
      items: itemsByRoom.get(r.id) || []
    }))
  };
}

// Flat item query across a project's rooms, with the room name attached — used by
// Invoice Creator / Purchase Orders / Order Tracker, which all work off item lists
// rather than the room-nested shape loadFullSchedule returns.
async function itemsForProject(projectId, whereExtra = '', extraParams = []) {
  const res = await pool.query(
    `SELECT items.*, rooms.name AS room_name FROM items
     JOIN rooms ON rooms.id = items.room_id
     WHERE rooms.project_id = $1 ${whereExtra}
     ORDER BY items.sort_order, items.id`,
    [projectId, ...extraParams]
  );
  return res.rows.map(row => ({ ...mapItem(row), room: row.room_name }));
}

router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT id, name FROM projects ORDER BY created_at, id');
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing "name" string in request body.' });
  }
  const result = await pool.query(
    'INSERT INTO projects (name) VALUES ($1) RETURNING id, name',
    [name]
  );
  res.status(201).json(result.rows[0]);
}));

const PROJECT_FIELDS = {
  name: 'name',
  clientName: 'client_name',
  clientAddress: 'client_address',
  clientEmail: 'client_email',
  clientPhone: 'client_phone'
};

router.patch('/:id', asyncHandler(async (req, res) => {
  const sets = [];
  const values = [];
  Object.entries(req.body || {}).forEach(([key, value]) => {
    const col = PROJECT_FIELDS[key];
    if (!col) return;
    values.push(value == null ? '' : String(value));
    sets.push(`${col} = $${values.length}`);
  });
  if (sets.length === 0) {
    return res.status(400).json({ error: 'No recognized fields in request body.' });
  }
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${values.length}
     RETURNING id, name, client_name AS "clientName", client_address AS "clientAddress", client_email AS "clientEmail", client_phone AS "clientPhone"`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
  res.json(result.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const countRes = await pool.query('SELECT count(*)::int AS n FROM projects');
  if (countRes.rows[0].n <= 1) {
    return res.status(400).json({ error: "Can't delete your only project." });
  }
  const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
  res.status(204).end();
}));

router.get('/:id/schedule', asyncHandler(async (req, res) => {
  const schedule = await loadFullSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Project not found.' });
  res.json(schedule);
}));

module.exports = { router, loadFullSchedule, mapItem, itemsForProject };
