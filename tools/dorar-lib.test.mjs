// Fixtures follow dorar.net's page structure (as in dorar-hadith-api's own fixtures); they are not saved live pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as lib from './dorar-lib.mjs';

const block = ({ n, text, rawi, mohdith, book, number, grade, tag, xplain }) => `
  <div class="border-bottom">
    <article><h5>${n} - ${text}</h5></article>
    <div>
      <strong>الراوي : <span>${rawi}</span></strong>
      <strong>المحدث : <a view-card="mhd" card-link="/hadith/mhd/256"><span>${mohdith}</span></a></strong>
      <strong>المصدر : <a view-card="book" card-link="/hadith/book-card/6216"><span>${book}</span></a></strong>
      <strong>الصفحة أو الرقم : <span>${number}</span></strong>
      <strong>خلاصة حكم المحدث : <span>${grade}</span></strong>
      <a xplain="${xplain}">شرح الحديث</a>
      <a tag="${tag}" href="https://dorar.net/h/${tag}"></a>
    </div>
  </div>`;

const searchHtml = `
  <a aria-controls="home">لغير المتخصص (3)</a>
  <a aria-controls="specialist">للمتخصص (12)</a>
  <div id="home">
    ${block({ n: 1, text: 'إنَّما الأعمالُ بالنِّيَّاتِ، وإنَّما لكلِّ امرئٍ ما نوى', rawi: 'عمر بن الخطاب', mohdith: 'البخاري', book: 'صحيح البخاري', number: '1', grade: '[صحيح]', tag: 'a1b2c3d4', xplain: '8209' })}
    ${block({ n: 2, text: 'حديثٌ آخر', rawi: 'أبو هريرة', mohdith: 'الألباني', book: 'السلسلة الضعيفة', number: '55', grade: 'ضعيف', tag: 'e5f6a7b8', xplain: '0' })}
    ${block({ n: 3, text: 'اتَّقِ اللهَ حيثُما كنتَ', rawi: 'أبو ذر الغفاري', mohdith: 'الترمذي', book: 'سنن الترمذي', number: '1987', grade: 'حسن صحيح', tag: 'c9d0e1f2', xplain: '0' })}
  </div>`;

const sharhHtml = (body) => `
  <article><h5>إنَّما الأعمالُ بالنِّيَّاتِ</h5></article>
  <div class="text-justify">الشرح</div>
  <div><p>${body}</p></div>`;

test('parses a search page', () => {
  const { total, results } = lib.parseSearchPage(searchHtml);
  assert.equal(total, 3);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    id: 'a1b2c3d4',
    text: 'إنَّما الأعمالُ بالنِّيَّاتِ، وإنَّما لكلِّ امرئٍ ما نوى',
    rawi: 'عمر بن الخطاب',
    mohdith: 'البخاري',
    book: 'صحيح البخاري',
    number: '1',
    grade: 'صحيح',
    takhrij: '',
    sharhId: '8209',
  });
  assert.equal(results[1].sharhId, null, 'xplain="0" means no sharh');
});

test('rejects a page without the results tab', () => {
  assert.throws(() => lib.parseSearchPage('<html><body>maintenance</body></html>'), lib.DorarFormatError);
});

test('parses a single hadith page and keeps the id from the link', () => {
  const html = `<div class="border-bottom"><article><h5>- : لا يُؤمِنُ أحدُكم</h5></article>
    <strong>الراوي : <span>أنس بن مالك</span></strong><strong>المصدر : <span>صحيح البخاري</span></strong>
    <strong>الصفحة أو الرقم : <span>13</span></strong><strong>خلاصة حكم المحدث : <span>[صحيح]</span></strong></div>`;
  const h = lib.parseHadithPage(html, 'zz99yy88');
  assert.equal(h.id, 'zz99yy88');
  assert.equal(h.text, 'لا يُؤمِنُ أحدُكم');
  assert.equal(h.number, '13');
  assert.equal(h.grade, 'صحيح');
});

test('accepts only sahih hadiths from the main collections', () => {
  const [bukhari, weak, tirmidhi] = lib.parseSearchPage(searchHtml).results;
  assert.equal(lib.assess(bukhari).ok, true);
  assert.equal(lib.assess(tirmidhi).ok, true);
  const verdict = lib.assess(weak);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasons.length, 2);
  assert.equal(lib.assess({ ...bukhari, book: 'صحيح الجامع' }).ok, false);
  assert.equal(lib.assess({ ...bukhari, book: 'صحيح الجامع' }, { anyBook: true }).ok, true);
  assert.equal(lib.assess({ ...bukhari, grade: 'إسناده ضعيف وله شاهد صحيح' }).ok, false);
});

