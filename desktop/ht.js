const {app, BrowserWindow} = require('electron');
app.disableHardwareAcceleration();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const heroOf = async (win) => win.webContents.executeJavaScript(`
  (() => { const k=[...document.querySelectorAll('p')].find(p=>/Trending now|Featured release/i.test(p.textContent||''));
    if(!k) return null; const box=k.closest('div'); const h=box&&box.querySelector('h1,h2,h3');
    return {kicker:k.textContent.trim(), title:(h?h.textContent:box?box.innerText.split('\n')[1]:'').trim().slice(0,40)}; })()`);
app.whenReady().then(async () => {
  const seen = new Set(); let kicker = null;
  for (let i = 0; i < 4; i++) {
    const win = new BrowserWindow({width: 1400, height: 900, show: false, webPreferences: {offscreen: true}});
    await win.loadURL('http://127.0.0.1:18010/');
    await wait(9000);
    const h = await heroOf(win);
    if (h) { seen.add(h.title); kicker = h.kicker; }
    win.destroy();
  }
  console.log('RESULT ' + JSON.stringify({kicker, distinctHeroes: seen.size, samples: [...seen].slice(0, 4)}));
  app.exit(0);
});
