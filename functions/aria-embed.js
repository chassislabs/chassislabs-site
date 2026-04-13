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

  // Inject base tag so all relative asset URLs resolve to app.relevanceai.com
  // Also inject a script that spoofs window.location so Nuxt router resolves correctly
  const inject = `<base href="${upstreamOrigin}/">
<script>
  (function() {
    var target = '${upstreamOrigin}/agents/${agentPath}/embed-chat?${params}';
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        get: function() {
          var url = new URL(target);
          return {
            href: url.href,
            origin: url.origin,
            protocol: url.protocol,
            host: url.host,
            hostname: url.hostname,
            port: url.port,
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
            assign: function(u) { window.top.location.href = u; },
            replace: function(u) { window.top.location.href = u; },
            reload: function() {}
          };
        }
      });
    } catch(e) {}
  })();
<\/script>`;

  // Insert right after <head>
  html = html.replace('<head>', '<head>\n' + inject);

  const headers = new Headers();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('x-frame-options', 'SAMEORIGIN');
  headers.set('content-security-policy', "frame-ancestors 'self' https://chassislabs.com https://www.chassislabs.com");
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'no-store');

  return new Response(html, { status: 200, headers });
}