test('takes the benefit from the «وفي الحديث» lessons', () => {
  const sharh = lib.parseSharhPage(sharhHtml('النية محلها القلب. وفي الحديث: الحثُّ على الإخلاصِ في الأعمال، وفيه: أنَّ الأعمال بخواتيمها.'));
  assert.deepEqual(lib.benefitFromSharh(sharh), { text: 'في الحديث: الحثُّ على الإخلاصِ في الأعمال.', fromLessons: true });
});

test('falls back to the first sentence of the explanation, clipped at a comma', () => {
  const long = 'يُبيِّن النبيُّ ﷺ ' + 'أنَّ العمل يتبع النية، '.repeat(12) + 'والله أعلم. ثم قال';
  const { text, fromLessons } = lib.benefitFromSharh(long, 80);
  assert.equal(fromLessons, false);
  assert.ok(text.length <= 81, text);
  assert.ok(text.endsWith('النية.'), text);
});

test('builds card entries with ids and references', () => {
  const [bukhari, , tirmidhi] = lib.parseSearchPage(searchHtml).results;
  const sharh = { text: 'في الحديث: الحثُّ على الإخلاص.', fromLessons: true };
  assert.deepEqual(lib.toCardEntry(bukhari, { cat: 'iman', sharh }), {
    id: 'bukhari-1',
    cat: 'iman',
    matn: 'إنَّما الأعمالُ بالنِّيَّاتِ، وإنَّما لكلِّ امرئٍ ما نوى.',
    source: 'صحيح البخاري',
    refs: 'رقم (1)',
    narrator: 'عمر بن الخطاب',
    sharh: 'في الحديث: الحثُّ على الإخلاص.',
    sharhSource: 'الدرر السنية',
    dorarId: 'a1b2c3d4',
  });
  const entry = lib.toCardEntry(tirmidhi, { cat: 'akhlaq', sharh: null });
  assert.equal(entry.id, 'tirmidhi-1987');
  assert.equal(entry.refs, 'رقم (1987)، الترمذي: حسن صحيح');
  assert.equal(entry.sharh, '');
  assert.equal('sharhSource' in entry, false);
  assert.equal(lib.toCardEntry({ ...bukhari, book: 'صحيح الجامع', number: '1/23' }, { cat: 'iman' }).id, 'dorar-a1b2c3d4');
});

test('reads and writes the index.html data block', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const list = lib.readCardData(html);
  assert.ok(list.length >= 21, 'the 21 hand-written hadiths stay on the card');
  assert.equal(new Set(list.map((h) => h.id)).size, list.length, 'every id is unique');
  for (const h of list) {
    assert.ok(lib.CATEGORY_IDS.includes(h.cat), `${h.id} has a known category`);
    assert.ok(h.matn && h.source && h.refs && h.narrator, `${h.id} has its text, source, reference and narrator`);
  }
  const entry = { id: 'test-1', cat: 'iman', matn: 'نصٌّ فيه </script> و$&', source: 's', refs: 'r', narrator: 'n', sharh: '' };
  const updated = lib.writeCardData(html, [...list, entry]);
  assert.deepEqual(lib.readCardData(updated).at(-1), entry);
  assert.equal(updated.split('</script>').length, html.split('</script>').length, 'no new closing tag leaks out');
  assert.equal(updated.slice(updated.indexOf('</script>', updated.indexOf('id="hadith-data"'))), html.slice(html.indexOf('</script>', html.indexOf('id="hadith-data"'))));
});

