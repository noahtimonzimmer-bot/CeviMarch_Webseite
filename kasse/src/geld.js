// Geldbetraege: intern immer ganze Rappen, nie Fliesskomma-Arithmetik.

/**
 * Wandelt eine Benutzereingabe ("12.50", "12,50", "12.-", 12.5) in Rappen um.
 * Gibt null zurueck, wenn die Eingabe kein gueltiger Betrag ist.
 */
export function zuRappen(eingabe) {
  if (eingabe === null || eingabe === undefined) return null;
  if (typeof eingabe === 'number') {
    if (!Number.isFinite(eingabe)) return null;
    return Math.round(eingabe * 100);
  }
  let text = String(eingabe).trim();
  if (!text) return null;
  text = text
    .replace(/chf/i, '')
    .replace(/fr\.?/i, '')
    .replace(/\s|'|’/g, '')
    .replace(/,/g, '.')
    .replace(/\.-$/, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const [ganz, bruch = ''] = text.replace('-', '').split('.');
  const vorzeichen = text.startsWith('-') ? -1 : 1;
  const rappen = Number(ganz) * 100 + Number((bruch + '00').slice(0, 2));
  return vorzeichen * rappen;
}

/** 1250 -> "12.50" */
export function ausRappen(rappen) {
  const n = Number(rappen || 0);
  const vorzeichen = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${vorzeichen}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 1250 -> "CHF 12.50" */
export function formatieren(rappen) {
  return `CHF ${ausRappen(rappen)}`;
}

/** Fuer Excel: 1250 -> 12.5 (Zahl, damit Excel damit rechnen kann) */
export function alsZahl(rappen) {
  return Number(rappen || 0) / 100;
}
