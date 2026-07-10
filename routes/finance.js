const express = require('express');
const pool = require('../db');
const { loadFullSchedule, itemsForProject } = require('./projects');
const asyncHandler = require('./asyncHandler');
const { invoiceLineTotal, costTotal, receivingCostTotal } = require('./pricing');

const router = express.Router();

function genNumber(prefix) {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 90 + 10);
  return `${prefix}-${datePart}-${rand}`;
}
function todayStr() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---- Invoice Creator ----

router.get('/projects/:projectId/invoice-candidates', asyncHandler(async (req, res) => {
  const items = await itemsForProject(req.params.projectId, 'AND items.include_on_invoice = true AND items.invoiced_id = \'\'');
  res.json({ items: items.map(it => ({ ...it, lineTotal: invoiceLineTotal(it) })) });
}));

router.get('/projects/:projectId/invoices', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, invoice_number AS "invoiceNumber", date, total, item_count AS "itemCount",
            paid_amount AS "paidAmount", paid_at AS "paidAt",
            qb_invoice_id AS "qbInvoiceId", qb_synced_at AS "qbSyncedAt"
     FROM invoices WHERE project_id = $1 ORDER BY id`,
    [req.params.projectId]
  );
  res.json(result.rows);
}));

// Payments are additive (not a single "mark as paid" flag) since real payments often
// arrive in parts — a deposit, then a balance — rather than all at once.
router.post('/invoices/:id/payments', asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount) || 0;
  if (amount <= 0) {
    return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
  }
  const result = await pool.query(
    `UPDATE invoices SET paid_amount = paid_amount + $1, paid_at = now()
     WHERE id = $2
     RETURNING id, invoice_number AS "invoiceNumber", date, total, item_count AS "itemCount",
               paid_amount AS "paidAmount", paid_at AS "paidAt"`,
    [amount, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found.' });
  res.json(result.rows[0]);
}));

// Items are looked up by their stamped invoicedId/poId rather than a stored id array —
// that link is already the source of truth, so there's nothing extra to keep in sync.
router.get('/projects/:projectId/invoices/:invoiceNumber/items', asyncHandler(async (req, res) => {
  const items = await itemsForProject(req.params.projectId, 'AND items.invoiced_id = $2', [req.params.invoiceNumber]);
  res.json({ items: items.map(it => ({ ...it, lineTotal: invoiceLineTotal(it) })) });
}));

router.post('/projects/:projectId/invoices', asyncHandler(async (req, res) => {
  const projectId = req.params.projectId;
  const itemIds = Array.isArray(req.body.itemIds) ? req.body.itemIds.map(Number) : [];
  if (!itemIds.length) {
    return res.status(400).json({ error: 'Missing "itemIds" array in request body.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eligible = (await itemsForProject(projectId, 'AND items.include_on_invoice = true AND items.invoiced_id = \'\' AND items.id = ANY($2::int[])', [itemIds]));
    if (!eligible.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'None of those items are still eligible to invoice — refresh from Schedule and try again.' });
    }
    const total = eligible.reduce((sum, it) => sum + invoiceLineTotal(it), 0);
    const invoiceNumber = genNumber('INV');
    const date = todayStr();
    const inserted = await client.query(
      `INSERT INTO invoices (project_id, invoice_number, date, total, item_count)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, invoice_number AS "invoiceNumber", date, total, item_count AS "itemCount"`,
      [projectId, invoiceNumber, date, total, eligible.length]
    );
    await client.query('UPDATE items SET invoiced_id = $1 WHERE id = ANY($2::int[])', [invoiceNumber, eligible.map(it => it.id)]);
    await client.query('COMMIT');
    res.status(201).json({ invoice: inserted.rows[0], schedule: await loadFullSchedule(projectId) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---- Purchase Orders ----

router.get('/projects/:projectId/po-candidates', asyncHandler(async (req, res) => {
  const items = await itemsForProject(req.params.projectId, 'AND items.invoiced_id != \'\' AND items.po_id = \'\'');
  res.json({ items: items.map(it => ({ ...it, costTotal: costTotal(it) })) });
}));

router.get('/projects/:projectId/purchase-orders', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, po_number AS "poNumber", vendor, date, total, item_count AS "itemCount"
     FROM purchase_orders WHERE project_id = $1 ORDER BY id`,
    [req.params.projectId]
  );
  res.json(result.rows);
}));

