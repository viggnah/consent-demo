# Consent Demo — Complete Progress Log

## Overview
A consent management demo showing how a Third-Party Provider (TPP) can access citizen KYC data through an API gateway with consent enforcement:

| Component | Technology | Port | Container |
|-----------|-----------|------|-----------|
| **OpenFGC** | Go consent server | 3000 | `consent-openfgc` |
| **WSO2 Identity Server 7.1.0** | Auth + CIBA | 9446 | `consent-is` |
| **WSO2 API Manager 4.5.0** | API gateway | 9443/8243 | `consent-apim` |
| **Mock KYC Backend** | Node.js Express | 3002 | `consent-mock-backend` |
| **MySQL 8.0** | OpenFGC database | 3306 | `consent-mysql` |
| **Bank Portal** | Node.js Express | 3010 | `consent-bank-portal` |
| **Citizen App** | Node.js Express | 3011 | `consent-citizen-app` |
| **JWKS Server** | Python HTTP | 8899 | (host) |

---

## Configuration Constants

| Key | Value |
|-----|-------|
| ORG_ID | `DEMO-ORG-001` |
| TPP Client ID (IS env `CONSENT_CLIENT_ID`) | `YSZ6l_tcxc7wTtuGzaEyopAZ_SIa` |
| KYC API ID (APIM) | `1d53baeb-0d35-431b-84ca-f96520a87908` |
| IS Key Manager ID | `611f2c05-559a-4024-91e9-af6339cd4286` |
| IS Key Manager Name | `WSO2 Identity Server` |
| Enforcement Policy ID | `b895b493-bc5f-4bc0-8f68-b6a6eb5a8753` |
| Response Filter Policy ID | `8989b57e-a0d6-43ae-8311-b0ea41e4d60e` |
| IS User | `john123` / `John@123` |
| IS Admin | `admin` / `admin` |
| APIM Admin | `admin` / `admin` |
| JWKS kid | `ciba-test-key-1` |
| JWT Algorithm | PS256 |
| Redirect URI | `https://oidcdebugger.com/debug` |
| APIM Max Revisions | 5 per API |

---

## Phase 1: Infrastructure Setup (Sessions 1–2)

### Step 1: Workspace Exploration ✅
- Explored entire workspace structure
- Identified all hardcoded values in Java files (`TPP-CLIENT-001`, `localhost:3000`, org-id)
- Understood the CIBA authentication flow and consent lifecycle
- Read all source files: Java handlers, JSP consent pages, policy templates, deployment.toml

### Step 2: Docker Infrastructure ✅
- Created `docker-compose.yml` with 5 services: mysql, openfgc, mock-backend, identity-server, api-manager
- MySQL 8.0 with health check, OpenFGC depends on MySQL
- IS and APIM use custom Dockerfiles with `build:` context
- All services on shared `consent-network` Docker bridge

### Step 3: OpenFGC ✅
- Required Go 1.25.3 — built locally with `GOTOOLCHAIN=go1.25.3`
- Cross-compiled: `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build`
- Alpine-based Dockerfile with pre-built binary
- Config via env vars: `DB_TYPE=mysql`, `DB_HOST=mysql`, `DB_PORT=3306`, `DB_NAME=openfgc`

### Step 4: Mock Backend KYC API ✅
- `mock-backend/server.js` — Node.js HTTP on port 3002
- `GET /user/{nic}` returns person info: name, DOB, gender, nationality, identifiers, contact, employment
- Sample NIINs: `NIN-1234567890` (John Doe), `NIN-9876543210` (Jane Smith)
- Unknown NIINs return default demo user
- **Issue & fix**: Alpine healthcheck used `wget` → switched to node-based HTTP check

### Step 5: Fix Hardcoded Java Values ✅
- `TPP-CLIENT-001` → actual IS client ID in: `OBCibaGrantHandler.java`, `OBCibaResponseTypeHandler.java`, `ConsentUtils.java`
- `localhost:3000` → `openfgc:3000` for Docker networking
- Updated `consentEnforcementPolicy.j2`: OpenFGC URL, org-id header
- Updated `dynamicEndpointPolicy.j2`: backend URL
- Later changed TPP client ID to use env var `CONSENT_CLIENT_ID` for flexibility

