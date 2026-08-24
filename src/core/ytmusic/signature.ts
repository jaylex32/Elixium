/**
 * Undoing YouTube's URL scrambling, by running YouTube's own player.
 *
 * A stream URL rarely arrives ready to use. It comes as a `signatureCipher` —
 * the real URL, a scrambled signature, and the parameter that signature belongs
 * in — and it usually also carries an `n` parameter, which throttles the
 * download to a crawl unless it is transformed too.
 *
 * Both transforms live in the player's JavaScript, and the obvious approach of
 * pattern-matching the transform out of it does not work any more. The player
 * builds its transforms at runtime out of nested helpers, hides every method
 * name behind a global string table, and is reminified weekly. Reading it
 * statically found nothing: an AST match over all 3,751 one-argument functions
 * in a real player turned up no transform at all, because there isn't one to
 * find in that shape.
 *
 * So this does what the browser does — it runs the player and asks it. The one
 * fixed point is a small function that builds a playback URL, recognisable
 * because it sets `alr=yes`. Handed a URL and a scrambled signature it returns a
 * URL object with the signature descrambled; setting `n` on that object
 * transforms `n` as well. Nothing about how either transform works needs to be
 * known here, which is what makes this survive the weekly reminification.
 *
 * The player's text is never rewritten. One statement is injected at the end of
 * its own wrapper scope to export the builder, and everything else is the file
 * exactly as served — there is no translation step that could corrupt it.
 *
 * Credit where due: locating the builder by its `alr=yes` call is the approach
 * yt-dlp's JS-challenge solver uses. They shell out to Deno, Bun, Node or
 * QuickJS to run it; Elixium is already Node, so it runs here directly.
 */
import vm from 'vm';
import * as acorn from 'acorn';
import type {AxiosInstance} from 'axios';

/** How long the player may take to load, and to answer, before giving up. */
const LOAD_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 5_000;

export interface Cipher {
  /** The real URL, still missing its signature. */
  url: string;
  /** The scrambled signature. */
  s: string;
  /** The query parameter the descrambled signature belongs in. */
  sp: string;
}

/**
 * Split a `signatureCipher` value into its parts.
 *
 * Returns null when the value is not a cipher, which is how a caller tells an
 * ordinary URL apart from one of these.
 */
export const parseCipher = (value: string): Cipher | null => {
  if (!value || !value.includes('s=') || !value.includes('url=')) return null;
  const params = new URLSearchParams(value);
  const url = params.get('url');
  const s = params.get('s');
  if (!url || !s) return null;
  return {url, s, sp: params.get('sp') || 'signature'};
};

/** Where the player's JavaScript lives, read from a watch page. */
export const playerUrlFrom = (watchPageHtml: string): string | null => {
  const match = /"(\/s\/player\/[^"]+\/base\.js)"/.exec(watchPageHtml);
  return match ? 'https://www.youtube.com' + match[1] : null;
};

/** A node in the player's syntax tree. Acorn's types are deliberately loose. */
type Node = acorn.Node & Record<string, any>;

const walk = (
  node: Node | null | undefined,
  visit: (node: Node, parent: Node | null) => void,
  parent: Node | null = null,
): void => {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child as Node, visit, node));
    else if (value && typeof (value as Node).type === 'string') walk(value as Node, visit, node);
  }
};

/**
 * The call that identifies the URL builder: `something.set("alr", "yes")`.
 *
 * Every playback URL the player constructs carries `alr=yes`, and it has for
 * years. Method names, variable names and file layout all change; this does
 * not, which is why it is the anchor rather than anything about the transform.
 */
const setsAlrYes = (node: Node): boolean =>
  node.type === 'ExpressionStatement' &&
  node.expression?.type === 'CallExpression' &&
  node.expression.callee?.type === 'MemberExpression' &&
  node.expression.arguments?.length === 2 &&
  node.expression.arguments[0]?.type === 'Literal' &&
  node.expression.arguments[0].value === 'alr' &&
  node.expression.arguments[1]?.type === 'Literal' &&
  node.expression.arguments[1].value === 'yes';

