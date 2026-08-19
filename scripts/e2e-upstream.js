import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.OPENPLEX_E2E_UPSTREAM_PORT) || 3100;
const origin = `http://${host}:${port}`;

const poster = `${origin}/poster.svg`;

function homeHtml() {
  return `<!doctype html><html><body>
    <div class="slide_wrap"><h2>Trending K-Drama <a class="more" href="/drama">Explore</a></h2>
      <div class="slide_drama"><div class="item"><div class="box">
        <a class="img" href="/drama/74001/1"><img src="${poster}" alt="Fixture Drama"></a>
        <a class="title" href="/drama/74001">Fixture Drama</a><div class="good">42</div>
      </div></div></div>
    </div>
    <div class="slide_wrap"><h2>Popular Movies <a class="more" href="/movie">Explore</a></h2>
      <div class="slide_drama"><div class="item"><div class="box">
        <a class="img" href="/movie/74002/1"><img src="${poster}" alt="Fixture Movie"></a>
        <a class="title" href="/movie/74002">Fixture Movie</a><div class="good">12</div>
      </div></div></div>
    </div>
    <div class="slide_wrap"><h2>Top Animation <a class="more" href="/animation">Explore</a></h2>
      <div class="slide_drama"><div class="item"><div class="box">
        <a class="img" href="/animation/74003/1"><img src="${poster}" alt="Fixture Animation"></a>
        <a class="title" href="/animation/74003">Fixture Animation</a><div class="good">9</div>
      </div></div></div>
    </div>
  </body></html>`;
}

function searchHtml(query) {
  const title = /cyberpunk/i.test(query)
    ? 'Cyberpunk Neo: Shinjuku 2099'
    : /squid/i.test(query)
      ? 'Squid Game: The Challenge Season 2'
      : 'Fixture Drama';
  return `<!doctype html><html><body><ul id="line_type"><li><div class="box">
    <a class="img" href="/drama/74001/1"><img src="${poster}" alt="${title}"></a>
    <span class="thumb-category">Drama</span><span class="thumb-desc">Integrated search result</span>
    <a class="title" href="/drama/74001">${title}</a>
  </div></li></ul></body></html>`;
}

function titleHtml() {
  return `<!doctype html><html><body>
    <h2 id="bo_v_title"><span class="bo_v_tit">Fixture Drama</span></h2>
    <ul class="episode-list">
      <li data-ep-idx="1">
        <a class="img ep-link" href="/drama/74001/1"><img src="${poster}"></a>
        <a class="title ep-link" href="/drama/74001/1">Episode One</a>
        <p>The complete integrated episode fixture.</p>
      </li>
      <li data-ep-idx="2">
        <a class="img ep-link" href="/drama/74001/2"><img src="${poster}"></a>
        <a class="title ep-link" href="/drama/74001/2">Episode Two</a>
        <p>The next-up episode fixture.</p>
      </li>
    </ul>
  </body></html>`;
}

function episodeHtml(epIdx) {
  const episodeTitle = epIdx === 2 ? 'Episode Two' : 'Episode One';
  return `<!doctype html><html><body>
    <link rel="canonical" href="${origin}/drama/74001/${epIdx}">
    <h2 id="bo_v_title"><span class="bo_v_tit">Fixture Drama - ${episodeTitle}</span></h2>
    <iframe id="view_iframe" data-session1="{}" data-session2="{}"></iframe>
  </body></html>`;
}

const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4.0,
/segment.ts
#EXT-X-ENDLIST
`;

export const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', origin);
  const send = (status, contentType, body) => {
    response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(body);
  };

  if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', homeHtml());
  if (url.pathname === '/bbs/search.php') {
    return send(200, 'text/html; charset=utf-8', searchHtml(url.searchParams.get('stx') ?? ''));
  }
  if (url.pathname === '/drama' || url.pathname === '/movie') {
    return send(200, 'text/html; charset=utf-8', '<html><body><ul id="list_type"></ul></body></html>');
  }
  if (url.pathname === '/drama/74001') return send(200, 'text/html; charset=utf-8', titleHtml());
  if (url.pathname === '/drama/74001/1') return send(200, 'text/html; charset=utf-8', episodeHtml(1));
  if (url.pathname === '/drama/74001/2') return send(200, 'text/html; charset=utf-8', episodeHtml(2));
  if (url.pathname === '/bbs/get_episode.php') {
    const requestedEpisode = Number(url.searchParams.get('ep_idx')) === 2 ? 2 : 1;
    const episodeTitle = requestedEpisode === 2 ? 'Episode Two' : 'Episode One';
    return send(200, 'application/json; charset=utf-8', JSON.stringify({
      success: true,
      episode: {
        idx: requestedEpisode,
        title: `Fixture Drama - ${episodeTitle}`,
        thumb: poster,
        hls_url: `${origin}/master.m3u8`,
        vtt: `${origin}/subtitle.vtt`,
        page_url: `/drama/74001/${requestedEpisode}`,
      },
      next_episode: requestedEpisode === 1 ? { idx: 2, title: 'Fixture Drama - Episode Two' } : null,
    }));
  }
  if (url.pathname === '/master.m3u8') {
    return send(200, 'application/vnd.apple.mpegurl', playlist);
  }
  if (url.pathname === '/segment.ts') {
    return send(200, 'video/mp2t', Buffer.alloc(188 * 3, 0x47));
  }
  if (url.pathname === '/subtitle.vtt') {
    return send(200, 'text/vtt; charset=utf-8', 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nFixture subtitle cue\n');
  }
  if (url.pathname === '/poster.svg') {
    return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="100%" height="100%" fill="#18181b"/><text x="50%" y="50%" fill="#f59e0b" text-anchor="middle" font-size="48">OpenPlex Fixture</text></svg>');
  }
  return send(404, 'text/plain; charset=utf-8', 'not found');
});

export function startE2eUpstream() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      console.log(`OpenPlex E2E upstream listening at ${origin}`);
      resolve(server);
    });
  });
}

const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await startE2eUpstream();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
