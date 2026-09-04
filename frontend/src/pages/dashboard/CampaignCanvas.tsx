import { useRef, useState } from 'react';
import { C } from '../../styles/theme';
import type { UgcScene } from '../../api/creative';

type SceneStatus = 'idle' | 'running' | 'done' | 'error';
interface SceneRun { status: SceneStatus; imageUrl?: string; videoUrl?: string }

type GroupKey = 'entrada' | 'generacion' | 'salida';
interface GNode { id: string; x: number; y: number; group: GroupKey; emoji: string; title: string; model?: string; badges: string[]; status: SceneStatus; media?: string; poster?: string; text?: string; scene?: UgcScene }

const W = 210, H = 156;
const GROUPS: { key: GroupKey; label: string; color: string }[] = [
  { key: 'entrada', label: 'Entrada', color: '#4da6ff' },
  { key: 'generacion', label: 'Generación', color: '#7c5cfc' },
  { key: 'salida', label: 'Salida', color: '#00d68f' },
];
const EDGE = '#2ee6c4'; // teal de los conectores

// Descargar la media de un nodo (imagen o video) como archivo
async function dlNode(url: string, name: string) {
  try {
    const r = await fetch(url); const b = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = name + (b.type.includes('video') ? '.mp4' : '.png');
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  } catch { window.open(url, '_blank'); }
}