### Step 6: Build Java Artifacts ✅
- Java 17.0.15-tem via sdkman, Maven 3.8.5
- **Major Issue**: WSO2 Maven repos inaccessible (support-maven.wso2.org timeout, maven.wso2.org 403)
- **Resolution**: Extracted 6 dependency JARs from `wso2/wso2is:7.1.0` Docker image and installed to local Maven repo:
  - `org.wso2.carbon.identity.oauth.ciba:7.0.259.26`
  - `org.wso2.carbon.identity.oauth:7.0.259.26`
  - `org.wso2.carbon.identity.oauth.common:7.0.259.26`
  - `org.wso2.carbon.user.core:4.10.42.21`
  - `org.wso2.carbon.utils:4.10.42.21`
  - `org.wso2.carbon.identity.application.authentication.framework:7.8.23.73`
- **Additional Issue**: Missing transitive deps (HttpClient, Oltu, oauth.common) — added to POM files
- **POM Fix**: consent-enforcement-payload-mediator `<relativePath>` wrong (`../../../pom.xml` → `../../pom.xml`)
- **Build Output** (all SUCCESS):
  - `docker/is/dropins/com.wso2.consent.accelerator.utils-1.0-SNAPSHOT.jar` (26KB)
  - `docker/is/dropins/com.wso2.consent.accelerator.ciba.authenticator-1.0-SNAPSHOT.jar` (10KB)
  - `docker/is/webapps/fs#authenticationendpoint.war` (4.3MB)
  - `docker/apim/dropins/consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar` (13KB)

### Step 7: IS 7.1.0 Docker Setup ✅
- `docker/is/Dockerfile` (FROM wso2/wso2is:7.1.0)
- Copies: dropins JARs, webapp WAR, deployment.toml
- `deployment.toml` configured with:
  - Hostname: consent.gov, offset: 3 (port 9446)
  - Custom OAuth response types: `code id_token` → ConsentHybridResponseTypeHandler, `cibaAuthCode` → OBCibaResponseTypeHandler
  - Custom grant types: `urn:openid:params:grant-type:ciba` → OBCibaGrantHandler
  - Custom grant handlers: authorization_code → FSAuthorizationCodeGrantHandler, refresh_token → FSRefreshGrantHandler
  - OIDC extensions: claim_callback_handler → FSDefaultOIDCClaimsCallbackHandler
  - SampleLocalAuthenticator enabled, CIBA endpoint unsecured

### Step 8: APIM 4.5.0 Docker Setup ✅
- `docker/apim/Dockerfile` (FROM wso2/wso2am:4.5.0)
- Copies `consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar` to APIM dropins

### Step 9: Consent Elements & Purposes in OpenFGC ✅
- Created 13 consent elements (KYC data fields) with JSON paths and resource paths:
  - **Mandatory (5)**: first_name, last_name, date_of_birth, gender, nationality
  - **Optional (8)**: contact, full_name, middle_name, place_of_birth, marital_status, occupation, identifiers, address
- Purpose: `kyc_data_access` with mandatory + optional elements
- **Note**: Later changed to create unique purposes per request for element filtering (see Step 40)

### Step 10: IS Application & Authenticators ✅
- OAuth2 app created via IS REST API
- Grant types: authorization_code, implicit, refresh_token, urn:openid:params:grant-type:ciba
- Authentication sequence: 2 steps (BasicAuthenticator + SampleLocalAuthenticator)
- Conditional auth script routes `cibaAuthCode` to Step 2

### Step 11: APIM API Configuration ✅
- KYC API: Name `KYCAPI`, Version 1.0.0, Context `/kyc`
- Backend: `http://mock-backend:3002`
- Operation: `GET /user/{nic}`
- Consent enforcement policy attached to request flow
- Response filter policy attached to response flow
- Published, deployed to Default environment

### Step 12: Normal OAuth2 Flow ✅
- Standard authorize → login → consent → code → token flow confirmed working
- IS configured as APIM Key Manager successfully

---

## Phase 2: CIBA Flow (Sessions 3–4)

### Step 13: PS256 JWT Signing ✅
- **Problem**: RS256 rejected by IS CIBA validator ("Provided algorithm: RS256 not supported")
- **Root cause**: IS uses Java algo names in config, CIBA validator gets JOSE name and can't match
- **Fix**: Switched to PS256 (already in all supported lists)
- **Result**: CIBA `/oauth2/ciba` returns `auth_req_id` successfully

### Step 14: JWKS URI Configuration ✅
- Set JWKS URI `http://host.docker.internal:8899/jwks.json` on IS app
- Required for JWT request object signature verification

