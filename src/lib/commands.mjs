/** Command search: finds editor features from a few typed characters, in kana, kanji or romaji.
 *  Typing 「キャ」, 「きゃ」 or "kya" all find 「キャンバスサイズを変更」. */

/** @typedef {{ id: string, label: string, reading?: string, keywords?: string[] }} Searchable */

/** Folds text for matching: width, case and hiragana → katakana, without spaces and middle dots.
 * @param {string} text */
export function fold(text) {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･_\-/]+/g, '');
}

const ROMAJI = {
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ',
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ', ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ',
  sa: 'サ', si: 'シ', shi: 'シ', su: 'ス', se: 'セ', so: 'ソ', za: 'ザ', zi: 'ジ', ji: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  ta: 'タ', ti: 'チ', chi: 'チ', tu: 'ツ', tsu: 'ツ', te: 'テ', to: 'ト', da: 'ダ', di: 'ヂ', du: 'ヅ', de: 'デ', do: 'ド',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ', ha: 'ハ', hi: 'ヒ', hu: 'フ', fu: 'フ', he: 'ヘ', ho: 'ホ',
  ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ', pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ', ya: 'ヤ', yu: 'ユ', yo: 'ヨ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ', wa: 'ワ', wo: 'ヲ', nn: 'ン', 'n\'': 'ン',
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ', gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  sha: 'シャ', shu: 'シュ', sho: 'ショ', she: 'シェ', sya: 'シャ', syu: 'シュ', syo: 'ショ',
  ja: 'ジャ', ju: 'ジュ', jo: 'ジョ', je: 'ジェ', zya: 'ジャ', zyu: 'ジュ', zyo: 'ジョ', jya: 'ジャ', jyu: 'ジュ', jyo: 'ジョ',
  cha: 'チャ', chu: 'チュ', cho: 'チョ', che: 'チェ', tya: 'チャ', tyu: 'チュ', tyo: 'チョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ', hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ', bya: 'ビャ', byu: 'ビュ', byo: 'ビョ',
  pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ', mya: 'ミャ', myu: 'ミュ', myo: 'ミョ', rya: 'リャ', ryu: 'リュ', ryo: 'リョ',
  fa: 'ファ', fi: 'フィ', fe: 'フェ', fo: 'フォ', ti_: 'ティ', thi: 'ティ', di_: 'ディ', dhi: 'ディ', va: 'ヴァ', vi: 'ヴィ', vu: 'ヴ', ve: 'ヴェ', vo: 'ヴォ',
  la: 'ァ', li: 'ィ', lu: 'ゥ', le: 'ェ', lo: 'ォ', xa: 'ァ', xi: 'ィ', xu: 'ゥ', xe: 'ェ', xo: 'ォ', ltu: 'ッ', xtu: 'ッ',
  '-': 'ー',
};
const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

/** Romaji → katakana, as far as it goes. A trailing incomplete syllable ("ky") is dropped,
 *  so a query being typed still matches. Returns '' when the text is not romaji.
 * @param {string} text */
export function romajiToKana(text) {
  const s = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (!/^[a-z'-]+$/.test(s)) return '';
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i], next = s[i + 1];
    // A doubled consonant is a small tsu: "kka" → ッカ.
    if (next === c && !VOWELS.has(c) && c !== 'n' && /[a-z]/.test(c)) { out += 'ッ'; i++; continue; }
    // "n" before a consonant (or "nn") is ン.
    if (c === 'n' && next && !VOWELS.has(next) && next !== 'y' && next !== 'n') { out += 'ン'; i++; continue; }
    let matched = false;
    for (const length of [3, 2, 1]) {
      const kana = ROMAJI[s.slice(i, i + length)];
      if (kana) { out += kana; i += length; matched = true; break; }
    }
    if (matched) continue;
    // An unfinished syllable at the end: stop, keeping what converted.
    if (i >= s.length - 2) break;
    return '';
  }
  return out;
}

/** Score of `text` (folded) for the folded query: higher is better, 0 is no match. Also returns where it matched.
 * @param {string} text @param {string} query @returns {{ score: number, index: number }} */
function matchText(text, query) {
  if (!query || !text) return { score: 0, index: -1 };
  if (text === query) return { score: 100, index: 0 };
  if (text.startsWith(query)) return { score: 80 + Math.min(10, query.length * 2) - Math.min(8, (text.length - query.length) / 4), index: 0 };
  const index = text.indexOf(query);
  if (index >= 0) return { score: 55 + Math.min(10, query.length * 2) - Math.min(15, index), index };
  // Letters in order with gaps ("きゃさ" → キャンバスサイズ): weaker, and only for queries of 2+ characters.
  if (query.length < 2) return { score: 0, index: -1 };
  let at = -1, first = -1, gaps = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, at + 1);
    if (found < 0) return { score: 0, index: -1 };
    if (first < 0) first = found; else gaps += found - at - 1;
    at = found;
  }
  return { score: Math.max(1, 30 - gaps * 2 - first), index: -1 };
}

/** How well a command matches the query (0 = not at all), and the matched span of its label for highlighting.
 * @param {Searchable} command @param {string} query @returns {{ score: number, start: number, end: number }} */
export function scoreCommand(command, query) {
  const folded = fold(query), kana = romajiToKana(query);
  const queries = [folded, kana].filter(Boolean);
  if (!queries.length) return { score: 0, start: -1, end: -1 };
  const label = fold(command.label);
  let best = { score: 0, start: -1, end: -1 };
  for (const q of queries) {
    // The label is worth most; its reading and keywords slightly less.
    const own = matchText(label, q);
    if (own.score > best.score) best = { score: own.score, start: own.index, end: own.index >= 0 ? own.index + q.length : -1 };
    for (const other of [command.reading, ...(command.keywords || [])]) {
      if (!other) continue;
      const m = matchText(fold(other), q);
      if (m.score * 0.9 > best.score) best = { score: m.score * 0.9, start: -1, end: -1 };
    }
  }
  return best;
}

/** Where the folded match falls in the original label (folding can change lengths, e.g. spaces), for highlighting.
 * @param {string} label @param {number} start @param {number} end @returns {[number, number] | null} */
export function labelSpan(label, start, end) {
  if (start < 0) return null;
  let folded = 0, from = -1, to = -1;
  for (let i = 0; i < label.length; i++) {
    const f = fold(label[i]).length;
    if (from < 0 && folded >= start && f) from = i;
    folded += f;
    if (folded >= end) { to = i + 1; break; }
  }
  return from >= 0 && to > from ? [from, to] : null;
}

/** Matching commands, best first. Recently used ones get a small lift; an empty query lists the recent ones.
 * @template {Searchable} T @param {T[]} commands @param {string} query @param {string[]} [recent] ids, most recent first
 * @returns {{ command: T, score: number, span: [number, number] | null }[]} */
export function searchCommands(commands, query, recent = []) {
  if (!fold(query)) {
    const byId = new Map(commands.map(command => [command.id, command]));
    return recent.map(id => byId.get(id)).filter(Boolean).map(command => ({ command: /** @type {T} */ (command), score: 0, span: null }));
  }
  const results = [];
  for (const command of commands) {
    const m = scoreCommand(command, query);
    if (!m.score) continue;
    const r = recent.indexOf(command.id);
    results.push({ command, score: m.score + (r >= 0 ? Math.max(1, 6 - r) : 0), span: labelSpan(command.label, m.start, m.end) });
  }
  return results.sort((a, b) => b.score - a.score || a.command.label.length - b.command.label.length);
}