test('finds duplicates by id, dorar id or text without tashkeel', async () => {
  const list = lib.readCardData(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  assert.equal(lib.findDuplicate(list, { id: 'x', matn: 'إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى، فمن كانت هجرته إلى دنيا يصيبها، أو إلى امرأة ينكحها، فهجرته إلى ما هاجر إليه.' })?.id, 'bukhari-1');
  assert.equal(lib.findDuplicate(list, { id: 'muslim-2594', matn: '' })?.id, 'muslim-2594');
  assert.equal(lib.findDuplicate(list, { id: 'new', matn: 'نص جديد' }), undefined);
});

test('reads dorar links and ids', () => {
  assert.equal(lib.parseHadithRef('https://dorar.net/h/K3Df3Vmd'), 'K3Df3Vmd');
  assert.equal(lib.parseHadithRef('https://www.dorar.net/h/ToIF2N8R?osoul=1'), 'ToIF2N8R');
  assert.equal(lib.parseHadithRef('K3Df3Vmd'), 'K3Df3Vmd');
  assert.equal(lib.parseHadithRef('12'), null);
});

// The shape of https://dorar.net/dorar_api.json?skey=… answers, including its stray closing tags.
const apiBlock = (n, text, rawi, book, number, grade) => `
<div class="hadith" style="text-align:justify;">${n} -   ${text}  .</div>

<div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> ${rawi}</span>
    <span class="info-subtitle">المحدث:</span> ${book === 'صحيح مسلم' ? 'مسلم' : 'البخاري'}
    <span class="info-subtitle">المصدر:</span>  ${book}
    <span class="info-subtitle">الصفحة أو الرقم:</span>  ${number}
    <span class="info-subtitle">خلاصة حكم المحدث:</span>  <span>${grade}</span>
</div>`;
const VOCALIZED = 'مَنْ كانَ يُؤْمِنُ باللَّهِ واليَومِ الآخِرِ فَلْيُكْرِمْ جارَهُ';
const apiBody = (...blocks) => ({ ahadith: { result: `<head>\n<link rel="canonical" href="https://dorar.net/dorar_api.json">\n</head>${blocks.join('\n')}\n--------------\n<br/><a href="https://dorar.net/hadith/search?q=x">المزيد</a>` } });

test("parses dorar.net's official API answer", () => {
  const records = lib.parseApiResult(apiBody(
    apiBlock(1, `<span class="search-keys">مَنْ</span> كانَ يُؤْمِنُ باللَّهِ واليَومِ الآخِرِ فَلْيُكْرِمْ جارَهُ`, '[أبو هريرة]', 'صحيح البخاري', '6019', '[صحيح]'),
    apiBlock(2, 'نَصٌّ آخَرُ', 'عائشة أم المؤمنين', 'صحيح مسلم', '2594', '[صحيح]'),
  ));
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    id: null, text: VOCALIZED, rawi: 'أبو هريرة', mohdith: 'البخاري', book: 'صحيح البخاري', number: '6019', grade: 'صحيح', takhrij: '', sharhId: null,
  });
  assert.equal(records[1].rawi, 'عائشة أم المؤمنين');
  assert.deepEqual(lib.parseApiResult({ ahadith: { result: '' } }), []);
  assert.throws(() => lib.parseApiResult({}), lib.DorarFormatError);
  assert.equal(lib.apiSearchUrl('النية', 2), 'https://dorar.net/dorar_api.json?skey=%D8%A7%D9%84%D9%86%D9%8A%D8%A9&s[]=6216&s[]=3088&page=2');
});

test('keeps only complete, vocalized sahih hadiths from al-Bukhari and Muslim that fit the card', () => {
  const record = (over) => ({ id: null, text: VOCALIZED, rawi: 'أبو هريرة', mohdith: 'البخاري', book: 'صحيح البخاري', number: '6019', grade: 'صحيح', takhrij: '', sharhId: null, ...over });
  const records = [
    record(),
    record({ number: '6019' }), // the same hadith again
    record({ book: 'صحيح الجامع', text: VOCALIZED + ' أَيْضًا' }),
    record({ grade: 'أورده في صحيحه وقال : هذا تفسير الأول', number: '1447', text: VOCALIZED + ' كَذَلِكَ' }),
    record({ number: '1/23', text: VOCALIZED + ' هُنا' }),
    record({ number: '50', text: 'إنَّما الأعمالُ بالنياتِ . . .' }),
    record({ number: '51', text: 'نَصٌّ' }),
    record({ number: '52', text: 'من كان يؤمن بالله واليوم الآخر فليقل خيرا أو ليصمت' }),
    record({ number: '53', text: 'كانَ النَّبيُّ ﷺ يُصَلِّي مِنَ اللَّيْلِ إحْدَى عَشْرَةَ رَكْعَةً', book: 'صحيح مسلم', mohdith: 'مسلم' }),
  ];
  const { entries, skipped } = lib.selectForCard(records, { cat: 'akhlaq', existing: [] });
  assert.deepEqual(entries.map((e) => e.id), ['bukhari-6019', 'muslim-53']);
  assert.deepEqual(skipped, {
    'already on the card': 1,
    'not al-Bukhari or Muslim': 1,
    'grade is not plainly sahih': 1,
    'no hadith number': 1,
    'abridged text': 1,
    'too short or too long for the card': 1,
    'not vocalized enough': 1,
  });
  assert.deepEqual(entries[0], { id: 'bukhari-6019', cat: 'akhlaq', matn: VOCALIZED + '.', source: 'صحيح البخاري', refs: 'رقم (6019)', narrator: 'أبو هريرة', sharh: '' });
  assert.equal(entries[1].lead, false, 'a narration about the Prophet ﷺ gets no «قال رسول الله ﷺ:»');

  const onCard = [{ id: 'bukhari-6019', matn: 'x' }];
  assert.equal(lib.selectForCard([record()], { cat: 'akhlaq', existing: onCard }).entries.length, 0);
  const agreedUpon = [{ id: 'bukhari-6018', matn: 'x', refs: 'البخاري (6018)، ومسلم (47)، واللفظ لمسلم' }];
  assert.deepEqual(lib.referenceIds(agreedUpon[0]), ['bukhari-6018', 'bukhari-6018', 'muslim-47']);
  assert.equal(lib.selectForCard([record({ book: 'صحيح مسلم', number: '47' })], { cat: 'akhlaq', existing: agreedUpon }).entries.length, 0, 'Muslim 47 is already on the card as bukhari-6018');
  const withChainNote = record({ number: '60', text: 'مَن أدرَك رَكعةً مِنَ الصَّلاةِ فقد أدرَك الصَّلاةَ. وفي روايةٍ: بمِثلِ حَديثِ يَحيى' });
  assert.deepEqual(lib.selectForCard([withChainNote], { cat: 'ibadat' }).skipped, { 'includes notes on other chains': 1 });
});