### Step 15: Web Auth Link redirect_uri Fix ✅
- **Problem**: `redirect_uri=regexp=(url1|url2)` caused `URISyntaxException` (500)
- **Fix**: `CIBAWebLinkAuthenticator.generateWebAuthLink()` extracts first URL from regexp pattern

### Step 16: Web Auth Link JWT Removal ✅
- **Problem**: Including JWT `request` parameter in web auth link caused signature verification failure
- **Fix**: Removed `request` from allowed params in web auth link
- **Side effect**: Consent ID (embedded in JWT claims) was also removed — fixed in Step 19

### Step 17: ciba.jsp Created ✅
- **Problem**: `OBCibaResponseTypeHandler.issue()` redirected to `/authenticationendpoint/ciba.jsp` → 404
- **Fix**: Created simple "Authentication Successful" JSP page

### Step 18: prompt=consent to Force Consent Page ✅
- **Problem**: After login, consent page was SKIPPED (OauthConsentKey/null → 404)
- **Fix**: Added `prompt=consent` to web auth link params
- **Result**: Consent page triggered after login

### Step 19: FSConsentServlet "No consentId found" ✅
- **Problem**: `WARN - No consentId found in request object` → redirect to error page
- **Root cause**: Consent ID was in JWT `request` object but JWT was removed in Step 16
- **Fix (two parts)**:
  1. `CIBAWebLinkAuthenticator.generateWebAuthLink()` — extracts `intent_id` from JWT and passes as plain query param
  2. `FSConsentServlet.extractConsentIdFromQueryParams()` — looks for `intent_id=` directly as fallback

### Step 20: Adapt Servlets to OpenFGC Format ✅
- **Problem**: `JSONObject["purposeGroups"] not found` — OpenFGC uses `purposes[].elements[]` not `purposeGroups[].purposes[]`
- **Fix**: Adapted all servlets to work directly with OpenFGC's native format:
  - `ConsentUtils.java`: Returns OpenFGC data as-is (removed normalization layers)
  - `FSConsentServlet.java`: Reads `purposes[].elements[].name` directly
  - `FSConsentConfirmServlet.java`: Reads `purposes[].elements[]` directly

### Step 21: Missing Environment Variables Fix ✅
- **Problem**: `CONSENT_CLIENT_ID` env var was empty → consent update returned 400
- **Root cause**: IS container started directly instead of via docker-compose
- **Fix**: Recreated IS container via `docker compose up -d identity-server`
- **Note**: IS uses H2 database — recreating loses all identity data (must re-setup)

### Step 22: deployment.toml `${carbon.local.ip}` Fix ✅
- **Problem**: Consent URL used `${carbon.local.ip}` which wasn't resolving
- **Fix**: `sed` replace in container's deployment.toml (source file already had `localhost`)

### Step 23: Recreate IS Data After Container Reset ✅
- Recreated user, application, OIDC config, auth sequence, JWKS, consent data after container rebuild

### Step 24: CIBA End-to-End Flow CONFIRMED WORKING ✅
- Full flow verified with Playwright automation:
  1. CIBA Authorize → `auth_req_id` ✅
  2. Web Auth Link → contains intent_id, prompt=consent ✅
  3. Login → username pre-filled from login_hint ✅
  4. Consent Page → all 6 KYC elements displayed correctly ✅
  5. Consent Approval → OpenFGC consent updated to ACTIVE ✅
  6. Token → access token with `consent_id_xxx` scope ✅

---

## Phase 3: API Invocation Fixes (Session 5)

### Step 25: APIM Strips Authorization Header ✅
- **Problem**: API invocation returned 401 — mock backend never saw the request
- **Discovery**: Transport headers dump showed `Authorization header present: false`
- **Root cause**: APIM `remove_outbound_auth_header = true` by default strips the `Authorization` header before forwarding to backend. The enforcement mediator was reading the JWT from this header.
- **Fix (two parts)**:
  1. Enabled backend JWT generation: `[apim.jwt] enable = true` in APIM deployment.toml — APIM sends JWT as `X-JWT-Assertion` header
  2. Updated `ConsentEnforcementUtils.java` to check `X-JWT-Assertion` as fallback when `Authorization` header is absent
- **Deployed**: Rebuilt mediator JAR, copied to APIM dropins, restarted APIM

