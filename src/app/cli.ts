import {Command} from 'commander';
import pc from 'picocolors';
import {APP_BRAND, APP_COMMAND, DEFAULT_CONFIG_FILE, REPOSITORY_PLACEHOLDER} from './brand';
import {formatBanner, formatCliError, terminalExamples, terminalNotes} from './terminal';

export const ensureLegacyNodeOptions = () => {
  const current = process.env.NODE_OPTIONS || '';
  if (!current.includes('--openssl-legacy-provider')) {
    process.env.NODE_OPTIONS = `${current} --openssl-legacy-provider`.trim();
  }
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
