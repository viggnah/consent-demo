const express = require('express');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3010;

// ----- Configuration -----
const APIM_BASE = 'https://localhost:9443';
const APIM_GW = 'https://localhost:8243';
const IS_BASE = 'https://localhost:9446';
const OPENFGC_BASE = 'http://localhost:3000';
const APIM_AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');
const IS_AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');
const ORG_ID = 'DEMO-ORG-001';
const IS_KM_NAME = 'WSO2 Identity Server';
const REDIRECT_URI = 'https://oidcdebugger.com/debug';
const KYC_API_NAME = 'KYCAPI';

// Disable TLS verification for self-signed certs (demo only)
const agent = new https.Agent({ rejectUnauthorized: false });
const fetchOpts = { agent };

// State
let CLIENT_ID = null;
let CLIENT_SECRET = null;
let TPP_CLIENT_ID = null;
let PRIVATE_KEY = null;
let API_ID = null;
let APP_ID = null;
let setupComplete = false;

// In-memory store of KYC requests
const kycRequests = [];

// Consent elements configuration — defines what fields can be requested
const CONSENT_ELEMENTS = [
  { name: 'first_name', jsonPath: '$.person.first_name', mandatory: true, display: 'First Name' },
  { name: 'last_name', jsonPath: '$.person.last_name', mandatory: true, display: 'Last Name' },
  { name: 'date_of_birth', jsonPath: '$.person.date_of_birth', mandatory: true, display: 'Date of Birth' },
  { name: 'gender', jsonPath: '$.person.gender', mandatory: true, display: 'Gender' },
  { name: 'nationality', jsonPath: '$.person.nationality', mandatory: true, display: 'Nationality' },
  { name: 'middle_name', jsonPath: '$.person.middle_name', mandatory: false, display: 'Middle Name' },
  { name: 'place_of_birth', jsonPath: '$.person.place_of_birth', mandatory: false, display: 'Place of Birth' },
  { name: 'marital_status', jsonPath: '$.person.marital_status', mandatory: false, display: 'Marital Status' },
  { name: 'tax_id', jsonPath: '$.person.tax_id', mandatory: false, display: 'Tax ID' },
  { name: 'source_of_funds', jsonPath: '$.person.source_of_funds', mandatory: false, display: 'Source of Funds' },
  { name: 'contact', jsonPath: '$.person.contact', mandatory: false, display: 'Contact Details' },
  { name: 'identifiers', jsonPath: '$.person.identifiers', mandatory: false, display: 'Identity Documents' },
  { name: 'employment', jsonPath: '$.person.employment', mandatory: false, display: 'Employment Details' },
];

// ===== Helper: fetch with SSL disabled =====
async function apiFetch(url, opts = {}) {
  return fetch(url, { ...fetchOpts, ...opts, agent });
}