### Step 26: Backend Request Never Reached Mock ✅
- **Problem**: After consent validation succeeded (isValid=true), the request still didn't reach the mock backend
- **Root cause**: `<call blocking="true">` to OpenFGC consumed the REST_URL_POSTFIX and set RESPONSE/NO_ENTITY_BODY properties, preventing the Synapse engine from forwarding to the actual backend
- **Fix in `consentEnforcementPolicy.j2`**:
  1. Save `REST_URL_POSTFIX` before blocking call, restore after
  2. Remove `RESPONSE` and `NO_ENTITY_BODY` properties after blocking call
- **Deployed**: Policy update process = detach → delete → re-upload → re-attach → create & deploy revision

### Step 27: Policy Update Process Documented ✅
- APIM allows max 5 revisions per API — must delete old ones before creating new
- Policies stored in H2 database — must use APIM publisher API to update
- Process: detach policy from operations → delete policy → upload new policy → attach to operations → create revision → deploy

### Step 28: API Invocation CONFIRMED WORKING ✅
- **Status 200**, filtered response returns only consented fields
- Example: If user consented to gender, date_of_birth, first_name, last_name → only those 4 fields returned
- Backend returns 11+ fields but gateway filters based on approved jsonPaths from OpenFGC consent
- Consent enforcement flow:
  1. Mediator extracts `consent_id` from JWT (access token scope)
  2. Policy calls OpenFGC `/validate` with JWT payload
  3. OpenFGC validates consent status (ACTIVE) and returns approved elements with jsonPaths
  4. JavaScript in policy collects approved jsonPaths matching the resource path
  5. Response filter policy uses jsonPaths to filter backend response

### Step 29: Mediator Cleanup ✅
- Removed all debug logging from `ConsentEnforcementUtils.java` and `ConsentEnforcementPayloadMediator.java`
- Clean production build: `consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar` (14.8KB)
- Uses `Base64.getUrlDecoder()` for JWT payload decoding (fixed from `Base64.getDecoder()`)

---

## Phase 4: demo.py Script (Sessions 5–6)

### Step 30: demo.py Created ✅
- Comprehensive 900-line Python demo script with 5 phases:
  - Phase 1: APIM App Setup (create app, subscribe, generate keys via IS KM)
  - Phase 2: IS Config (find DCR-created app, set auth sequence, JWKS)
  - Phase 3: Consent Setup (create purpose + elements + consent in OpenFGC)
  - Phase 4: CIBA Flow (authorize, show web auth link, poll for token)
  - Phase 5: API Invocation (call KYC API with consent-bound token, show filtered response)
- Interactive with colored terminal output, pause prompts between phases
- CLI modes: `demo.py` (full), `demo.py token <id>` (poll), `demo.py invoke <token>` (API call)

### Step 31: OIDC PUT 500 Workaround ✅
- **Problem**: Updating OIDC config via PUT returned 500 (IS validation error on `implicitResponseType`)
- **Fix**: Skip PUT operation, use GET to verify DCR already set correct values
- Grant types and callback URL are already correct from the generate-keys step

### Step 32: CIBA binding_message Fix ✅
- **Problem**: `binding_message: "KYC_ACCESS"` rejected by IS validator (underscores not allowed per CIBA spec?)
- **Fix**: Changed to `binding_message: "KYCAccess"` (camelCase, no special chars)

### Step 33: TPP Client ID Mismatch Fix ✅
- **Problem**: demo.py used the OAuth client_id as TPP client ID for OpenFGC, but IS uses `CONSENT_CLIENT_ID` env var
- **Fix**: demo.py reads `CONSENT_CLIENT_ID` from IS container via `docker exec consent-is printenv CONSENT_CLIENT_ID`
- Falls back to OAuth client_id if env var is empty

### Step 34: KM Issuer Mismatch Fix ✅
- **Problem**: Token validation failed with issuer mismatch (token had `identity-server:9446`, APIM expected `localhost:9446`)
- **Fix**: Updated IS Key Manager config in APIM to use `https://localhost:9446/oauth2/token` as issuer

### Step 35: Base64URL Decode Fix ✅
- **Problem**: Mediator failed to parse JWT payload — `Base64.getDecoder()` doesn't handle URL-safe encoding
- **Fix**: Changed to `Base64.getUrlDecoder()` in `ConsentEnforcementUtils.java`

### Step 36: Stale Key Mappings 409 Fix ✅
- **Problem**: `demo.py` failed with `409 Key Mappings already exists` — ghost key mappings exist without actual keys
- **Discovery**: `/oauth-keys` returns `{"count":0,"list":[]}` but `generate-keys` returns 409
- **Fix in `create_apim_app()`**: Now checks if existing app has usable keys via `/oauth-keys`. If keys list is empty (stale), deletes app and recreates fresh.
- **Fix in `generate_keys_via_is()`**: Relaxed key matching to accept any key with `consumerKey` present (removed strict `keyManager == IS_KM_NAME` check)