/** The name a function was assigned to, however it was written. */
const nameOf = (node: Node, parent: Node | null): string | null => {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') return parent.left.name;
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
  return null;
};

/**
 * Find the URL builder and the scope it lives in.
 *
 * Three parameters distinguishes the signature builder from the other function
 * that sets `alr=yes` — a redirector helper taking two.
 */
export const findUrlBuilder = (playerJs: string): {name: string; injectAt: number} | null => {
  let ast: Node;
  try {
    ast = acorn.parse(playerJs, {ecmaVersion: 'latest'}) as Node;
  } catch {
    return null;
  }

  const candidates: Array<{name: string; node: Node}> = [];
  walk(ast, (node, parent) => {
    if (node.type !== 'FunctionExpression' && node.type !== 'FunctionDeclaration') return;
    if (!Array.isArray(node.body?.body)) return;
    if (!node.body.body.some(setsAlrYes)) return;
    const name = nameOf(node, parent);
    if (name) candidates.push({name, node});
  });
  if (candidates.length === 0) return null;

  /*
   * Three arguments — url, parameter, signature — is what the signature builder
   * takes, and it distinguishes it from the redirector helper that also sets
   * alr=yes. Taking it as a preference rather than a requirement means a player
   * that changes the arity degrades to a guess instead of to nothing.
   */
  const builder = candidates.find((entry) => entry.node.params?.length === 3) ?? candidates[0];

  /*
   * The export goes at the end of the innermost function enclosing the builder.
   * The player is one big wrapper around everything, so a name declared inside
   * it is invisible from outside until something inside hands it out.
   */
  const found: {name: string; node: Node} = builder;
  let scope: Node | null = null;
  walk(ast, (node) => {
    if (node.type !== 'FunctionExpression' && node.type !== 'FunctionDeclaration') return;
    if (found.node.start <= node.start || found.node.end >= node.end) return;
    if (!scope || node.start > scope.start) scope = node;
  });

  const enclosing = scope as Node | null;
  return {name: found.name, injectAt: enclosing ? enclosing.body.end - 1 : playerJs.length};
};

/** Enough of a browser for the player to load in a bare engine. */
const SHIMS = [
  'if (typeof globalThis.XMLHttpRequest === "undefined") globalThis.XMLHttpRequest = {prototype:{}};',
  'globalThis.location = new URL("https://www.youtube.com/watch?v=elixium");',
  'if (typeof globalThis.document === "undefined") globalThis.document = Object.create(null);',
  'if (typeof globalThis.navigator === "undefined") globalThis.navigator = Object.create(null);',
  'if (typeof globalThis.self === "undefined") globalThis.self = globalThis;',
  'if (typeof globalThis.window === "undefined") globalThis.window = globalThis;',
].join('\n');

/** What a loaded player can do. */
export interface PlayerSolver {
  /**
   * Build a finished playback URL.
   *
   * Both transforms happen inside the player: the signature is descrambled as
   * the URL is built, and `n` is transformed as it is set.
   */
  buildUrl: (input: {url: string; signature?: string; signatureParam?: string; n?: string}) => string | null;
}

/**
 * Load a player and expose its URL builder.
 *
 * The player runs in a context holding only what it needs — no require, no
 * process, no filesystem, no network — and under a timeout. It is a couple of
 * megabytes of code fetched from the internet, and it is not getting the run of
 * this process.
 */
