/* ─── dorar.net → hadith card ───
   Parses dorar.net search, hadith and sharh pages, checks a result against the card's
   authenticity rules, and turns it into an entry for the #hadith-data block in index.html.
   Page structure follows dorar.net's markup as used by the MIT-licensed dorar-hadith-api
   (https://github.com/AhmedElTabarani/dorar-hadith-api). */

import { parseHTML } from 'linkedom';

export const DORAR = 'https://www.dorar.net';
export const CATEGORY_IDS = ['ibadat', 'akhlaq', 'iman', 'dhikr'];

// Collections the card accepts by default: dorar.net book id, exact name on dorar.net, id prefix on the card.
// Names must match exactly: dorar.net also has «مختصر سنن أبي داود», «تخريج سنن الترمذي» and the like.
const BOOKS = [
  { dorarId: '6216', name: 'صحيح البخاري', slug: 'bukhari', sahih: true },
  { dorarId: '3088', name: 'صحيح مسلم', slug: 'muslim', sahih: true },
  { dorarId: '6267', name: 'سنن أبي داود', slug: 'abudawud' },
  { dorarId: '13509', name: 'سنن الترمذي', slug: 'tirmidhi' },
  { dorarId: '13508', name: 'سنن النسائي', slug: 'nasai' },
  { dorarId: '6264', name: 'سنن ابن ماجة', slug: 'ibnmajah' },
  { dorarId: '11155', name: 'رياض الصالحين', slug: 'riyad' },
];
export const MAIN_BOOK_IDS = BOOKS.map((b) => b.dorarId);

// «صحيح» but not «صحيحه» (as in «أخرجه في صحيحه», which names a book, not a grade).
const SAHIH_GRADE = /صحيح(?!ه)|متفق عليه/;
const WEAK_GRADE = /ضعيف|منكر|موضوع|باطل|لا يصح|لم يصح|شاذ|لا أصل|مكذوب|معلول|معلق|تعليق/;

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

/* ─── Rules ─── */

const findBook = (book) => BOOKS.find((b) => b.name === squash(book || '')) || null;

export function assess(hadith, { anyBook = false } = {}) {
  const book = findBook(hadith.book);
  const reasons = [];
  if (!anyBook && !book) reasons.push(`source «${hadith.book || 'missing'}» isn't one of the main collections`);
  // Everything in al-Bukhari and Muslim is sahih; Dorar's note there may be a remark on extra chains, so only
  // a note marking the hadith as suspended (معلق) or criticized rules it out.
  if (book?.sahih) {
    if (WEAK_GRADE.test(hadith.grade)) reasons.push(`Dorar's note «${clip(hadith.grade, 60)}» marks it as suspended or criticized`);
  } else if (!SAHIH_GRADE.test(hadith.grade) || WEAK_GRADE.test(hadith.grade)) {
    reasons.push(`grade is «${clip(hadith.grade || 'missing', 60)}», not sahih`);
  }
  return { ok: reasons.length === 0, reasons };
}

// Share of Arabic letters carrying a haraka; fully vocalized text is roughly 0.8 or more.
export function tashkeelRatio(text) {
  const letters = (text.match(/[\u0621-\u064A]/g) || []).length;
  const marks = (text.match(/[\u064B-\u0652]/g) || []).length;
  return letters ? marks / letters : 0;
}

const stripTashkeel = (s) => s.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
const lettersOnly = (s) => squash(stripTashkeel(s)).replace(/[^\u0621-\u064A ]/g, '');
export const sameText = (a, b) => lettersOnly(a) === lettersOnly(b);

// Words that open a narration («قالوا: يا رسول الله…», «إنَّ رجلًا سأل…») rather than the Prophet's own words.
const NARRATION_START = /^(قال|قالت|قالوا|قلت|قلنا|سألت|سأل|سئل|إن رجلا|أن رجلا|أن النبي|أن رسول|كان|عن|جاء|أتى|سمعت|بينما|رأيت|دخل|خرج)(?=[\s:،]|$)/;

// The opening words when the matn starts with narration, or null.
export function narrationOpening(text) {
  const plain = squash(stripTashkeel(text)).replace(/^[«"(\s]+/, '');
  return NARRATION_START.test(plain) ? plain.split(' ').slice(0, 3).join(' ') : null;
}

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
  const book = findBook(hadith.book);
  const slug = book?.slug;
  const number = /^\d+$/.test(hadith.number) ? hadith.number : null;
  const sahihain = !!book?.sahih;
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
  if (narrationOpening(matn)) entry.intro = false;
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
