/* ─── dorar.net → hadith card ───
   Parses dorar.net search, hadith and sharh pages, checks a result against the card's
   authenticity rules, and turns it into an entry for the #hadith-data block in index.html.
   Page structure follows dorar.net's markup as used by the MIT-licensed dorar-hadith-api
   (https://github.com/AhmedElTabarani/dorar-hadith-api). */

import { parseHTML } from 'linkedom';

export const DORAR = 'https://www.dorar.net';
export const CATEGORY_IDS = ['ibadat', 'akhlaq', 'iman', 'dhikr'];

// Collections the card accepts by default, with the id prefix each one gets.
const BOOKS = [
  ['صحيح البخاري', 'bukhari'],
  ['صحيح مسلم', 'muslim'],
  ['سنن أبي داود', 'abudawud'],
  ['سنن الترمذي', 'tirmidhi'],
  ['سنن النسائي', 'nasai'],
  ['سنن ابن ماجه', 'ibnmajah'],
  ['رياض الصالحين', 'riyad'],
];
const WEAK_GRADE = /ضعيف|منكر|موضوع|باطل|لا يصح|لم يصح|شاذ|لا أصل|مكذوب|معلول/;

const LABELS = {
  rawi: 'الراوي',
  mohdith: 'المحدث',
  book: 'المصدر',
  number: 'الصفحة أو الرقم',
  grade: 'خلاصة حكم المحدث',
  degree: 'درجة الحديث',
  takhrij: 'التخريج',
};

