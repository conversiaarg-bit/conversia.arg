import { useEffect, useRef, useState } from 'react';
import { C } from '../../styles/theme';
import { creativeApi, type UgcScene, type Fmt } from '../../api/creative';
import { workspaceApi } from '../../api/workspace';
import CampaignCanvas from './CampaignCanvas';

const toBase64 = (file: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });

type SceneStatus = 'idle' | 'running' | 'done' | 'error';
interface SceneRun { status: SceneStatus; imageUrl?: string; videoUrl?: string }

// Esqueleto para mostrar el canvas poblado antes de que el copiloto planifique
const SKELETON: UgcScene[] = [
  { key: 'hook', title: 'Gancho', seconds: 8, role: '', imagePrompt: '', videoPrompt: '', script: '' },
  { key: 'message', title: 'El mensaje', seconds: 8, role: '', imagePrompt: '', videoPrompt: '', script: '' },
  { key: 'build', title: 'Se construye', seconds: 8, role: '', imagePrompt: '', videoPrompt: '', script: '' },
  { key: 'cta', title: 'CTA', seconds: 8, role: '', imagePrompt: '', videoPrompt: '', script: '' },
];

// Campaña UGC por "nodos": el agente planifica 4 escenas y las genera con IA (Seedance).
export default function UgcCampaign({ costs, credits, setCredits }: { costs: Record<string, number>; credits: number; setCredits: (n: number) => void }) {
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');   // estilo/comandos "/x" aplicados a todas las escenas
  const [imageBase64, setImageBase64] = useState<string | undefined>();
  const [format] = useState<Fmt>('9:16');
  const [plan, setPlan] = useState<{ creator: string; scenes: UgcScene[] } | null>(null);
  const [runs, setRuns] = useState<Record<string, SceneRun>>({});
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sceneCost = costs.ugc_video_10 ?? 10;
  const totalCost = plan ? plan.scenes.length * sceneCost : 0;
  const [creatorKey, setCreatorKey] = useState<string | undefined>();
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  useEffect(() => { workspaceApi.getBrand().then(b => { setCreatorKey(b?.data?.preferredCreator); setAvatarUrl(b?.data?.avatarUrl); }).catch(() => {}); }, []);

  // ── Copiloto (chat que planifica y ejecuta) ────────────────────────────────
  const [messages, setMessages] = useState<{ role: 'user' | 'copilot'; text: string }[]>([
    { role: 'copilot', text: '¡Hola! Soy tu copiloto creativo. Contame qué producto querés promocionar y armo la campaña UGC en 4 escenas.' },
  ]);
  const pushMsg = (role: 'user' | 'copilot', text: string) => setMessages(m => [...m, { role, text }]);

  // El agente pregunta antes de generar (duración)
  const [askDur, setAskDur] = useState(false);
  const [brief, setBrief] = useState('');
  const startCampaign = (b?: string) => { const v = b ?? name; if (v) setName(v); setBrief(v || 'Producto'); setAskDur(true); };
  const DURATIONS = [
    { key: '5', label: '5 segundos', sub: 'El más corto y barato — ideal para Reels y TikTok', rec: true },
    { key: '10', label: '10 segundos', sub: 'Un poco más de tiempo para mostrar el producto' },
    { key: '15', label: '15 segundos', sub: 'Más detalle por escena' },
  ];
  const pickDuration = (d: { key: string; label: string }) => {
    setAskDur(false);
    pushMsg('user', `Duración: ${d.label} por escena`);
    doPlan(brief, +d.key);
  };

  const doPlan = async (overrideName?: string, seconds?: number) => {
    const pName = (overrideName ?? brief ?? name) || 'Producto';
    setErr(null); setPlanning(true);
    pushMsg('copilot', 'Analizando el producto y planificando las escenas…');
    try {
      const p = await creativeApi.ugcPlan({ product: { name: pName }, creatorKey });
      // Aplicamos la duración elegida a todas las escenas (5/10/15 s)
      const secs = Math.min(15, Math.max(5, seconds ?? 10));
      const scenes = p.scenes.map(s => ({ ...s, seconds: secs }));
      setPlan({ ...p, scenes });
      setRuns(Object.fromEntries(scenes.map(s => [s.key, { status: 'idle' as SceneStatus }])));
      pushMsg('copilot', `Listo. Armé una campaña con ${p.scenes.length} escenas (Gancho → Mensaje → Se construye → CTA), protagonizada por ${p.creator}. Cada escena es una imagen de la persona con el producto → video con Seedance.`);
      pushMsg('copilot', `▶ Listo para ejecutar ${p.scenes.length + 2} nodos. Apretá "Generar" cuando quieras.`);
    } catch { setErr('No se pudo planificar la campaña (¿IA configurada?).'); pushMsg('copilot', 'No pude planificar — falta configurar la IA (OpenAI).'); }
    finally { setPlanning(false); }
  };

  const cancelRef = useRef(false);
  const cancelRun = () => { cancelRef.current = true; };
  const runAll = async () => {
    if (!plan) return;
    if (!window.confirm(`Generar la campaña completa usará ${totalCost} créditos (${plan.scenes.length} escenas × ${sceneCost}). Tenés ${credits}. ¿Continuar?`)) return;
    cancelRef.current = false;
    setRunning(true); setErr(null);
    pushMsg('copilot', `Generando la campaña — ${plan.scenes.length} escenas. Te aviso escena por escena…`);
    let anyVideo = false;
    for (let i = 0; i < plan.scenes.length; i++) {
      if (cancelRef.current) { pushMsg('copilot', '⏸ Generación cancelada. Los nodos ya listos quedan guardados.'); break; }
      const scene = plan.scenes[i];
      setRuns(r => ({ ...r, [scene.key]: { ...r[scene.key], status: 'running' } }));
      try {
        const res = await creativeApi.ugcScene({ product: { name: name || 'Producto' }, scene, referenceImage: imageBase64 || avatarUrl, format, brief: cmd });
        setCredits(res.credits);
        if (res.videoUrl) anyVideo = true;
        setRuns(r => ({ ...r, [scene.key]: { status: 'done', imageUrl: res.imageUrl, videoUrl: res.videoUrl || undefined } }));
        pushMsg('copilot', res.videoUrl ? `✓ Escena ${i + 1} (${scene.title}) lista.` : `✓ Escena ${i + 1} (${scene.title}): imagen lista (el video queda pendiente hasta activar Seedance).`);
      } catch (e: any) {
        setRuns(r => ({ ...r, [scene.key]: { ...r[scene.key], status: 'error' } }));
        const sc = e?.response?.data?.message === 'SIN_CREDITOS';
        setErr(sc ? 'Te quedaste sin créditos.' : 'Una escena falló (no se descontaron créditos de esa escena).');
        pushMsg('copilot', sc ? '🪫 Te quedaste sin créditos. Recargá para seguir.' : `La escena ${i + 1} falló (no se descontaron créditos). Podés reintentar.`);
        break;
      }
    }
    if (Object.values(runs).every(r => r.status !== 'error')) {
      pushMsg('copilot', anyVideo
        ? '🎬 Escenas listas. Podés "Ensamblar video final" y guardar la campaña como proyecto.'
        : '🖼️ Imágenes de las escenas listas. Los videos quedan pendientes hasta que actives Seedance — mientras tanto podés descargar/guardar las imágenes.');
    }
    setRunning(false);
  };

  const doneCount = Object.values(runs).filter(r => r.status === 'done').length;
  const [saved, setSaved] = useState(false);
  const viewPlan = plan ?? { creator: 'Tu creador IA', scenes: SKELETON };

  const materialize = (p: typeof plan) => p ?? { creator: 'Tu creador IA', scenes: SKELETON.map(s => ({ ...s })) };
  const addScene = (title?: string) => {
    const key = `extra_${Date.now()}`;
    const scene: UgcScene = { key, title: title || 'Nueva escena', seconds: 8, role: 'Presentador', imagePrompt: `synthetic UGC person with the product ${name || ''}`, videoPrompt: 'natural UGC movement, person showing the product', script: '' };
    setPlan(p => { const b = materialize(p); return { ...b, scenes: [...b.scenes, scene] }; });
    setRuns(r => ({ ...r, [key]: { status: 'idle' } }));
  };
  const deleteScene = (key: string) => {
    setPlan(p => { const b = materialize(p); return { ...b, scenes: b.scenes.filter(s => s.key !== key) }; });
    setRuns(r => { const c = { ...r }; delete c[key]; return c; });
  };
  const setAllDurations = (sec: number) => setPlan(p => { const b = materialize(p); return { ...b, scenes: b.scenes.map(s => ({ ...s, seconds: Math.min(15, Math.max(4, sec)) })) }; });
  const updateScene = (key: string, patch: Partial<UgcScene>) => setPlan(p => { const b = materialize(p); return { ...b, scenes: b.scenes.map(s => s.key === key ? { ...s, ...patch } : s) }; });

  // Regenerar una sola escena
  const runScene = async (i: number) => {
    const scene = plan?.scenes[i];
    if (!scene) { pushMsg('copilot', `No encontré la escena ${i + 1}.`); return; }
    if (!window.confirm(`Generar la escena ${i + 1} usará ${sceneCost} créditos. Tenés ${credits}. ¿Continuar?`)) return;
    setRunning(true); setErr(null);
    setRuns(r => ({ ...r, [scene.key]: { ...r[scene.key], status: 'running' } }));
    pushMsg('copilot', `Generando la escena ${i + 1} (${scene.title})…`);
    try {
      const res = await creativeApi.ugcScene({ product: { name: name || 'Producto' }, scene, referenceImage: imageBase64 || avatarUrl, format, brief: cmd });
      setCredits(res.credits);
      setRuns(r => ({ ...r, [scene.key]: { status: 'done', imageUrl: res.imageUrl, videoUrl: res.videoUrl || undefined } }));
      pushMsg('copilot', `✓ Escena ${i + 1} lista.`);
    } catch (e: any) {
      setRuns(r => ({ ...r, [scene.key]: { ...r[scene.key], status: 'error' } }));
      pushMsg('copilot', e?.response?.data?.message === 'SIN_CREDITOS' ? '🪫 Te quedaste sin créditos.' : `La escena ${i + 1} falló (no se descontaron créditos).`);
    } finally { setRunning(false); }
  };

  // Foto de un nuevo artículo: pasa a ser la referencia de producto y reinicia los nodos para regenerarlos
  const applyNewProduct = (b64: string, label?: string) => {
    setImageBase64(b64);
    if (label) setName(label);
    setRuns(r => Object.fromEntries(Object.keys(r).map(k => [k, { status: 'idle' as SceneStatus }])));
    setFinalVideoUrl(undefined);
  };
  const onCopilotAttach = async (file: File) => {
    const b64 = await toBase64(file);
    const nice = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const prev = name;
    pushMsg('user', `📎 ${file.name} — hacelo con este artículo`);
    applyNewProduct(b64, nice);
    pushMsg('copilot', `Veo que subiste una nueva imagen de producto${nice ? ` (${nice})` : ''}. Voy a rehacer el anuncio con este artículo${prev ? ` en lugar de ${prev}` : ''}: lo puse como referencia en el nodo Producto y reinicié las escenas para regenerarlas. Escribí "ejecutá todo" y genero los videos con este producto.`);
  };

  // ── El Copiloto interpreta y construye/edita los nodos por chat ──────────────
  const recommend = () => {
    if (!plan) return 'Contame el producto y un beneficio clave y armo el flujo Gancho → Mensaje → Se construye → CTA. Tip: subí una foto del producto (📷 arriba) para que la persona lo sostenga en cada escena.';
    if (doneCount === 0) return `Tu flujo tiene ${plan.scenes.length} escenas. Te recomiendo: un gancho de 3s con una pregunta, mostrar el producto en la escena 2 y un CTA claro al final. ¿Sumo una escena de prueba social? Escribí: "agregá una escena de testimonio".`;
    if (doneCount < plan.scenes.length) return `Vas ${doneCount}/${plan.scenes.length} escenas. Podés seguir con "ejecutá todo" o ajustar una escena antes de generarla.`;
    return 'Ya tenés todas las escenas listas. Escribí "ensamblá" para unir el video final, o guardá la campaña como proyecto.';
  };
  const extractTitle = (t: string) => {
    const m = t.match(/(?:escena|nodo|toma|clip)\s+(?:de|sobre|con|para)\s+(.+)/i) || t.match(/(?:de|sobre)\s+(.+)/i);
    const s = m?.[1]?.trim().replace(/[.!?]+$/, '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined;
  };
  const handleCopilot = (raw: string) => {
    const t = raw.trim(); if (!t) return;
    const s = t.toLowerCase();
    const scenesNow = plan ? plan.scenes : SKELETON;
    // Ejecutar / ensamblar
    if (/\b(gener|ejecut|corr[ée]|render|dale ya)/.test(s)) { pushMsg('user', t); if (!plan) pushMsg('copilot', 'Todavía no armé los nodos con contenido real. Decime el producto y los creo; después los ejecutamos.'); else { pushMsg('copilot', `Perfecto, ejecuto los ${plan.scenes.length} nodos ahora.`); runAll(); } return; }
    if (/\b(ensambl|uni[rí]|video final|junt[aá])/.test(s)) { pushMsg('user', t); pushMsg('copilot', 'Ensamblando el video final con las escenas listas…'); assembleFinal(); return; }
    // Recomendaciones
    if (/(recomend|consej|ayuda|suger|mejor|idea|qu[eé] hago)/.test(s)) { pushMsg('user', t); pushMsg('copilot', recommend()); return; }
    // Borrar escena N
    const idx = s.match(/escena\s*(\d+)/);
    if (idx && /(borr|elimin|saca|quit)/.test(s)) { const i = +idx[1] - 1; pushMsg('user', t); if (scenesNow[i]) { deleteScene(scenesNow[i].key); pushMsg('copilot', `Listo, saqué la escena ${i + 1}. Quedan ${scenesNow.length - 1} nodos en Generación.`); } else pushMsg('copilot', `No encontré la escena ${i + 1}.`); return; }
    // Editar una escena puntual (renombrar / guion / visual / duración / regenerar)
    if (idx) {
      const i = +idx[1] - 1; const sc = scenesNow[i];
      if (!sc) { pushMsg('user', t); pushMsg('copilot', `No encontré la escena ${i + 1}.`); return; }
      const cap = (x: string) => { const v = x.trim().replace(/[.!?]+$/, ''); return v.charAt(0).toUpperCase() + v.slice(1); };
      if (/(regener|volv[eé] a gener|rehac[eé]|gener[aá] de nuevo)/.test(s)) { pushMsg('user', t); if (!plan) pushMsg('copilot', 'Primero armá los nodos con un producto y después regeneramos.'); else runScene(i); return; }
      let m = t.match(/(?:renombr\w*|llam\w*|titul\w*)\s+(?:la\s+)?escena\s*\d+\s*(?:a|como|:)\s*(.+)/i);
      if (m) { const title = cap(m[1]); pushMsg('user', t); updateScene(sc.key, { title }); pushMsg('copilot', `Renombré la escena ${i + 1} a "${title}".`); return; }
      m = t.match(/(?:gui[oó]n|di[gj]a|texto|frase)[^:]*[:]\s*(.+)/i) || (/(gui[oó]n|di[gj]a|texto|frase)/i.test(s) ? t.match(/(?:que\s+diga|:)\s*["“]?(.+?)["”]?$/i) : null);
      if (m && /(gui[oó]n|di[gj]a|texto|frase)/i.test(s)) { const script = m[1].trim(); pushMsg('user', t); updateScene(sc.key, { script }); pushMsg('copilot', `Actualicé el guion de la escena ${i + 1}: “${script}”.`); return; }
      const ds = s.match(/(\d{1,2})\s*(?:s|seg)/);
      if (ds) { const sec = Math.min(15, Math.max(4, +ds[1])); pushMsg('user', t); updateScene(sc.key, { seconds: sec }); pushMsg('copilot', `La escena ${i + 1} ahora dura ${sec}s.`); return; }
      m = t.match(/(?:muestre?|mostr\w+|se\s+vea|aparezca|con|en\s+primer\s+plano|estilo)\s+(.+)/i);
      if (m) { const vis = m[1].trim(); pushMsg('user', t); updateScene(sc.key, { imagePrompt: `synthetic UGC person with the product ${name || ''}, ${vis}`, videoPrompt: `${vis}, natural UGC movement` }); pushMsg('copilot', `Actualicé la escena ${i + 1}: ${vis}.`); return; }
      pushMsg('user', t); pushMsg('copilot', `Sobre la escena ${i + 1} puedo: renombrarla, cambiar el guion ("cambiá el guion de la escena ${i + 1}: ..."), el visual ("que muestre ..."), la duración ("de 10s") o regenerarla.`); return;
    }
    // Duración
    const secM = s.match(/(\d{1,2})\s*(?:s|seg)/);
    const longer = /(m[aá]s largo|extend|dura m[aá]s)/.test(s), shorter = /(m[aá]s corto|acort)/.test(s);
    if (secM || longer || shorter) {
      pushMsg('user', t);
      const per = secM ? Math.round(+secM[1] / scenesNow.length) : (materialize(plan).scenes[0].seconds + (longer ? 2 : -2));
      setAllDurations(per);
      pushMsg('copilot', `Ajusté cada escena a ~${Math.min(15, Math.max(4, per))}s (${Math.min(15, Math.max(4, per)) * scenesNow.length}s en total aprox).`);
      return;
    }
    // Agregar escena
    if (/(agreg|sum[aá]|añad|otra|nuev|incorpor)/.test(s) && /(escena|nodo|toma|clip|parte)/.test(s)) {
      const title = extractTitle(t); pushMsg('user', t); addScene(title);
      pushMsg('copilot', `Agregué una escena${title ? ` de "${title}"` : ''} al grupo Generación. Podés editarla tocando el nodo, o decime otra.`);
      return;
    }
    // Por defecto: es el producto → planificamos
    pushMsg('user', t); setName(t); startCampaign(t);
    pushMsg('copilot', `¡Buenísimo, "${t}"! Elegí la duración arriba y armo los nodos (Gancho → Mensaje → Se construye → CTA).`);
  };

  const [finalVideoUrl, setFinalVideoUrl] = useState<string | undefined>();
  const [assembling, setAssembling] = useState(false);
  const assembleFinal = async () => {
    if (!plan) return;
    const urls = plan.scenes.map(s => runs[s.key]?.videoUrl).filter(Boolean) as string[];
    if (!urls.length) return;
    setAssembling(true); setErr(null);
    try { const r = await creativeApi.assembleFinal(urls); setFinalVideoUrl(r.videoUrl); }
    catch { setErr('No se pudo ensamblar el video final.'); }
    finally { setAssembling(false); }
  };

  const saveProject = async () => {
    if (!plan) return;
    const first = plan.scenes.map(s => runs[s.key]).find(r => r?.videoUrl || r?.imageUrl);
    try {
      await workspaceApi.createProject({
        name: `Campaña UGC — ${name || 'Producto'}`, type: 'ugc_campaign',
        thumbnailUrl: first?.videoUrl || first?.imageUrl,
        creditsUsed: doneCount * sceneCost,
        data: { product: { name }, creator: plan.creator, scenes: plan.scenes.map(s => ({ ...s, ...(runs[s.key] || {}) })) },
      });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch { setErr('No se pudo guardar el proyecto.'); }
  };

  return (
    <div style={{ padding: '16px clamp(12px,2vw,24px)', color: C.text }}>
      {/* Barra superior: título + producto compacto */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ marginRight: 'auto' }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 19 }}>🎬 Campaña UGC · Canvas</div>
          <div style={{ color: C.textMuted, fontSize: 12.5 }}>{plan ? <>Creador <b style={{ color: C.text }}>{plan.creator}</b> · {plan.scenes.length} escenas · <b style={{ color: C.accent }}>{totalCost} créditos</b> · {doneCount}/{plan.scenes.length} listas</> : 'El Copiloto arma los nodos por vos. Contale tu producto en el chat →'}</div>
        </div>
        <div onClick={() => fileRef.current?.click()} title="Imagen del producto" style={{ width: 44, height: 44, borderRadius: 10, border: `1.5px dashed ${C.borderBright}`, background: C.surface, display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden', flexShrink: 0 }}>
          {imageBase64 ? <img src={imageBase64} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18 }}>📷</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async e => e.target.files?.[0] && setImageBase64(await toBase64(e.target.files[0]))} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Producto…" style={{ width: 160, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
        <input value={cmd} onChange={e => setCmd(e.target.value)} title="Estilo o comandos /x que se aplican a TODAS las escenas (ej: /ad /appetite /studio)" placeholder="Estilo / comandos: /ad /appetite /studio…" style={{ width: 230, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
        <Btn onClick={() => startCampaign()} disabled={planning || (!name && !imageBase64)}>{planning ? 'Planeando…' : plan ? 'Replanificar' : '🤖 Planificar'}</Btn>
        {doneCount > 0 && <button onClick={saveProject} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}>{saved ? '✓ Guardado' : '💾 Guardar'}</button>}
      </div>

      {askDur && (
        <div style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 16, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: C.grad, display: 'grid', placeItems: 'center', fontSize: 13 }}>✨</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>¿Cuánto debe durar el video UGC?</div>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {DURATIONS.map(d => (
              <button key={d.key} onClick={() => pickDuration(d)} className="cv-lift" style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 11, cursor: 'pointer', background: d.rec ? C.accentDim : C.surface2, border: `1.5px solid ${d.rec ? C.accent : C.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.label} {d.rec && <span style={{ color: C.accent, fontSize: 11 }}>· Recomendado</span>}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{d.sub}</div>
                </div>
                <span style={{ color: C.textMuted }}>→</span>
              </button>
            ))}
          </div>
          <button onClick={() => setAskDur(false)} style={{ marginTop: 10, background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 12 }}>Cancelar</button>
        </div>
      )}

      {err && <div style={{ background: C.redDim, border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>⚠️ {err}</div>}

      {/* Canvas de nodos + Copiloto (siempre visible) */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }} className="canvas-copilot">
        <div style={{ flex: 1, minWidth: 0 }}>
          <CampaignCanvas plan={viewPlan} runs={runs} running={running} totalCost={totalCost} productImage={imageBase64} productName={name}
            onRunAll={plan ? runAll : () => pushMsg('copilot', 'Primero contame qué producto querés promocionar (escribilo en el chat) y armo los nodos por vos.')}
            onAddScene={addScene} onDeleteScene={deleteScene} finalVideoUrl={finalVideoUrl} assembling={assembling} onAssemble={assembleFinal} onCancel={cancelRun} />
        </div>
        <CopilotPanel messages={messages} running={running || planning} planned={!!plan} onGenerate={runAll} onSend={handleCopilot} onAttach={onCopilotAttach} />
      </div>
    </div>
  );
}

function CopilotPanel({ messages, running, planned, onGenerate, onSend, onAttach }: { messages: { role: 'user' | 'copilot'; text: string }[]; running: boolean; planned: boolean; onGenerate: () => void; onSend: (t: string) => void; onAttach: (f: File) => void }) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const send = () => { const t = text.trim(); if (!t) return; setText(''); onSend(t); };
  return (
    <aside className="cv-card copilot-panel" style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, height: 'calc(100vh - 210px)', minHeight: 420 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: C.grad, display: 'grid', placeItems: 'center', fontSize: 14 }}>✨</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Copiloto</div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted }}>{running ? 'trabajando…' : 'en línea'}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', background: m.role === 'user' ? C.accent : C.surface2, color: m.role === 'user' ? '#fff' : C.text, borderRadius: 12, padding: '9px 12px', fontSize: 13, lineHeight: 1.5, border: m.role === 'user' ? 'none' : `1px solid ${C.border}` }}>{m.text}</div>
        ))}
        {!planned && !running && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 600, letterSpacing: 0.3 }}>¿Qué querés crear?</div>
            {[
              { ic: '🎬', t: 'Anuncio UGC con un presentador', send: 'Quiero un anuncio UGC con un presentador de mi producto' },
              { ic: '🖼️', t: 'Anuncio de imagen de mi producto', send: 'Quiero un anuncio de imagen de mi producto' },
              { ic: '✍️', t: 'Ya tengo un guion', send: 'Ya tengo un guion para el anuncio' },
              { ic: '📦', t: 'Mostrar mi producto en video', send: 'Quiero un video mostrando mi producto' },
            ].map(q => (
              <button key={q.t} onClick={() => onSend(q.send)} className="cv-lift" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 11, padding: '10px 12px', color: C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: C.accentDim, display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>{q.ic}</span>{q.t}
              </button>
            ))}
          </div>
        )}
        {running && <div style={{ alignSelf: 'flex-start', color: C.textMuted, fontSize: 13, padding: '4px 8px' }}>● ● ●</div>}
        <div ref={endRef} />
      </div>
      {planned && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
          <button onClick={onGenerate} disabled={running} style={{ width: '100%', background: C.grad, color: '#fff', border: 'none', borderRadius: 11, padding: '11px', fontWeight: 700, fontSize: 14, cursor: running ? 'wait' : 'pointer', opacity: running ? 0.6 : 1 }}>{running ? 'Generando…' : '▶ Generar campaña'}</button>
        </div>
      )}
      <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={attachRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onAttach(f); e.currentTarget.value = ''; }} />
        <button onClick={() => attachRef.current?.click()} disabled={running} title="Adjuntar foto de un artículo" style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, width: 38, height: 38, flexShrink: 0, cursor: 'pointer', fontSize: 16, opacity: running ? 0.5 : 1 }}>📎</button>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Pedile al Copiloto: crear, editar un nodo, o adjuntá un artículo…" style={{ flex: 1, minWidth: 0, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
        <button onClick={send} disabled={running || !text.trim()} style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '0 14px', height: 38, fontWeight: 700, cursor: 'pointer', opacity: running || !text.trim() ? 0.5 : 1 }}>↑</button>
      </div>
    </aside>
  );
}

function Btn({ children, onClick, disabled }: any) {
  return <button onClick={onClick} disabled={disabled} style={{ padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, border: 'none', background: C.accent, color: '#fff', whiteSpace: 'nowrap' }}>{children}</button>;
}
