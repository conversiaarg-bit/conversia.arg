import { useRef, useState } from 'react';
import { C } from '../../styles/theme';

type SceneStatus = 'idle' | 'running' | 'done' | 'error';

// Estado del pipeline único (1 solo video)
export interface Pipe {
  productData?: any;
  imagePrompt?: string;
  videoPrompt?: string;
  script?: string;
  imageUrl?: string;
  videoUrl?: string;
  // Pipeline de IMAGEN (producto exacto): recorte → fondo → composición
  cutoutUrl?: string;
  backgroundUrl?: string;
  sceneUrl?: string;
}

type GroupKey = 'entrada' | 'generacion' | 'salida';
interface GNode { id: string; x: number; y: number; group: GroupKey; emoji: string; title: string; model?: string; badges: string[]; status: SceneStatus; media?: string; poster?: string; text?: string }

const W = 250, H = 220;
const GROUPS: { key: GroupKey; label: string; color: string }[] = [
  { key: 'entrada', label: 'Input', color: '#4da6ff' },
  { key: 'generacion', label: 'Generación', color: '#7c5cfc' },
  { key: 'salida', label: 'Salida', color: '#00d68f' },
];
const EDGE = '#2ee6c4';

async function dlNode(url: string, name: string) {
  try {
    const r = await fetch(url); const b = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = name + (b.type.includes('video') ? '.mp4' : '.png');
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  } catch { window.open(url, '_blank'); }
}