### Step 37: demo.py End-to-End CONFIRMED WORKING ✅
- Quick test verified all phases (non-interactive):
  - Phase 1: App created, subscribed, keys generated via IS KM ✅
  - Phase 2: IS app found, auth sequence set, JWKS configured ✅
  - Phase 3: Consent purpose reused, new consent created ✅
  - Phase 4: CIBA authorize successful, web auth link extracted from logs ✅
  - Phase 5: (requires interactive browser login + consent approval)
- Full interactive demo run confirmed working end-to-end

---

## Phase 5: Cleanup (Session 7)

### Step 38: Temp File Cleanup ✅
- Removed 17 temporary scripts and debug artifacts:
  - `ciba-browser-test.py`, `ciba-step1.py`, `ciba-test.py` (old CIBA test scripts)
  - `fix-km-issuer.py` (one-time fix)
  - `setup-is-app.py` (replaced by demo.py)
  - `test-api-invoke.py`, `test-demo-flow.py`, `test-keygen.py`, `test-keys-check.py`, `test-oidc-update.py`, `test-oidc2.py`, `test-oidc3.py` (debug scripts)
  - `update-api-policies.py`, `update-policy.py`, `update-policy2.py`, `update-policy3.py` (policy upload scripts)
  - `oidc-update.json`, `patch-auth.json` (one-time data files)
  - `ciba-consent-page.png`, `ciba-test-before-login.png`, `ciba-test-screenshot.png` (debug screenshots)
  - `.playwright-mcp/` (Playwright temp logs)

---

## Phase 6: Bank Portal & Citizen App (Sessions 8–9)

### Step 39: Bank Portal — Delete Request Feature ✅
- Added `DELETE /api/requests/:id` route in `bank-portal/server.js`
- Added Delete buttons to dashboard and all-requests tables in `app.js`
- Added `.btn-delete` styling (red color) in `style.css`

### Step 40: Bank Portal — Optional Element Filtering ✅
- **Problem**: All consent elements were shown regardless of frontend selection — if user selected 6 of 13, all 13 still appeared in the consent
- **Root cause**: OpenFGC resolves ALL elements tied to a purpose definition, regardless of what the caller specifies
- **Fix (workaround)**: Create a unique purpose per request (`kyc_data_access_<timestamp>`) containing only the selected elements
  - `app.js` collects checked checkbox values and sends `elements[]` array in POST body
  - `server.js` accepts `elements` array in the POST handler and creates a purpose with only those elements
  - Each consent then has exactly the selected elements
- **Verified**: Requesting 6 elements → consent has exactly 6; requesting all 13 → consent has 13

### Step 41: Mock Backend NIN Data Update ✅
- **Problem**: Mock backend returned "Demo User Test" data even after editing `server.js`
- **Root cause**: `docker compose restart` doesn't rebuild the image — old code baked into the container
- **Fix**: `docker compose build mock-backend && docker compose up -d mock-backend`
- Updated NIN mappings:
  - `NIN-1234567890` → `CM19951234567890` (John Doe, DOB 1995-03-15)
  - `NIN-9876543210` → `CF19900722123456` (Jane Smith)
  - `NIN-5566778899` → `CF19781234567890` (Amal Kumara)
- Updated `index.html`: NIN input label changed to "National Identification Number", default value `CM19951234567890`, customer name default `John Doe`

### Step 42: Reject Flow — "API Error: 401" Fix (Attempt 1) ❌ → (Attempt 2) ✅
- **Problem**: When citizen rejected consent, bank portal showed "Error / API Error: 401" instead of "Rejected"

- **Attempt 1 (Session 8)**: Changed `authorizeRequest("true")` to `authorizeRequest(approval ? "true" : "false")`
  - ❌ **FAILED** — IS `/oauth2/authorize` endpoint does NOT accept `"true"/"false"` strings
  - The custom consent page's form has `consent` field set to `true`/`false` by `approvedConsent()`/`denyConsent()` JS functions, but what gets POSTed to IS's authorize endpoint by the servlet is a different parameter
  - IS's own default consent flow uses `"approve"/"deny"` strings (see `auth-functions.js` → `approvedDefaultClaim()` / `denyDefaultClaim()`)

