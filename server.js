// Minimal backend for the E.P. Interiors Studio Suite proof-of-concept.
// Purpose: prove two things work outside Claude's artifact sandbox —
//   1) real <img> tags load product images with no restriction
//   2) calling Claude's API from a real server is cheap and simple
//
// Run locally with:  npm install && node server.js
// Deploy: see DEPLOY.md

require('dotenv').config();
const express = require('express');
const path = require('path');
const { router: projectsRouter } = require('./routes/projects');
const scheduleRouter = require('./routes/schedule');
const aiRouter = require('./routes/ai');
const financeRouter = require('./routes/finance');
const businessRouter = require('./routes/business');
const sharesRouter = require('./routes/shares');
const quickbooksRouter = require('./routes/quickbooks');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.warn('WARNING: ANTHROPIC_API_KEY is not set. The /api/search endpoint will fail until it is.');
}

app.use('/api/projects', projectsRouter);
app.use('/api', scheduleRouter);
app.use('/api/ai', aiRouter);
app.use('/api', financeRouter);
app.use('/api', businessRouter);
app.use('/api', sharesRouter);
app.use('/api', quickbooksRouter);

// The client-facing signing page — deliberately outside the main app shell and
// (for now, pending the security decision) not behind any login, since the
// person opening it is a client, not a Studio Suite user. The token in the URL
// is the only thing gating access to that one tear sheet's content.
app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// The frontend calls THIS endpoint instead of api.anthropic.com directly.
// The real API key lives only here, server-side — never sent to the browser.
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing "query" string in request body.' });
  }

  const prompt = `You are a product sourcing assistant for interior designers. Search the web for one real, currently available product matching this request:

"${query}"

Return ONLY a single valid minified JSON object, no markdown fences, no commentary:
{"name":string,"vendor":string,"price":string,"url":string (the real product page URL),"imageUrl":string (a direct image file URL found in search results, empty string if none found)}`;

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
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errText}` });
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ error: 'No JSON found in model response.', raw: text });
    }
    const result = JSON.parse(match[0]);
    res.json({ result, usage: data.usage || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catches rejected promises from async route handlers (Express 4 doesn't do this itself)
// so a DB error returns a clean 500 instead of hanging the request.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Studio Suite server running on port ${PORT}`);
});
