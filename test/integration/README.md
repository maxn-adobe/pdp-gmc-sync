# Integration tests

These tests exercise the real Merchant API against the **test account** and are
gated on `GMC_RUN_INTEGRATION=1`. They will **not** run under `npm test` or the
default `jest` invocation — an empty pass shows up in the report.

## Requirements before running

1. GMC has provisioned an OAuth client + refresh token OR a service account, and
   registered the GCP project against the Merchant Center account
   (`developerRegistration.registerGcp` — otherwise you'll get
   `AUTH_GCP_NOT_REGISTERED`).
2. A test account exists (`accounts.createTestAccount`) and its ID is stored in
   `GMC_MERCHANT_ACCOUNT_ID_TEST` in `.env`.
3. `bootstrap-datasource --param env test` has been run and
   `GMC_DATASOURCE_ID_TEST` is populated in `.env`.
4. `.env` is loaded into the shell:
   ```
   set -a && source .env && set +a
   GMC_RUN_INTEGRATION=1 npx jest test/integration
   ```

**Never point integration tests at prod.** They insert throw-away rows.