// Pipeline fijo: Input → OpenAI (prompts + imagen) → Seedance (1 video) → Salida.
export default function CampaignCanvas({ pipe, running, onRun, cost, productImages, productDesc, characterDesc, onCancel, onTemplates, mode = 'video' }: {
  pipe: Pipe;
  running: boolean;
  onRun: () => void;
  cost: number;
  productImages?: string[];
  productDesc?: string;
  characterDesc?: string;
  onCancel?: () => void;
  onTemplates?: () => void;
  mode?: 'video' | 'image';
}) {
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [sel, setSel] = useState<GNode | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const st = (filled: unknown): SceneStatus => filled ? 'done' : (running ? 'running' : 'idle');
  const done = mode === 'image' ? !!pipe.sceneUrl : !!pipe.videoUrl;

  // ── Layout: Input (col A) → col B → col C → Salida (col D)
  const A = 40, B = 360, Cx = 700, D = 1040, GAP = 250;
  const nodes: GNode[] = [];
  let edges: [string, string][] = [];
  if (mode === 'image') {
    // Pipeline IMAGEN producto-exacto: Input → (Recorte + Fondo) → Composición → Imagen final
    nodes.push({ id: 'product', x: A, y: 40 + GAP * 0.5, group: 'entrada', emoji: '📦', title: 'Imágenes de producto', model: 'Input', badges: productImages?.length ? [`${productImages.length} img`] : ['imagen'], status: 'done', poster: productImages?.[0], text: productImages?.length ? undefined : 'Subí fotos del producto' });
    nodes.push({ id: 'pdesc', x: A, y: 40 + GAP * 1.7, group: 'entrada', emoji: '📝', title: 'Categoría / producto', model: 'Static', badges: [], status: 'done', text: productDesc || 'Tu producto (define el estilo del fondo)' });
    nodes.push({ id: 'cutout', x: B, y: 40, group: 'generacion', emoji: '✂️', title: 'Recorte del producto', model: 'birefnet (fal)', badges: ['PNG'], status: st(pipe.cutoutUrl), poster: pipe.cutoutUrl, text: pipe.cutoutUrl ? undefined : 'Recorta el producto REAL (fondo transparente)' });
    nodes.push({ id: 'bg', x: B, y: 40 + GAP * 1.4, group: 'generacion', emoji: '🌆', title: 'Fondo publicitario', model: 'gpt-image-1', badges: ['solo fondo'], status: st(pipe.backgroundUrl), poster: pipe.backgroundUrl, text: pipe.backgroundUrl ? undefined : 'Genera SOLO el fondo (sin producto)' });
    nodes.push({ id: 'compose', x: Cx, y: 40 + GAP * 0.7, group: 'generacion', emoji: '🧩', title: 'Composición', model: 'sharp', badges: ['producto exacto'], status: st(pipe.sceneUrl), poster: pipe.sceneUrl, text: pipe.sceneUrl ? undefined : 'Pega el producto real sobre el fondo + sombra' });
    nodes.push({ id: 'scene', x: D, y: 40 + GAP * 0.7, group: 'salida', emoji: '🖼️', title: 'Imagen final', model: 'PNG', badges: ['9:16'], status: st(pipe.sceneUrl), poster: pipe.sceneUrl, text: pipe.sceneUrl ? undefined : 'El creativo listo (producto idéntico)' });
    edges = [['product', 'cutout'], ['pdesc', 'bg'], ['cutout', 'compose'], ['bg', 'compose'], ['compose', 'scene']];
  } else {
    // Input
    nodes.push({ id: 'product', x: A, y: 40, group: 'entrada', emoji: '📦', title: 'Imágenes de producto', model: 'Input', badges: productImages?.length ? [`${productImages.length} img`] : ['imagen'], status: 'done', poster: productImages?.[0], text: productImages?.length ? undefined : 'Subí fotos del producto' });
    nodes.push({ id: 'pdesc', x: A, y: 40 + GAP, group: 'entrada', emoji: '📝', title: 'Descripción de producto', model: 'Static', badges: [], status: 'done', text: productDesc || 'Tu producto' });
    nodes.push({ id: 'cdesc', x: A, y: 40 + GAP * 2, group: 'entrada', emoji: '🧑', title: 'Descripción de personaje', model: 'Static', badges: [], status: 'done', text: characterDesc || 'Persona UGC (avatar)' });
    // Generación — Product Analyzer (visión) extrae la verdad literal del producto
    nodes.push({ id: 'analyzer', x: B, y: 40, group: 'generacion', emoji: '🔍', title: 'Analizador de producto', model: 'GPT-4o visión', badges: ['OpenAI'], status: st(pipe.productData), text: pipe.productData ? JSON.stringify(pipe.productData, null, 1) : 'Lee la imagen y extrae marcas/colores/etiquetas exactas' });
    // Generación — prompts (OpenAI)
    nodes.push({ id: 'master', x: B, y: 40 + GAP, group: 'generacion', emoji: '✨', title: 'Prompt maestro', model: 'GPT-4o-mini', badges: ['OpenAI'], status: st(pipe.imagePrompt), text: pipe.imagePrompt ? 'Prompts de imagen y video generados ✓' : 'OpenAI arma el prompt de imagen y de video' });
    nodes.push({ id: 'imgprompt', x: B, y: 40 + GAP * 2, group: 'generacion', emoji: '🖼️', title: 'Prompt de imagen', model: 'OpenAI', badges: ['prompt'], status: st(pipe.imagePrompt), text: pipe.imagePrompt || 'Prompt de la imagen (se genera)' });
    nodes.push({ id: 'vidprompt', x: B, y: 40 + GAP * 3, group: 'generacion', emoji: '🎬', title: 'Prompt de video', model: 'OpenAI', badges: ['prompt'], status: st(pipe.videoPrompt), text: pipe.videoPrompt || 'Prompt del video (se genera)' });
    // Generación — imagen del personaje (OpenAI)
    nodes.push({ id: 'chargen', x: Cx, y: 40 + GAP * 1.5, group: 'generacion', emoji: '🧑‍🎤', title: 'Generación de personaje', model: 'gpt-image-1', badges: ['imagen: OpenAI'], status: st(pipe.imageUrl), poster: pipe.imageUrl, text: pipe.imageUrl ? undefined : 'La persona con el producto exacto' });
    // Salida — video (Seedance)
    nodes.push({ id: 'video', x: D, y: 40 + GAP * 1.5, group: 'salida', emoji: '🎥', title: 'Video final', model: 'Seedance 1.5', badges: ['video: Seedance', '9:16'], status: st(pipe.videoUrl), media: pipe.videoUrl, text: pipe.videoUrl ? undefined : 'El video (Seedance usa el prompt de video)' });
    edges = [
      ['product', 'analyzer'], ['analyzer', 'master'], ['pdesc', 'master'], ['cdesc', 'master'],
      ['master', 'imgprompt'], ['master', 'vidprompt'],
      ['imgprompt', 'chargen'], ['product', 'chargen'],
      ['vidprompt', 'video'], ['chargen', 'video'],
    ];
  }

  nodes.forEach(n => { const p = positions[n.id]; if (p) { n.x = p.x; n.y = p.y; } });

  const byId = (id: string) => nodes.find(n => n.id === id)!;

  const groupRects = GROUPS.map(g => {
    const ns = nodes.filter(n => n.group === g.key);
    const minX = Math.min(...ns.map(n => n.x)) - 20, minY = Math.min(...ns.map(n => n.y)) - 40;
    const maxX = Math.max(...ns.map(n => n.x + W)) + 20, maxY = Math.max(...ns.map(n => n.y + H)) + 20;
    return { ...g, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  });

  const path = (a: GNode, b: GNode) => {
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };
  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
  const onNodeDown = (e: React.MouseEvent, n: GNode) => { e.stopPropagation(); nodeDrag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false }; };
  const onMove = (e: React.MouseEvent) => {
    const nd = nodeDrag.current;
    if (nd) {
      if (Math.abs(e.clientX - nd.sx) > 3 || Math.abs(e.clientY - nd.sy) > 3) nd.moved = true;
      setPositions(p => ({ ...p, [nd.id]: { x: nd.ox + (e.clientX - nd.sx) / zoom, y: nd.oy + (e.clientY - nd.sy) / zoom } }));
      return;
    }
    if (drag.current) setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
  };
  const onUp = () => {
    const nd = nodeDrag.current;
    if (nd) { if (!nd.moved) setSel(nodes.find(n => n.id === nd.id) ?? null); nodeDrag.current = null; return; }
    drag.current = null;
  };

  const worldW = 1340, worldH = 40 + GAP * 4 + 120;

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 150px)', minHeight: 480, borderRadius: 16, border: `1px solid ${C.border}`, background: `radial-gradient(circle at 1px 1px, #1c1c2e 1px, transparent 0) 0 0/24px 24px, #0a0a14`, overflow: 'hidden' }}>
      {/* Toolbar superior */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
        <div style={{ background: '#0f0f1a', border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 12px', fontSize: 12, color: C.textMuted, pointerEvents: 'auto' }}>
          {mode === 'image'
            ? <>Pipeline · <b style={{ color: C.text }}>1 imagen</b> · recorte + fondo + composición · <b style={{ color: C.accent }}>{cost} créditos</b></>
            : <>Pipeline · <b style={{ color: C.text }}>1 video</b> · imagen OpenAI + video Seedance · <b style={{ color: C.accent }}>{cost} créditos</b></>}
        </div>
        <div style={{ display: 'flex', gap: 8, pointerEvents: 'auto', alignItems: 'center' }}>
          {running ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#0f0f1a', border: `1px solid ${C.amber}66`, borderRadius: 10, padding: '7px 13px', fontSize: 12.5, color: C.text }}>
                <span style={{ width: 13, height: 13, borderRadius: '50%', border: `2px solid ${C.surface2}`, borderTopColor: C.amber, display: 'inline-block', animation: 'cvspin 1s linear infinite' }} />
                <b>Generando…</b>
                <span style={{ color: C.textMuted }}>{mode === 'image'
                  ? (pipe.sceneUrl ? 'listo' : pipe.backgroundUrl ? 'composición' : 'recorte + fondo')
                  : (pipe.imageUrl ? 'video' : pipe.imagePrompt ? 'imagen' : 'prompts')}</span>
              </div>
              {onCancel && <button onClick={onCancel} style={{ ...tbtn, borderColor: C.red, color: C.red }}>✕ Cancelar</button>}
            </>
          ) : (
            <button onClick={onRun} style={{ ...tbtn, background: C.accent, color: '#fff', border: 'none', fontWeight: 700 }}>{done ? (mode === 'image' ? '↻ Regenerar imagen' : '↻ Regenerar video') : (mode === 'image' ? '▶ Generar imagen' : '▶ Generar video')}</button>
          )}
        </div>
        <style>{`@keyframes cvspin{to{transform:rotate(360deg)}}@keyframes cvbar{0%{left:-42%}100%{left:100%}}@keyframes cvdash{to{stroke-dashoffset:-16}}`}</style>
      </div>

      {/* Lienzo */}
      <div onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} style={{ position: 'absolute', inset: 0, cursor: nodeDrag.current ? 'grabbing' : drag.current ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          {groupRects.map(g => (
            <div key={g.key} style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: 20, border: `1.5px solid ${g.color}44`, background: `${g.color}0d` }}>
              <div style={{ position: 'absolute', top: 10, left: 14, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color }} />{g.label}
              </div>
            </div>
          ))}
          <svg width={worldW} height={worldH} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}>
            {edges.map(([a, b], i) => {
              const t = byId(b);
              const stroke = t.status === 'done' ? C.green : t.status === 'running' ? C.amber : EDGE;
              const animated = t.status === 'running';
              return <path key={i} d={path(byId(a), t)} fill="none" stroke={stroke} strokeWidth={2} opacity={t.status === 'idle' ? 0.5 : 0.9}
                strokeDasharray={animated ? '6 6' : undefined} style={animated ? { animation: 'cvdash 0.6s linear infinite' } : undefined} />;
            })}
          </svg>
          {nodes.map(n => <Node key={n.id} n={n} onDown={onNodeDown} selected={sel?.id === n.id} />)}
        </div>
      </div>

      {/* Minimapa */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 4, width: 150, height: 96, borderRadius: 10, border: `1px solid ${C.border}`, background: '#0f0f1a', overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${worldW} ${worldH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
          {groupRects.map(g => <rect key={g.key} x={g.x} y={g.y} width={g.w} height={g.h} rx={20} fill={`${g.color}18`} stroke={`${g.color}55`} strokeWidth={3} />)}
          {nodes.map(n => <rect key={n.id} x={n.x} y={n.y} width={W} height={H} rx={12} fill={n.status === 'done' ? C.green : n.status === 'running' ? C.amber : '#4a4a6e'} />)}
        </svg>
      </div>

      {/* Zoom */}
      <div style={{ position: 'absolute', bottom: 12, left: 172, zIndex: 4, display: 'flex', gap: 4, background: '#0f0f1a', border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
        <ZBtn onClick={() => setZoom(z => Math.max(0.3, +(z - 0.1).toFixed(2)))}>−</ZBtn>
        <span style={{ fontSize: 12, color: C.textMuted, alignSelf: 'center', minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <ZBtn onClick={() => setZoom(z => Math.min(1.4, +(z + 0.1).toFixed(2)))}>+</ZBtn>
        <ZBtn onClick={() => { setZoom(0.7); setPan({ x: 30, y: 20 }); }}>⤢</ZBtn>
      </div>

      {/* Plantillas / Avatares */}
      {onTemplates && (
        <button onClick={onTemplates} title="Plantillas / Avatares — elegí una persona y reutilizala" style={{ position: 'absolute', bottom: 12, left: 320, zIndex: 4, display: 'flex', alignItems: 'center', gap: 8, background: '#0f0f1a', border: `1px solid ${C.borderBright}`, borderRadius: 10, padding: '9px 14px', color: C.text, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          🧑 Plantillas
        </button>
      )}

      {/* Panel del nodo */}
      {sel && (
        <div style={{ position: 'absolute', top: 54, right: 12, bottom: 12, width: 300, zIndex: 5, background: '#0f0f1a', border: `1px solid ${C.borderBright}`, borderRadius: 14, padding: 16, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{sel.emoji} {sel.title}</div>
            <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          {sel.model && <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'DM Mono',monospace", marginBottom: 12 }}>modelo: <span style={{ color: C.blue }}>{sel.model}</span></div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {sel.badges.map(b => <span key={b} style={{ fontSize: 10, fontWeight: 600, color: C.blue, background: C.blueDim, borderRadius: 6, padding: '2px 7px' }}>{b}</span>)}
          </div>
          {sel.media && <video src={sel.media} controls loop style={{ width: '100%', borderRadius: 10, marginBottom: 12, background: C.surface2 }} />}
          {sel.poster && !sel.media && <img src={sel.poster} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} />}
          {(sel.media || sel.poster) && (
            <button onClick={() => dlNode((sel.media || sel.poster)!, sel.id)} style={{ width: '100%', marginBottom: 12, background: C.accent, color: '#fff', border: 'none', borderRadius: 9, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>⬇ Descargar {sel.media ? 'video' : 'imagen'}</button>
          )}
          {sel.text && <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{sel.text}</div>}
        </div>
      )}
    </div>
  );
}

function Node({ n, onDown, selected }: { n: GNode; onDown: (e: React.MouseEvent, n: GNode) => void; selected: boolean }) {
  const border = selected ? C.accent : n.status === 'running' ? C.amber : n.status === 'done' ? C.green : '#2a2a44';
  const STt: Record<SceneStatus, string> = { idle: 'En espera', running: '● Generando', done: '✓ Listo', error: '✕ Error' };
  const STc: Record<SceneStatus, string> = { idle: C.textMuted, running: C.amber, done: C.green, error: C.red };
  const hasMedia = !!(n.media || n.poster);
  return (
    <div onMouseDown={e => onDown(e, n)} style={{ position: 'absolute', left: n.x, top: n.y, width: W, height: H, background: '#12122a', border: `2px solid ${border}`, borderRadius: 14, overflow: 'hidden', cursor: 'grab', boxShadow: selected ? `0 0 0 3px ${C.accentDim}` : '0 8px 20px -12px #000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid #ffffff10` }}>
        <span style={{ fontSize: 14 }}>{n.emoji}</span>
        <span style={{ fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{n.title}</span>
        {n.model && <span style={{ fontSize: 9.5, fontWeight: 600, color: '#9a9ac2', fontFamily: "'DM Mono',monospace", background: '#ffffff0a', border: '1px solid #ffffff14', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.model}</span>}
      </div>
      <div style={{ flex: 1, background: hasMedia ? '#080814' : '#0d0d1e', position: 'relative', display: hasMedia ? 'grid' : 'block', placeItems: 'center', overflow: 'hidden' }}>
        {n.media ? <video src={n.media} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : n.poster ? <img src={n.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <div style={{ padding: '8px 10px', fontSize: 10.5, lineHeight: 1.45, color: '#b9b9d6', display: '-webkit-box', WebkitLineClamp: 7, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.text}</div>}
        {hasMedia && n.badges.length > 0 && (
          <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {n.badges.slice(0, 2).map(b => <span key={b} style={{ fontSize: 8.5, fontWeight: 600, color: '#cfe0ff', background: '#000a', borderRadius: 5, padding: '1px 5px' }}>{b}</span>)}
          </div>
        )}
        <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, fontWeight: 700, color: STc[n.status], background: '#000000aa', borderRadius: 5, padding: '1px 6px' }}>{STt[n.status]}</span>
        {n.status === 'running' && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: '#0007', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: '42%', background: C.amber, borderRadius: 3, animation: 'cvbar 1.1s ease-in-out infinite' }} />
          </div>
        )}
      </div>
    </div>
  );
}

function ZBtn({ children, onClick }: any) {
  return <button onClick={onClick} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 16 }}>{children}</button>;
}
const tbtn: React.CSSProperties = { background: '#12122a', color: C.text, border: `1px solid ${C.borderBright}`, borderRadius: 10, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' };
