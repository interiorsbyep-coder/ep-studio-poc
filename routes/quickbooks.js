const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const asyncHandler = require('./asyncHandler');
const { itemsForProject } = require('./projects');
const { invoiceLineTotal } = require('./pricing');
const qb = require('./quickbooks-client');

const router = express.Router();

// Single-user app — an in-memory pending state is enough to guard the OAuth
// redirect round-trip without needing a cookie/session layer.
let pendingState = null;

router.get('/quickbooks/status', asyncHandler(async (req, res) => {
  if (!qb.isConfigured()) {
    return res.json({ configured: false, connected: false });
  }
  const conn = await qb.getConnection();
  res.json({ configured: true, connected: !!conn, companyName: conn ? conn.company_name : '' });
}));

router.get('/quickbooks/connect', (req, res) => {
  if (!qb.isConfigured()) {
    return res.status(500).send('QuickBooks is not configured yet — set QB_CLIENT_ID / QB_CLIENT_SECRET / QB_REDIRECT_URI.');
  }
  pendingState = crypto.randomBytes(16).toString('hex');
  res.redirect(qb.buildAuthorizeUrl(pendingState));
});

router.get('/quickbooks/callback', asyncHandler(async (req, res) => {
  const { code, state, realmId } = req.query;
  if (!state || state !== pendingState) {
    return res.status(400).send('QuickBooks connection failed — the request expired or was tampered with. Close this tab and try connecting again.');
  }
  pendingState = null;
  if (!code || !realmId) {
    return res.status(400).send('QuickBooks did not return the expected authorization code.');
  }

  const tokens = await qb.exchangeCodeForTokens(code);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await pool.query('DELETE FROM quickbooks_connection');
  await pool.query(
    `INSERT INTO quickbooks_connection (realm_id, access_token, refresh_token, access_token_expires_at)
     VALUES ($1,$2,$3,$4)`,
    [realmId, tokens.access_token, tokens.refresh_token, expiresAt]
  );

  res.redirect('/?qb=connected');
}));

router.post('/quickbooks/disconnect', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM quickbooks_connection');
  res.status(204).end();
}));

// ---- Sending an invoice to QuickBooks ----

router.get('/invoices/:id/quickbooks-customers', asyncHandler(async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.json({ candidates: [] });
  const customers = await qb.searchCustomers(name);
  res.json({ candidates: customers.map(c => ({ id: c.Id, name: c.DisplayName })) });
}));

router.post('/invoices/:id/send-to-quickbooks', asyncHandler(async (req, res) => {
  const invoiceRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (!invoiceRes.rows.length) return res.status(404).json({ error: 'Invoice not found.' });
  const invoice = invoiceRes.rows[0];

  const { customerId, newCustomerName } = req.body;
  if (!customerId && !newCustomerName) {
    return res.status(400).json({ error: 'Pick an existing QuickBooks customer or provide a name for a new one.' });
  }

  const items = await itemsForProject(invoice.project_id, 'AND items.invoiced_id = $2', [invoice.invoice_number]);
  if (!items.length) {
    return res.status(400).json({ error: "Couldn't find this invoice's line items — has the schedule changed since it was created?" });
  }

  let finalCustomerId = customerId;
  if (!finalCustomerId) {
    const created = await qb.createCustomer(newCustomerName);
    finalCustomerId = created.Id;
  }

  const qbInvoice = await qb.createInvoice({
    customerId: finalCustomerId,
    items: items.map(it => ({
      description: `${it.item}${it.vendor ? ' — ' + it.vendor : ''}`,
      qty: it.qty || 1,
      amount: invoiceLineTotal(it)
    }))
  });

  const updated = await pool.query(
    `UPDATE invoices SET qb_invoice_id = $1, qb_customer_id = $2, qb_synced_at = now()
     WHERE id = $3
     RETURNING id, invoice_number AS "invoiceNumber", date, total, item_count AS "itemCount",
               paid_amount AS "paidAmount", paid_at AS "paidAt",
               qb_invoice_id AS "qbInvoiceId", qb_synced_at AS "qbSyncedAt"`,
    [qbInvoice.Id, finalCustomerId, invoice.id]
  );
  res.status(201).json(updated.rows[0]);
}));

// ---- Pulling payment status back from QuickBooks ----

router.post('/quickbooks/sync-payments', asyncHandler(async (req, res) => {
  const linked = await pool.query("SELECT id, qb_invoice_id, total, paid_amount FROM invoices WHERE qb_invoice_id IS NOT NULL");
  const updates = [];
  for (const inv of linked.rows) {
    try {
      const qbInvoice = await qb.getInvoice(inv.qb_invoice_id);
      const amountPaid = Number(qbInvoice.TotalAmt) - Number(qbInvoice.Balance || 0);
      if (Math.abs(amountPaid - Number(inv.paid_amount)) > 0.005) {
        await pool.query(
          'UPDATE invoices SET paid_amount = $1, paid_at = now(), qb_synced_at = now() WHERE id = $2',
          [amountPaid, inv.id]
        );
        updates.push({ id: inv.id, paidAmount: amountPaid });
      }
    } catch (err) {
      // One bad QuickBooks invoice (e.g. deleted on the QB side) shouldn't block syncing the rest.
      updates.push({ id: inv.id, error: err.message });
    }
  }
  res.json({ updated: updates });
}));

module.exports = router;
