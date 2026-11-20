// Standard shop categories. The slug is stored on each deal; names and emojis are only for display,
// so they can be changed here at any time. Keep "other" last: it's the fallback.
export const CATEGORIES = [
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

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
export const DEFAULT_CATEGORY = 'other';

const bySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const isCategory = (slug) => bySlug.has(slug);

// Always returns a category: unknown or missing slugs show as "Other".
export const categoryFor = (slug) => bySlug.get(slug) ?? bySlug.get(DEFAULT_CATEGORY);
