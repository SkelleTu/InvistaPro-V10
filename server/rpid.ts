import type { Request } from 'express';

function getHost(req: Request) {
  const xf = (req.headers['x-forwarded-host'] as string) || '';
  return (xf || req.hostname).split(',')[0].trim();
}

function getProto(req: Request) {
  return (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
}

export function getRpContext(req: Request) {
  const host = getHost(req);
  const proto = getProto(req) === 'http' ? 'https' : 'https'; // força https
  return { rpID: host, origin: `${proto}://${host}` };
}