- **Attempt 2 (Session 9)**: Changed to `authorizeRequest(approval ? "approve" : "deny")`
  - ✅ **SUCCESS** — IS correctly processes `"deny"` and redirects to `redirect_uri` with `error=access_denied`
  - File: `FSConsentConfirmServlet.java` line 153

- **Defense-in-depth**: Added OpenFGC consent status check in bank-portal polling loop
  - After receiving a token, check the consent's authorization status in OpenFGC
  - If `authorizationStatus === "rejected"`, set status to `'rejected'` without calling KYC API
  - This catches cases where the CIBA token might be issued but consent was actually rejected

### Step 43: Reject Flow — oidcdebugger.com Redirect Issue ⚠️ IN PROGRESS
- **Problem**: On reject, user redirected to `https://oidcdebugger.com/debug?error=access_denied&error_description=access_denied,+User+denied+the+consent.` and request stays `pending` in bank portal
- **Root cause (reject)**: IS correctly denies and redirects to the `redirect_uri` with an error — this is expected OIDC behavior for denied consent. The bank portal should detect this via the CIBA token poll (which should return an `access_denied` error when consent is denied).
- **Root cause (approve stays pending)**: The web auth link `nonce` parameter was a random UUID instead of the CIBA `auth_req_id`. IS uses the `nonce` to correlate the web auth link with the CIBA session. Without the correct `auth_req_id`, IS couldn't link the consent approval back to the pending CIBA request.
- **Fix**: Changed `getWebAuthLink()` to accept `authReqId` parameter and use it as the `nonce` value:
  ```js
  // Before (broken)
  async function getWebAuthLink(consentId) { nonce: uuidv4(), ... }
  // After (fixed)
  async function getWebAuthLink(consentId, authReqId) { nonce: authReqId, ... }
  ```
- **Status**: Fix deployed to Docker container. Both approve and reject flows should now work correctly because IS can correlate the web auth link back to the CIBA session via the nonce=auth_req_id.

### Step 44: Dockerize Bank Portal & Citizen App ✅
- **Problem**: Bank portal and citizen app were running locally (`node server.js`), not in docker-compose. Citizen app was down when not manually started.
- **Solution**: Created Dockerfiles and added both to `docker-compose.yml`

- **bank-portal/Dockerfile** (NEW):
  - `FROM node:20-alpine`, copies package files, `npm ci --production`, copies server.js and public/
  - Exposes port 3010

- **citizen-app/Dockerfile** (NEW):
  - Same pattern as bank-portal, exposes port 3011

- **docker-compose.yml additions**:
  - `bank-portal` service: builds from `./bank-portal`, depends on `api-manager` healthy
  - `citizen-app` service: builds from `./citizen-app`, depends on `bank-portal` healthy

### Step 45: Bank Portal URL Configuration for Docker ✅
- **Problem**: Bank portal had all URLs hardcoded to `localhost` — doesn't work inside Docker network
- **Fix**: Made all URLs env-configurable:

  | Env Var | Docker Value | Default (local) | Purpose |
  |---------|-------------|------------------|---------|
  | `APIM_BASE` | `https://consent-apim:9443` | `https://localhost:9443` | APIM publisher API |
  | `APIM_GW` | `https://consent-apim:8243` | `https://localhost:8243` | API gateway calls |
  | `IS_BASE` | `https://consent-is:9446` | `https://localhost:9446` | Server-to-server IS calls |
  | `IS_PUBLIC_BASE` | `https://localhost:9446` | `https://localhost:9446` | Browser-facing IS URLs |
  | `OPENFGC_BASE` | `http://consent-openfgc:3000` | `http://localhost:3000` | Consent management |
  | `PRIVATE_KEY_PATH` | `/keys/ciba-test-key.pem` | `../ciba-test-key.pem` | CIBA JWT signing key |
  | `IS_SCRIPT_PATH` | `/keys/is-conditional-script.js` | `../is-conditional-script.js` | IS conditional auth script |
  | `BANK_PORTAL_URL` | `http://consent-bank-portal:3010` | `http://localhost:3010` | Citizen app → bank portal |

- **IS_PUBLIC_BASE vs IS_BASE distinction**: Critical for Docker. `IS_BASE` is used for server-to-server calls within the Docker network (e.g., CIBA authorize, token exchange). `IS_PUBLIC_BASE` is used for browser-facing URLs (web auth link construction, JWT `aud` claim) because the browser resolves `localhost:9446` via port mapping.

- **Volume mounts**: `ciba-test-key.pem` and `is-conditional-script.js` mounted as read-only volumes into bank-portal container since they live in the parent directory.

