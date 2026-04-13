export async function onRequest(context) {
  const upstreamUrl =
    'https://app.relevanceai.com/agents/bcbe5a/afcb6d6a-9301-49a7-89fe-b2c89ca18179/4849a6c2-bbd3-4dfc-abe7-d11bcd31fccf/embed-chat' +
    '?hide_tool_steps=false&hide_file_uploads=false&hide_conversation_list=false' +
    '&bubble_style=agent&primary_color=%23685FFF&bubble_icon=pd%2Fchat' +
    '&input_placeholder_text=Type+your+message...&hide_logo=false&hide_description=false';

  const upstream = await fetch(upstreamUrl, {
    headers: {
      'User-Agent': context.request.headers.get('User-Agent') || '',
      'Accept': context.request.headers.get('Accept') || 'text/html',
      'Accept-Language': context.request.headers.get('Accept-Language') || 'en-US,en',
    },
  });

  // Copy headers, stripping the ones that block iframe embedding
  const headers = new Headers(upstream.headers);
  headers.delete('x-frame-options');
  headers.delete('X-Frame-Options');
  headers.set(
    'content-security-policy',
    "frame-ancestors 'self' https://chassislabs.com https://www.chassislabs.com"
  );
  // Allow the embedded page to communicate back
  headers.set('access-control-allow-origin', 'https://chassislabs.com');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