// ===== Setup: Initialize APIM app and keys =====
async function setup() {
  console.log('[Setup] Starting bank portal initialization...');

  // Load private key
  const keyPath = path.join(__dirname, '..', 'ciba-test-key.pem');
  if (!fs.existsSync(keyPath)) {
    console.error('[Setup] FATAL: ciba-test-key.pem not found at', keyPath);
    process.exit(1);
  }
  PRIVATE_KEY = fs.readFileSync(keyPath, 'utf8');

  // TPP_CLIENT_ID will be set after we generate keys (= our own CLIENT_ID)

  // Find KYC API
  let r = await apiFetch(`${APIM_BASE}/api/am/publisher/v4/apis?limit=50`, {
    headers: { Authorization: APIM_AUTH }
  });
  const apis = await r.json();
  const kycApi = (apis.list || []).find(a => a.name === KYC_API_NAME);
  if (!kycApi) {
    console.error('[Setup] FATAL: KYC API not found in APIM');
    process.exit(1);
  }
  API_ID = kycApi.id;
  console.log(`[Setup] Found KYC API: ${API_ID}`);

  // Find or create app
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications?limit=50`, {
    headers: { Authorization: APIM_AUTH }
  });
  const apps = await r.json();
  const existing = (apps.list || []).find(a => a.name === 'BankPortalApp');

  if (existing) {
    APP_ID = existing.applicationId;
    // Check if keys are usable
    r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications/${APP_ID}/oauth-keys`, {
      headers: { Authorization: APIM_AUTH }
    });
    const keysData = await r.json();
    const usableKey = (keysData.list || []).find(k => k.consumerKey);
    if (usableKey) {
      CLIENT_ID = usableKey.consumerKey;
      CLIENT_SECRET = usableKey.consumerSecret;
      TPP_CLIENT_ID = CLIENT_ID;
      console.log(`[Setup] Reusing existing app ${APP_ID} with keys`);
      setupComplete = true;
      return;
    }
    // Stale — delete and recreate
    console.log('[Setup] Stale app found, deleting...');
    await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications/${APP_ID}`, {
      method: 'DELETE', headers: { Authorization: APIM_AUTH }
    });
  }

  // Create app
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications`, {
    method: 'POST',
    headers: { Authorization: APIM_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'BankPortalApp',
      throttlingPolicy: 'Unlimited',
      description: 'Bank Portal Demo Application',
      tokenType: 'JWT'
    })
  });
  const appData = await r.json();
  APP_ID = appData.applicationId;
  console.log(`[Setup] Created app: ${APP_ID}`);

  // Subscribe
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/subscriptions`, {
    method: 'POST',
    headers: { Authorization: APIM_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId: APP_ID, apiId: API_ID, throttlingPolicy: 'Unlimited' })
  });
  console.log(`[Setup] Subscribed: ${r.status}`);

  // Generate keys
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications/${APP_ID}/generate-keys`, {
    method: 'POST',
    headers: { Authorization: APIM_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyType: 'PRODUCTION',
      keyManager: IS_KM_NAME,
      grantTypesToBeSupported: ['authorization_code', 'implicit', 'refresh_token', 'urn:openid:params:grant-type:ciba'],
      callbackUrl: REDIRECT_URI,
      scopes: ['openid', 'gov'],
      validityTime: 3600,
      additionalProperties: {}
    })
  });
  if (r.status === 200 || r.status === 201) {
    const keys = await r.json();
    CLIENT_ID = keys.consumerKey;
    CLIENT_SECRET = keys.consumerSecret;
    TPP_CLIENT_ID = CLIENT_ID;
    console.log(`[Setup] Keys generated. Client ID: ${CLIENT_ID}`);
  } else {
    const err = await r.text();
    console.error('[Setup] FATAL: Key generation failed:', r.status, err);
    process.exit(1);
  }

  // Configure IS app (auth sequence + JWKS)
  await configureISApp();

  setupComplete = true;
  console.log('[Setup] Bank portal ready!');
}

async function configureISApp() {
  // Find IS app matching our client_id
  let r = await apiFetch(`${IS_BASE}/api/server/v1/applications?limit=50`, {
    headers: { Authorization: IS_AUTH }
  });
  const isApps = await r.json();
  let isAppId = null;

  for (const app of (isApps.applications || [])) {
    try {
      const or = await apiFetch(`${IS_BASE}/api/server/v1/applications/${app.id}/inbound-protocols/oidc`, {
        headers: { Authorization: IS_AUTH }
      });
      if (or.status === 200) {
        const oidc = await or.json();
        if (oidc.clientId === CLIENT_ID) {
          isAppId = app.id;
          break;
        }
      }
    } catch (e) { /* skip */ }
  }

  if (!isAppId) {
    console.warn('[Setup] Could not find IS app for client_id');
    return;
  }

  // Set auth sequence
  const scriptPath = path.join(__dirname, '..', 'is-conditional-script.js');
  const script = fs.readFileSync(scriptPath, 'utf8');

  await apiFetch(`${IS_BASE}/api/server/v1/applications/${isAppId}`, {
    method: 'PATCH',
    headers: { Authorization: IS_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authenticationSequence: {
        type: 'USER_DEFINED',
        steps: [
          { id: 1, options: [{ idp: 'LOCAL', authenticator: 'BasicAuthenticator' }] },
          { id: 2, options: [{ idp: 'LOCAL', authenticator: 'SampleLocalAuthenticator' }] }
        ],
        script
      }
    })
  });

  // Set JWKS
  await apiFetch(`${IS_BASE}/api/server/v1/applications/${isAppId}`, {
    method: 'PATCH',
    headers: { Authorization: IS_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedConfigurations: {
        certificate: { type: 'JWKS', value: 'http://host.docker.internal:8899/jwks.json' }
      }
    })
  });

  console.log(`[Setup] IS app ${isAppId} configured`);
}

// ===== Consent + CIBA helpers =====

