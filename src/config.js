require('dotenv').config();
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';

// En production, on refuse de démarrer si SESSION_SECRET n'est pas fourni :
// une clé publique par défaut permettrait à un attaquant de forger des cookies de session.
if (NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('\n  ✗ SESSION_SECRET manquant.');
  console.error('    Créez un fichier .env à la racine avec au minimum :');
  console.error("    SESSION_SECRET=<chaîne aléatoire d'au moins 32 caractères>\n");
  console.error('    Exemple pour générer une clé forte sous Windows PowerShell :');
  console.error('      [Convert]::ToBase64String((1..48 | %{Get-Random -Max 256}))\n');
  process.exit(1);
}

module.exports = {
  PORT: parseInt(process.env.PORT || '9000', 10),
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-insecure-key-change-me',
  NODE_ENV,

  DEVISE: process.env.DEVISE || 'FCFA',
  ENTREPRISE_NOM: process.env.ENTREPRISE_NOM || 'Le Traiteur du Bistrot',
  ENTREPRISE_ADRESSE: process.env.ENTREPRISE_ADRESSE || '[A COMPLETER - Adresse]',
  ENTREPRISE_TEL: process.env.ENTREPRISE_TEL || '[A COMPLETER - Telephone]',
  TAUX_TVA: parseFloat(process.env.TAUX_TVA || '19.25'),

  BASE_DIR: path.resolve(__dirname, '..'),
  DB_PATH: path.resolve(__dirname, '..', 'data', 'app.db'),
  UPLOADS_DIR: path.resolve(__dirname, '..', 'public', 'uploads'),
};
