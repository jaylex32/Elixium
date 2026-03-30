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

  const initDeezerForDownload = async () => {
    if (getIsDeezerDownloadReady()) return;

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

  const initQobuzForSearch = async () => {
    if (getIsQobuzInitialized()) return;

    logUpdate(signale.pending('Loading Qobuz API for search...'));
    let secrets: string[] = [];
    const configuredSecrets = conf.get('qobuz.secrets') as string;
    if (configuredSecrets) {
      secrets = configuredSecrets.split(',');
    }
    let appId = conf.get('qobuz.app_id') as number;
    if (!appId || secrets.length < 1) {
      const spoofer = new qobuz.QobuzSpoofer();
      await spoofer.init();
      appId = spoofer.get_app_id() as number;
      secrets = spoofer.get_secrets();
      conf.set('qobuz.app_id', appId);
      conf.set('qobuz.secrets', secrets.join(','));
    }

    const authToken = (conf.get('qobuz.token') as string) || '';
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
    initQobuzForSearch,
    initQobuzForDownload,
  };
};