export class DorarFormatError extends Error {}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(html) {
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const parseDocument = (html) => parseHTML(decodeEntities(html)).document;

// Reads the «label : <span>value</span>» pairs dorar.net prints under each hadith.
export function parseInfo(el) {
  const info = {};
  for (const strong of el.querySelectorAll('strong')) {
    const label = squash(strong.textContent.split(':')[0].replace(/\|/g, ''));
    const span = strong.querySelector('span');
    if (!span) continue;
    for (const [key, text] of Object.entries(LABELS)) {
      if (label === text && !info[key]) info[key] = squash(span.textContent);
    }
  }
  return info;
}

function parseBlock(block, { textNode = block.children[0], infoNode = block.children[1] || block } = {}) {
  if (!textNode) return null;
  const text = squash(textNode.textContent).replace(/^\d+\s*-\s*/, '').replace(/^-\s*:?\s*/, '');
  if (!text) return null;
  const info = parseInfo(infoNode);
  const sharhId = block.querySelector('a[xplain]')?.getAttribute('xplain');
  return {
    id: block.querySelector('a[tag]')?.getAttribute('tag') || null,
    text,
    rawi: info.rawi || '',
    mohdith: info.mohdith || '',
    book: info.book || '',
    number: info.number || '',
    grade: (info.grade || info.degree || '').replace(/[[\]]/g, '').trim(),
    takhrij: info.takhrij || '',
    sharhId: sharhId && sharhId !== '0' ? sharhId : null,
  };
}

// https://www.dorar.net/hadith/search?q=… — the "لغير المتخصص" tab (#home).
export function parseSearchPage(html) {
  const doc = parseDocument(html);
  const tab = doc.querySelector('#home');
  if (!tab) throw new DorarFormatError('No results tab (#home) on the dorar.net search page.');
  const total = Number(doc.querySelector('a[aria-controls="home"]')?.textContent.match(/\d+/)?.[0] || 0);
  const results = [...tab.querySelectorAll('.border-bottom')].map((b) => parseBlock(b)).filter(Boolean);
  return { total, results };
}

// https://www.dorar.net/h/<id>
export function parseHadithPage(html, id) {
  const block = parseDocument(html).querySelector('.border-bottom');
  if (!block) throw new DorarFormatError('No hadith block on the dorar.net hadith page.');
  const result = parseBlock(block, { infoNode: block });
  if (!result) throw new DorarFormatError('The dorar.net hadith page had no hadith text.');
  return { ...result, id: result.id || id };
}

// https://www.dorar.net/hadith/sharh/<id>
export function parseSharhPage(html) {
  const body = parseDocument(html).querySelector('.text-justify')?.nextElementSibling;
  if (!body) throw new DorarFormatError('No explanation text on the dorar.net sharh page.');
  return squash(body.textContent);
}

export function parseHadithRef(value) {
  const link = String(value).match(/dorar\.net\/h\/([A-Za-z0-9]+)/);
  if (link) return link[1];
  return /^[A-Za-z0-9]{4,}$/.test(value) && !/^\d+$/.test(value) ? value : null;
}

/* ─── dorar-hadith-api JSON ───
   Answers from the /v1/site/… endpoints of https://github.com/AhmedElTabarani/dorar-hadith-api, mapped to the
   same records parseSearchPage and parseHadithPage produce. */

const apiText = (value) => (typeof value === 'string' ? squash(value) : '');

// One hadith object as the API sends it in search results, similar lists or GET /v1/site/hadith/:id.
export function fromApiHadith(item, fallbackId = null) {
  if (!item || typeof item !== 'object' || typeof item.hadith !== 'string') return null;
  const text = squash(item.hadith).replace(/^\d+\s*-\s*/, '').replace(/^-\s*:?\s*/, '');
  if (!text) return null;
  const sharhId = item.sharhMetadata?.id;
  return {
    id: apiText(item.hadithId) || fallbackId,
    text,
    rawi: apiText(item.rawi),
    mohdith: apiText(item.mohdith),
    book: apiText(item.book),
    number: apiText(item.numberOrPage),
    grade: apiText(item.grade || item.explainGrade).replace(/[[\]]/g, '').trim(),
    takhrij: apiText(item.takhrij),
    sharhId: sharhId && String(sharhId) !== '0' ? String(sharhId) : null,
  };
}

// GET /v1/site/hadith/search?value=…
export function fromApiSearch(body) {
  if (!Array.isArray(body?.data)) throw new DorarFormatError('dorar-hadith-api answered without a result list.');
  const meta = body.metadata || {};
  const total = Number(meta.total ?? meta.numberOfNonSpecialist ?? meta.length) || body.data.length;
  return { total, results: body.data.map((item) => fromApiHadith(item)).filter(Boolean) };
}

// GET /v1/site/sharh/:id
export function fromApiSharh(body) {
  const sharh = body?.data?.sharhMetadata?.sharh;
  if (typeof sharh !== 'string' || !sharh.trim()) throw new DorarFormatError('dorar-hadith-api answered without the explanation text.');
  return squash(sharh);
}

/* ─── dorar.net's official API ───
   https://dorar.net/dorar_api.json?skey=… (dorar.net/article/389) answers { ahadith: { result: "<html>" } }.
   Each hadith is a <div class="hadith"> followed by a <div class="hadith-info"> of «label: value» pairs.
   It has no ids, explanations or categories. */

export const API_BOOKS = { bukhari: '6216', muslim: '3088' };

export function apiSearchUrl(query, page = 1) {
  const books = Object.values(API_BOOKS).map((id) => `&s[]=${id}`).join('');
  return `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(query)}${books}${page > 1 ? `&page=${page}` : ''}`;
}

const API_LABELS = Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [label, key]));
const unbracket = (s) => s.replace(/^\[(.*)\]$/, '$1').trim();

export function parseApiResult(body) {
  const html = body?.ahadith?.result;
  if (typeof html !== 'string') throw new DorarFormatError("dorar.net's API answered without a result list.");
  const doc = parseDocument(`<html><body>${html}</body></html>`);
  const records = [];
  for (const info of doc.querySelectorAll('.hadith-info')) {
    const textNode = info.previousElementSibling;
    if (!textNode || !textNode.classList.contains('hadith')) continue;
    const fields = {};
    let key = null;
    for (const node of info.childNodes) {
      if (node.nodeType === 1 && node.classList.contains('info-subtitle')) {
        key = API_LABELS[squash(node.textContent).replace(/:$/, '')] || null;
      } else if (key) {
        fields[key] = (fields[key] || '') + node.textContent;
      }
    }
    const text = squash(textNode.textContent).replace(/^\d+\s*-\s*/, '').replace(/\s+\.$/, '').trim();
    if (!text) continue;
    records.push({
      id: null,
      text,
      rawi: unbracket(squash(fields.rawi || '')),
      mohdith: squash(fields.mohdith || ''),
      book: squash(fields.book || ''),
      number: squash(fields.number || ''),
      grade: unbracket(squash(fields.grade || '')),
      takhrij: '',
      sharhId: null,
    });
  }
  return records;
}

