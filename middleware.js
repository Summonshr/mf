const ALLOWED_ORIGIN = 'https://meroshare.cdsc.com.np';

export default function middleware(request) {
  const url = new URL(request.url);

  // Allow cron endpoint to use its own authorization mechanism
  if (url.pathname === '/api/cron') {
    return;
  }

  const origin = request.headers.get('Origin');

  // Block all requests that don't have the correct Origin header
  if (origin !== ALLOWED_ORIGIN) {
    return new Response('Forbidden', {
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  // Allow the request to proceed
  return;
}

export const config = {
  matcher: ['/((?!_vercel).*)'],
};
