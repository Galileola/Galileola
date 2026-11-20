// Shop categories. The owner edits them in Admin → Settings → Categories (stored in the
// `categories` table); the shop starts with the built-in list below. The slug is stored on each
// deal and used in links (/?category=home). Names: a name the owner typed for a language wins;
// otherwise built-in categories use the translations in src/i18n/locales (categories.<slug>), and
// new ones use their English name. "other" always exists: it's the fallback for unknown slugs.
export const BUILT_IN_CATEGORIES = [
  { slug: 'electronics', name: 'Electronics', emoji: '📱', hint: 'phones, computers, audio, cameras, gadgets, accessories' },
  { slug: 'home', name: 'Home & Kitchen', emoji: '🏠', hint: 'cookware, appliances, furniture, decor, bedding, cleaning' },
  { slug: 'fashion', name: 'Fashion', emoji: '👗', hint: 'clothes, shoes, bags, jewellery, watches' },
  { slug: 'beauty', name: 'Beauty & Health', emoji: '💄', hint: 'cosmetics, skincare, hair care, personal care, wellness' },
  { slug: 'sports', name: 'Sports & Outdoors', emoji: '⚽', hint: 'fitness, cycling, camping, hiking, sportswear, bikes' },
  { slug: 'kids', name: 'Toys & Kids', emoji: '🧸', hint: 'toys, games, baby products, school supplies' },
  { slug: 'food', name: 'Food & Drinks', emoji: '🍫', hint: 'groceries, snacks, coffee, tea, drinks, sweets' },
  { slug: 'garden', name: 'Garden & DIY', emoji: '🌱', hint: 'garden tools, plants, outdoor furniture, power tools, hardware' },
  { slug: 'pets', name: 'Pets', emoji: '🐾', hint: 'pet food, toys, beds, leads, care products' },
  { slug: 'hobbies', name: 'Books & Hobbies', emoji: '🎨', hint: 'books, art and craft supplies, music instruments, board games, collectibles' },
  { slug: 'auto', name: 'Car & Motorbike', emoji: '🚗', hint: 'car accessories, car care, motorbike gear, tyres' },
  { slug: 'other', name: 'Other', emoji: '🎁', hint: 'anything that fits none of the above' },
];
export const DEFAULT_CATEGORY = 'other';
const builtInBySlug = new Map(BUILT_IN_CATEGORIES.map((c) => [c.slug, c]));

// { slug, emoji, hint, names: { en: 'Pets', de: … }, builtIn, name (English display name) }
const withName = (c) => ({ ...c, name: c.names?.en || builtInBySlug.get(c.slug)?.name || c.slug });
let list = BUILT_IN_CATEGORIES.map((c) => withName({ ...c, names: {}, builtIn: true }));
let bySlug = new Map(list.map((c) => [c.slug, c]));

function setList(next) {
  list = next.map(withName);
  if (!list.some((c) => c.slug === DEFAULT_CATEGORY)) list.push(withName({ ...builtInBySlug.get(DEFAULT_CATEGORY), names: {}, builtIn: true }));
  bySlug = new Map(list.map((c) => [c.slug, c]));
}

// Reads the categories from the database, adding the built-in list the first time.
export function loadCategories(repo) {
  if (!repo?.listCategories) return;
  let rows = repo.listCategories();
  if (!rows.length) {
    BUILT_IN_CATEGORIES.forEach((c, i) => repo.insertCategory({ slug: c.slug, emoji: c.emoji, hint: c.hint, names: {}, position: i, built_in: 1 }));
    rows = repo.listCategories();
  }
  setList(rows.map((r) => ({ slug: r.slug, emoji: r.emoji, hint: r.hint, names: safeJson(r.names), builtIn: Boolean(r.built_in) })));
}

function safeJson(s) {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export const allCategories = () => list;
export const categorySlugs = () => list.map((c) => c.slug);
export const isCategory = (slug) => bySlug.has(slug);
// Always returns a category: unknown or missing slugs show as "Other".
export const categoryFor = (slug) => bySlug.get(slug) ?? bySlug.get(DEFAULT_CATEGORY);

// The category's name in `lang`. `t` translates dictionary keys for that language.
export function categoryName(c, lang, t) {
  if (c.names?.[lang]) return c.names[lang];
  if (c.builtIn && t) {
    const key = `categories.${c.slug}`;
    const name = t(key);
    if (name && name !== key) return name;
  }
  return c.name;
}

// A slug for a new category from its English name ("Phone cases" -> "phone-cases").
export function newCategorySlug(name) {
  const base =
    String(name)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'category';
  let slug = base;
  for (let i = 2; bySlug.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}
