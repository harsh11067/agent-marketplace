/** @type {import('next').NextConfig} */
const backendOrigin =
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN ||
  process.env.BACKEND_ORIGIN ||
  'http://localhost:3002'

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
