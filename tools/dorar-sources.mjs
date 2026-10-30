/* ─── Where the importer gets hadiths from ───
   Two sources give the same records ({ id, text, rawi, mohdith, book, number, grade, takhrij, sharhId }):
   - site: dorar.net's own pages, parsed from HTML. The default.
   - api:  a dorar-hadith-api server you run (https://github.com/AhmedElTabarani/dorar-hadith-api), JSON over HTTP.
   The fetch functions are injected so the sources can be tested without a network. */

import * as lib from './dorar-lib.mjs';

// The API server could not be reached at all (nothing listening, DNS, timeout).
export class ApiUnreachableError extends Error {}

export function createSiteSource({ fetchHtml }) {
  return {
    name: 'dorar.net',
    async search(query, page = 1) {
      const url = `${lib.DORAR}/hadith/search?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
      return lib.parseSearchPage(await fetchHtml(url));
    },
    async hadith(id) {
      return lib.parseHadithPage(await fetchHtml(`${lib.DORAR}/h/${id}`), id);
    },
    async sharh(id) {
      return lib.parseSharhPage(await fetchHtml(`${lib.DORAR}/hadith/sharh/${id}`));
    },
  };
}

// --direct wins; otherwise --api, then DORAR_API_URL; with neither, dorar.net's pages.
export function chooseSource({ api, direct, envUrl, fetchHtml, fetchJson }) {
  if (direct && api) throw new Error('--direct and --api contradict each other; choose one.');
  const apiUrl = direct ? null : api || envUrl;
  return apiUrl ? createApiSource({ baseUrl: apiUrl, fetchJson }) : createSiteSource({ fetchHtml });
}

export function createApiSource({ baseUrl, fetchJson }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error(`The dorar-hadith-api address must start with http:// or https:// (got «${baseUrl}»).`);
  return {
    name: `dorar-hadith-api at ${base}`,
    async search(query, page = 1) {
      const url = `${base}/v1/site/hadith/search?value=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
      return lib.fromApiSearch(await fetchJson(url));
    },
    async hadith(id) {
      const body = await fetchJson(`${base}/v1/site/hadith/${encodeURIComponent(id)}`);
      const hadith = lib.fromApiHadith(body?.data, id);
      if (!hadith) throw new lib.DorarFormatError('dorar-hadith-api answered without the hadith text.');
      return hadith;
    },
    async sharh(id) {
      return lib.fromApiSharh(await fetchJson(`${base}/v1/site/sharh/${encodeURIComponent(id)}`));
    },
  };
}
