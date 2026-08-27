import type { CookieEntry, CookieRequest, CookieResponse } from '../shared/types.js';

function formatExpiry(expirationDate?: number): string {
  if (!expirationDate) return 'Session';
  return new Date(expirationDate * 1000).toISOString();
}

function toCookieEntry(cookie: chrome.cookies.Cookie): CookieEntry {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: formatExpiry(cookie.expirationDate),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
}

chrome.runtime.onMessage.addListener(
  (message: CookieRequest, _sender, sendResponse: (response: CookieResponse) => void) => {
    if (message?.type !== 'GET_COOKIES' || typeof message.url !== 'string') return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(message.url);
    } catch {
      sendResponse({ ok: false, error: 'このページのURLはCookie APIで利用できません。' });
      return;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      sendResponse({ ok: false, error: 'Cookieの表示はHTTP/HTTPSページで利用できます。' });
      return;
    }

    chrome.cookies
      .getAll({ url: parsedUrl.href })
      .then((cookies) => {
        sendResponse({
          ok: true,
          data: cookies
            .map(toCookieEntry)
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      })
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Cookieの取得に失敗しました。',
        });
      });

    return true;
  },
);
