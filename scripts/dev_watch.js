/**
 * Watcher de développement (remplace `node --watch`).
 *
 * Pourquoi : sous Windows, `node --watch` plante avec « Error: kill EPERM »
 * lorsqu'il tente de tuer un processus enfant déjà terminé ou protégé.
 * L'erreur n'est pas interceptée par Node et fait tomber le watcher entier.
 * Ici on tue l'arbre de processus avec taskkill et on encaisse les erreurs.
 *
 * Usage : npm run dev
 */
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');
const ENTREE = path.join(BASE_DIR, 'src', 'server.js');
const DOSSIERS_SURVEILLES = ['src', 'routes', 'controllers', 'middleware', 'db'];
const EXTENSIONS = ['.js', '.json'];
const DELAI_ANTI_REBOND = 250; // ms

let enfant = null;
let redemarrageEnCours = false;
let minuteur = null;

function demarrer() {
  enfant = spawn(process.execPath, [ENTREE], { stdio: 'inherit', cwd: BASE_DIR });
  const pid = enfant.pid;
  enfant.on('exit', (code, signal) => {
    if (enfant && enfant.pid === pid) enfant = null;
    if (!redemarrageEnCours && code !== null && code !== 0) {
      console.log(`\n  ✗ Le serveur s'est arrêté (code ${code}). En attente d'une modification…\n`);
    } else if (!redemarrageEnCours && signal) {
      console.log(`\n  ✗ Le serveur s'est arrêté (${signal}). En attente d'une modification…\n`);
    }
  });
  enfant.on('error', (e) => console.error('  ! Impossible de lancer le serveur :', e.message));
}

function arreter(callback) {
  const proc = enfant;
  enfant = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return callback();

  let termine = false;
  const fini = () => { if (!termine) { termine = true; callback(); } };
  proc.once('exit', fini);

  if (process.platform === 'win32') {
    // /T : tue l'arbre complet (utile si Puppeteer a lancé un Chrome enfant)
    execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => {});
  } else {
    try { proc.kill('SIGTERM'); } catch (_) { /* déjà mort */ }
  }
  // Filet de sécurité : ne jamais rester bloqué si le processus ne signale pas sa sortie
  setTimeout(fini, 2000).unref();
}

function redemarrer(fichier) {
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    redemarrageEnCours = true;
    console.log(`\n  ↻ Redémarrage (${fichier})\n`);
    arreter(() => { redemarrageEnCours = false; demarrer(); });
  }, DELAI_ANTI_REBOND);
}

for (const dossier of DOSSIERS_SURVEILLES) {
  const chemin = path.join(BASE_DIR, dossier);
  if (!fs.existsSync(chemin)) continue;
  fs.watch(chemin, { recursive: true }, (_type, nom) => {
    if (!nom) return;
    if (!EXTENSIONS.includes(path.extname(nom))) return;
    redemarrer(path.join(dossier, nom));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { arreter(() => process.exit(0)); });
}

console.log(`  👀 Surveillance : ${DOSSIERS_SURVEILLES.join(', ')} (Ctrl+C pour quitter)\n`);
demarrer();
