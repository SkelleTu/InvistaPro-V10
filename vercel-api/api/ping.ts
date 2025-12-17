import type { VercelRequest, VercelResponse } from '@vercel/node';

let pingStats = {
  totalReceived: 0,
  lastPingFrom: null as string | null,
  lastPingTime: null as string | null,
  startTime: new Date().toISOString()
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const source = (req.headers['x-ping-from'] as string) || 
                 (req.query.source as string) || 
                 req.body?.source || 
                 'external';
  
  pingStats.totalReceived++;
  pingStats.lastPingFrom = source;
  pingStats.lastPingTime = new Date().toISOString();

  console.log(`📥 Ping recebido de: ${source} | Total: ${pingStats.totalReceived}`);

  // Se o ping veio do Replit, pingar de volta
  const replitUrl = process.env.REPLIT_URL;
  if (replitUrl && source === 'replit') {
    try {
      await fetch(`${replitUrl}/api/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ping-From': 'vercel'
        },
        body: JSON.stringify({ source: 'vercel', timestamp: Date.now() })
      });
      console.log('📤 Ping de volta enviado para Replit');
    } catch (error) {
      console.log('⚠️ Erro ao pingar Replit:', (error as Error).message);
    }
  }

  res.status(200).json({
    pong: true,
    server: 'vercel',
    timestamp: new Date().toISOString(),
    source,
    stats: pingStats
  });
}
