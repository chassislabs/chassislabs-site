export async function onRequest(context) {
  const agentPath = 'bcbe5a/afcb6d6a-9301-49a7-89fe-b2c89ca18179/4849a6c2-bbd3-4dfc-abe7-d11bcd31fccf';
  const params = 'hide_tool_steps=false&hide_file_uploads=false&hide_conversation_list=false&bubble_style=agent&primary_color=%23685FFF&bubble_icon=pd%2Fchat&input_placeholder_text=Type+your+message...&hide_logo=false&hide_description=false';
  const upstreamUrl = `https://app.relevanceai.com/agents/${agentPath}/embed-chat?${params}`;
  const upstreamOrigin = 'https://app.relevanceai.com';

  const upstream = await fetch(upstreamUrl, {
    headers: {
      'User-Agent': context.request.headers.get('User-Agent') || '',
      'Accept': 'text/html',
      'Accept-Language': context.request.headers.get('Accept-Language') || 'en-US,en',
    },
  });

  let html = await upstream.text();

  const targetUrl = `${upstreamOrigin}/agents/${agentPath}/embed-chat?${params}`;

  const inject = `<base href="${upstreamOrigin}/">
<script>
  (function() {
    try {
      history.replaceState(history.state, '', '${targetUrl}');
    } catch(e) {}
  })();
<\/script>`;

  html = html.replace('<head>', '<head>\n' + inject);

  const headers = new Headers();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('x-frame-options', 'SAMEORIGIN');
  headers.set('content-security-policy', "frame-ancestors 'self' https://chassislabs.com https://www.chassislabs.com");
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'no-store');

  return new Response(html, { status: 200, headers });
}
