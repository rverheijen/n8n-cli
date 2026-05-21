const TRIGGER_TYPES = [
  ['n8n-nodes-base.chatTrigger',     'Chat Trigger — test via the n8n chat UI or POST /webhook/<path>/chat'],
  ['n8n-nodes-base.formTrigger',     'Form Trigger — test by submitting the form in a browser'],
  ['n8n-nodes-base.scheduleTrigger', 'Schedule Trigger — no HTTP endpoint to test directly'],
  ['n8n-nodes-base.manualTrigger',   'Manual Trigger — run from the n8n editor'],
];

export async function testWorkflow(workflow, baseUrl, opts = {}) {
  const { prod = false, data = null, query = null } = opts;

  const webhookNodes = (workflow.nodes ?? []).filter(n => n.type === 'n8n-nodes-base.webhook');

  if (webhookNodes.length === 0) {
    for (const [type, reason] of TRIGGER_TYPES) {
      if ((workflow.nodes ?? []).some(n => n.type === type)) {
        return [{ skipped: true, reason }];
      }
    }
    return [{ skipped: true, reason: 'No webhook trigger found in workflow' }];
  }

  const results = [];
  for (const node of webhookNodes) {
    const wPath  = node.parameters?.path ?? '';
    const method = (node.parameters?.httpMethod ?? 'POST').toUpperCase();
    const prefix = prod ? 'webhook' : 'webhook-test';
    const base   = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url    = new URL(`${prefix}/${wPath}`, base);

    const queryObj = query      ? JSON.parse(query)
                   : (method === 'GET' && data ? JSON.parse(data) : null);
    if (queryObj) {
      for (const [k, v] of Object.entries(queryObj)) url.searchParams.set(k, String(v));
    }

    const fetchOpts = { method };
    if (data && method !== 'GET') {
      fetchOpts.headers = { 'Content-Type': 'application/json' };
      fetchOpts.body = data;
    }

    let status, body;
    try {
      const res = await fetch(url.toString(), fetchOpts);
      status = res.status;
      body   = await res.text();
    } catch (err) {
      results.push({ node: node.name, method, url: url.toString(), error: err.message });
      continue;
    }

    results.push({ node: node.name, method, url: url.toString(), status, body });
  }

  return results;
}
