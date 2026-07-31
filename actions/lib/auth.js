const { GoogleAuth } = require("google-auth-library");

const CONTENT_SCOPE = "https://www.googleapis.com/auth/content";
const PLACEHOLDER = "__PLACEHOLDER__";

function isPlaceholder(v) {
    return v === undefined || v === null || v === "" || v === PLACEHOLDER;
}

function parseServiceAccountJson(value) {
    let credentials;
    try {
        credentials = typeof value === "string" ? JSON.parse(value) : value;
    } catch (e) {
        throw new Error("GMC_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
    if (
        !credentials ||
        credentials.type !== "service_account" ||
        isPlaceholder(credentials.private_key) ||
        isPlaceholder(credentials.client_email) ||
        isPlaceholder(credentials.private_key_id)
    ) {
        throw new Error("GMC_SERVICE_ACCOUNT_JSON must be a service_account key with private_key and client_email");
    }
    return credentials;
}

function getAuthClient(params) {

    if (isPlaceholder(params.GMC_SERVICE_ACCOUNT_JSON)) {
        throw new Error("GMC credentials not configured: need GMC_SERVICE_ACCOUNT_JSON");
    }

    const credentials = parseServiceAccountJson(params.GMC_SERVICE_ACCOUNT_JSON);

    if (
        !isPlaceholder(params.GMC_SERVICE_ACCOUNT_EMAIL) &&
        credentials.client_email !== params.GMC_SERVICE_ACCOUNT_EMAIL
    ) {
        throw new Error("GMC service account email does not match GMC_SERVICE_ACCOUNT_EMAIL");
    }

    if (
        !isPlaceholder(params.GMC_GCP_PROJECT_ID) &&
        !isPlaceholder(credentials.project_id) &&
        credentials.project_id !== params.GMC_GCP_PROJECT_ID
    ) {
        throw new Error("GMC service account project does not match GMC_GCP_PROJECT_ID");
    }

    // GoogleAuth (unlike a bare OAuth2Client/JWT client) exposes getUniverseDomain(),
    // which google-gax's GrpcClient.createStub calls when constructing every GAPIC
    // stub — see gmcClients.js.
    return new GoogleAuth({ credentials, scopes: [CONTENT_SCOPE] });
}

module.exports = { getAuthClient, CONTENT_SCOPE, isPlaceholder, parseServiceAccountJson };
