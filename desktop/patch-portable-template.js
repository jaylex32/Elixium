'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- build script, CommonJS. */

/**
 * Make the portable build unpack once instead of on every launch.
 *
 * The portable .exe is a self-extracting archive: electron-builder's template
 * wipes a temporary folder, writes the entire 286 MB application into it, runs
 * it, and deletes it again on exit. That is the whole of why the portable took
 * around 50 seconds to open — measured — while the installed copy takes about
 * two. Shrinking the payload got it to roughly 16; the remaining cost is the
 * unpacking itself, and no payload that has to carry Electron's 180 MB binary
 * will ever unpack in two seconds.
 *
 * So it is made to keep what it unpacked. The application lands in a folder
 * beside the .exe, and a later launch that finds a finished copy of the same
 * version runs it directly. First launch pays the same cost as before; every
 * launch after it is as fast as the installed build.
 *
 * Beside the .exe rather than in %TEMP% because that is what a portable app
 * should do: the folder is visible, the user can delete it, and it travels
 * with the .exe onto a memory stick. Deleting it costs one slow launch and
 * nothing else — it is rebuilt on the spot.
 *
 * This has to be done by rewriting electron-builder's own template, because
 * the portable target accepts no custom script and no custom include: it reads
 * templates/nsis/portable.nsi directly, and computeFinalScript returns early
 * for portable before any include hook runs. That makes this a patch against
 * another package's internals, so it refuses to guess: it matches the exact
 * lines it expects and fails the build loudly if they are not there, rather
 * than half-applying itself to a template that has changed underneath it.
 */

const fs = require('fs');
const path = require('path');

/** Folder the application is unpacked into, beside the .exe. */
const DIR_NAME = 'Elixium-app';

/**
 * Identifies the unpacked copy, so a new version replaces an old one.
 *
 * The version is written into a marker file after unpacking finishes, and read
 * back on the next launch. Written last on purpose: an unpacking that was
 * interrupted leaves no marker, so it is redone rather than trusted.
 */
const BUILD_ID = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

const SENTINEL = '; --- Elixium: unpack once, beside the .exe ---';

const templatePath = path.join(__dirname, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'portable.nsi');

const fail = (reason) => {
  console.error('\nThe portable fast-start patch could not be applied.\n');
  console.error('  ' + reason + '\n');
  console.error("electron-builder's portable template is not what this patch expects,");
  console.error('which usually means electron-builder was upgraded. Review');
  console.error('desktop/patch-portable-template.js against the new template before');
  console.error('releasing — an unreviewed portable build may not start at all.\n');
  process.exit(1);
};

if (!fs.existsSync(templatePath)) fail('templates/nsis/portable.nsi is missing at ' + templatePath);

const original = fs.readFileSync(templatePath, 'utf8');

if (original.includes(SENTINEL)) {
  /*
   * Already patched: node_modules survives between local builds.
   *
   * The version still has to be refreshed. It is written into the template as
   * a literal, and it is what tells an unpacked copy apart from the one a
   * previous version left behind — so a template patched before a version bump
   * would stamp the old version, and a portable built from it would reuse the
   * previous release's files instead of its own.
   */
  const stamped = original.match(/StrCmp \$R6 "([^"]*)" elixium_ready/);
  if (!stamped) fail('the patched template has no version marker to refresh');

  if (stamped[1] === BUILD_ID) {
    console.log(`portable template: already patched (unpacks to ./${DIR_NAME}, build ${BUILD_ID})`);
    process.exit(0);
  }

  const refreshed = original
    .replace(`StrCmp $R6 "${stamped[1]}" elixium_ready`, `StrCmp $R6 "${BUILD_ID}" elixium_ready`)
    .replace(`FileWrite $R5 "${stamped[1]}"`, `FileWrite $R5 "${BUILD_ID}"`);

  if (refreshed.includes(`"${stamped[1]}"`)) fail(`could not replace every ${stamped[1]} marker`);

  fs.writeFileSync(templatePath, refreshed, 'utf8');
  console.log(`portable template: version refreshed ${stamped[1]} -> ${BUILD_ID}`);
  process.exit(0);
}

