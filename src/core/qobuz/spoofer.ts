import axios, {AxiosInstance} from 'axios';

/**
 * How long either bundle request may take before it is abandoned.
 *
 * Both requests used the bare `axios` default export, which carries no
 * timeout at all, and the second one downloads Qobuz's web player bundle —
 * around 9 MB. A stalled connection therefore never returned, and because
 * engine startup awaited this, the desktop app could not open. The bound is
 * per-request; the caller applies its own bound over the whole attempt.
 */
export const QOBUZ_BUNDLE_TIMEOUT_MS = 15_000;

export class QobuzSpoofer {
  seed_timezone_regex = /[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g;
  info_extracts_regex = 'name:"\\w+/({timezones})",info:"([\\w=]+)",extras:"([\\w=]+)"';
  /**
   * Where the app id lives, newest layout first.
   *
   * Qobuz restructured their bundle: the old `{app_id:"...",app_secret:"...",
   * base_port:"80"...}` object is gone entirely, and the credentials now sit in
   * a per-environment map — integration, nightly, recette, beta, production.
   * Reading the wrong environment is not harmless, so production is matched
   * explicitly before anything more general.
   *
   * The old pattern is kept as a fallback: an app id that still works is worth
   * more than tidiness, and Qobuz has changed this shape before.
   */
  productionApi_regex = /production:\{api:\{appId:"(\d+)",appSecret:"([0-9a-f]{32})"\}/;
  legacyAppId_regex =
    /{app_id:"(\d{9})",app_secret:"\w{32}",base_port:"80",base_url:"https:\/\/www\.qobuz\.com",base_method:"\/api\.json\/0\.2\/"}/;
  anyApi_regex = /appId:"(\d{9})",appSecret:"([0-9a-f]{32})"/;

  bundle = '';
  app_id: number | null = null;
  /** The secret Qobuz publishes beside the app id, when the bundle carries one. */
  app_secret: string | null = null;

  /** Injectable so the startup tests never depend on Qobuz being reachable. */
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        timeout: QOBUZ_BUNDLE_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0',
        },
      });
  }

  async init() {
    if (this.bundle.length > 0) return;
    const {data} = await this.http.get<string>('https://play.qobuz.com/login');
    const bundle_url = data.match(/<script src="(\/resources\/\d+\.\d+\.\d+-[a-z]\d{3}\/bundle\.js)"><\/script>/);
    if (!bundle_url) {
      throw new Error('Failed to fetch Qobuz API data');
    }
    const bundle_data = await this.http.get<string>('https://play.qobuz.com' + bundle_url[1]);
    this.bundle = bundle_data.data;
  }

  get_app_id() {
    if (this.app_id !== null) return this.app_id;

    const production = this.bundle.match(this.productionApi_regex);
    if (production) {
      this.app_id = +production[1];
      this.app_secret = production[2];
      return this.app_id;
    }

    const legacy = this.bundle.match(this.legacyAppId_regex);
    if (legacy) {
      this.app_id = +legacy[1];
      return this.app_id;
    }

    /*
     * Last resort: any app id/secret pair in the bundle. Less precise than
     * naming the environment, but a working Qobuz beats a correct refusal —
     * and every pair present is one Qobuz's own player uses.
     */
    const any = this.bundle.match(this.anyApi_regex);
    if (any) {
      this.app_id = +any[1];
      this.app_secret = any[2];
    }

    return this.app_id;
  }

  get_secrets() {
    /*
     * Qobuz now publishes the app secret in the bundle beside the app id, so
     * the seed/timezone reconstruction below is no longer the only source. The
     * published one goes first: it is the secret Qobuz's own player signs with,
     * and trying it first means one request instead of several when it works.
     */
    const published: string[] = [];
    if (this.app_id === null) this.get_app_id();
    if (this.app_secret) published.push(this.app_secret);

    const secrets: string[][] = [];

    let match_tmp;
    while ((match_tmp = this.seed_timezone_regex.exec(this.bundle)) !== null) {
      const [seed, timezone] = [match_tmp[1], match_tmp[2]];
      secrets.push([timezone, seed]);
    }

    /*
     * Shift the first and second timezone. Qobuz's own ordering, don't ask.
     *
     * Guarded, because the swap on a shorter list writes `undefined` into
     * slots 0 and 1 and grows the array to length two — which the `.map` below
     * then dereferences, turning "this bundle has no seed data" into a
     * TypeError. Qobuz now publishes the secret directly, so a bundle with no
     * seeds at all is a live possibility rather than a hypothetical.
     */
    if (secrets.length > 1) {
      [secrets[0], secrets[1]] = [secrets[1], secrets[0]];
    }

    /*
     * An empty alternation would build `name:"\w+/()"`, which matches things it
     * should not. With no seeds there is nothing to reconstruct, so stop here
     * and return whatever the bundle published outright.
     */
    if (secrets.length === 0) return [...published];

    const re = new RegExp(
      this.info_extracts_regex.replace(
        '{timezones}',
        secrets.map((t) => t[0].replace(/^\w/, (c) => c.toUpperCase())).join('|'),
      ),
      'g',
    );

    while ((match_tmp = re.exec(this.bundle)) !== null) {
      const [timezone, info, extras] = [match_tmp[1], match_tmp[2], match_tmp[3]];
      for (const s of secrets) {
        if (s[0] === timezone.toLowerCase()) {
          s.push(info);
          s.push(extras);
        }
      }
    }

    const final_secrets = [...published];

    for (let i = 0; i < secrets.length; i++) {
      if (secrets[i].length === 4) {
        // base64 decode
        const dec = Buffer.from(secrets[i][1] + secrets[i][2] + secrets[i][3], 'base64').toString('utf-8');
        if (!final_secrets.includes(dec)) final_secrets.push(dec);
      }
    }

    return final_secrets;
  }
}
