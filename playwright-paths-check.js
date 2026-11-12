const fs = require('fs');
const p = require('path');
const r = require('/home/daytona/codebase/node_modules/playwright-core/lib/coreBundle.js');
const home = require('os').homedir();
const cache = p.join(home, '.cache');
const regDir = p.join(cache, 'ms-playwright');
console.log('regDir:', regDir, 'exists:', fs.existsSync(regDir));
if (fs.existsSync(regDir)) {
  try { console.log('regDir listing:', JSON.stringify(fs.readdirSync(regDir).slice(0, 200))); } catch (e) { console.log('regDir read err:', e.message); }
}
console.log('shortPlatform:', r.shortPlatform);
const ep = r.EXECUTABLE_PATHS;
console.log('EXECUTABLE_PATHS:', ep);
console.log('EXECUTABLE_PATHS type:', typeof ep);
if (typeof ep === 'object' && ep !== null) {
  console.log('EXECUTABLE_PATHS keys:', Object.keys(ep).join(','));
  for (const name of Object.keys(ep)) {
    console.log('==', name, '==');
    const entry = ep[name];
    console.log('  entry type:', typeof entry);
    if (typeof entry === 'object' && entry !== null) {
      const keys = Object.keys(entry);
      console.log('  entry keys:', keys.join(','));
      const sp = r.shortPlatform;
      const tokens = entry[sp];
      console.log('  tokens for', sp, ':', JSON.stringify(tokens));
      if (tokens) {
        const built = p.join(regDir, ...tokens);
        console.log('  built path:', built, 'exists:', fs.existsSync(built));
        if (fs.existsSync(built)) {
          try { console.log('  listing:', JSON.stringify(fs.readdirSync(built).slice(0, 200))); } catch (e) { console.log('  ls err:', e.message); }
        }
      }
    }
  }
}
