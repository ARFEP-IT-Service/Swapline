// Öffentliche IPv4-Adresse des Routers per UPnP (Internet Gateway Device) abfragen – z. B. bei einer FritzBox.
// Nur im eigenen Netz: Suche per SSDP (Multicast), Gerätebeschreibung und Abfrage nur bei privaten Adressen,
// keine Internetdienste. Es wird nur gelesen (GetExternalIPAddress), nie eine Portfreigabe angelegt.
'use strict';
const dgram = require('node:dgram');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');

const MAX_BODY = 256 * 1024;
const SSDP_ADDR = '239.255.255.250', SSDP_PORT = 1900;
const TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

function privateV4(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
// Keine echte öffentliche Adresse: privat, CGNAT (100.64.0.0/10, z. B. DS-Lite) oder leer
function notPublic(ip) {
  if (!net.isIPv4(ip) || ip === '0.0.0.0') return true;
  const [a, b] = ip.split('.').map(Number);
  return privateV4(ip) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
// Nur http-Adressen im eigenen Netz (Router), nie Namen oder fremde Adressen
function localUrl(u, base) {
  let url; try { url = new URL(u, base); } catch { return null; }
  return url.protocol === 'http:' && privateV4(url.hostname) ? url : null;
}

function request(url, { method = 'GET', headers = {}, body = null, timeout = 3000 } = {}) {
  return new Promise(resolve => {
    if (body) headers = { ...headers, 'Content-Length': Buffer.byteLength(body) }; // FritzBox lehnt „chunked“ ab (411)
    const req = http.request(url, { method, headers, timeout }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; if (data.length > MAX_BODY) req.destroy(); });
      res.on('end', () => resolve(res.statusCode === 200 ? data : null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

// Eigene Adressen im Heimnetz (ohne VPN-/virtuelle Adapter, deren Router nicht der Internet-Router ist)
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Docker|Radmin|Hamachi|ZeroTier|Tailscale|VPN/i;
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (!a.internal && a.family === 'IPv4' && privateV4(a.address) && !VIRTUAL.test(name)) out.push(a.address);
  }
  return out;
}

// SSDP: Router im Netz finden – Suche über jede Heimnetz-Schnittstelle einzeln (sonst geht sie evtl. über einen
// VPN-Adapter hinaus). Ergebnis sind Adressen der Gerätebeschreibungen.
function discover(timeout = 2500) {
  const one = local => new Promise(resolve => {
    const found = new Set();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return resolve([]); }
    const done = () => { try { sock.close(); } catch {} resolve([...found]); };
    sock.on('error', done);
    sock.on('message', (msg, rinfo) => {
      const loc = /^location:\s*(\S+)/im.exec(msg.toString('utf8').slice(0, 4096))?.[1];
      const url = loc && localUrl(loc);
      if (url && url.hostname === rinfo.address) found.add(url.href); // Beschreibung nur vom antwortenden Gerät selbst
    });
    sock.bind(0, local, () => {
      try { if (local) sock.setMulticastInterface(local); } catch {}
      for (const st of TARGETS) {
        const m = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        sock.send(m, SSDP_PORT, SSDP_ADDR, () => {});
      }
      setTimeout(done, timeout);
    });
  });
  const locals = lanAddresses();
  return Promise.all((locals.length ? locals : [undefined]).map(one)).then(lists => [...new Set(lists.flat())]);
}

// WAN-Dienste (Typ und Steuer-Adresse) aus der Gerätebeschreibung
function wanServices(xml, base) {
  const out = [];
  for (const m of String(xml).matchAll(/<service>([\s\S]*?)<\/service>/g)) {
    const type = /<serviceType>\s*([^<\s]+)\s*<\/serviceType>/.exec(m[1])?.[1] || '';
    const ctrl = /<controlURL>\s*([^<\s]+)\s*<\/controlURL>/.exec(m[1])?.[1];
    if (!/^urn:schemas-upnp-org:service:WAN(IP|PPP)Connection:\d$/.test(type) || !ctrl) continue;
    const url = localUrl(ctrl, base);
    if (url) out.push({ type, url: url.href });
  }
  return out;
}

async function queryLocation(location) {
  const loc = localUrl(location);
  if (!loc) return null;
  const xml = await request(loc.href);
  if (!xml) return null;
  for (const s of wanServices(xml, loc.href)) {
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="${s.type}"/></s:Body></s:Envelope>`;
    const res = await request(s.url, { method: 'POST', body, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${s.type}#GetExternalIPAddress"` } });
    const ip = res && /<NewExternalIPAddress>\s*([^<\s]*)\s*<\/NewExternalIPAddress>/.exec(res)?.[1];
    if (ip !== undefined && ip !== null) return { address: net.isIPv4(ip) && !notPublic(ip) ? ip : null, router: loc.hostname };
  }
  return null;
}

// { address: '1.2.3.4' | null (keine öffentliche IPv4, z. B. DS-Lite), router } oder null (kein UPnP-Router gefunden)
// Rückfall ohne SSDP (Antworten z. B. von einer Firewall geblockt): Router meist unter x.y.z.1, FritzBox mit fester Beschreibung
const FALLBACK = [':49000/igddesc.xml'];
async function externalAddress() {
  const guesses = lanAddresses().map(a => a.replace(/\.\d+$/, '.1')).flatMap(g => FALLBACK.map(p => `http://${g}${p}`));
  for (const loc of [...await discover(), ...guesses]) {
    const r = await queryLocation(loc);
    if (r) return r;
  }
  return null;
}

module.exports = { externalAddress, queryLocation, wanServices, notPublic, privateV4, lanAddresses };
