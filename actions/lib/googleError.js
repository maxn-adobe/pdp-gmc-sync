const GRPC = {
  0: 'OK',
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED'
}

const RETRIABLE_STATUS = new Set([
  'DEADLINE_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'UNAVAILABLE',
  'ABORTED'
])

function extractReason (err) {
  const details = err?.response?.data?.error?.details
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d?.reason) return d.reason
      if (d?.metadata?.REASON) return d.metadata.REASON
      if (d?.metadata?.reason) return d.metadata.reason
    }
  }
  if (Array.isArray(err?.statusDetails)) {
    for (const d of err.statusDetails) {
      if (d?.reason) return d.reason
      if (d?.metadata?.REASON) return d.metadata.REASON
    }
  }
  return err?.errorInfoMetadata?.REASON || ''
}

function parseGoogleError (err) {
  if (err?.response?.status) {
    const http = err.response.status
    const status = err.response.data?.error?.status || ''
    return {
      code: http,
      status,
      reason: extractReason(err),
      message: err.response.data?.error?.message || err.message,
      retriable: http === 429 || http >= 500
    }
  }

  const code = err?.code
  const status = typeof code === 'number' ? (GRPC[code] || `CODE_${code}`) : String(code ?? 'UNKNOWN')
  return {
    code,
    status,
    reason: extractReason(err),
    message: err?.message || 'unknown error',
    retriable: RETRIABLE_STATUS.has(status) || code === 429
  }
}

module.exports = { parseGoogleError, GRPC, RETRIABLE_STATUS }