### Step 46: Docker Startup Issues & Fixes ✅
- **Issue 1: ENOENT for is-conditional-script.js**
  - Bank portal reads `is-conditional-script.js` from parent dir — doesn't exist in container
  - Fix: Made path configurable via `IS_SCRIPT_PATH` env var + mounted as volume

- **Issue 2: CIBA `aud` parameter mismatch**
  - JWT `aud` was set to `${IS_BASE}/oauth2/token` → resolved to `consent-is:9446` inside Docker
  - IS expected `localhost:9446` as the audience
  - Fix: Changed JWT `aud` to use `${IS_PUBLIC_BASE}/oauth2/token`

### Step 47: Remove docker logs Hack for Web Auth Link ✅
- **Problem**: Previously extracted web auth link by parsing `docker logs consent-is` output — fragile and doesn't work inside Docker
- **Fix**: Construct the URL directly from known CIBA parameters:
  ```js
  function getWebAuthLink(consentId, authReqId) {
    const params = new URLSearchParams({
      binding_message: 'KYCAccess',
      client_id: CLIENT_ID,
      nonce: authReqId,  // MUST be auth_req_id for CIBA correlation
      response_type: 'cibaAuthCode',
      scope: 'gov openid',
      intent_id: consentId,
      redirect_uri: REDIRECT_URI,
      ciba_web_auth_link: 'true',
      login_hint: 'john123',
      prompt: 'consent'
    });
    return `${IS_PUBLIC_BASE}/oauth2/authorize?${params.toString()}`;
  }
  ```

### Step 48: All 7 Containers Running ✅
- Verified all containers healthy:
  - `consent-mysql` (MySQL 8.0)
  - `consent-openfgc` (Go consent server)
  - `consent-mock-backend` (Node.js KYC API)
  - `consent-is` (WSO2 IS 7.1.0)
  - `consent-apim` (WSO2 APIM 4.5.0)
  - `consent-bank-portal` (Node.js bank officer UI) — NEW
  - `consent-citizen-app` (Node.js citizen mobile UI) — NEW
- End-to-end KYC request flow verified from Docker (curl tests)
- Element filtering verified: requesting 6 elements → consent has exactly 6
- Citizen app fetching pending requests over Docker network

### Step 49: WAR Deployment Process ✅
- WAR with `approve`/`deny` fix deployed to IS container:
  ```bash
  cd consent-accelerator-v1 && mvn clean install -DskipTests -q
  docker cp docker/is/webapps/fs#authenticationendpoint.war consent-is:/home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/
  docker exec consent-is rm -rf /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/fs#authenticationendpoint
  # Wait ~5s for IS to auto-expand the WAR
  ```

---

## Outstanding / Known Issues

1. **Approve + Reject flow needs browser testing**: The nonce=auth_req_id fix (Step 43) needs manual browser verification — create KYC request, open web auth link, login as john123/John@123, approve/reject, verify bank portal status updates.
2. **Reject redirects to oidcdebugger.com**: This is expected OIDC behavior — IS redirects to the configured `redirect_uri` with `error=access_denied`. The bank portal detects rejection via the CIBA token poll error, not via the redirect. The citizen should close the browser tab after seeing the redirect.
3. **JWKS server still on host**: Runs via `python3 -m http.server 8899` on the host machine. Bank portal references it via `host.docker.internal:8899`. Could be dockerized for full docker-compose coverage.
4. **docker-compose.yml `version: '3.8'`**: Generates deprecation warning — attribute is obsolete in modern Docker Compose.

---

## Current Workspace Structure (Clean)

