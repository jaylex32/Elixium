import logUpdate from 'log-update';
import signale from '../lib/signale';
import Config from '../lib/config';

type RuntimeOptions = {
  web?: boolean;
};

interface ServiceRuntimeDependencies {
  options: RuntimeOptions;
  conf: Config;
  deezer: any;
  qobuz: any;
  appCommand: string;
  getIsDeezerInitialized: () => boolean;
  setIsDeezerInitialized: (value: boolean) => void;
  getIsQobuzInitialized: () => boolean;
  setIsQobuzInitialized: (value: boolean) => void;
  getIsDeezerDownloadReady: () => boolean;
  setIsDeezerDownloadReady: (value: boolean) => void;
  getIsQobuzDownloadReady: () => boolean;
  setIsQobuzDownloadReady: (value: boolean) => void;
}

export const createServiceRuntime = ({
  options,
  conf,
  deezer,
  qobuz,
  appCommand,
  getIsDeezerInitialized,
  setIsDeezerInitialized,
  getIsQobuzInitialized,
  setIsQobuzInitialized,
  getIsDeezerDownloadReady,
  setIsDeezerDownloadReady,
  getIsQobuzDownloadReady,
  setIsQobuzDownloadReady,
}: ServiceRuntimeDependencies) => {
  const initDeezerForSearch = async () => {
    setIsDeezerInitialized(true);
    console.log(signale.success('Deezer search ready (no authentication needed for browsing)'));
  };

  /*
   * One session setup at a time.
   *
   * Pressing play fires two requests at once — the player probes the stream
   * and then loads it — and both used to start their own login against the
   * same shared HTTP client. Two in flight can leave the client holding a
   * half-built session, which fails exactly like an unlicensed account and
   * ends as a 30-second preview.
   */
  let deezerLogin: Promise<void> | null = null;

  const loginToDeezer = async () => {
    logUpdate(signale.pending('Initializing Deezer for downloads...'));
    const arl = conf.get('cookies.arl') as string;

    if (!arl) {
      throw new Error(
        `Deezer ARL cookie required for downloads. Please set it using: ${appCommand} --set-arl "your_arl_here"`,
      );
    }

    logUpdate(signale.pending('Verifying Deezer session...'));
    try {
      await deezer.initDeezerApi(arl);
      const {BLOG_NAME} = await deezer.getUser();
      logUpdate(signale.success('Logged in to Deezer as ' + BLOG_NAME));
      logUpdate.done();

      setIsDeezerDownloadReady(true);
    } catch (error: any) {
      logUpdate.clear();
      console.log(signale.error('Deezer authentication failed: ' + error.message));
      console.log(signale.note('Your ARL cookie may have expired. Please get a fresh one from deezer.com'));
      throw error;
    }
  };

  const initDeezerForDownload = async () => {
    if (getIsDeezerDownloadReady()) return;
    if (!deezerLogin) {
      deezerLogin = loginToDeezer().finally(() => {
        deezerLogin = null;
      });
    }
    return deezerLogin;
  };

  /**
   * Establish the session again, whether or not it is believed to be ready.
   *
   * The ready flag is sticky by design — it exists so every request does not
   * re-login — but that also means a session which went stale is never
   * rebuilt, and playback silently degrades until the app is restarted. This
   * is the way back without a restart.
   */
  const refreshDeezerSession = async () => {
    setIsDeezerDownloadReady(false);
    return initDeezerForDownload();
  };

  /** A positive integer app id, or null if the value is unusable. */
  const usableAppId = (value: unknown): number | null => {
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  /**
   * Read Qobuz's app id and signing secrets out of their web player bundle.
   *
   * Throws rather than returning nulls. Writing a null app id into the config
   * and handing it on is what produced `Cannot read properties of null
   * (reading 'toString')` — an internal-looking crash for what is really
   * "Qobuz changed their site and this needs updating".
   */
  const scrapeQobuzCredentials = async (): Promise<{appId: number; secrets: string[]}> => {
    const spoofer = new qobuz.QobuzSpoofer();
    await spoofer.init();

    const appId = usableAppId(spoofer.get_app_id());
    if (appId === null) {
      throw new Error(
        'Could not read the Qobuz app id from their web player — Qobuz has changed their site and Elixium needs an update',
      );
    }

    return {appId, secrets: spoofer.get_secrets()};
  };

  /**
   * The app id to use, preferring one already stored.
   *
   * Signing in needs this before it has a token, because Qobuz ties the token
   * it issues to the id the login was made with. Reusing a stored id keeps an
   * existing token and a newly issued one interchangeable.
   */
  const ensureQobuzAppId = async (): Promise<number> => {
    const cached = usableAppId(conf.get('qobuz.app_id'));
    if (cached !== null) return cached;

    const scraped = await scrapeQobuzCredentials();
    conf.set('qobuz.app_id', scraped.appId);
    if (scraped.secrets.length > 0 && !((conf.get('qobuz.secrets') as string) || '')) {
      conf.set('qobuz.secrets', scraped.secrets.join(','));
    }
    return scraped.appId;
  };

  const initQobuzForSearch = async () => {
    if (getIsQobuzInitialized()) return;

    logUpdate(signale.pending('Loading Qobuz API for search...'));

    let appId = usableAppId(conf.get('qobuz.app_id'));
    const configuredSecrets = (conf.get('qobuz.secrets') as string) || '';
    let secrets = configuredSecrets.split(',').filter(Boolean);

    if (appId === null || secrets.length < 1) {
      const scraped = await scrapeQobuzCredentials();

      /*
       * A working app id is never replaced.
       *
       * Qobuz issues a user's auth token against the app id used to log in,
       * and that token is rejected by every other app id. Re-scraping because
       * the *secrets* were missing and overwriting the id along with them
       * would sign the user out with no explanation and no way back except
       * re-entering their password.
       */
      if (appId === null) {
        appId = scraped.appId;
        conf.set('qobuz.app_id', appId);
      }
      if (secrets.length < 1 && scraped.secrets.length > 0) {
        secrets = scraped.secrets;
        conf.set('qobuz.secrets', secrets.join(','));
      }
    }

    /*
     * Qobuz requires an account for everything now — not only downloads.
     * Browsing endpoints (catalog/search, genre/list, album/getFeatured) all
     * answer 401 without a user token, so there is nothing to be gained by
     * initialising and every request failing one at a time. Say so once,
     * quickly, instead of spending a network round trip per secret first.
     */
    const authToken = (conf.get('qobuz.token') as string) || '';
    if (!authToken) {
      logUpdate.clear();
      throw new Error('Qobuz needs an account: add your Qobuz Token in Settings to browse or download');
    }

    await qobuz.initQobuzApi(authToken, appId, secrets);
    logUpdate(signale.success('Qobuz search ready'));
    logUpdate.done();

    setIsQobuzInitialized(true);
  };

  const initQobuzForDownload = async () => {
    if (getIsQobuzDownloadReady()) return;

    if (!getIsQobuzInitialized()) {
      await initQobuzForSearch();
    }

    logUpdate(signale.pending('Initializing Qobuz for downloads...'));

    const authToken = conf.get('qobuz.token') as string;
    const appId = conf.get('qobuz.app_id') as number;
    const secrets = (conf.get('qobuz.secrets') as string).split(',');

    if (!authToken) {
      if (options.web) {
        logUpdate(signale.warn('Qobuz token not set - downloads will require authentication'));
        logUpdate.done();
        return;
      }

      throw new Error(
        'Qobuz token required for downloads. Please configure your token in the web interface or config file',
      );
    }

    await qobuz.initQobuzApi(authToken, appId, secrets);
    logUpdate(signale.success('Qobuz downloads ready'));
    logUpdate.done();

    setIsQobuzDownloadReady(true);
  };

  return {
    initDeezerForSearch,
    initDeezerForDownload,
    refreshDeezerSession,
    initQobuzForSearch,
    initQobuzForDownload,
    ensureQobuzAppId,
  };
};