async function createConsentInOpenFGC() {
  const headers = { 'org-id': ORG_ID, 'TPP-client-id': TPP_CLIENT_ID, 'Content-Type': 'application/json' };

  // Ensure purpose exists
  let r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes`, { headers });
  let purposeId = null;
  if (r.ok) {
    const data = await r.json();
    const existing = (data.data || []).find(p => p.name === 'kyc_data_access' && p.clientId === TPP_CLIENT_ID);
    if (existing) purposeId = existing.id;
  }

  if (!purposeId) {
    // Create missing elements — check which already exist
    const existR = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements`, { headers });
    const existingNames = new Set();
    if (existR.ok) {
      const existData = await existR.json();
      (existData.data || []).forEach(e => existingNames.add(e.name));
    }

    const newElements = CONSENT_ELEMENTS.filter(e => !existingNames.has(e.name));
    if (newElements.length > 0) {
      const createR = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements`, {
        method: 'POST', headers,
        body: JSON.stringify(newElements.map(elem => ({
          name: elem.name, type: 'resource-field',
          description: elem.display,
          properties: { jsonPath: elem.jsonPath, resourcePath: '/user/{nic}' }
        })))
      });
      if (!createR.ok) {
        console.error('[Consent] Element creation failed:', createR.status, await createR.text());
      }
    }

    // Create purpose
    r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'kyc_data_access',
        description: 'KYC data access for bank account opening',
        clientId: TPP_CLIENT_ID,
        elements: CONSENT_ELEMENTS.map(e => ({ name: e.name, isMandatory: e.mandatory }))
      })
    });
    if (r.ok) {
      const pData = await r.json();
      purposeId = pData.id;
    } else {
      console.error('[Consent] Purpose creation failed:', r.status, await r.text());
    }
  }

  // Create consent record
  r = await fetch(`${OPENFGC_BASE}/api/v1/consents`, {
    method: 'POST', headers,
    body: JSON.stringify({
      type: 'kyc',
      clientId: TPP_CLIENT_ID,
      recurringIndicator: false,
      validityTime: 0, frequency: 0, dataAccessValidityDuration: 0,
      purposes: [{
        name: 'kyc_data_access',
        elements: CONSENT_ELEMENTS.map(e => ({ name: e.name, isUserApproved: false }))
      }],
      authorizations: [], attributes: {}
    })
  });

  if (r.ok) {
    const consent = await r.json();
    return consent.id;
  }
  console.error('[Consent] Failed to create consent:', r.status, await r.text());
  return null;
}

function createCIBARequestJWT(consentId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CLIENT_ID,
    iat: now,
    exp: now + 1500,
    aud: `${IS_BASE}/oauth2/token`,
    binding_message: 'KYCAccess',
    login_hint: 'john123',
    scope: 'openid gov',
    nbf: now - 2000,
    jti: `jti-${uuidv4()}`,
    claims: { id_token: { intent_id: { value: consentId, essential: true } } },
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI
  };
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: 'PS256', header: { kid: 'ciba-test-key-1', alg: 'PS256' } });
}

async function initiateCIBA(consentId) {
  const requestJwt = createCIBARequestJWT(consentId);

  const r = await apiFetch(`${IS_BASE}/oauth2/ciba`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64') },
    body: `request=${encodeURIComponent(requestJwt)}`
  });

  if (r.ok) {
    const data = await r.json();
    return { authReqId: data.auth_req_id, expiresIn: data.expires_in };
  }
  const err = await r.text();
  console.error('[CIBA] Authorize failed:', r.status, err);
  return null;
}

async function getWebAuthLink() {
  try {
    const { execSync } = require('child_process');
    const logs = execSync('docker logs consent-is --tail 300 2>&1', { timeout: 10000 }).toString();
    const lines = logs.split('\n').reverse();
    for (const line of lines) {
      if (line.includes('web_auth_link')) {
        const match = line.match(/https?:\/\/[^\s"]+web_auth_link[^\s"]*/);
        if (match) return match[0];
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function pollForToken(authReqId) {
  const r = await apiFetch(`${IS_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64') },
    body: `grant_type=urn%3Aopenid%3Aparams%3Agrant-type%3Aciba&auth_req_id=${encodeURIComponent(authReqId)}`
  });

  if (r.ok) {
    return await r.json();
  }
  const data = await r.json().catch(() => ({}));
  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { pending: true };
  }
  return { error: data.error || 'unknown', description: data.error_description };
}

