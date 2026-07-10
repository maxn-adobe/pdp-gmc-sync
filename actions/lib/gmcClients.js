const { ProductInputsServiceClient, ProductsServiceClient } = require('@google-shopping/products').v1
const { DataSourcesServiceClient } = require('@google-shopping/datasources').v1
const { ReportServiceClient } = require('@google-shopping/reports').v1
const { getAuthClient } = require('./auth')

function makeClients (params) {
  const auth = getAuthClient(params)
  return {
    productInputs: new ProductInputsServiceClient({ auth }),
    products: new ProductsServiceClient({ auth }),
    dataSources: new DataSourcesServiceClient({ auth }),
    reports: new ReportServiceClient({ auth })
  }
}

module.exports = { makeClients }
