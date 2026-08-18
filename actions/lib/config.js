const { isPlaceholder } = require("./auth");

const ENVS = new Set(["test", "prod"]);

function assertValidGmcEnv(params) {
    if (!ENVS.has(params.GMC_ENV)) {
        throw new Error(`GMC_ENV must be 'test' or 'prod', got: ${JSON.stringify(params.GMC_ENV)}`);
    }
}

function resolveAccount(params) {
    assertValidGmcEnv(params);

    const id = params.GMC_MERCHANT_ACCOUNT_ID;

    if (isPlaceholder(id)) {
        throw new Error("Missing GMC_MERCHANT_ACCOUNT_ID in action params.");
    }

    return String(id).replace(/^accounts\//, "");
}

function resolveDataSource(params, accountId) {
    const id = params.GMC_DATASOURCE_ID;

    if (isPlaceholder(id)) {
        throw new Error("Missing GMC_DATASOURCE_ID in action params. Run bootstrap-datasource first and populate .env.");
    }

    const bare = String(id).split("/").pop();

    return `accounts/${accountId}/dataSources/${bare}`;
}

module.exports = { resolveAccount, resolveDataSource, ENVS };