// The card prints «قال رسول الله ﷺ:» above the text. That is only right when the text is the Prophet's own words,
// so texts that mention him or open like a companion's account are treated as narrations.
const PROPHET = /رسول الله|النبي|نبي الله|ﷺ|صلى الله عليه وسلم/;
const ACCOUNT_OPENING = /^(كان|كانت|كنا|كنت|رأيت|سمعت|جاء|جاءت|أتى|أتيت|خرج|خرجنا|دخل|دخلت|سألت|سئل|قالت|بينما|بينا|لما|أخبرني|حدثني|عن|أن رجلا|أن امرأة|قال رجل|قال لي|قلت)(?=[\s،,:]|$)/; // \b doesn't see Arabic letters as word characters
export function isProphetsSaying(text) {
  const plain = stripTashkeel(text).replace(/[«»"]/g, '').trim();
  return !PROPHET.test(plain) && !ACCOUNT_OPENING.test(plain);
}

const MIN_CHARS = 20;
// Texts up to 700 characters fit both card formats at a readable size (checked with npm run check-cards).
export const MAX_CHARS = 700;
// Dorar vocalizes the letters that need it, about 0.4 by tashkeelRatio; below 0.3 a text is barely vocalized.
const MIN_TASHKEEL = 0.3;
// Muslim's texts sometimes end with notes on other chains («وفي رواية: بمثل حديث يحيى…»), which aren't the hadith's wording.
const CHAIN_NOTES = /وفي رواية|بمثل حديث|بهذا الإسناد|بهذا الاسناد|حدثنا|أخبرنا|نحو حديث|بإسناده|وزاد في رواية/;

// Every al-Bukhari or Muslim number an entry stands for: its id, plus the numbers in references like «البخاري (8)، ومسلم (16)».
export function referenceIds(entry) {
  const ids = [entry.id];
  for (const [, book, number] of String(entry.refs || '').matchAll(/(البخاري|مسلم) \((\d+)\)/g)) ids.push(`${book === 'مسلم' ? 'muslim' : 'bukhari'}-${number}`);
  return ids;
}

// Turns API records into card entries, keeping only complete, vocalized, sahih hadiths from al-Bukhari and
// Muslim that fit the card and aren't on it yet. Returns the entries and a count of each reason for skipping.
export function selectForCard(records, { cat, existing = [] }) {
  const entries = [];
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const knownIds = new Set(existing.flatMap(referenceIds));
  for (const record of records) {
    const slug = bookSlug(record.book);
    const length = Array.from(record.text).length;
    if (slug !== 'bukhari' && slug !== 'muslim') skip('not al-Bukhari or Muslim');
    else if (record.grade !== 'صحيح') skip('grade is not plainly sahih');
    else if (!/^\d+$/.test(record.number)) skip('no hadith number');
    else if (/\.\s?\.\s?\.|…/.test(record.text)) skip('abridged text');
    else if (CHAIN_NOTES.test(stripTashkeel(record.text))) skip('includes notes on other chains');
    else if (length < MIN_CHARS || length > MAX_CHARS) skip('too short or too long for the card');
    else if (tashkeelRatio(record.text) < MIN_TASHKEEL) skip('not vocalized enough');
    else {
      const entry = toCardEntry(record, { cat, sharh: null });
      if (!isProphetsSaying(record.text)) entry.lead = false;
      if (knownIds.has(entry.id) || findDuplicate([...existing, ...entries], entry)) skip('already on the card');
      else {
        entries.push(entry);
        knownIds.add(entry.id);
      }
    }
  }
  return { entries, skipped };
}

/* ─── Rules ─── */

const bookSlug = (book) => BOOKS.find(([name]) => book.includes(name))?.[1] || null;

export function assess(hadith, { anyBook = false } = {}) {
  const reasons = [];
  if (!/صحيح/.test(hadith.grade) || WEAK_GRADE.test(hadith.grade)) {
    reasons.push(`grade is «${hadith.grade || 'missing'}», not sahih`);
  }
  if (!anyBook && !bookSlug(hadith.book)) {
    reasons.push(`source «${hadith.book || 'missing'}» isn't one of the main collections`);
  }
  return { ok: reasons.length === 0, reasons };
}

// Share of Arabic letters carrying a haraka; fully vocalized text is roughly 0.8 or more.
export function tashkeelRatio(text) {
  const letters = (text.match(/[ء-ي]/g) || []).length;
  const marks = (text.match(/[ً-ْ]/g) || []).length;
  return letters ? marks / letters : 0;
}

const stripTashkeel = (s) => s.replace(/[ً-ْٰـ]/g, '');
export const sameText = (a, b) => squash(stripTashkeel(a)).replace(/[^ء-ي ]/g, '') === squash(stripTashkeel(b)).replace(/[^ء-ي ]/g, '');

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const comma = cut.lastIndexOf('،');
  if (comma > max * 0.5) return cut.slice(0, comma);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// Dorar's explanations close with «وفي الحديث: …» lessons; the first one makes a card-sized benefit.
export function benefitFromSharh(sharh, max = 190) {
  const marker = sharh.lastIndexOf('وفي الحديث');
  if (marker !== -1) {
    const lessons = sharh.slice(marker + 'وفي الحديث'.length).replace(/^\s*:\s*/, '');
    const first = squash(lessons.split(/\.\s|\.$|\s*وفيه\s*:?/)[0]).replace(/[.،؛:\s]+$/, '');
    if (first) return { text: 'في الحديث: ' + clip(first, max) + '.', fromLessons: true };
  }
  const first = squash(sharh.split(/\.\s/)[0]).replace(/[.،؛:\s]+$/, '');
  return { text: clip(first, max) + '.', fromLessons: false };
}

export function toCardEntry(hadith, { cat, sharh }) {
  const slug = bookSlug(hadith.book);
  const number = /^\d+$/.test(hadith.number) ? hadith.number : null;
  const sahihain = slug === 'bukhari' || slug === 'muslim';
  let refs = number ? `رقم (${number})` : `الصفحة أو الرقم: ${hadith.number}`;
  if (!sahihain && hadith.mohdith) refs += `، ${hadith.mohdith}: ${hadith.grade}`;
  const matn = /[.!؟»]$/.test(hadith.text) ? hadith.text : hadith.text + '.';
  const entry = {
    id: slug && number ? `${slug}-${number}` : `dorar-${hadith.id}`,
    cat,
    matn,
    source: hadith.book,
    refs,
    narrator: hadith.rawi,
    sharh: sharh ? sharh.text : '',
  };
  if (sharh) entry.sharhSource = 'الدرر السنية';
  if (hadith.id) entry.dorarId = hadith.id;
  return entry;
}

/* ─── index.html data block ─── */

const DATA_BLOCK = /(<script type="application\/json" id="hadith-data">)([\s\S]*?)(<\/script>)/;

export function readCardData(html) {
  const match = html.match(DATA_BLOCK);
  if (!match) throw new Error('No <script id="hadith-data"> block in index.html.');
  return JSON.parse(match[2]);
}

export function writeCardData(html, list) {
  const json = JSON.stringify(list, null, 2).replace(/</g, '\\u003c');
  return html.replace(DATA_BLOCK, (all, open, body, close) => `${open}\n${json}\n${close}`);
}

export function findDuplicate(list, entry) {
  return list.find((h) => h.id === entry.id || (entry.dorarId && h.dorarId === entry.dorarId) || sameText(h.matn, entry.matn));
}
