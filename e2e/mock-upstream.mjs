// Minimal stand-in for a Radio Browser mirror, used only by the E2E suite so tests are
// deterministic and do not depend on (or load) the public API.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const BASE = `http://localhost:${PORT}`;

const station = (n, over = {}) => ({
  stationuuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Mock Radio India ${n}`,
  url: `${BASE}/stream.wav`,
  url_resolved: `${BASE}/stream.wav`,
  homepage: 'https://example.com',
  favicon: '',
  tags: 'bollywood,hindi,music',
  country: 'India',
  countrycode: 'IN',
  language: 'hindi',
  codec: 'MP3',
  bitrate: 128,
  hls: 0,
  lastcheckok: 1,
  votes: 100 - n,
  clickcount: 1000 - n,
  ...over,
});

const INDIA = [
  station(1),
  station(2),
  station(3),
  // Marked broken upstream: must be hidden.
  station(4, { lastcheckok: 0, name: 'Broken Station' }),
  // Listed as OK but the stream 404s: exercises the player's error state.
  station(5, { name: 'Mock Radio India Offline', url: `${BASE}/dead`, url_resolved: `${BASE}/dead`, clickcount: 998, votes: 0 }),
];
const COUNTRIES = [
  { name: 'India', iso_3166_1: 'IN', stationcount: 4 },
  { name: 'Germany', iso_3166_1: 'DE', stationcount: 2 },
  { name: 'Brazil', iso_3166_1: 'BR', stationcount: 1 },
];

// 60 s of silent 8 kHz mono PCM, enough for the <audio> element to start playing.
function silentWav(seconds = 60, rate = 8000) {
  const data = rate * seconds;
  const buf = Buffer.alloc(44 + data, 0x80);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data, 40);
  return buf;
}
const WAV = silentWav();

const json = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', BASE);
    const p = url.pathname;
    if (p === '/json/countries') return json(res, COUNTRIES);
    if (p === '/json/stations/bycountrycodeexact/IN') return json(res, INDIA);
    if (p.startsWith('/json/stations/bycountrycodeexact/')) return json(res, []);
    if (p === '/json/stations/search') {
      const name = (url.searchParams.get('name') ?? '').toLowerCase();
      return json(res, INDIA.filter((s) => s.name.toLowerCase().includes(name)));
    }
    if (p.startsWith('/json/url/')) return json(res, { ok: true, message: 'retrieved station url' });
    if (p === '/stream.wav') {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': WAV.length });
      return res.end(WAV);
    }
    res.writeHead(404).end();
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock upstream on ${BASE}`));
