// Optional cookies (analytics, marketing) the shop sets only after consent.
//
// Empty: the shop sets only necessary cookies (gb_consent, gb_lang, and Stripe's fraud-prevention
// cookies on the payment pages), which need no consent. The cookie notice then only informs, with
// one "OK" button, instead of offering a choice that changes nothing.
//
// When you add an optional cookie: list it here (the notice then offers "Only necessary" and
// "Accept all"), describe it on the cookie page (views/legal/cookies-body*.ejs), update
// cookieBanner.text in the dictionaries, and load it only once window.gbConsent.allows('optional').
// Cookie-free analytics (Plausible, Umami, or the shop's own visit counting in Admin → Performance)
// need no entry here.
export const OPTIONAL_COOKIES = [];

export const hasOptionalCookies = (config) => (config?.optionalCookies ?? OPTIONAL_COOKIES).length > 0;
