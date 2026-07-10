// Low-level QuickBooks Online API client: OAuth2 token exchange/refresh + the
// handful of API calls Studio Suite needs (customer search/create, invoice
// create/read). Kept separate from routes/quickbooks.js so the OAuth/HTTP
// plumbing doesn't get tangled up with the Express route handlers.
const pool = require('../db');

const CLIENT_ID = process.env.QB_CLIENT_ID;
const CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
const ENVIRONMENT = process.env.QB_ENVIRONMENT || 'sandbox';
const REDIRECT_URI = process.env.QB_REDIRECT_URI;

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
  });
  if (!response.ok) throw new Error(`QuickBooks token exchange failed: ${await response.text()}`);
  return response.json();
}

async function refreshTokens(refreshToken) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  if (!response.ok) throw new Error(`QuickBooks token refresh failed: ${await response.text()}`);
  return response.json();
}

async function getConnection() {
  const result = await pool.query('SELECT * FROM quickbooks_connection ORDER BY id DESC LIMIT 1');
  return result.rows[0] || null;
}

// Returns a valid access token + realm_id, refreshing (and persisting the refresh)
// if the current access token is expired or about to be.
async function getValidConnection() {
  const conn = await getConnection();
  if (!conn) return null;
  const expiresInMs = new Date(conn.access_token_expires_at).getTime() - Date.now();
  if (expiresInMs > 60000) return conn; // still valid for at least another minute

  const tokens = await refreshTokens(conn.refresh_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const updated = await pool.query(
    `UPDATE quickbooks_connection
     SET access_token = $1, refresh_token = $2, access_token_expires_at = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [tokens.access_token, tokens.refresh_token || conn.refresh_token, expiresAt, conn.id]
  );
  return updated.rows[0];
}

async function apiRequest(method, path, body) {
  const conn = await getValidConnection();
  if (!conn) throw new Error('Not connected to QuickBooks yet.');
  const response = await fetch(`${API_BASE}/v3/company/${conn.realm_id}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = data && data.Fault && data.Fault.Error && data.Fault.Error[0] && data.Fault.Error[0].Message;
    throw new Error(msg || `QuickBooks API error (HTTP ${response.status})`);
  }
  return data;
}

// Escapes single quotes for QuickBooks' SQL-like query language.
function qbEscape(s) {
  return String(s).replace(/'/g, "\\'");
}

async function searchCustomers(name) {
  const data = await apiRequest('GET', `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName LIKE '%${qbEscape(name)}%'`)}`);
  return (data.QueryResponse && data.QueryResponse.Customer) || [];
}

async function createCustomer(name) {
  const data = await apiRequest('POST', '/customer', { DisplayName: name });
  return data.Customer;
}

async function createInvoice({ customerId, items }) {
  const data = await apiRequest('POST', '/invoice', {
    CustomerRef: { value: customerId },
    Line: items.map(it => ({
      DetailType: 'SalesItemLineDetail',
      Amount: it.amount,
      Description: it.description,
      SalesItemLineDetail: { Qty: it.qty, UnitPrice: it.qty ? it.amount / it.qty : it.amount }
    }))
  });
  return data.Invoice;
}

async function getInvoice(qbInvoiceId) {
  const data = await apiRequest('GET', `/invoice/${qbInvoiceId}`);
  return data.Invoice;
}

module.exports = {
  isConfigured, buildAuthorizeUrl, exchangeCodeForTokens,
  getConnection, getValidConnection, apiRequest,
  searchCustomers, createCustomer, createInvoice, getInvoice
};
