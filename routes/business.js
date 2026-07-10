const express = require('express');
const pool = require('../db');
const { mapItem } = require('./projects');
const asyncHandler = require('./asyncHandler');
const { totalClientAllIn } = require('./pricing');

const router = express.Router();

// ---- Business Overview (aggregated across every project) ----

router.get('/business-overview', asyncHandler(async (req, res) => {
  const [projectsRes, itemsRes, invoicesRes, posRes, entriesRes] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM projects'),
    pool.query('SELECT * FROM items'),
    pool.query('SELECT total, paid_amount FROM invoices'),
    pool.query('SELECT total FROM purchase_orders'),
    pool.query('SELECT type, amount FROM finance_entries')
  ]);

  const items = itemsRes.rows.map(mapItem);
  const totalPipelineBudget = items.reduce((sum, it) => sum + totalClientAllIn(it), 0);

  const totalInvoicedAllTime = invoicesRes.rows.reduce((sum, r) => sum + Number(r.total), 0);
  const totalPaid = invoicesRes.rows.reduce((sum, r) => sum + Number(r.paid_amount), 0);
  const totalPOSpend = posRes.rows.reduce((sum, r) => sum + Number(r.total), 0);
  const manualIncome = entriesRes.rows.filter(r => r.type === 'Income').reduce((sum, r) => sum + Number(r.amount), 0);
  const manualExpense = entriesRes.rows.filter(r => r.type === 'Expense').reduce((sum, r) => sum + Number(r.amount), 0);

  // "Received" means actual cash collected against invoices (plus manual income
  // entries, which represent cash the designer explicitly logged as received) —
  // not fulfillment status. Net Cash is real money in minus real money out.
  const totalReceivedValue = totalPaid + manualIncome;
  const totalSpent = totalPOSpend + manualExpense;
  const netCashPosition = totalReceivedValue - totalSpent;

  res.json({
    activeProjects: projectsRes.rows[0].n,
    totalPipelineBudget,
    totalInvoicedAllTime,
    totalReceivedValue,
    totalSpent,
    netCashPosition,
    totalIncomeAllTime: totalReceivedValue
  });
}));

// ---- Budget allocation buckets (global, not per-project) ----

router.get('/budget-buckets', asyncHandler(async (req, res) => {
  const buckets = await pool.query('SELECT id, name, percentage FROM budget_buckets ORDER BY id');
  const entries = await pool.query("SELECT category, amount FROM finance_entries WHERE type = 'Expense'");
  const overview = await pool.query(`
    SELECT
      (SELECT coalesce(sum(paid_amount),0) FROM invoices) AS paid,
      (SELECT coalesce(sum(amount),0) FROM finance_entries WHERE type = 'Income') AS manual_income
  `);
  // Buckets allocate against cash actually received, not just billed — you can't
  // set money aside from a payment that hasn't come in yet.
  const totalIncomeAllTime = Number(overview.rows[0].paid) + Number(overview.rows[0].manual_income);

  const result = buckets.rows.map(b => {
    const actual = entries.rows
      .filter(e => (e.category || '').trim().toLowerCase() === b.name.trim().toLowerCase())
      .reduce((sum, e) => sum + Number(e.amount), 0);
    return {
      id: b.id,
      name: b.name,
      percentage: Number(b.percentage),
      target: totalIncomeAllTime * Number(b.percentage) / 100,
      actual
    };
  });
  res.json({ buckets: result, totalIncomeAllTime });
}));

router.post('/budget-buckets', asyncHandler(async (req, res) => {
  const { name, percentage } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing "name" string in request body.' });
  }
  await pool.query('INSERT INTO budget_buckets (name, percentage) VALUES ($1, $2)', [name, Number(percentage) || 0]);
  res.status(201).json({ ok: true });
}));

router.patch('/budget-buckets/:id', asyncHandler(async (req, res) => {
  const { name, percentage } = req.body;
  const sets = [];
  const values = [];
  if (name !== undefined) { values.push(name); sets.push(`name = $${values.length}`); }
  if (percentage !== undefined) { values.push(Number(percentage) || 0); sets.push(`percentage = $${values.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'No recognized fields in request body.' });
  values.push(req.params.id);
  await pool.query(`UPDATE budget_buckets SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ ok: true });
}));

router.delete('/budget-buckets/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM budget_buckets WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
