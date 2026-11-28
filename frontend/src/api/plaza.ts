import { getAuthCsrfToken, requestJson } from './client';
import type { Creator, ListingOptions, PlazaItem, PlazaPageData } from './plazaTypes';

const P = '/api/v1';
const accountWrite = <T>(path: string, method: string, body?: unknown) => requestJson<T>(
  P + path, { method, body: body === undefined ? undefined : JSON.stringify(body) },
  { csrfOverride: getAuthCsrfToken() },
);

export const plazaApi = {
  list: (params: URLSearchParams) => requestJson<PlazaPageData>(P + '/plaza?' + params),
  listing: (shareId: string) => requestJson<PlazaItem>(P + '/plaza/shares/' + encodeURIComponent(shareId)),
  bookmarks: (offset: number, kind?: 'workshop' | 'deck') => requestJson<PlazaPageData>(
    P + '/plaza/bookmarks?offset=' + offset + (kind ? '&kind=' + kind : '')),
  creator: (userId: string, offset: number, kind?: 'workshop' | 'deck') => requestJson<Creator>(
    P + '/creators/' + encodeURIComponent(userId) + '?offset=' + offset + (kind ? '&kind=' + kind : '')),
  react: (id: string, kind: 'like' | 'bookmark') => accountWrite<PlazaItem>('/plaza/items/' + id + '/react', 'POST', { kind }),
  edit: (id: string, options: Partial<ListingOptions> & { title?: string; pinned?: boolean }) => accountWrite<PlazaItem>('/plaza/items/' + id, 'PATCH', options),
  unlist: (id: string) => accountWrite<void>('/plaza/items/' + id, 'DELETE'),
  forkDeck: (shareId: string) => requestJson<{ material_id: string }>(P + '/p/' + encodeURIComponent(shareId) + '/fork', { method: 'POST' }),
};