// Canvas de flujo estilo pipeline: Entrada → Generación → Salida.
// Cada nodo lleva su modelo de IA en el header; nodos de texto o de media; Copiloto externo.
export default function CampaignCanvas({ plan, runs, running, onRunAll, totalCost, onAddScene, onDeleteScene, finalVideoUrl, assembling, onAssemble, productImage, productName, onCancel }: {
  plan: { creator: string; scenes: UgcScene[] };
  runs: Record<string, SceneRun>;
  running: boolean;
  onRunAll: () => void;
  totalCost: number;
  onAddScene: () => void;
  onDeleteScene: (key: string) => void;
  finalVideoUrl?: string;
  assembling?: boolean;
  onAssemble?: () => void;
  productImage?: string;
  productName?: string;
  onCancel?: () => void;
}) {
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [sel, setSel] = useState<GNode | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const doneCount = plan.scenes.filter(s => runs[s.key]?.status === 'done').length;
  const runningCount = plan.scenes.filter(s => runs[s.key]?.status === 'running').length;
  const queued = Math.max(0, plan.scenes.length - doneCount - runningCount);

  // ── Layout en 3 columnas (Entrada → Generación → Salida) ──
  const IN_X = 40, GEN_X = 380, OUT_X = 760, GAP = 172;
  const nodes: GNode[] = [];
  // Entrada
  nodes.push({ id: 'product', x: IN_X, y: 40, group: 'entrada', emoji: '📦', title: 'Imagen de producto', model: 'Referencia', badges: ['imagen'], status: 'done', poster: productImage, text: productImage ? undefined : 'Subí una foto del producto' });
  nodes.push({ id: 'desc', x: IN_X, y: 40 + GAP, group: 'entrada', emoji: '📝', title: 'Descripción de producto', model: 'Static', badges: [], status: 'done', text: productName || 'Tu producto' });
  nodes.push({ id: 'char', x: IN_X, y: 40 + GAP * 2, group: 'entrada', emoji: '🧑‍🎤', title: 'Descripción de personaje', model: 'Static', badges: [], status: 'done', text: plan.creator });
  // Generación (una por escena)
  plan.scenes.forEach((s, i) => {
    const run = runs[s.key] ?? { status: 'idle' as SceneStatus };
    nodes.push({
      id: s.key, x: GEN_X, y: 40 + i * GAP, group: 'generacion',
      emoji: ['🎣', '💬', '⚡', '🎯'][i] ?? '🎬',
      title: `Escena ${i + 1} · ${s.title}`, model: 'Seedance 1.5 Pro',
      badges: ['gpt-image-2', 'Seedance'], status: run.status,
      media: run.videoUrl, poster: run.imageUrl,
      text: s.script || s.imagePrompt || `Persona con el producto — ${s.seconds}s`, scene: s,
    });
  });
  // Salida
  const finalDone = doneCount === plan.scenes.length && plan.scenes.length > 0;
  const cy = 40 + Math.max(0, (plan.scenes.length - 1) * GAP) / 2;
  nodes.push({ id: 'final', x: OUT_X, y: cy, group: 'salida', emoji: '🎞️', title: 'Video final', model: 'Ensamblado', badges: ['9:16'], status: finalVideoUrl ? 'done' : assembling ? 'running' : 'idle', media: finalVideoUrl, text: finalVideoUrl ? undefined : '9:16 · con subtítulos' });

  nodes.forEach(n => { const p = positions[n.id]; if (p) { n.x = p.x; n.y = p.y; } });

  const byId = (id: string) => nodes.find(n => n.id === id)!;
  const edges: [string, string][] = [];
  plan.scenes.forEach(s => { edges.push(['product', s.key]); edges.push(['desc', s.key]); edges.push(['char', s.key]); edges.push([s.key, 'final']); });

  // Rects de grupo calculados de sus nodos
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

  const worldW = 1010, worldH = Math.max(600, 40 + plan.scenes.length * GAP + 160);

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 150px)', minHeight: 480, borderRadius: 16, border: `1px solid ${C.border}`, background: `radial-gradient(circle at 1px 1px, #1c1c2e 1px, transparent 0) 0 0/24px 24px, #0a0a14`, overflow: 'hidden' }}>
      {/* Toolbar superior */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
        <div style={{ background: '#0f0f1a', border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 12px', fontSize: 12, color: C.textMuted, pointerEvents: 'auto' }}>
          Flujo · <b style={{ color: C.text }}>{nodes.length} nodos</b> · {doneCount}/{plan.scenes.length} escenas · <b style={{ color: C.accent }}>{totalCost} créditos</b>
        </div>
        <div style={{ display: 'flex', gap: 8, pointerEvents: 'auto', alignItems: 'center' }}>
          {running ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#0f0f1a', border: `1px solid ${C.amber}66`, borderRadius: 10, padding: '7px 13px', fontSize: 12.5, color: C.text }}>
                <span style={{ width: 13, height: 13, borderRadius: '50%', border: `2px solid ${C.surface2}`, borderTopColor: C.amber, display: 'inline-block', animation: 'cvspin 1s linear infinite' }} />
                <b>{doneCount}/{plan.scenes.length}</b>
                <span style={{ color: C.amber }}>· {runningCount} generando</span>
                {queued > 0 && <span style={{ color: C.textMuted }}>· {queued} en cola</span>}
              </div>
              {onCancel && <button onClick={onCancel} style={{ ...tbtn, borderColor: C.red, color: C.red }}>✕ Cancelar</button>}
            </>
          ) : (
            <>
              <button onClick={() => onAddScene()} style={tbtn}>+ Nodo</button>
              {finalDone && !finalVideoUrl && onAssemble && <button onClick={onAssemble} disabled={assembling} style={{ ...tbtn, background: C.gradGreen, color: '#04140d', border: 'none', fontWeight: 700 }}>{assembling ? 'Ensamblando…' : '🎬 Ensamblar'}</button>}
              <button onClick={onRunAll} style={{ ...tbtn, background: C.accent, color: '#fff', border: 'none', fontWeight: 700 }}>▶ Ejecutar todo</button>
            </>
          )}
        </div>
        <style>{`@keyframes cvspin{to{transform:rotate(360deg)}}@keyframes cvbar{0%{left:-42%}100%{left:100%}}@keyframes cvdash{to{stroke-dashoffset:-16}}`}</style>
      </div>

      {/* Lienzo */}
      <div onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} style={{ position: 'absolute', inset: 0, cursor: nodeDrag.current ? 'grabbing' : drag.current ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          {/* Grupos */}
          {groupRects.map(g => (
            <div key={g.key} style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: 20, border: `1.5px solid ${g.color}44`, background: `${g.color}0d` }}>
              <div style={{ position: 'absolute', top: 10, left: 14, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color }} />{g.label}
              </div>
            </div>
          ))}
          {/* Edges */}
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
            <button onClick={() => dlNode((sel.media || sel.poster)!, `escena-${sel.id}`)} style={{ width: '100%', marginBottom: 12, background: C.accent, color: '#fff', border: 'none', borderRadius: 9, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>⬇ Descargar {sel.media ? 'video' : 'imagen'}</button>
          )}
          {sel.scene ? (
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}><b style={{ color: C.text }}>Guion:</b> {sel.scene.script || '—'}</p>
              <p style={{ margin: '0 0 8px', fontSize: 12 }}><b style={{ color: C.text }}>Escena:</b> {sel.scene.imagePrompt || '—'}</p>
              <p style={{ margin: '0 0 14px', fontSize: 12 }}><b style={{ color: C.text }}>Movimiento:</b> {sel.scene.videoPrompt || '—'}</p>
              <button onClick={() => { onDeleteScene(sel.scene!.key); setSel(null); }} style={{ background: 'transparent', border: `1px solid ${C.red}`, color: C.red, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🗑 Borrar nodo</button>
            </div>
          ) : sel.text ? <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>{sel.text}</div> : null}
        </div>
      )}
    </div>
  );
}

