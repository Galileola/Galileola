// Entry point. Checks the Node.js version before loading anything that needs built-in SQLite,
// so a wrong version picked in the hosting panel gives a clear message instead of a crash.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `Node.js ${process.versions.node} is too old: this app needs Node.js 22.13 or newer (it uses the built-in SQLite). ` +
      'In your hosting panel choose Node.js 22.x (latest) or 24.x.'
  );
  process.exit(1);
}
// Settings shared with other copies of the shop on this hosting account (see settingsFile.js).
const fs = await import('node:fs');
const { loadSettingsFile, settingsFileCandidates } = await import('./settingsFile.js');
const settingsFile = settingsFileCandidates().find((f) => fs.existsSync(f));
if (settingsFile) {
  try {
    const filled = loadSettingsFile(process.env, settingsFile);
    console.log(`[settings] ${filled.length} settings read from ${settingsFile} (the hosting panel's variables take priority)`);
  } catch (err) {
    console.error(`[settings] could not read ${settingsFile}: ${err.message}`);
  }
}
await import('./server.js');
