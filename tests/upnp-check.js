// UPnP-Abfrage der öffentlichen Adresse (src/upnp.js) gegen einen nachgebauten Router auf 127.0.0.1.
// Wird von tests/run.js gestartet und gibt die Ergebnisse als JSON aus.
'use strict';
const http = require('node:http');
const path = require('node:path');
const upnp = require(path.join(__dirname, '..', 'src', 'upnp.js'));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

function fakeRouter(answerIp, { chunkedOk = false } = {}) {
  const desc = `<?xml version="1.0"?><root><device><deviceList><device><serviceList>
    <service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/ctl/common</controlURL></service>
    <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/ip</controlURL></service>
    <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>http://8.8.8.8/fremd</controlURL></service>
  </serviceList></device></deviceList></device></root>`;
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/desc.xml') return res.end(desc);
    if (req.method === 'POST' && req.url === '/ctl/ip') {
      if (!chunkedOk && !req.headers['content-length']) { res.statusCode = 411; return res.end(); } // wie die FritzBox
      if (!/GetExternalIPAddress/.test(req.headers.soapaction || '')) { res.statusCode = 500; return res.end(); }
      return res.end(`<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>${answerIp}</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>`);
    }
    res.statusCode = 404; res.end();
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

(async () => {
  let srv = await fakeRouter('203.0.113.7');
  let r = await upnp.queryLocation(`http://127.0.0.1:${srv.address().port}/desc.xml`);
  check('UPnP: öffentliche Adresse vom Router gelesen (mit Content-Length)', r?.address === '203.0.113.7', JSON.stringify(r));
  srv.close();

  srv = await fakeRouter('100.70.1.2');
  r = await upnp.queryLocation(`http://127.0.0.1:${srv.address().port}/desc.xml`);
  check('UPnP: CGNAT-Adresse (DS-Lite) gilt nicht als öffentlich', r && r.address === null, JSON.stringify(r));
  srv.close();

  srv = await fakeRouter('');
  r = await upnp.queryLocation(`http://127.0.0.1:${srv.address().port}/desc.xml`);
  check('UPnP: leere Antwort = keine öffentliche IPv4', r && r.address === null, JSON.stringify(r));
  srv.close();

  check('UPnP: nur Router-Adressen im eigenen Netz', (await upnp.queryLocation('http://8.8.8.8/desc.xml')) === null && (await upnp.queryLocation('https://172.16.0.1/desc.xml')) === null && (await upnp.queryLocation('file:///C:/x.xml')) === null);
  const svc = upnp.wanServices('<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>http://8.8.8.8/x</controlURL></service>', 'http://172.16.0.1:1/d.xml');
  check('UPnP: Steuer-Adressen außerhalb des Netzes werden ignoriert', svc.length === 0, JSON.stringify(svc));
  check('UPnP: Einordnung öffentlich/privat', !upnp.notPublic('198.51.100.2') && upnp.notPublic('172.16.5.1') && upnp.notPublic('100.64.0.1') && upnp.notPublic('0.0.0.0') && upnp.notPublic('x'));
  process.stdout.write(JSON.stringify(results));
})().catch(e => { process.stdout.write(JSON.stringify([{ name: 'UPnP-Test', ok: false, detail: e.message }])); });
