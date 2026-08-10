const { Ims, getTokenData: decodeImsToken } = require('@adobe/aio-lib-ims')
const { getBearerToken } = require('../utils')

const ims = new Ims('prod')
const allowList = ['<da.live client_id>', "projectx_webapp", "darkalley"]


function getTokenData (token) {
  return decodeImsToken(token)
}

async function isValidImsToken (params) {
  const token = getBearerToken(params)
  if (!token) return false

  const validation = await ims.validateToken(token)
  const claims = getTokenData(token)
  console.log(`IMS token claims: ${JSON.stringify({
    as: claims.as,
    client_id: claims.client_id,
    type: claims.type
  })}`)

  const allowListValidation = await ims.validateTokenAllowList(token, allowList)
  console.log(`IMS token validation: valid=${validation?.valid}, allowList=${allowListValidation?.valid}, validation=${JSON.stringify(validation)}, allowListValidation=${JSON.stringify(allowListValidation)}`)

  return validation?.valid === true && allowListValidation?.valid === true
}

module.exports = { getTokenData, isValidImsToken }