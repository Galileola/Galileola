// The EU harmonised notice on the legal guarantee of conformity (Directive 2011/83/EU,
// Article 6(1)(l) and Article 22a; Commission Implementing Regulation (EU) 2025/1960, Annex I),
// required from 27 September 2026 before a consumer is bound by a contract.
//
// The images in public/legal/ are the official colour versions from the Official Journal (OJ L,
// 2.10.2025, ELI: http://data.europa.eu/eli/reg_impl/2025/1960/oj), unchanged: "None of the
// elements of the harmonised notice can be edited", and online shops must show it in colour. The
// notice exists in the EU's official languages; Russian is not one, so Russian pages show the
// Estonian notice (the shop is Estonian). Other languages get the English one.
//
// `text` is the notice's own wording, for screen readers (the image is a picture of text).

const NOTICES = {
  et: {
    lang: 'et',
    src: '/static/legal/eu-legal-guarantee-notice-et.jpg',
    width: 1184,
    height: 1673,
    title: 'Seadusest tulenev vastutus',
    link: 'https://europa.eu/youreurope/garantiid',
    text: 'SEADUSEST TULENEV VASTUTUS. Vähemalt kaheaastane seadusest tulenev vastutus Euroopa Liidus müüdavate kaupade puhul. '
      + 'Tarbijad võivad nõuda oma õigusi müüja seadusest tuleneva vastutuse alusel, näiteks kui kaup: ei vasta kirjeldusele; ei toimi ettenähtud viisil. '
      + 'Müüjad vastutavad kauba üleandmise ajal esinenud mittevastavuse eest, mis ilmneb seadusest tuleneva vastutuse kehtivusaja jooksul. '
      + 'Sellises olukorras peavad müüjad pakkuma järgmist: kauba tasuta parandamine või tasuta asendamine; mõnel juhul hinna vähendamine või täieulatuslik hüvitamine. '
      + 'Mõnes riigis on seadusest tuleneva vastutuse kehtivusaeg pikem. Kasutatud kaupadel võib see aeg olla lühem, kuid mitte alla ühe aasta. '
      + 'Et saada lisateavet oma õiguste kohta konkreetses riigis, skannige allolev ruutkood või küsige müüjalt: europa.eu/youreurope/garantiid. '
      + 'Kuidas toimida, kui saate nõuetele mittevastava kauba? 1. Võtke võimalikult kiiresti müüjaga ühendust ja teatage probleemist. '
      + '2. Esitage ostutõend, näiteks kassatšekk, arve või pangaväljavõte. '
      + 'Müüjad ja tootjad võivad pakkuda ka müügigarantiid, mis kehtib sõltumatult seadusest tulenevast vastutusest. '
      + 'Näiteks selline märgis „GARAN“ näitab, et tootja pakub ilma igasuguse lisatasuta vastupidavusega seotud müügigarantiid, mis katab kogu kauba.',
  },
  en: {
    lang: 'en',
    src: '/static/legal/eu-legal-guarantee-notice-en.jpg',
    width: 1186,
    height: 1675,
    title: 'Legal guarantee',
    link: 'https://europa.eu/youreurope/guarantees',
    text: 'LEGAL GUARANTEE. Minimum two-year legal guarantee protection for goods sold in the European Union. '
      + 'Consumers can claim their rights under the legal guarantee of conformity, for example if goods: do not match the description; do not function as intended. '
      + 'Sellers are liable for any lack of conformity which existed when the goods were delivered, and which becomes apparent within the legal guarantee period. '
      + 'Sellers in such a situation are required to offer: free repair or free replacement; in some cases, a price reduction or full reimbursement. '
      + 'Some countries have a longer legal guarantee period. For second-hand goods, a shorter period may apply, but not less than one year. '
      + 'For more information on your rights in a specific country, scan the QR code below or ask the seller: europa.eu/youreurope/guarantees. '
      + 'What to do if you receive non-conforming goods: 1. Contact the seller as soon as possible to report the issue; '
      + '2. Provide proof of purchase, such as a receipt, invoice, or bank statement. '
      + 'Sellers and producers may also offer commercial guarantees, which apply independently from the legal guarantee. '
      + 'For example, you may see this GARAN label representing a commercial guarantee of durability offered by the producer at no additional cost and covering the entire good.',
  },
};

const FOR_LANGUAGE = { et: 'et', ru: 'et' };

export const guaranteeNotice = (lang) => NOTICES[FOR_LANGUAGE[lang] ?? 'en'];