test("tells the Prophet's own words from accounts about him", () => {
  assert.equal(lib.isProphetsSaying('إنَّما الأعْمالُ بالنِّيّاتِ'), true);
  assert.equal(lib.isProphetsSaying('قالَ اللَّهُ تَعالَى: أنا عِنْدَ ظَنِّ عَبْدِي بي'), true, 'a hadith qudsi is still his saying');
  assert.equal(lib.isProphetsSaying('«الدِّينُ النَّصِيحَةُ»، قُلْنا: لِمَنْ؟'), true);
  assert.equal(lib.isProphetsSaying('كانَ النبيُّ ﷺ يُصَلِّي'), false);
  assert.equal(lib.isProphetsSaying('أنَّ رَسولَ اللَّهِ صَلَّى اللهُ عليه وسلَّمَ قالَ: الدِّينُ النَّصِيحَةُ'), false);
  assert.equal(lib.isProphetsSaying('كُنَّا نُصَلِّي مع'), false);
  assert.equal(lib.isProphetsSaying('سَأَلْتُ عائِشَةَ'), false);
  assert.equal(lib.isProphetsSaying('كانَتْ عائشةُ'), false);
});

test('measures tashkeel and decodes entities', () => {
  assert.ok(lib.tashkeelRatio('بُنِيَ الْإِسْلَامُ عَلَى خَمْسٍ') > 0.8);
  assert.ok(lib.tashkeelRatio('بني الإسلام على خمس') === 0);
  assert.equal(lib.decodeEntities('&#1575;&#x644; &amp; &quot;'), 'ال & "');
});

test('maps dorar-hadith-api records to the same shape as the parsed pages', () => {
  const siteFirst = lib.parseSearchPage(searchHtml).results[0];
  const apiFirst = {
    hadith: 'إنَّما الأعمالُ بالنِّيَّاتِ، وإنَّما لكلِّ امرئٍ ما نوى', rawi: 'عمر بن الخطاب', mohdith: 'البخاري', mohdithId: '256',
    book: 'صحيح البخاري', bookId: '6216', numberOrPage: '1', grade: '[صحيح]', explainGrade: '[صحيح]', takhrij: '', hadithId: 'a1b2c3d4',
    categories: [], hasSharhMetadata: true, sharhMetadata: { id: '8209', isContainSharh: false, urlToGetSharh: '/v1/site/sharh/8209' },
  };
  const weak = { ...apiFirst, hadithId: 'e5f6a7b8', grade: '', explainGrade: 'ضعيف', hasSharhMetadata: false, sharhMetadata: undefined };
  const { total, results } = lib.fromApiSearch({ status: 'success', metadata: { length: 3, total: 3, page: 1 }, data: [apiFirst, weak, { rawi: 'no text' }] });
  assert.equal(total, 3);
  assert.equal(results.length, 2, 'records without text are skipped');
  assert.deepEqual(results[0], siteFirst);
  assert.equal(results[1].grade, 'ضعيف', 'uses explainGrade when grade is empty');
  assert.equal(results[1].sharhId, null);
  assert.equal(lib.fromApiSearch({ data: [], metadata: { numberOfNonSpecialist: 7 } }).total, 7);
  assert.equal(lib.fromApiHadith({ hadith: '12 - نصٌّ ', numberOrPage: '12' }, 'zz99yy88').id, 'zz99yy88');
  assert.equal(lib.fromApiHadith({ hadith: '12 - نصٌّ ' }).text, 'نصٌّ');
  assert.equal(lib.fromApiHadith({ hadith: '- : نصٌّ' }).text, 'نصٌّ');
  assert.equal(lib.fromApiHadith({ rawi: 'x' }), null);
  assert.throws(() => lib.fromApiSearch({ status: 'fail', message: 'x' }), lib.DorarFormatError);
});

test('reads the explanation from a dorar-hadith-api sharh answer', () => {
  assert.equal(lib.fromApiSharh({ data: { sharhMetadata: { id: '8209', isContainSharh: true, sharh: '  النية  محلها القلب. ' } } }), 'النية محلها القلب.');
  assert.throws(() => lib.fromApiSharh({ data: { sharhMetadata: { id: '8209', isContainSharh: false } } }), lib.DorarFormatError);
});
