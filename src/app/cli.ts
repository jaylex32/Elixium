import {Command} from 'commander';
import {createDecipheriv} from 'crypto';
import {spawnSync} from 'child_process';
import pc from 'picocolors';
import {APP_BRAND, APP_COMMAND, DEFAULT_CONFIG_FILE, REPOSITORY_PLACEHOLDER} from './brand';
import {formatBanner, formatCliError, terminalExamples, terminalNotes} from './terminal';

/** Set on the child so a failed relaunch cannot loop forever. */
const RELAUNCH_SENTINEL = 'ELIXIUM_OPENSSL_RELAUNCHED';

/** Whether this Node build can still do Blowfish, which Deezer streams need. */
const canDecryptDeezer = (): boolean => {
  try {
    createDecipheriv('bf-cbc', Buffer.alloc(16), Buffer.alloc(8));
    return true;
  } catch {
    return false;
  }
};

/**
 * Make sure Blowfish is available, relaunching once if it is not.
 *
 * Deezer streams are Blowfish-CBC encrypted, and OpenSSL 3 (Node 17+) moved
 * that cipher into the legacy provider, so `bf-cbc` throws
 * ERR_OSSL_EVP_UNSUPPORTED unless Node starts with --openssl-legacy-provider.
 *
 * This previously assigned to process.env.NODE_OPTIONS, which cannot work:
 * Node parses that variable once at startup, so setting it from inside the
 * running process has no effect. Every Deezer download therefore failed on any
 * modern Node with a cryptic OpenSSL error, while Qobuz — which is not
 * encrypted — kept working and masked the problem.
 *
 * Re-exec is used rather than a pure-JS Blowfish because it keeps one code
 * path and the native cipher; the sentinel stops a relaunch loop if the flag
 * still does not help.
 */
export const ensureLegacyNodeOptions = () => {
  if (canDecryptDeezer() || process.env[RELAUNCH_SENTINEL]) return;

  /*
   * Never re-exec from inside a packaged binary.
   *
   * Under pkg, process.execPath is the Elixium executable rather than node, so
   * the relaunch would run the app again with an argument it does not
   * understand instead of enabling the cipher. Today's target is node16, whose
   * OpenSSL 1.x still has Blowfish, so this branch is unreachable there — but
   * it would become a silent boot loop the moment that target moves to node18.
   */
  if ((process as any).pkg) {
    console.warn(
      'Blowfish is unavailable in this build, so Deezer downloads will fail. ' +
        'Qobuz is unaffected. Please report this — the packaged Node version needs the legacy OpenSSL provider.',
    );
    return;
  }

  const result = spawnSync(
    process.execPath,
    ['--openssl-legacy-provider', ...process.execArgv, ...process.argv.slice(1)],
    {stdio: 'inherit', env: {...process.env, [RELAUNCH_SENTINEL]: '1'}},
  );

  // If the relaunch could not start, carry on: Qobuz still works, and the
  // Deezer path reports a clear error rather than dying here.
  if (result.error) {
    console.warn(
      'Blowfish is unavailable and Elixium could not relaunch with --openssl-legacy-provider. ' +
        'Deezer downloads will fail; start Node with that flag manually.',
    );
    return;
  }

  process.exit(result.status ?? 0);
};

export const printBanner = (version: string) => console.log(formatBanner(version));

export const buildCommand = () => {
  const cmd = new Command()
    .name(APP_COMMAND)
    .description(`${APP_BRAND} streaming music downloader and browser control plane`)
    .option(
      '-q, --quality <quality>',
      'The quality of the files to download: 128/320/flac for Deezer, 320kbps/44khz/96khz/192khz for Qobuz',
    )
    .option('-o, --output <template>', 'Output filename template')
    .option('-u, --url <url>', 'Deezer/Qobuz album/artist/playlist/track url')
    .option('-i, --input-file <file>', 'Downloads all urls listed in text file')
    .option('-c, --concurrency <number>', 'Download concurrency for album, artists and playlist')
    .option('-a, --set-arl <string>', 'Set arl cookie')
    .option('-d, --headless', 'Run in headless mode for scripting automation', false)
    .option('-conf, --config-file <file>', 'Custom location to your config file', DEFAULT_CONFIG_FILE)
    .option('-rfp, --resolve-full-path', 'Use absolute path for playlists')
    .option('-cp, --create-playlist', 'Force create a playlist file for non playlists')
    .option('-b, --qobuz', 'Experimental Qobuz support')
    .option('-w, --web', 'Start web interface', false)
    .option('-p, --port <port>', 'Web interface port', '3000');

  cmd.showHelpAfterError('(run with --help for usage and examples)');
  cmd.configureOutput({
    outputError: (str, write) => write(formatCliError(str)),
  });
  cmd.configureHelp({
    sortOptions: true,
    optionTerm: (option) => pc.cyan(option.flags),
    subcommandTerm: (subcommand) => pc.cyan(subcommand.name()),
  });
  cmd.usage('[options]');
  const defaultHelpInformation = cmd.helpInformation.bind(cmd);
  (cmd as Command & {helpInformation: () => string}).helpInformation = () =>
    `${defaultHelpInformation()}\n${pc.dim(
      `Control routes through ${DEFAULT_CONFIG_FILE}. ${REPOSITORY_PLACEHOLDER}.`,
    )}\n\n${terminalExamples()}\n\n${terminalNotes()}\n`;

  if ((process as any).pkg) {
    cmd.option('-U, --update', 'Check update status for this build');
  }

  return cmd;
};