async function invokeKYCAPI(accessToken, nic) {
  const r = await apiFetch(`${APIM_GW}/kyc/1.0.0/user/${encodeURIComponent(nic)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  if (r.ok) {
    return await r.json();
  }
  return { error: r.status, body: await r.text() };
}

// ===== Background polling =====
setInterval(async () => {
  for (const req of kycRequests) {
    if (req.status !== 'pending_approval') continue;

    try {
      const result = await pollForToken(req.authReqId);
      if (result.pending) continue;
      if (result.error) {
        req.status = 'rejected';
        req.statusMessage = result.description || result.error;
        req.updatedAt = new Date().toISOString();
        continue;
      }
      // Token received — invoke KYC API
      req.status = 'approved';
      req.accessToken = result.access_token;
      req.updatedAt = new Date().toISOString();

      const kycData = await invokeKYCAPI(result.access_token, req.nin);
      if (kycData.error) {
        req.status = 'error';
        req.statusMessage = `API Error: ${kycData.error}`;
      } else {
        req.status = 'data_available';
        req.kycData = kycData;
      }
      req.updatedAt = new Date().toISOString();
    } catch (e) {
      console.error(`[Poll] Error for ${req.id}:`, e.message);
    }
  }
}, 4000);

// ===== API Routes =====

app.get('/api/status', (req, res) => {
  res.json({ ready: setupComplete, clientId: CLIENT_ID ? CLIENT_ID.substring(0, 8) + '...' : null });
});

app.get('/api/config', (req, res) => {
  res.json({
    elements: CONSENT_ELEMENTS.map(e => ({ name: e.name, display: e.display, mandatory: e.mandatory }))
  });
});

app.post('/api/kyc-request', async (req, res) => {
  if (!setupComplete) return res.status(503).json({ error: 'Setup not complete' });

  const { nin, customerName, accountType } = req.body;
  if (!nin) return res.status(400).json({ error: 'NIN is required' });

  try {
    // 1. Create consent
    const consentId = await createConsentInOpenFGC();
    if (!consentId) return res.status(500).json({ error: 'Failed to create consent' });

    // 2. Initiate CIBA
    const ciba = await initiateCIBA(consentId);
    if (!ciba) return res.status(500).json({ error: 'Failed to initiate CIBA authorization' });

    // 3. Get web auth link
    // Small delay for IS to process
    await new Promise(resolve => setTimeout(resolve, 1500));
    const webAuthLink = await getWebAuthLink();

    // 4. Create request record
    const kycReq = {
      id: uuidv4(),
      nin,
      customerName: customerName || 'N/A',
      accountType: accountType || 'Savings',
      consentId,
      authReqId: ciba.authReqId,
      webAuthLink,
      status: 'pending_approval',
      statusMessage: 'Waiting for citizen consent',
      kycData: null,
      accessToken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'Branch Officer'
    };
    kycRequests.unshift(kycReq);

    res.json({
      id: kycReq.id,
      status: kycReq.status,
      webAuthLink: kycReq.webAuthLink,
      consentId: kycReq.consentId
    });
  } catch (e) {
    console.error('[KYC-Request] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/requests', (req, res) => {
  res.json(kycRequests.map(r => ({
    id: r.id, nin: r.nin, customerName: r.customerName,
    accountType: r.accountType, status: r.status, statusMessage: r.statusMessage,
    createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy,
    hasData: !!r.kycData
  })));
});

app.get('/api/requests/:id', (req, res) => {
  const kycReq = kycRequests.find(r => r.id === req.params.id);
  if (!kycReq) return res.status(404).json({ error: 'Not found' });

  res.json({
    ...kycReq,
    accessToken: undefined // don't expose token to frontend
  });
});

// Serve citizen app notification endpoint — when bank creates a request,
// the citizen app can poll this to find pending approvals
app.get('/api/citizen/pending', (req, res) => {
  const pending = kycRequests
    .filter(r => r.status === 'pending_approval' && r.webAuthLink)
    .map(r => ({
      id: r.id,
      nin: r.nin,
      customerName: r.customerName,
      webAuthLink: r.webAuthLink,
      createdAt: r.createdAt
    }));
  res.json(pending);
});

// Start server
setup().then(() => {
  app.listen(PORT, () => {
    console.log(`\nBank Portal running at http://localhost:${PORT}`);
    console.log(`Citizen App will run at http://localhost:3011`);
  });
}).catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
