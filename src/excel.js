// Génération de modèles Excel et parsing d'imports
const ExcelJS = require('exceljs');

/**
 * Génère un modèle Excel avec en-têtes formatés, exemples et instructions.
 * @param {object} config
 *   - titre : nom de la feuille et du fichier
 *   - colonnes : [{ header, key, width, required, exemple, options, note }]
 *   - lignes_exemple : [{...}]
 *   - instructions : string[] (lignes du panneau d'instructions)
 * @returns {Promise<Buffer>}
 */
async function genererModele({ titre, colonnes, lignes_exemple = [], instructions = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Le Traiteur du Bistrot';
  wb.created = new Date();

  // Feuille de données
  const ws = wb.addWorksheet(titre, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = colonnes.map(c => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: c.width || 20 }));

  // Styling en-tête
  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFCA8A04' } } };
  });

  // Ajouter les lignes d'exemple
  for (const l of lignes_exemple) {
    const row = ws.addRow(l);
    row.eachCell(cell => {
      cell.font = { italic: true, color: { argb: 'FF64748B' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    });
  }

  // Notes sur les colonnes required (via commentaires cellule d'en-tête)
  colonnes.forEach((c, i) => {
    if (c.note) {
      const cell = ws.getCell(1, i + 1);
      cell.note = { texts: [{ text: c.note }], margins: { insetmode: 'auto' } };
    }
    // Validations dropdown pour listes fermées
    if (c.options && c.options.length) {
      const col = String.fromCharCode(65 + i); // A, B, C, ...
      ws.dataValidations.add(`${col}2:${col}1000`, {
        type: 'list',
        allowBlank: !c.required,
        formulae: [`"${c.options.join(',')}"`],
      });
    }
  });

  // Feuille Instructions
  if (instructions.length) {
    const wsI = wb.addWorksheet('Instructions');
    wsI.getColumn(1).width = 100;
    wsI.addRow(['📋 ' + titre + ' — Comment remplir ce modèle']).font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } };
    wsI.addRow([]);
    for (const inst of instructions) {
      wsI.addRow([inst]).font = { size: 11 };
    }
    wsI.addRow([]);
    wsI.addRow(['💡 Les colonnes avec * sont obligatoires. Vous pouvez supprimer les lignes d\'exemple avant l\'import.']).font = { italic: true, color: { argb: 'FF64748B' } };
  }

  return await wb.xlsx.writeBuffer();
}

/**
 * Parse un fichier Excel uploadé et retourne les lignes.
 * @param {Buffer} buffer
 * @param {object} config - { colonnes: [{key, required, type}] }
 * @returns {Promise<{lignes, erreurs, entete}>}
 */
async function parserImport(buffer, { colonnes }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // Prendre la première feuille (celle des données)
  const ws = wb.worksheets[0];
  if (!ws) return { lignes: [], erreurs: ['Aucune feuille de données trouvée dans le fichier.'], entete: [] };

  // Lire l'en-tête et faire un mapping colonne → key
  const headerRow = ws.getRow(1);
  const headerMap = {}; // colonne (1-based) → key
  headerRow.eachCell((cell, colNumber) => {
    const headerText = String(cell.value || '').replace(/\s*\*\s*$/, '').trim();
    const match = colonnes.find(c => c.header === headerText);
    if (match) headerMap[colNumber] = match.key;
  });

  const lignes = [];
  const erreurs = [];
  const entete = Object.values(headerMap);

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // sauter l'en-tête
    if (row.actualCellCount === 0) return; // ligne vide
    const data = {};
    let ligneVide = true;
    row.eachCell((cell, colNumber) => {
      const key = headerMap[colNumber];
      if (!key) return;
      let val = cell.value;
      // Formule ? Prendre le résultat
      if (val && typeof val === 'object' && 'result' in val) val = val.result;
      if (val && typeof val === 'object' && 'text' in val) val = val.text; // richtext
      if (typeof val === 'string') val = val.trim();
      if (val !== null && val !== undefined && val !== '') ligneVide = false;
      data[key] = val;
    });
    if (ligneVide) return;
    // Validation obligatoires
    const lignesErreurs = [];
    for (const c of colonnes) {
      if (c.required && (data[c.key] === undefined || data[c.key] === null || String(data[c.key]).trim() === '')) {
        lignesErreurs.push(`ligne ${rowNumber} : « ${c.header} » manquant`);
      }
      if (c.type === 'number' && data[c.key] !== undefined && data[c.key] !== null && data[c.key] !== '') {
        const n = Number(String(data[c.key]).replace(',', '.'));
        if (Number.isNaN(n)) lignesErreurs.push(`ligne ${rowNumber} : « ${c.header} » n'est pas un nombre (« ${data[c.key]} »)`);
        else data[c.key] = n;
      }
    }
    data.__ligne_excel = rowNumber;
    data.__erreurs = lignesErreurs;
    lignes.push(data);
    if (lignesErreurs.length) erreurs.push(...lignesErreurs);
  });

  return { lignes, erreurs, entete };
}

module.exports = { genererModele, parserImport };
