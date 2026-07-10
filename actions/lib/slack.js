const fetch = require('node-fetch')

async function postSlack (webhookUrl, text) {
  if (!webhookUrl || webhookUrl === '__PLACEHOLDER__') return { skipped: true, reason: 'no SLACK_WEBHOOK_URL configured' }
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error('SLACK_WEBHOOK_URL must be HTTPS')

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Slack webhook returned ${res.status}: ${body.slice(0, 500)}`)
  }
  return { ok: true }
}

function formatDigest (report) {
  const { env, counts, offerCount, itemIssueTop } = report
  const lines = [
    `*GMC diagnostics* — env: \`${env}\` — offers examined: ${offerCount}`,
    `Active: ${counts.active}  Pending: ${counts.pending}  Disapproved: ${counts.disapproved}  Unknown: ${counts.unknown}`
  ]
  if (itemIssueTop && itemIssueTop.length) {
    lines.push('*Top item-level issues:*')
    for (const it of itemIssueTop.slice(0, 10)) {
      lines.push(`• [${it.severity || 'severity?'}] ${it.code} — ${it.count} product(s)${it.attribute ? ` (${it.attribute})` : ''}`)
    }
  }
  return lines.join('\n')
}

module.exports = { postSlack, formatDigest }