```
consent-demo/
├── PROGRESS.md                     # This file
├── demo.py                         # Main demo script (interactive, 5 phases)
├── docker-compose.yml              # Infrastructure (7 containers)
├── deployment.toml                 # IS deployment config
├── instructions.md                 # Original setup instructions
├── is-conditional-script.js        # IS conditional auth script
├── ciba-test-key.pem               # RSA private key (PS256 signing)
├── ciba-test-key-pub.pem           # RSA public key
├── jwks.json                       # JWKS endpoint data (served by Python HTTP)
├── ciba.jsp                        # CIBA success page for IS
├── docker/                         # Docker configs
│   ├── apim/                       # APIM Dockerfile + dropins
│   ├── is/                         # IS Dockerfile + dropins + webapp
│   ├── mysql/                      # MySQL init
│   └── openfgc/                    # OpenFGC Dockerfile
├── bank-portal/                    # Bank Officer Portal (branch officer UI)
│   ├── Dockerfile
│   ├── server.js                   # Express backend (APIM, IS, CIBA, OpenFGC integration)
│   └── public/                     # Static HTML/CSS/JS frontend
│       ├── index.html
│       ├── app.js
│       └── style.css
├── citizen-app/                    # Citizen Mobile Consent App
│   ├── Dockerfile
│   ├── server.js                   # Express proxy to bank portal
│   └── public/                     # Mobile-viewport static frontend
├── mock-backend/                   # Mock KYC API
│   ├── Dockerfile
│   └── server.js
├── scripts/                        # Setup scripts & JSON payloads
├── consent-accelerator-v1/         # Java source (4 modules)
│   ├── consent-accelerator-utils/  # Shared utils (ConsentUtils.java)
│   ├── consent-authentication-webapp/  # Consent UI (FSConsentServlet, JSP)
│   ├── consent-mediation/          # APIM mediator + policy templates
│   └── pom.xml
├── openfgc/                        # OpenFGC source (Go)
├── docs-apim/                      # APIM API docs
└── docs-is/                        # IS API docs
```

---

## Build & Deploy Quick Reference

```bash
# Build all Java modules:
cd consent-accelerator-v1 && mvn clean install -DskipTests -q

# Outputs:
# docker/is/dropins/com.wso2.consent.accelerator.utils-1.0-SNAPSHOT.jar
# docker/is/dropins/com.wso2.consent.accelerator.ciba.authenticator-1.0-SNAPSHOT.jar
# docker/is/webapps/fs#authenticationendpoint.war
# docker/apim/dropins/consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar

# Start all infrastructure (7 containers):
docker compose up -d

# Start JWKS server (on host, still needed):
cd /path/to/consent-demo && python3 -m http.server 8899 &

# Deploy WAR update to running IS (without full rebuild):
docker cp docker/is/webapps/fs#authenticationendpoint.war consent-is:/home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/
docker exec consent-is rm -rf /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/fs#authenticationendpoint
# Wait ~5s for IS to auto-expand the WAR

# Rebuild individual app containers after code changes:
docker compose build bank-portal && docker compose up -d bank-portal
docker compose build citizen-app && docker compose up -d citizen-app
docker compose build mock-backend && docker compose up -d mock-backend

# Run demo:
python3 demo.py
```

---

## Key Lessons Learned

1. **APIM strips Authorization header by default** — Use `[apim.jwt] enable = true` to get `X-JWT-Assertion` header instead
2. **Synapse `<call blocking="true">` side effects** — Must save/restore `REST_URL_POSTFIX` and clear `RESPONSE`/`NO_ENTITY_BODY` after blocking calls
3. **APIM max 5 revisions** — Must delete old revisions before creating new ones
4. **IS H2 database is ephemeral** — Container recreation loses all identity data
5. **PS256 over RS256 for CIBA** — IS CIBA validator's algorithm name mapping issues with RS256
6. **Base64URL vs Base64** — JWT payloads use URL-safe Base64 encoding
7. **TPP Client ID vs OAuth Client ID** — Independent values; OpenFGC uses its own client ID
8. **APIM stale key mappings** — Ghost mappings can exist without actual keys; must detect and recreate app
9. **WSO2 Maven repos unreliable** — Extract dependencies from Docker images as fallback
10. **IS consent approve/deny strings** — IS `/oauth2/authorize` expects `"approve"` / `"deny"`, NOT `"true"` / `"false"`. The custom consent page's form field uses `true`/`false` but the servlet must translate to `approve`/`deny` when posting to IS's authorize endpoint.
11. **CIBA web auth link nonce = auth_req_id** — IS uses the `nonce` parameter in the web auth link to correlate with the CIBA session. Must pass the actual `auth_req_id` from the CIBA response, not a random UUID.
12. **Docker `restart` vs `build`** — `docker compose restart` reuses the existing image; code changes to sources require `docker compose build <service>` to rebuild the image.
13. **Docker networking: IS_PUBLIC_BASE vs IS_BASE** — Inside Docker, services communicate via container names (`consent-is:9446`), but browser-facing URLs must use `localhost:9446` (port-mapped). Use separate env vars for server-to-server vs browser-facing URLs.
14. **OpenFGC resolves ALL elements from purpose** — Cannot selectively include elements per consent from a shared purpose. Workaround: create a unique purpose per request with only the desired elements.