router.get('/projects/:projectId/purchase-orders/:poNumber/items', asyncHandler(async (req, res) => {
  const items = await itemsForProject(req.params.projectId, 'AND items.po_id = $2', [req.params.poNumber]);
  res.json({ items: items.map(it => ({ ...it, costTotal: costTotal(it) })) });
}));

router.post('/projects/:projectId/purchase-orders', asyncHandler(async (req, res) => {
  const projectId = req.params.projectId;
  const { vendor } = req.body;
  const itemIds = Array.isArray(req.body.itemIds) ? req.body.itemIds.map(Number) : [];
  if (!vendor || !itemIds.length) {
    return res.status(400).json({ error: 'Missing "vendor" or "itemIds" in request body.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eligible = (await itemsForProject(projectId, 'AND items.invoiced_id != \'\' AND items.po_id = \'\' AND items.id = ANY($2::int[])', [itemIds]));
    if (!eligible.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'None of those items are still eligible for a PO — refresh from Schedule and try again.' });
    }
    const total = eligible.reduce((sum, it) => sum + costTotal(it), 0);
    const poNumber = genNumber('PO');
    const date = todayStr();
    const inserted = await client.query(
      `INSERT INTO purchase_orders (project_id, po_number, vendor, date, total, item_count)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, po_number AS "poNumber", vendor, date, total, item_count AS "itemCount"`,
      [projectId, poNumber, vendor, date, total, eligible.length]
    );
    await client.query('UPDATE items SET po_id = $1 WHERE id = ANY($2::int[])', [poNumber, eligible.map(it => it.id)]);
    await client.query('COMMIT');
    res.status(201).json({ po: inserted.rows[0], schedule: await loadFullSchedule(projectId) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---- Order Tracker ----

router.get('/projects/:projectId/tracked-items', asyncHandler(async (req, res) => {
  const items = await itemsForProject(req.params.projectId, 'AND items.po_id != \'\'');
  res.json({ items });
}));

// ---- Income & Expense ----

async function getFinanceBundle(projectId) {
  const [invoices, purchaseOrders, manualEntries, onOrderItems] = await Promise.all([
    pool.query('SELECT id, invoice_number AS "invoiceNumber", date, total, item_count AS "itemCount", paid_amount AS "paidAmount", paid_at AS "paidAt" FROM invoices WHERE project_id = $1 ORDER BY id', [projectId]),
    pool.query('SELECT id, po_number AS "poNumber", vendor, date, total, item_count AS "itemCount" FROM purchase_orders WHERE project_id = $1 ORDER BY id', [projectId]),
    pool.query('SELECT id, category, description, type, amount, date FROM finance_entries WHERE project_id = $1 ORDER BY id', [projectId]),
    itemsForProject(projectId, "AND items.po_id != ''")
  ]);
  // Receiving fees are owed to a separate party (a receiving/warehouse service) from
  // product vendors, so this is broken out from Total Expenses rather than blended in.
  const totalReceivingCost = onOrderItems.reduce((sum, it) => sum + receivingCostTotal(it), 0);
  return { invoices: invoices.rows, purchaseOrders: purchaseOrders.rows, manualEntries: manualEntries.rows, totalReceivingCost };
}

router.get('/projects/:projectId/finance', asyncHandler(async (req, res) => {
  res.json(await getFinanceBundle(req.params.projectId));
}));

router.post('/projects/:projectId/finance-entries', asyncHandler(async (req, res) => {
  const projectId = req.params.projectId;
  const { category, description, type, amount, date } = req.body;
  if (!description || !type || !amount) {
    return res.status(400).json({ error: 'Missing "description", "type", or "amount" in request body.' });
  }
  await pool.query(
    'INSERT INTO finance_entries (project_id, category, description, type, amount, date) VALUES ($1,$2,$3,$4,$5,$6)',
    [projectId, category || (type === 'Income' ? 'Other Income' : 'Other Expense'), description, type, Number(amount) || 0, date || todayStr()]
  );
  res.status(201).json(await getFinanceBundle(projectId));
}));

module.exports = router;
