// Visual styles. Each one sets the fonts, the button shape and the mood the
// art director is asked to aim for. Every font has Latin, Latin Extended
// (Estonian) and Cyrillic (Russian) letters.

export const STYLES = {
  luxury: {
    label: 'Luxury',
    mood: 'premium, elegant, calm, expensive; deep shadows, rich materials (marble, silk, brushed metal, dark wood), restrained colour',
    headline: { font: 'Playfair Display', weight: 700, uppercase: false, width: 0.5 },
    body: { font: 'Montserrat', weight: 500 },
    cta: { font: 'Montserrat', weight: 600, uppercase: true, radius: 0, outline: true, tracking: 0.12 },
    subTracking: 0.18,
    subUppercase: true,
  },
  bold: {
    label: 'Bold',
    mood: 'loud, energetic, high-contrast, saturated colour blocks, punchy studio lighting, graphic and modern',
    headline: { font: 'Oswald', weight: 700, uppercase: true, width: 0.44 },
    body: { font: 'Inter', weight: 600 },
    cta: { font: 'Inter', weight: 800, uppercase: true, radius: 999, outline: false, tracking: 0.04 },
    subTracking: 0.02,
    subUppercase: false,
  },
  minimal: {
    label: 'Minimal',
    mood: 'clean, airy, minimalist, soft daylight, seamless light backdrop, lots of negative space, Scandinavian simplicity',
    headline: { font: 'Manrope', weight: 800, uppercase: false, width: 0.56 },
    body: { font: 'Manrope', weight: 500 },
    cta: { font: 'Manrope', weight: 700, uppercase: false, radius: 10, outline: false, tracking: 0 },
    subTracking: 0,
    subUppercase: false,
  },
  fresh: {
    label: 'Fresh',
    mood: 'bright, natural, joyful, morning sunlight, plants, water splashes or fruit where it fits, vivid but natural colour',
    headline: { font: 'Rubik', weight: 800, uppercase: false, width: 0.56 },
    body: { font: 'Rubik', weight: 500 },
    cta: { font: 'Rubik', weight: 700, uppercase: false, radius: 999, outline: false, tracking: 0 },
    subTracking: 0,
    subUppercase: false,
  },
  tech: {
    label: 'Tech',
    mood: 'futuristic, sleek, dark background with neon rim light, glossy reflective surfaces, subtle glow and haze',
    headline: { font: 'Exo 2', weight: 800, uppercase: true, width: 0.6 },
    body: { font: 'Inter', weight: 500 },
    cta: { font: 'Exo 2', weight: 700, uppercase: true, radius: 6, outline: false, tracking: 0.08 },
    subTracking: 0.04,
    subUppercase: false,
  },
  warm: {
    label: 'Warm',
    mood: 'cosy, friendly, golden-hour light, natural textures (linen, wood, ceramics), warm earthy colours, homely',
    headline: { font: 'Lora', weight: 700, uppercase: false, width: 0.52 },
    body: { font: 'Inter', weight: 500 },
    cta: { font: 'Inter', weight: 700, uppercase: false, radius: 999, outline: false, tracking: 0 },
    subTracking: 0,
    subUppercase: false,
  },
};

export const STYLE_IDS = Object.keys(STYLES);
