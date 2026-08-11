require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

let sfSession = {
  accessToken: null,
  instanceUrl: null,
  refreshToken: null
};

let pkceVerifier = null;

function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Middleware: block API routes if not logged in yet
function requireAuth(req, res, next) {
  if (!sfSession.accessToken) {
    return res.status(401).json({ error: 'Not logged in. Visit /login first.' });
  }
  next();
}

// ---------- AUTH ROUTES ----------

app.get('/login', (req, res) => {
  pkceVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(pkceVerifier).digest());

  const authUrl = `${process.env.SF_LOGIN_URL}/services/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${process.env.SF_CLIENT_ID}` +
    `&redirect_uri=${process.env.SF_CALLBACK_URL}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No authorization code received.');

  try {
    const tokenResponse = await axios.post(
      `${process.env.SF_LOGIN_URL}/services/oauth2/token`,
      null,
      {
        params: {
          grant_type: 'authorization_code',
          code: code,
          client_id: process.env.SF_CLIENT_ID,
          client_secret: process.env.SF_CLIENT_SECRET,
          redirect_uri: process.env.SF_CALLBACK_URL,
          code_verifier: pkceVerifier
        }
      }
    );

    sfSession.accessToken = tokenResponse.data.access_token;
    sfSession.instanceUrl = tokenResponse.data.instance_url;
    sfSession.refreshToken = tokenResponse.data.refresh_token;

    console.log('Login successful! Instance URL:', sfSession.instanceUrl);
    res.redirect('http://localhost:5173/?login=success');
  } catch (error) {
    console.error('Token exchange failed:', error.response?.data || error.message);
    res.status(500).send('OAuth login failed. Check server console.');
  }
});

app.get('/whoami', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(
      `${sfSession.instanceUrl}/services/oauth2/userinfo`,
      { headers: { Authorization: `Bearer ${sfSession.accessToken}` } }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ---------- FIELD METADATA (describe) ----------
// Returns a curated list of fields for a given object (min 5, max 10)

const FIELD_CONFIG = {
  Account: ['Name', 'Industry', 'Phone', 'Website', 'AnnualRevenue', 'BillingCity', 'Type'],
  Opportunity: ['Name', 'StageName', 'Amount', 'CloseDate', 'Probability', 'Type'],
  Lead: ['FirstName', 'LastName', 'Company', 'Email', 'Phone', 'Status', 'LeadSource'],
  Contact: ['FirstName', 'LastName', 'Email', 'Phone', 'Title', 'AccountId'],
  Case: ['Subject', 'Status', 'Priority', 'Origin', 'Description', 'ContactEmail']
};

app.get('/api/objects/:objectName/fields', requireAuth, async (req, res) => {
  const { objectName } = req.params;
  if (!FIELD_CONFIG[objectName]) {
    return res.status(400).json({ error: 'Unsupported object' });
  }

  try {
    const describeUrl = `${sfSession.instanceUrl}/services/data/v60.0/sobjects/${objectName}/describe`;
    const response = await axios.get(describeUrl, {
      headers: { Authorization: `Bearer ${sfSession.accessToken}` }
    });

    const wantedFields = FIELD_CONFIG[objectName];
    const allFields = response.data.fields;

    const fieldDetails = wantedFields
      .map(name => allFields.find(f => f.name === name))
      .filter(Boolean)
      .map(f => ({
        name: f.name,
        label: f.label,
        type: f.type,
        createable: f.createable,
        updateable: f.updateable,
        picklistValues: f.picklistValues?.map(p => p.value) || []
      }));

    res.json(fieldDetails);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ---------- RECORDS: LIST (with pagination) ----------

app.get('/api/objects/:objectName/records', requireAuth, async (req, res) => {
  const { objectName } = req.params;
  const offset = parseInt(req.query.offset) || 0;
  const limit = 20;

  if (!FIELD_CONFIG[objectName]) {
    return res.status(400).json({ error: 'Unsupported object' });
  }

  const fields = ['Id', ...FIELD_CONFIG[objectName]].join(',');
  const soql = `SELECT ${fields} FROM ${objectName} ORDER BY CreatedDate DESC LIMIT ${limit} OFFSET ${offset}`;

  try {
    const queryUrl = `${sfSession.instanceUrl}/services/data/v60.0/query`;
    const response = await axios.get(queryUrl, {
      headers: { Authorization: `Bearer ${sfSession.accessToken}` },
      params: { q: soql }
    });

    res.json({
      records: response.data.records,
      totalSize: response.data.totalSize,
      hasMore: response.data.records.length === limit
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ---------- RECORDS: CREATE ----------

app.post('/api/objects/:objectName/records', requireAuth, async (req, res) => {
  const { objectName } = req.params;
  const recordData = req.body;

  try {
    const createUrl = `${sfSession.instanceUrl}/services/data/v60.0/sobjects/${objectName}`;
    const response = await axios.post(createUrl, recordData, {
      headers: {
        Authorization: `Bearer ${sfSession.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ---------- RECORDS: UPDATE ----------

app.patch('/api/objects/:objectName/records/:id', requireAuth, async (req, res) => {
  const { objectName, id } = req.params;
  const recordData = req.body;

  try {
    const updateUrl = `${sfSession.instanceUrl}/services/data/v60.0/sobjects/${objectName}/${id}`;
    await axios.patch(updateUrl, recordData, {
      headers: {
        Authorization: `Bearer ${sfSession.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ---------- RECORDS: DELETE ----------

app.delete('/api/objects/:objectName/records/:id', requireAuth, async (req, res) => {
  const { objectName, id } = req.params;

  try {
    const deleteUrl = `${sfSession.instanceUrl}/services/data/v60.0/sobjects/${objectName}/${id}`;
    await axios.delete(deleteUrl, {
      headers: { Authorization: `Bearer ${sfSession.accessToken}` }
    });
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Go to http://localhost:${PORT}/login to start OAuth login`);
});		