export const loadSolver = (playerJs: string): PlayerSolver | null => {
  const builder = findUrlBuilder(playerJs);
  if (!builder) return null;

  const patched =
    playerJs.slice(0, builder.injectAt) +
    `;try{globalThis.__elixiumBuild=${builder.name}}catch(e){};` +
    playerJs.slice(builder.injectAt);

  const context: Record<string, unknown> = {
    URL,
    URLSearchParams,
    Math,
    JSON,
    Date,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  context.globalThis = context;
  vm.createContext(context);

  try {
    new vm.Script(SHIMS + '\n' + patched).runInContext(context, {timeout: LOAD_TIMEOUT_MS});
  } catch {
    return null;
  }

  const build = context.__elixiumBuild;
  if (typeof build !== 'function') return null;

  /*
   * The builder returns an object with `set`, `get`, `clone` and one more
   * method — the one that renders it as a string. Its name is minified, so it
   * is found by elimination rather than by name.
   */
  const render = (urlObject: Record<string, unknown>): string | null => {
    const proto = Object.getPrototypeOf(urlObject) as object;
    const names = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));
    for (const name of names) {
      if (['constructor', 'set', 'get', 'clone'].includes(name)) continue;
      const method = (urlObject as Record<string, unknown>)[name];
      if (typeof method !== 'function') continue;
      try {
        const rendered = (method as () => unknown).call(urlObject);
        if (typeof rendered === 'string' && rendered.startsWith('http')) return rendered;
      } catch {
        /* Not the renderer; try the next. */
      }
    }
    return null;
  };

  return {
    buildUrl: ({url, signature, signatureParam, n}) => {
      try {
        const script = new vm.Script('__elixiumBuild(__u, __p, __s)');
        context.__u = url;
        context.__p = signatureParam || 's';
        context.__s = signature ? encodeURIComponent(signature) : undefined;
        const built = script.runInContext(context, {timeout: CALL_TIMEOUT_MS}) as Record<string, unknown>;
        if (!built) return null;
        if (n) (built.set as (k: string, v: string) => void).call(built, 'n', n);
        return render(built);
      } catch {
        return null;
      }
    },
  };
};

/**
 * Read one query parameter, tolerating a URL that will not parse.
 *
 * These come from YouTube rather than from us, and a URL that trips the parser
 * should cost one throttled download at worst — not an exception out of a
 * function whose caller is only asking whether there is an `n` to transform.
 */
const parameterOf = (url: string, name: string): string | undefined => {
  try {
    return new URL(url).searchParams.get(name) || undefined;
  } catch {
    return undefined;
  }
};

/** Cached solver, so a queue of downloads loads the player once. */
let cached: {url: string; solver: PlayerSolver | null} | null = null;

/** Forget the cached player, for tests and for a forced refresh. */
export const clearPlayerCache = (): void => {
  cached = null;
};

/**
 * Fetch the player named by a watch page and load its solver.
 *
 * The player is a couple of megabytes and changes perhaps weekly, so this is
 * done once per player version. A null solver is cached too: a player this
 * cannot drive will not become drivable by asking again.
 */
export const solverFor = async (http: AxiosInstance, watchPageHtml: string): Promise<PlayerSolver | null> => {
  const url = playerUrlFrom(watchPageHtml);
  if (!url) return null;
  if (cached && cached.url === url) return cached.solver;

  const response = await http.get(url, {
    timeout: LOAD_TIMEOUT_MS,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  const source = typeof response.data === 'string' ? response.data : '';
  const solver = source ? loadSolver(source) : null;
  cached = {url, solver};
  return solver;
};

/**
 * Turn a cipher into a usable URL.
 *
 * Returns null when it could not be descrambled, so the caller can say so
 * rather than requesting a URL that is certain to be refused.
 */
export const resolveCipher = (cipher: Cipher, solver: PlayerSolver | null): string | null => {
  if (!solver) return null;
  return solver.buildUrl({
    url: cipher.url,
    signature: cipher.s,
    signatureParam: cipher.sp,
    n: parameterOf(cipher.url, 'n'),
  });
};

/**
 * Transform the `n` parameter on a URL that needed no signature.
 *
 * Worth doing even when the URL is otherwise ready: an untransformed `n` is
 * what throttles a download to tens of kilobytes a second. If it cannot be
 * transformed the original URL is returned, since a slow download beats none.
 */
export const resolveThrottle = (url: string, solver: PlayerSolver | null): string => {
  if (!solver) return url;
  const n = parameterOf(url, 'n');
  if (!n) return url;
  return solver.buildUrl({url, n}) || url;
};
