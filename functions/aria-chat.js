export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (context.request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const { message, conversation_id } = body;
  if (!message) return new Response('Missing message', { status: 400 });

  const apiKey = context.env.RELEVANCE_API_KEY;
  const agentId = '4849a6c2-bbd3-4dfc-abe7-d11bcd31fccf';
  const projectId = 'bcbe5a';
  const region = 'bcbe5a';

  const triggerPayload = { message: { role: 'user', content: message }, agent_id: agentId };
  if (conversation_id) triggerPayload.conversation_id = conversation_id;

  const triggerResp = await fetch(
    `https://api-${region}.stack.tryrelevance.com/latest/agents/trigger`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: apiKey }, body: JSON.stringify(triggerPayload) }
  );
  if (!triggerResp.ok) {
    const errText = await triggerResp.text();
    return sseError(`Trigger failed: ${triggerResp.status} ${errText.slice(0,300)}`);
  }

  const triggerData = await triggerResp.json();
  const jobId = triggerData.job_id || triggerData.job_info?.job_id;
  const convId = triggerData.conversation_id || conversation_id || crypto.randomUUID();
  if (!jobId) return sseError(`No job_id. Keys=${JSON.stringify(Object.keys(triggerData))} Data=${JSON.stringify(triggerData).slice(0,400)}`);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const writeSSE = async (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  (async () => {
    const maxAttempts = 60;
    let attempts = 0;
    let lastOutput = '';
    let debugSent = false;

    while (attempts < maxAttempts) {
      attempts++;
      await sleep(2000);

      let pollResp;
      try {
        pollResp = await fetch(
          `https://api-${region}.stack.tryrelevance.com/latest/agents/conversations/${convId}/tasks/${jobId}`,
          { headers: { Authorization: apiKey } }
        );
      } catch (e) {
        await writeSSE({ type: 'error', message: 'Poll fetch failed: ' + e.message });
        break;
      }

      if (!pollResp.ok) {
        pollResp = await fetch(
          `https://api-${region}.stack.tryrelevance.com/latest/studios/${agentId}/async_poll/${jobId}?project=${projectId}`,
          { headers: { Authorization: apiKey } }
        );
      }
      if (!pollResp.ok) { await writeSSE({ type: 'error', message: `Poll ${pollResp.status}` }); break; }

      const data = await pollResp.json();
      const status = data.status || data.type;

      // Send raw poll structure once for debugging
      if (!debugSent) {
        debugSent = true;
        await writeSSE({ type: 'chunk', text: `[DBG] status=${status} keys=${JSON.stringify(Object.keys(data))} ${JSON.stringify(data).slice(0,600)}` });
      }

      const output = extractOutput(data);
      if (output && output !== lastOutput) {
        const chunk = output.slice(lastOutput.length);
        if (chunk) await writeSSE({ type: 'chunk', text: chunk });
        lastOutput = output;
      }

      if (status === 'complete' || status === 'completed' || status === 'done') {
        await writeSSE({ type: 'done', conversation_id: convId });
        break;
      }
      if (status === 'failed' || status === 'error') {
        await writeSSE({ type: 'error', message: data.errors?.[0]?.message || 'Agent failed' });
        break;
      }
    }
    if (attempts >= maxAttempts) await writeSSE({ type: 'error', message: 'Timed out' });
    await writer.close();
  })();

  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' } });
}

function extractOutput(data) {
  if (data.output?.answer) return data.output.answer;
  if (data.output?.response) return data.output.response;
  if (data.output?.message) return data.output.message;
  if (typeof data.output === 'string') return data.output;
  if (data.updates) {
    for (let i = data.updates.length - 1; i >= 0; i--) {
      const u = data.updates[i];
      if (u.type === 'agent-message' || u.type === 'message') return u.message?.content || u.content || '';
    }
  }
  return '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sseError(message) {
  return new Response(`data: ${JSON.stringify({ type: 'error', message })}\n\n`, { headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' } });
}
