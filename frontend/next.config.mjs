/** @type {import('next').NextConfig} */
const backendOrigin =
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN ||
  process.env.BACKEND_ORIGIN ||
  'http://15.135.158.19/agent-marketplace-api'

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${backendOrigin}/:path*`,
      },
    ]
  },
}

export default nextConfig
