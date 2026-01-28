const ALLOWED_ORIGIN = 'https://meroshare.cdsc.com.np';

export default function middleware(request) {
  const url = new URL(request.url);

  // Allow cron endpoint to use its own authorization mechanism
  if (url.pathname === '/api/cron') {
    return;
  }

  const origin = request.headers.get('Origin');

  // Block all requests without Origin header (direct browser access)
  // or with incorrect Origin header
  if (!origin || origin !== ALLOWED_ORIGIN) {
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
