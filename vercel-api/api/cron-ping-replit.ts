import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const replitUrl = process.env.REPLIT_URL;
  
  if (!replitUrl) {
    console.log('⚠️ REPLIT_URL não configurada');
    return res.status(400).json({ 
      success: false, 
      error: 'REPLIT_URL não configurada nas environment variables' 
    });
  }

  try {
    console.log(`📤 Cron: Pingando Replit em ${replitUrl}`);
    
    const response = await fetch(`${replitUrl}/api/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ping-From': 'vercel-cron'
      },
      body: JSON.stringify({ 
        source: 'vercel-cron', 
        timestamp: Date.now(),
        cronTime: new Date().toISOString()
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Ping para Replit bem sucedido');
      return res.status(200).json({ 
        success: true, 
        message: 'Replit pingado com sucesso',
        replitResponse: data
      });
    } else {
      console.log(`⚠️ Replit respondeu com status: ${response.status}`);
      return res.status(200).json({ 
        success: false, 
        error: `Replit status: ${response.status}` 
      });
    }
  } catch (error) {
    console.error('❌ Erro ao pingar Replit:', error);
    return res.status(500).json({ 
      success: false, 
      error: (error as Error).message 
    });
  }
}
