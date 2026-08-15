import {readFileSync} from 'fs';
import {deezer} from './src/core';
import {requestLight} from './src/core/deezer/api/request';
(async () => {
  const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  await deezer.initDeezerApi(String(cfg?.cookies?.arl || ''));
  for (const method of ['deezer.pageCharts', 'charts.getCountryList']) {
    try {
      const r: any = await requestLight({}, method);
      const keys = r && typeof r === 'object' ? Object.keys(r) : [];
      console.log(`  ${method}: keys=${JSON.stringify(keys).slice(0, 160)}`);
      if (r?.COUNTRIES) console.log('    COUNTRIES sample:', JSON.stringify(r.COUNTRIES).slice(0, 200));
    } catch (e: any) {
      console.log(`  ${method}: FAILED ${String(e.message).slice(0, 70)}`);
    }
  }
})().catch((e) => console.log('outer:', e?.message));
