// Marca Conversia: la "C" abierta + flecha de crecimiento, gradiente azul→magenta.
// SVG escalable, sin depender de un archivo. size = lado en px.
export default function LogoMark({ size = 32, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flexShrink: 0, ...style }} aria-label="Conversia">
      <defs>
        <linearGradient id="cvLogoGrad" x1="14" y1="88" x2="90" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1e3a8a" />
          <stop offset="0.5" stopColor="#3b5bd9" />
          <stop offset="1" stopColor="#d21fd2" />
        </linearGradient>
      </defs>
      {/* "C" — arco abierto hacia la derecha */}
      <path d="M70 24 A32 32 0 1 0 70 76" stroke="url(#cvLogoGrad)" strokeWidth="11" strokeLinecap="round" fill="none" />
      {/* Flecha de crecimiento (zig-zag ascendente) */}
      <path d="M30 66 L46 50 L57 60 L72 36" stroke="url(#cvLogoGrad)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Punta de flecha */}
      <path d="M82 24 L64 29 L77 43 Z" fill="url(#cvLogoGrad)" />
    </svg>
  );
}
