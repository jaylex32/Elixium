/*
 * Undoing YouTube's URL scrambling by running their player.
 *
 * The player here is synthetic — a real one is two and a half megabytes and is
 * replaced weekly, so pinning one would test nothing durable. What it does
 * reproduce is the structure that matters: everything wrapped in one scope, a
 * URL object with minified method names, and a builder identified only by its
 * `alr=yes` call.
 *
 * The behaviour worth guarding is the refusal. When the builder cannot be found
 * or driven, this must return null rather than something — an undescrambled URL
 * and a descrambled one look identical at the call site, and the version that
 * guessed passed a cipher string to the HTTP client as though it were an
 * address.
 */
import test from 'ava';
import {
  parseCipher,
  playerUrlFrom,
  findUrlBuilder,
  loadSolver,
  resolveCipher,
  resolveThrottle,
} from '../src/core/ytmusic/signature';

/**
 * A player shaped like YouTube's: one wrapper scope, a URL class whose renderer
 * has a minified name, and a builder that descrambles as it builds.
 *
 * The transform here reverses the signature and uppercases `n`. What it does is
 * irrelevant — the point is that the caller never needs to know.
 */
const player = `
var _yt_player={};
(function(g){
  var Url = function(base){
    // Parsed, not kept as text: the real player replaces an existing n rather
    // than appending a second one, and a fixture that appends would pass a
    // test the real thing fails.
    var cut = base.indexOf('?');
    this.base = cut === -1 ? base : base.slice(0, cut);
    this.params = {};
    if (cut !== -1) {
      var pairs = base.slice(cut + 1).split('&');
      for (var i = 0; i < pairs.length; i++) {
        if (!pairs[i]) continue;
        var eq = pairs[i].indexOf('=');
        this.params[pairs[i].slice(0, eq)] = pairs[i].slice(eq + 1);
      }
    }
  };
  Url.prototype.set = function(k, v){
    if (k === 'n') v = String(v).toUpperCase();
    this.params[k] = v;
  };
  Url.prototype.get = function(k){ return this.params[k]; };
  Url.prototype.clone = function(){ return this; };
  Url.prototype.qZ = function(){
    var out = this.base;
    for (var k in this.params) out += (out.indexOf('?') === -1 ? '?' : '&') + k + '=' + this.params[k];
    return out;
  };
  var descramble = function(s){ return s.split('').reverse().join(''); };
  var build = function(t, f, H){
    t = new Url(t);
    t.set("alr","yes");
    H && t.set(f, descramble(decodeURIComponent(H)));
    return t;
  };
  g.build = build;
})(_yt_player);
`;

/** A second builder taking two arguments, as the real player also has. */
const playerWithDecoy = player.replace(
  '  g.build = build;',
  '  var redirect = function(t, f){ var H = new Url(t); H.set("alr","yes"); return H; };\n  g.redirect = redirect;\n  g.build = build;',
);

test('a cipher is split into its url, signature and parameter name', (t) => {
  const cipher = parseCipher('s=SCRAMBLED&sp=sig&url=https%3A%2F%2Fexample.com%2Fplay%3Fitag%3D140');
  t.is(cipher?.s, 'SCRAMBLED');
  t.is(cipher?.sp, 'sig');
  t.is(cipher?.url, 'https://example.com/play?itag=140');
});

test('a cipher with no sp defaults to the signature parameter', (t) => {
  t.is(parseCipher('s=X&url=https%3A%2F%2Fexample.com%2F')?.sp, 'signature');
});

test('an ordinary URL is not mistaken for a cipher', (t) => {
  t.is(parseCipher('https://example.com/videoplayback?itag=140'), null);
  t.is(parseCipher(''), null);
});

test('the player URL is read out of a watch page', (t) => {
  t.is(
    playerUrlFrom('junk"/s/player/abc123/player_ias.vflset/en_US/base.js"more'),
    'https://www.youtube.com/s/player/abc123/player_ias.vflset/en_US/base.js',
  );
  t.is(playerUrlFrom('a page with no player in it'), null);
});

/*
 * Finding the builder is the whole trick.
 *
 * Nothing about the transform is stable enough to match on — it is rebuilt at
 * runtime from nested helpers and every method name is minified afresh each
 * week. The one fixed point is that a playback URL carries `alr=yes`.
 */
test('the builder is found by its alr=yes call', (t) => {
  const found = findUrlBuilder(player);
  t.is(found?.name, 'build');
});

test('the three-argument builder is chosen over the two-argument decoy', (t) => {
  // The real player has a redirector helper that also sets alr=yes.
  t.is(findUrlBuilder(playerWithDecoy)?.name, 'build');
});

