// Browser binary for the Playwright harness. Repo paths stay relative;
// the Chrome/Chromium binary is machine-local and overridable.
const fs = require('fs');

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

module.exports = chromePath;
