// Test-only LAN boundary; never used by the production Worker.
import { isIP } from 'node:net';

const ipv4 = s => isIP(s) === 4 ? s.split('.').reduce((n,x) => (n * 256 + Number(x)) >>> 0, 0) : null;
export function lanConfig(address, interfaces, port) {
  const n=ipv4(address);
  if (n === null || !(address.startsWith('10.') || address.startsWith('192.168.') || (address.startsWith('172.') && Number(address.split('.')[1]) >= 16 && Number(address.split('.')[1]) <= 31))) throw Error('LAN preview requires an RFC1918 IPv4 address');
  const matches=Object.values(interfaces).flat().filter(x => x.family === 'IPv4' && !x.internal && x.address === address);
  if (matches.length !== 1) throw Error('LAN preview address must be assigned to exactly one non-internal interface');
  const mask=ipv4(matches[0].netmask);
  if (mask === null || mask === 0 || (((~mask >>> 0) & ((~mask >>> 0) + 1)) !== 0)) throw Error('Invalid interface netmask');
  return { address, mask, network:(n & mask) >>> 0, host:`${address}:${port}` };
}
export function allowedLanRequest(config, host, peer) {
  const n=ipv4(peer?.startsWith('::ffff:') ? peer.slice(7) : peer);
  return host === config.host && n !== null && ((n & config.mask) >>> 0) === config.network;
}
const names = new Map([['__Host-oauth','fixture_oauth'], ['__Host-session','fixture_session'], ['__Host-csrf','fixture_csrf']]);
export function toWorkerCookies(value='') {
  const reverse=new Map([...names].map(([a,b])=>[b,a]));
  return value.split(';').map(x => x.trim()).map(pair => { const i=pair.indexOf('='); const name=pair.slice(0,i); return i>0 && reverse.has(name) ? reverse.get(name)+pair.slice(i) : ''; }).filter(Boolean).join('; ');
}
export function toLanCookie(value) {
  const parts=value.split(';'); const i=parts[0].indexOf('='); const name=parts[0].slice(0,i);
  if (i<1 || !names.has(name)) throw Error('Unexpected Worker cookie');
  return [names.get(name)+parts[0].slice(i), ...parts.slice(1).filter(x=>x.trim().toLowerCase() !== 'secure')].join(';');
}