/*
 * Arity is a preference, not a gate.
 *
 * Three arguments is what today's builder takes, and it is what separates it
 * from the redirector that also sets alr=yes. But a player that changed the
 * arity would take every download with it, so a lone candidate is used
 * whatever its shape — a guess beats a refusal when there is only one.
 */
test('a builder with an unexpected arity is still used when it is the only one', (t) => {
  const odd = player.replace('var build = function(t, f, H){', 'var build = function(t, f, H, extra){');
  t.is(findUrlBuilder(odd)?.name, 'build');
});

test('a player with no builder in it is declined, not guessed at', (t) => {
  t.is(findUrlBuilder('var a=1;function unrelated(x){return x+1}'), null);
  t.is(findUrlBuilder('this is not javascript at all ((('), null);
});

test('the signature is descrambled by the player itself', (t) => {
  const solver = loadSolver(player);
  t.truthy(solver);
  const url = solver?.buildUrl({url: 'https://example.com/videoplayback', signature: 'abcdef', signatureParam: 'sig'});
  t.truthy(url);
  t.is(new URL(url as string).searchParams.get('sig'), 'fedcba');
});

/*
 * The n parameter is not decoration.
 *
 * Left untransformed it throttles a download to tens of kilobytes a second,
 * which reads as a slow connection rather than as a missing step.
 */
test('the n parameter is transformed as it is set', (t) => {
  const solver = loadSolver(player);
  const url = solver?.buildUrl({url: 'https://example.com/videoplayback', n: 'quiet'});
  t.is(new URL(url as string).searchParams.get('n'), 'QUIET');
});

test('a cipher resolves to a URL carrying both transforms', (t) => {
  const solver = loadSolver(player);
  const cipher = parseCipher(`s=abcdef&sp=sig&url=${encodeURIComponent('https://example.com/play?itag=140&n=quiet')}`);
  const params = new URL(resolveCipher(cipher!, solver) as string).searchParams;
  t.is(params.get('sig'), 'fedcba');
  t.is(params.get('n'), 'QUIET');
  t.is(params.get('itag'), '140', 'the original parameters must survive');
});

test('with no solver, resolving refuses rather than returning the raw URL', (t) => {
  t.is(resolveCipher(parseCipher('s=X&sp=sig&url=https%3A%2F%2Fexample.com%2F')!, null), null);
});

test('throttling is undone on a URL that needed no signature', (t) => {
  const solver = loadSolver(player);
  t.is(
    new URL(resolveThrottle('https://example.com/videoplayback?itag=140&n=quiet', solver)).searchParams.get('n'),
    'QUIET',
  );
});

test('a URL with no n is left exactly as it was', (t) => {
  const url = 'https://example.com/videoplayback?itag=140';
  t.is(resolveThrottle(url, loadSolver(player)), url);
});

/*
 * A slow download beats no download.
 *
 * If the player cannot be driven the URL is still usable, just throttled, so
 * this hands back the original rather than failing the whole download.
 */
test('without a solver the URL is returned unchanged rather than dropped', (t) => {
  const url = 'https://example.com/videoplayback?itag=140&n=quiet';
  t.is(resolveThrottle(url, null), url);
});

test('a player that cannot be loaded yields no solver', (t) => {
  t.is(loadSolver('var a=1;'), null);
});

test('player code cannot reach the process it runs in', (t) => {
  // Two megabytes of code fetched from the internet does not get require or fs.
  const probe = player.replace(
    '  g.build = build;',
    '  g.leak = typeof process + "/" + typeof require;\n  globalThis.__leak = g.leak;\n  g.build = build;',
  );
  const solver = loadSolver(probe);
  t.truthy(solver, 'the probe player must still load');
  t.is((globalThis as Record<string, unknown>).__leak, undefined, 'nothing may escape into this process');
});

/*
 * A URL that will not parse must cost one throttled download, not an
 * exception. These arrive from YouTube, not from us, so their shape is not
 * something this code gets to assume.
 */
test('a malformed URL does not throw out of the throttle path', (t) => {
  const solver = loadSolver(player);
  t.notThrows(() => resolveThrottle('not-a-url-at-all', solver));
  t.is(resolveThrottle('not-a-url-at-all', solver), 'not-a-url-at-all');
});

test('a malformed URL inside a cipher does not throw either', (t) => {
  const solver = loadSolver(player);
  t.notThrows(() => resolveCipher({url: ':::broken:::', s: 'abc', sp: 'sig'}, solver));
});
