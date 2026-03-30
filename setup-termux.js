/* eslint-disable */
const {existsSync, writeFileSync} = require('fs');
const {spawnSync} = require('child_process');

const {HOME, PATH} = process.env;
const CONFIG_FILE = 'elixium.config.json';

if (HOME && PATH.includes('com.termux') && !existsSync(CONFIG_FILE)) {
  console.log('Setting config file for termux users in ' + CONFIG_FILE);
  const STORAGE_LOCATION = `${HOME}/storage`;
  const DOWNLOAD_LOCATION = `${STORAGE_LOCATION}/downloads`;

  if (!existsSync(STORAGE_LOCATION)) {
    console.log(
      `It is necessary to grant storage permission for Termux on Android 6 and higher. Use 'Settings>Apps>Termux>Permissions>Storage' and set to true.`,
    );
    spawnSync('termux-setup-storage');
  }

  if (existsSync(DOWNLOAD_LOCATION)) {
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          saveLayout: {
            track: `${DOWNLOAD_LOCATION}/Music/{ALB_TITLE}/{SNG_TITLE}`,
            album: `${DOWNLOAD_LOCATION}/Music/{ALB_TITLE}/{SNG_TITLE}`,
            artist: `${DOWNLOAD_LOCATION}/Music/{ALB_TITLE}/{SNG_TITLE}`,
            playlist: `${DOWNLOAD_LOCATION}/Playlist/{TITLE}/{SNG_TITLE}`,
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
    console.log('Done. Config created.');
  } else {
    console.error('Something went wrong. Cannot find downloads location: ' + DOWNLOAD_LOCATION);
  }
}