const lines = original.split('\n');
const findOne = (predicate, what) => {
  const matches = lines.map((line, i) => [line, i]).filter(([line]) => predicate(line));
  if (matches.length !== 1) fail(`expected exactly one ${what}, found ${matches.length}`);
  return matches[0][1];
};

/* The header that chooses a folder and empties it. */
const startIndex = findOne((l) => l.trim() === 'StrCpy $INSTDIR "$PLUGINSDIR\\app"', 'temporary-folder line');
const setOutIndex = findOne((l) => l.trim() === 'SetOutPath $INSTDIR', 'SetOutPath $INSTDIR line');
if (setOutIndex < startIndex) fail('SetOutPath $INSTDIR appears before the folder is chosen');

const wipeBefore = lines.slice(startIndex, setOutIndex).filter((l) => l.trim() === 'RMDir /r $INSTDIR');
if (wipeBefore.length !== 1) fail('expected one RMDir before unpacking, found ' + wipeBefore.length);

/* The line that runs the application, and the cleanup that follows it. */
const execIndex = findOne((l) => l.trim().startsWith('ExecWait "$INSTDIR\\'), 'ExecWait line');
const cleanupCandidates = lines
  .map((line, i) => [line, i])
  .filter(([line, i]) => i > execIndex && line.trim() === 'RMDir /r $INSTDIR');
if (cleanupCandidates.length !== 1) fail('expected one RMDir after the app exits, found ' + cleanupCandidates.length);
const cleanupIndex = cleanupCandidates[0][1];

/* Where unpacking has finished and the environment is set up. */
const envIndex = findOne((l) => l.includes('PORTABLE_EXECUTABLE_DIR'), 'PORTABLE_EXECUTABLE_DIR line');
if (envIndex < setOutIndex || envIndex > execIndex) fail('the environment block is not where it was expected');

const header = `${SENTINEL}
  ;
  ; Unpack beside the .exe and reuse it, instead of unpacking every launch.
  ; Applied by desktop/patch-portable-template.js — see that file for why.
  StrCpy $INSTDIR "$EXEDIR\\${DIR_NAME}"

  ; Beside the .exe is the intent, but it is not always writable: a
  ; write-protected stick, a network share, a folder belonging to someone
  ; else. Probe it, and fall back to %TEMP% rather than failing to start.
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $R5 "$INSTDIR\\.elixium-write-test" w
  IfErrors elixium_fallback_temp
  FileClose $R5
  Delete "$INSTDIR\\.elixium-write-test"
  Goto elixium_have_dir

elixium_fallback_temp:
  ClearErrors
  StrCpy $INSTDIR "$TEMP\\${DIR_NAME}"
  CreateDirectory "$INSTDIR"

elixium_have_dir:
  ; A finished copy of this exact version is used as it stands.
  IfFileExists "$INSTDIR\\.elixium-ready" 0 elixium_unpack
  ClearErrors
  FileOpen $R5 "$INSTDIR\\.elixium-ready" r
  IfErrors elixium_unpack
  FileRead $R5 $R6
  FileClose $R5
  StrCmp $R6 "${BUILD_ID}" elixium_ready

elixium_unpack:
  ClearErrors
  ; Overwrite in place rather than deleting first. Nothing is destroyed next
  ; to the user's own files, and "try" means a file held open by a copy that
  ; is already running is stepped over instead of aborting the launch.
  SetOverwrite try
  SetOutPath $INSTDIR`;

const finished = `
  ; Unpacked. The marker is written last, so an interrupted unpack is redone.
  Delete "$INSTDIR\\.elixium-ready"
  FileOpen $R5 "$INSTDIR\\.elixium-ready" w
  FileWrite $R5 "${BUILD_ID}"
  FileClose $R5

elixium_ready:
  SetOutPath $INSTDIR
`;

const patched = [
  ...lines.slice(0, startIndex),
  header,
  ...lines.slice(setOutIndex + 1, envIndex),
  finished,
  ...lines.slice(envIndex, cleanupIndex),
  '  ; The unpacked copy is deliberately kept; that is what makes the next',
  '  ; launch fast. Deleting the folder simply costs one slow launch.',
  ...lines.slice(cleanupIndex + 1),
].join('\n');

fs.writeFileSync(templatePath, patched, 'utf8');
console.log(`portable template: patched (unpacks once to ./${DIR_NAME}, build ${BUILD_ID})`);
