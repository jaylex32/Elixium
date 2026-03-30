import axios from 'axios';

export class QobuzSpoofer {
  seed_timezone_regex = /[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g;
  info_extracts_regex = 'name:"\\w+/({timezones})",info:"([\\w=]+)",extras:"([\\w=]+)"';
  appId_regex =
    /{app_id:"(\d{9})",app_secret:"\w{32}",base_port:"80",base_url:"https:\/\/www\.qobuz\.com",base_method:"\/api\.json\/0\.2\/"},n\.base_url="https:\/\/play\.qobuz\.com"/;
  bundle = '';
  app_id: number | null = null;

  async init() {
    if (this.bundle.length > 0) return;
    const {data} = await axios.get<string>('https://play.qobuz.com/login');
    const bundle_url = data.match(/<script src="(\/resources\/\d+\.\d+\.\d+-[a-z]\d{3}\/bundle\.js)"><\/script>/);
    if (!bundle_url) {
      throw new Error('Failed to fetch Qobuz API data');
    }
    const bundle_data = await axios.get<string>('https://play.qobuz.com' + bundle_url[1]);
    this.bundle = bundle_data.data;
  }

  get_app_id() {
    if (this.app_id === null) {
      const res = this.bundle.match(this.appId_regex);
      if (res) {
        this.app_id = +res[1];
      }
    }
    return this.app_id;
  }

  get_secrets() {
    const secrets: string[][] = [];

    let match_tmp;
    while ((match_tmp = this.seed_timezone_regex.exec(this.bundle)) !== null) {
      const [seed, timezone] = [match_tmp[1], match_tmp[2]];
      secrets.push([timezone, seed]);
    }

    // Shift first and second timezone
    // Qobuz shit, don't ask. Or maybe ask qobuz_dl?
    [secrets[0], secrets[1]] = [secrets[1], secrets[0]];

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

    const final_secrets = [];

    for (let i = 0; i < secrets.length; i++) {
      if (secrets[i].length === 4) {
        // base64 decode
        const dec = Buffer.from(secrets[i][1] + secrets[i][2] + secrets[i][3], 'base64').toString('utf-8');
        final_secrets.push(dec);
      }
    }

    return final_secrets;
  }
}