function Node({ n, onDown, selected }: { n: GNode; onDown: (e: React.MouseEvent, n: GNode) => void; selected: boolean }) {
  const border = selected ? C.accent : n.status === 'running' ? C.amber : n.status === 'done' ? C.green : '#2a2a44';
  const STt: Record<SceneStatus, string> = { idle: 'Planificado', running: '● Generando', done: '✓ Listo', error: '✕ Error' };
  const STc: Record<SceneStatus, string> = { idle: C.textMuted, running: C.amber, done: C.green, error: C.red };
  const hasMedia = !!(n.media || n.poster);
  return (
    <div onMouseDown={e => onDown(e, n)} style={{ position: 'absolute', left: n.x, top: n.y, width: W, height: H, background: '#12122a', border: `2px solid ${border}`, borderRadius: 14, overflow: 'hidden', cursor: 'grab', boxShadow: selected ? `0 0 0 3px ${C.accentDim}` : '0 8px 20px -12px #000', display: 'flex', flexDirection: 'column' }}>
      {/* Header: emoji + título (izq) · modelo (der) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid #ffffff10` }}>
        <span style={{ fontSize: 14 }}>{n.emoji}</span>
        <span style={{ fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{n.title}</span>
        {n.model && <span style={{ fontSize: 9.5, fontWeight: 600, color: '#9a9ac2', fontFamily: "'DM Mono',monospace", background: '#ffffff0a', border: '1px solid #ffffff14', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.model}</span>}
      </div>
      {/* Cuerpo: media o texto */}
      <div style={{ flex: 1, background: hasMedia ? '#080814' : '#0d0d1e', position: 'relative', display: hasMedia ? 'grid' : 'block', placeItems: 'center', overflow: 'hidden' }}>
        {n.media ? <video src={n.media} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : n.poster ? <img src={n.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ padding: '8px 10px', fontSize: 10.5, lineHeight: 1.45, color: '#b9b9d6', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.text}</div>}
        {/* Badges de modelo secundarios (solo en nodos con media) */}
        {hasMedia && n.badges.length > 0 && (
          <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {n.badges.slice(0, 2).map(b => <span key={b} style={{ fontSize: 8.5, fontWeight: 600, color: '#cfe0ff', background: '#000a', borderRadius: 5, padding: '1px 5px' }}>{b}</span>)}
          </div>
        )}
        {/* Estado (esquina) */}
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
