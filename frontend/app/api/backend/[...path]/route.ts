// Disabled route handler: We are now using Next.js native rewrites in next.config.mjs for faster, error-free API proxying.
export function GET() { return new Response('Use native rewrites', { status: 404 }); }
