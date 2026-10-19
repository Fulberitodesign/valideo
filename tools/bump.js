// Publie une nouvelle version : node tools/bump.js "Nouveauté 1" "Nouveauté 2"…
// Incrémente ?v= dans app.html et sw.js, le cache du service worker, et version.json (fenêtre « Nouvelle version »).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), p = f => path.join(root, f);
const v = JSON.parse(fs.readFileSync(p('version.json'), 'utf8')), next = v.v + 1;
for (const f of ['app.html', 'sw.js']) fs.writeFileSync(p(f), fs.readFileSync(p(f), 'utf8').replace(/\?v=\d+/g, '?v=' + next).replace(/valideo-v\d+/g, 'valideo-v' + next));
const notes = process.argv.slice(2);
fs.writeFileSync(p('version.json'), JSON.stringify({ v: next, date: new Date().toISOString().slice(0, 10), notes: notes.length ? notes : v.notes }, null, 2) + '\n');
console.log('Version ' + next);
