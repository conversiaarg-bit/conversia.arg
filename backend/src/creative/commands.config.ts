// Sistema de comandos "/comando" → fragmentos visuales en inglés para prompts publicitarios.
// El usuario escribe comandos (ej. "/product /ad /appetite /studio") en el brief y se
// expanden a directivas profesionales que se inyectan en el prompt del modelo de imágenes.

export const COMMAND_MAP: Record<string, string> = {
  // CORE
  product: 'product-focused composition, the product as the centered main subject',
  ad: 'advertising style, high-conversion commercial visual',
  commercial: 'professional commercial photography style',
  catalog: 'clean catalog style, neutral background',
  ecommerce: 'optimized for an online store listing',
  branding: 'strong brand identity feel',
  hero: 'hero shot, dominant heroic composition',
  // INTENCIÓN DE VENTA
  'high-conversion': 'visually optimized to drive sales',
  'scroll-stopping': 'bold, eye-catching scroll-stopping composition',
  clickbait: 'exaggerated visual appeal',
  viral: 'trendy, high-engagement aesthetic',
  offer: 'promotional offer context',
  discount: 'sale feeling with urgency cues',
  promo: 'marketing campaign style',
  limited: 'scarcity visual cues, limited edition feel',
  urgency: 'tension and fast-action feel',
  premium: 'high-end luxury look',
  'mass-market': 'accessible, appealing to a wide audience',
  // TARGET
  kids: 'playful, colorful, kid-friendly',
  teen: 'trendy, vibrant, youthful',
  adult: 'balanced, mature style',
  women: 'elegant, soft tones',
  men: 'strong contrast, bold masculine tones',
  fitness: 'energetic, clean, athletic',
  'luxury-buyer': 'premium aspirational aesthetic',
  budget: 'simple, accessible, value feel',
  'food-lover': 'appetizing emphasis',
  'tech-lover': 'futuristic clean design',
  // PSICOLOGÍA VISUAL
  appetite: 'highly appetizing, mouth-watering',
  craving: 'intense desire, craving-inducing visuals',
  desire: 'seductive, desirable presentation',
  trust: 'clean, reliable, trustworthy look',
  clean: 'hygienic, minimal, spotless',
  fresh: 'bright, natural, fresh',
  healthy: 'organic and light, healthy feel',
  indulgent: 'rich, heavy, indulgent textures',
  exclusive: 'rare, exclusive, premium feeling',
  fomo: 'fear-of-missing-out triggers',
  // ESTILO VISUAL
  realistic: 'photorealistic',
  hyperreal: 'hyper-realistic, extreme detail',
  ultrarealistic: 'ultra high fidelity, ultra realistic',
  '3d': '3D render style',
  cgi: 'high-end CGI rendering',
  cartoon: 'stylized cartoon look',
  anime: 'anime art style',
  illustration: 'illustrated look',
  flat: 'flat design',
  minimal: 'minimal aesthetic',
  luxury: 'elegant premium look',
  editorial: 'magazine editorial style',
  fashion: 'fashion photography style',
  // ILUMINACIÓN
  softlight: 'soft diffused lighting',
  hardlight: 'hard light with sharp shadows',
  dramatic: 'dramatic high-contrast lighting',
  cinematic: 'cinematic lighting setup',
  neon: 'neon glow lighting',
  studio: 'professional studio lighting',
  rimlight: 'rim lighting on the edges',
  backlight: 'backlit subject',
  goldenhour: 'warm golden-hour tones',
  daylight: 'natural daylight',
  moody: 'dark moody tones',
  highkey: 'bright high-key white lighting',
  lowkey: 'dark low-key low-light scene',
  // CÁMARA
  closeup: 'close-up shot',
  macro: 'extreme macro detail',
  wide: 'wide-angle shot',
  topview: 'top-down flat-lay shot',
  sideview: 'side-angle shot',
  angle: 'dynamic perspective angle',
  isometric: 'isometric view',
  depth: 'shallow depth of field',
  bokeh: 'creamy background bokeh',
  focus: 'razor-sharp focus on the subject',
  blur: 'motion blur',
  motion: 'dynamic sense of movement',
  // FONDO
  white: 'clean white background',
  black: 'black background',
  gradient: 'smooth gradient background',
  solid: 'solid color background',
  abstract: 'abstract background design',
  texture: 'textured surface background',
  marble: 'marble surface',
  wood: 'wood surface',
  concrete: 'concrete background',
  context: 'real-life environment context',
  kitchen: 'kitchen setting',
  restaurant: 'restaurant scene',
  street: 'urban street setting',
  // COMPOSICIÓN
  center: 'centered composition',
  'rule-of-thirds': 'rule-of-thirds layout',
  symmetry: 'symmetrical layout',
  asymmetry: 'asymmetric layout',
  stacked: 'stacked elements',
  floating: 'floating product',
  exploded: 'exploded view',
  cutaway: 'cutaway detail view',
  layered: 'layered composition',
  framing: 'natural framing',
  // EFECTOS
  splash: 'liquid splash effect',
  smoke: 'smoke effect',
  fire: 'flames',
  steam: 'steam vapor',
  glow: 'glowing highlights',
  particles: 'floating particles',
  sparkles: 'sparkle highlights',
  liquid: 'fluid liquid motion',
  melting: 'melting effect',
  dripping: 'dripping textures',
  fog: 'fog atmosphere',
  // FOOD
  juicy: 'juicy texture',
  melted: 'melted ingredients',
  crispy: 'crispy texture',
  grilled: 'grill marks',
  hot: 'hot and steaming',
  cheesy: 'cheese emphasis, cheese pull',
  saucy: 'sauce dripping',
  sweet: 'sweet glossy finish',
  delicious: 'highly appetizing and delicious',
  // MATERIALES
  glossy: 'glossy reflections',
  matte: 'matte finish',
  metallic: 'metallic reflections',
  glass: 'transparent glass',
  plastic: 'plastic texture',
  transparent: 'see-through transparency',
  reflection: 'reflective surface',
  shiny: 'shiny highlights',
  rough: 'rough texture',
  // FORMATO
  square: '1:1 square format',
  vertical: 'vertical composition',
  horizontal: 'horizontal composition',
  story: 'vertical story format',
  banner: 'banner layout',
  thumbnail: 'thumbnail style',
  '4k': '4K resolution detail',
  '8k': '8K ultra detail',
  hd: 'high definition',
  // TEXTO EN IMAGEN
  headline: 'bold marketing headline text',
  tagline: 'short slogan text',
  price: 'visible pricing',
  'discount-badge': 'sale/discount badge',
  cta: 'clear call-to-action',
  logo: 'brand logo',
  'branding-text': 'brand text elements',
};

// Extrae comandos "/x" de un texto, los mapea a fragmentos en inglés y devuelve
// también el texto libre restante (lo que el usuario escribió que no es comando).
export function expandCommands(text?: string): { fragments: string[]; rest: string } {
  if (!text) return { fragments: [], rest: '' };
  const fragments: string[] = [];
  const rest = text
    .replace(/\/([a-z0-9-]+)/gi, (m, cmd: string) => {
      const frag = COMMAND_MAP[cmd.toLowerCase()];
      if (frag) { if (!fragments.includes(frag)) fragments.push(frag); return ' '; }
      return m; // comando desconocido: se deja como texto
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { fragments, rest };
}
