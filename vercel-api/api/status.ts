import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status: 'online',
    server: 'vercel',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'development',
    replitUrl: process.env.REPLIT_URL ? 'configured' : 'not-configured'
  });
}
