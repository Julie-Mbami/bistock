/**
 * Watcher de développement (remplace `node --watch`).
 *
 * Pourquoi : sous Windows, `node --watch` plante avec « Error: kill EPERM »
 * lorsqu'il tente de tuer un processus enfant déjà terminé ou protégé.
 * L'erreur n'est pas interceptée par Node et fait tomber le watcher entier.
 * Ici on tue l'arbre de processus avec taskkill et on encaisse les erreurs.
 *
 * Détection des changements : `fs.watch` récursif donne une réaction immédiate,
 * mais sous Windows il cesse silencieusement de livrer des événements quand le
 * tampon de ReadDirectoryChangesW déborde — ce qui arrive dès qu'une commande
 * touche tout l'arbre d'un coup (`git add -A`, `git checkout`, une extraction
 * d'archive). Le processus reste vivant mais sourd. Un balayage périodique des
 * dates de modification sert donc de filet : 23 fichiers à comparer, le coût
 * est négligeable et la détection ne peut plus être perdue.
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
const DELAI_ANTI_REBOND = 250;   // ms — regroupe les écritures multiples d'un même enregistrement
const PERIODE_BALAYAGE = 1000;   // ms — filet de sécurité si fs.watch devient sourd

let enfant = null;
let redemarrageEnCours = false;
let minuteur = null;

// ---------------------------------------------------------------------------
// Cycle de vie du serveur
// ---------------------------------------------------------------------------
function demarrer() {
  enfant = spawn(process.execPath, [ENTREE], { stdio: 'inherit', cwd: BASE_DIR });
  const pid = enfant.pid;
  enfant.on('exit', (code, signal) => {
    if (enfant && enfant.pid === pid) enfant = null;
    if (redemarrageEnCours) return;
    if (code !== null && code !== 0) {
      console.log(`\n  ✗ Le serveur s'est arrêté (code ${code}). En attente d'une modification…\n`);
    } else if (signal) {
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
  // Filet : ne jamais rester bloqué si le processus ne signale pas sa sortie
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

// ---------------------------------------------------------------------------
// Détection des changements
// ---------------------------------------------------------------------------
function estSurveille(fichier) {
  return EXTENSIONS.includes(path.extname(fichier));
}

// Empreinte de l'arborescence : chemin → "taille:date de modification"
function releverEmpreintes() {
  const empreintes = new Map();
  const parcourir = (dossier) => {
    let entrees;
    try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
    catch (_) { return; }  // dossier supprimé entre-temps
    for (const e of entrees) {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(complet); continue; }
      if (!e.isFile() || !estSurveille(e.name)) continue;
      try {
        const st = fs.statSync(complet);
        empreintes.set(complet, `${st.size}:${st.mtimeMs}`);
      } catch (_) { /* fichier supprimé entre-temps */ }
    }
  };
  for (const dossier of DOSSIERS_SURVEILLES) {
    const chemin = path.join(BASE_DIR, dossier);
    if (fs.existsSync(chemin)) parcourir(chemin);
  }
  return empreintes;
}

let empreintes = releverEmpreintes();

function balayer() {
  const actuelles = releverEmpreintes();
  let change = null;
  for (const [fichier, signature] of actuelles) {
    if (empreintes.get(fichier) !== signature) { change = fichier; break; }
  }
  if (!change) {
    for (const fichier of empreintes.keys()) {
      if (!actuelles.has(fichier)) { change = fichier; break; }
    }
  }
  empreintes = actuelles;
  if (change) redemarrer(path.relative(BASE_DIR, change));
}

// Réaction immédiate — doublée par le balayage si fs.watch décroche.
// Les objets FSWatcher sont conservés pour qu'ils ne soient pas ramassés.
const surveillants = [];
for (const dossier of DOSSIERS_SURVEILLES) {
  const chemin = path.join(BASE_DIR, dossier);
  if (!fs.existsSync(chemin)) continue;
  try {
    const s = fs.watch(chemin, { recursive: true }, (_type, nom) => {
      if (!nom || !estSurveille(nom)) return;
      empreintes = releverEmpreintes();   // évite un double redémarrage au balayage suivant
      redemarrer(path.join(dossier, nom));
    });
    // Sans ce gestionnaire, une erreur de surveillance ferait tomber le watcher
    s.on('error', (e) => console.warn(`  ! Surveillance de ${dossier} interrompue (${e.message}) — le balayage périodique prend le relais.`));
    surveillants.push(s);
  } catch (e) {
    console.warn(`  ! Surveillance de ${dossier} impossible (${e.message}) — balayage périodique uniquement.`);
  }
}

const balayage = setInterval(balayer, PERIODE_BALAYAGE);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(balayage);
    for (const s of surveillants) { try { s.close(); } catch (_) {} }
    arreter(() => process.exit(0));
  });
}

console.log(`  👀 Surveillance : ${DOSSIERS_SURVEILLES.join(', ')} (Ctrl+C pour quitter)\n`);
demarrer();
