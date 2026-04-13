export async function onRequest(context) {
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { message, conversation_id } = body;
  if (!message) {
    return new Response('Missing message', { status: 400 });
  }

  const apiKey = context.env.RELEVANCE_API_KEY;
  const agentId = '4849a6c2-bbd3-4dfc-abe7-d11bcd31fccf';
  const projectId = 'bcbe5a';
  const region = 'bcbe5a';

  // Step 1: Trigger the agent (start a new task or continue one)
  const triggerPayload = {
    message: {
      role: 'user',
      content: message,
    },
    agent_id: agentId,
  };

  if (conversation_id) {
    triggerPayload.conversation_id = conversation_id;
  }

  const triggerResp = await fetch(
    `https://api-${region}.stack.tryrelevance.com/latest/agents/trigger`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify(triggerPayload),
    }
  );

  if (!triggerResp.ok) {
    const errText = await triggerResp.text();
    return sseError(`Trigger failed: ${triggerResp.status} ${errText}`);
  }

  const triggerData = await triggerResp.json();
  const jobId = triggerData.job_id;
  const convId = triggerData.conversation_id || conversation_id || crypto.randomUUID();

  if (!jobId) {
    return sseError('No job_id returned from agent trigger');
  }

  // Step 2: Poll for the result and stream it back as SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const writeSSE = async (obj) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  // Poll in background, stream SSE to client
  (async () => {
    const maxAttempts = 60; // 60 * 2s = 2 minutes max
    let attempts = 0;
    let lastOutput = '';

    while (attempts < maxAttempts) {
      attempts++;
      await sleep(2000);

      let pollResp;
      try {
        pollResp = await fetch(
          `https://api-${region}.stack.tryrelevance.com/latest/agents/conversations/${convId}/tasks/${jobId}`,
          {
            headers: { Authorization: apiKey },
          }
        );
      } catch (e) {
        await writeSSE({ type: 'error', message: 'Poll request failed' });
        break;
      }

      if (!pollResp.ok) {
        // Try alternate endpoint
        pollResp = await fetch(
          `https://api-${region}.stack.tryrelevance.com/latest/studios/${agentId}/async_poll/${jobId}?project=${projectId}`,
          {
            headers: { Authorization: apiKey },
          }
        );
      }

      if (!pollResp.ok) {
        await writeSSE({ type: 'error', message: `Poll failed: ${pollResp.status}` });
        break;
      }

      const data = await pollResp.json();
      const status = data.status || data.type;

      // Extract any new output text to stream incrementally
      const output = extractOutput(data);
      if (output && output !== lastOutput) {
        const newChunk = output.slice(lastOutput.length);
        if (newChunk) {
          await writeSSE({ type: 'chunk', text: newChunk });
        }
        lastOutput = output;
      }

      if (status === 'complete' || status === 'completed' || status === 'done') {
        const finalOutput = extractOutput(data);
        if (finalOutput && finalOutput !== lastOutput) {
          await writeSSE({ type: 'chunk', text: finalOutput.slice(lastOutput.length) });
        }
        await writeSSE({ type: 'done', conversation_id: convId });
        break;
      }

      if (status === 'failed' || status === 'error') {
        await writeSSE({ type: 'error', message: data.errors?.[0]?.message || 'Agent failed' });
        break;
      }
    }

    if (attempts >= maxAttempts) {
      await writeSSE({ type: 'error', message: 'Response timed out' });
    }

    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function extractOutput(data) {
  // Try common response shapes from Relevance AI
  if (data.output?.answer) return data.output.answer;
  if (data.output?.response) return data.output.response;
  if (data.output?.message) return data.output.message;
  if (typeof data.output === 'string') return data.output;
  if (data.updates) {
    // Find the last agent message in updates array
    const updates = data.updates;
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      if (u.type === 'agent-message' || u.type === 'message') {
        return u.message?.content || u.content || '';
      }
    }
  }
  return '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sseError(message) {
  const body = `data: ${JSON.stringify({ type: 'error', message })}\n\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
