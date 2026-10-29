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

test('reads and writes the hadith-card.html data block', async () => {
  const html = await readFile(new URL('../hadith-card.html', import.meta.url), 'utf8');
  const list = lib.readCardData(html);
  assert.equal(list.length, 21);
  const entry = { id: 'test-1', cat: 'iman', matn: 'نصٌّ فيه </script> و$&', source: 's', refs: 'r', narrator: 'n', sharh: '' };
  const updated = lib.writeCardData(html, [...list, entry]);
  assert.deepEqual(lib.readCardData(updated).at(-1), entry);
  assert.equal(updated.split('</script>').length, html.split('</script>').length, 'no new closing tag leaks out');
  assert.equal(updated.slice(updated.indexOf('</script>', updated.indexOf('id="hadith-data"'))), html.slice(html.indexOf('</script>', html.indexOf('id="hadith-data"'))));
});

test('finds duplicates by id, dorar id or text without tashkeel', async () => {
  const list = lib.readCardData(await readFile(new URL('../hadith-card.html', import.meta.url), 'utf8'));
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

test('measures tashkeel and decodes entities', () => {
  assert.ok(lib.tashkeelRatio('بُنِيَ الْإِسْلَامُ عَلَى خَمْسٍ') > 0.8);
  assert.ok(lib.tashkeelRatio('بني الإسلام على خمس') === 0);
  assert.equal(lib.decodeEntities('&#1575;&#x644; &amp; &quot;'), 'ال & "');
});
