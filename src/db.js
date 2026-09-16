const { Database } = require('node-sqlite3-wasm');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const dir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Nettoyer un éventuel verrou orphelin (crash précédent, redémarrage brutal)
const lockPath = config.DB_PATH + '.lock';
try {
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    if (stat.isDirectory()) fs.rmSync(lockPath, { recursive: true, force: true });
    else fs.unlinkSync(lockPath);
    console.log('  → Verrou orphelin supprimé : ' + lockPath);
  }
} catch (e) {
  console.warn('  ⚠ Impossible de nettoyer le verrou (' + e.message + ') — la base est peut-être ouverte par un autre processus.');
}

const db = new Database(config.DB_PATH);
// PRAGMA optionnels : si un autre processus tient la DB, on continue sans bloquer.
try { db.exec('PRAGMA foreign_keys = ON'); } catch (e) { console.warn('PRAGMA foreign_keys ignoré :', e.message); }

// -----------------------------------------------------------------------------
// Couche de compatibilité API better-sqlite3 → node-sqlite3-wasm
// better-sqlite3 accepte des paramètres en varargs : stmt.get(1, 2, 3)
// node-sqlite3-wasm attend un tableau ou un objet : stmt.get([1, 2, 3])
// On wrap prepare() pour convertir les varargs en tableau.
// -----------------------------------------------------------------------------
const originalPrepare = db.prepare.bind(db);
db.prepare = function(sql) {
  const stmt = originalPrepare(sql);
  const origAll = stmt.all.bind(stmt);
  const origGet = stmt.get.bind(stmt);
  const origRun = stmt.run.bind(stmt);

  function normalizeParams(args) {
    if (args.length === 0) return undefined;
    if (args.length === 1) {
      const p = args[0];
      // Si c'est déjà un tableau ou un objet non-null, on le passe tel quel
      if (Array.isArray(p)) return p;
      if (p !== null && typeof p === 'object') return p;
      return [p];
    }
    return Array.from(args);
  }

  stmt.all = function(...args) {
    const p = normalizeParams(args);
    return p === undefined ? origAll() : origAll(p);
  };
  stmt.get = function(...args) {
    const p = normalizeParams(args);
    return p === undefined ? origGet() : origGet(p);
  };
  stmt.run = function(...args) {
    const p = normalizeParams(args);
    return p === undefined ? origRun() : origRun(p);
  };
  return stmt;
};

// db.pragma() : shim compatibilité better-sqlite3
db.pragma = function(sql) {
  return db.exec('PRAGMA ' + sql);
};

// Emuler db.transaction(fn) comme better-sqlite3 :
// - retourne une fonction appelable
// - supporte l'imbrication via SAVEPOINT (comme better-sqlite3 le fait en interne)
// C'est INDISPENSABLE quand une fonction transactionnelle en appelle une autre
// (ex : encaissement → écriture comptable, tous deux dans leur propre `db.transaction`).
let _txDepth = 0;
db.transaction = function(fn) {
  return function(...args) {
    const isOuter = _txDepth === 0;
    const spName = `sp_${_txDepth}`;
    if (isOuter) db.exec('BEGIN');
    else db.exec(`SAVEPOINT ${spName}`);
    _txDepth++;
    try {
      const result = fn(...args);
      _txDepth--;
      if (isOuter) db.exec('COMMIT');
      else db.exec(`RELEASE ${spName}`);
      return result;
    } catch (e) {
      _txDepth--;
      try {
        if (isOuter) db.exec('ROLLBACK');
        else db.exec(`ROLLBACK TO ${spName}`);
      } catch (_) {}
      throw e;
    }
  };
};

module.exports = db;
