// Umstellung auf 0.19: bestehende Geräte behalten ihre Rechte („!“ wie bisher „Alles erlauben“), bekommen je einen
// eigenen Vermittler-Schlüssel; der alte Einrichtungscode (gemeinsames Kennwort) gilt nicht mehr.
(async () => {
  const info = await api.remote.info();
  const [a, b] = info.host.devices;
  check('Umstellung: Gerät mit „Alles erlauben“ behält es und bekommt „!“', a?.name === 'Altes Handy' && a.allowBypass === true && a.allowBang === true && a.allowProjects === true, JSON.stringify(a));
  check('Umstellung: Gerät ohne „Alles erlauben“ bekommt kein „!“', b?.name === 'Alter Laptop' && b.allowBypass === false && b.allowBang === false, JSON.stringify(b));
  check('Umstellung: alter Vermittler-Code markiert, kein Schlüssel', info.host.relay.legacy === true && info.host.relay.hasKey === false && info.host.relay.address === 'relay.example', JSON.stringify(info.host.relay));
  check('Umstellung: Oberfläche bekommt keine Schlüssel', !/keyEnc|dialKey|secret/i.test(JSON.stringify(info)));
  remoteState = info;
  check('Umstellung: Hinweis zum alten Code in den Einstellungen', relaySection(info.host).textContent.includes('alte Einrichtungscode'));
  return T;
})()
