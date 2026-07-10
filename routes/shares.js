const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const asyncHandler = require('./asyncHandler');

const router = express.Router();

function genToken() {
  return crypto.randomBytes(12).toString('base64url');
}

// ---- Designer-side: create a share, list history for a project ----

router.post('/projects/:projectId/tear-sheet-shares', asyncHandler(async (req, res) => {
  const { projectName, items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Missing "items" array in request body.' });
  }
  const token = genToken();
  const result = await pool.query(
    `INSERT INTO tear_sheet_shares (project_id, token, project_name, items)
     VALUES ($1,$2,$3,$4) RETURNING id, token, created_at AS "createdAt"`,
    [req.params.projectId, token, projectName || '', JSON.stringify(items)]
  );
  res.status(201).json(result.rows[0]);
}));

router.get('/projects/:projectId/tear-sheet-shares', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, token, project_name AS "projectName", items, signer_name AS "signerName",
            signature, signed_at AS "signedAt", created_at AS "createdAt"
     FROM tear_sheet_shares WHERE project_id = $1 ORDER BY id DESC`,
    [req.params.projectId]
  );
  res.json(result.rows);
}));

// ---- Public (unauthenticated, token-gated): view + sign ----

router.get('/tear-sheet-shares/:token', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT token, project_name AS "projectName", items, signer_name AS "signerName",
            signature, signed_at AS "signedAt"
     FROM tear_sheet_shares WHERE token = $1`,
    [req.params.token]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'This link is no longer valid.' });
  res.json(result.rows[0]);
}));

router.post('/tear-sheet-shares/:token/sign', asyncHandler(async (req, res) => {
  const { signerName, signature, approvedIndexes } = req.body;
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'A signature is required.' });
  }
  const existing = await pool.query('SELECT items FROM tear_sheet_shares WHERE token = $1', [req.params.token]);
  if (!existing.rows.length) return res.status(404).json({ error: 'This link is no longer valid.' });

  const approvedSet = new Set(Array.isArray(approvedIndexes) ? approvedIndexes.map(Number) : []);
  const items = existing.rows[0].items.map((it, i) => ({ ...it, approved: approvedSet.has(i) }));

  const result = await pool.query(
    `UPDATE tear_sheet_shares
     SET signer_name = $1, signature = $2, signed_at = now(), items = $3
     WHERE token = $4
     RETURNING token, project_name AS "projectName", items, signer_name AS "signerName", signature, signed_at AS "signedAt"`,
    [signerName || '', signature, JSON.stringify(items), req.params.token]
  );
  res.json(result.rows[0]);
}));

module.exports = router;
