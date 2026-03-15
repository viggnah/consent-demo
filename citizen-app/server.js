const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3011;
const BANK_PORTAL = 'http://localhost:3010';

app.use(express.static(path.join(__dirname, 'public')));

// Proxy pending requests from bank portal
app.get('/api/pending', async (req, res) => {
  try {
    const r = await fetch(`${BANK_PORTAL}/api/citizen/pending`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

app.listen(PORT, () => {
  console.log(`Citizen App running at http://localhost:${PORT}`);
});
