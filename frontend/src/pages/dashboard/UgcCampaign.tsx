import { useEffect, useRef, useState } from 'react';
import { C } from '../../styles/theme';
import { creativeApi, type UgcScene, type Fmt } from '../../api/creative';
import { workspaceApi } from '../../api/workspace';
import CampaignCanvas, { type Pipe } from './CampaignCanvas';

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

// Cache en memoria: mantiene la campaña (nodos, imágenes, config) al navegar y volver.
// No se borra al cambiar de sección; solo se pierde al recargar la página (las imágenes
// igual quedan en "Mis creativos"). Vive fuera del componente para sobrevivir el re-montaje.
const ugcCache: { s?: any } = {};

// Campaña UGC por "nodos": el agente planifica 4 escenas y las genera con IA (Seedance).
export default function UgcCampaign({ costs, credits, setCredits, vqOptions = [], vq = 'economico', setVq }: { costs: Record<string, number>; credits: number; setCredits: (n: number) => void; vqOptions?: any[]; vq?: string; setVq?: (k: string) => void }) {
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');   // estilo/comandos "/x" aplicados a todas las escenas
  const [avatar, setAvatar] = useState('');  // descripción del avatar/persona
  const [hd, setHd] = useState(false);  // Producto exacto (alta fidelidad, cuesta más)
  // Galería de Plantillas / Avatares
  const [selectedAvatar, setSelectedAvatar] = useState<string | undefined>();
  const [avatarLib, setAvatarLib] = useState<string[]>([]);
  const [uploadedAvatars, setUploadedAvatars] = useState<string[]>([]);
  const [showAvatars, setShowAvatars] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const selfAvatarRef = useRef<HTMLInputElement>(null);
  const loadAvatars = () => creativeApi.list().then((items: any[]) => {
    // Todas las escenas con imagen (sirve de referencia del avatar; incluye las que ya tienen video)
    const imgs = (items || []).filter(it => it.output_url).map(it => it.output_url);
    setAvatarLib(imgs.slice(0, 60));
  }).catch(() => {});
  const uploadAvatar = async (f: File) => { const b64 = await toBase64(f); setUploadedAvatars(l => [b64, ...l]); setSelectedAvatar(b64); };
  const [imageBase64, setImageBase64] = useState<string | undefined>();
  const [productImages, setProductImages] = useState<string[]>([]); // varias fotos → combos
  const [comboImage, setComboImage] = useState<string | undefined>(); // imagen combo generada (todos los productos juntos)
  const [comboLoading, setComboLoading] = useState(false);
  const [pipe, setPipe] = useState<Pipe>({}); // pipeline único: prompts + imagen + 1 video
  const [videoDur, setVideoDur] = useState<'5' | '10'>('5');
  const [pkg, setPkg] = useState<any>(null);   // paquete de ads (hooks/copy/variaciones)
  const [pkgLoading, setPkgLoading] = useState(false);
  const [showPkg, setShowPkg] = useState(false);
  const [adScript, setAdScript] = useState('');   // guion elegido de una variación → lo dice el video
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
  useEffect(() => { loadAvatars(); }, [running]); // recarga la galería al montar y al terminar de generar // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── PIPELINE ÚNICO: 1 solo video (OpenAI prompts + imagen → Seedance video) ──
  const vqOpt = (vqOptions ?? []).find((o: any) => o.key === vq) ?? (vqOptions ?? [])[0];
  const oneShotCost = (videoDur === '10' ? vqOpt?.credits10 : vqOpt?.credits5) ?? (videoDur === '10' ? 6 : 3);
  const runOneShot = async () => {
    // Para generar la persona con el producto EXACTO, gpt-image-1 necesita las fotos
    // INDIVIDUALES (no un collage): con un collage no puede aislar un producto y termina
    // inventando uno. El combo recortado se muestra igual (el prompt pide todos los productos).
    const productRef = productImages[0] || imageBase64 || comboImage;
    if (!productRef && productImages.length === 0) { pushMsg('copilot', 'Primero subí al menos una foto del producto (📎 acá o 📷 arriba).'); return; }
    const refsArr = productImages.length > 1 ? productImages : undefined;
    if (!window.confirm(`Generar el video usará ${oneShotCost} créditos (imagen con OpenAI + 1 video con Seedance). Tenés ${credits}. ¿Continuar?`)) return;
    setRunning(true); setErr(null); setPipe({});
    pushMsg('copilot', 'Generando: OpenAI arma el prompt de imagen y de video, crea la imagen del personaje con el producto, y Seedance hace el video…');
    try {
      const res = await creativeApi.ugcOneShot({ product: { name: name || 'Producto' }, referenceImage: productRef, referenceImages: refsArr, avatarImage: selectedAvatar, avatarDesc: avatar, brief: cmd, scriptOverride: adScript || undefined, quality: hd ? 'premium' : undefined, videoQuality: vq, format, duration: videoDur });
      setCredits(res.credits);
      setPipe({ productData: (res as any).productData, imagePrompt: res.imagePrompt, videoPrompt: res.videoPrompt, script: res.script, imageUrl: res.imageUrl, videoUrl: res.videoUrl || undefined });
      pushMsg('copilot', res.videoUrl ? '🎥 Video listo — descargalo desde el nodo Video.' : '🖼️ Imagen lista (el video queda pendiente hasta activar Seedance).');
    } catch (e: any) {
      const sc = e?.response?.data?.message === 'SIN_CREDITOS';
      setErr(sc ? 'Te quedaste sin créditos.' : 'Falló la generación (no se descontaron créditos).');
      pushMsg('copilot', sc ? '🪫 Te quedaste sin créditos.' : 'Falló la generación (no se descontaron créditos). Reintentá.');
    } finally { setRunning(false); }
  };

  const doneCount = Object.values(runs).filter(r => r.status === 'done').length;
  const [saved, setSaved] = useState(false);

  // Mantener la campaña al navegar: restaurar al montar + guardar en cada cambio (en memoria).
  const restored = useRef(false);
  useEffect(() => {
    const c = ugcCache.s;
    if (c && !restored.current) {
      if (c.plan) setPlan(c.plan);
      if (c.runs) setRuns(c.runs);
      if (c.name) setName(c.name);
      if (c.cmd) setCmd(c.cmd);
      if (c.avatar) setAvatar(c.avatar);
      if (c.hd) setHd(c.hd);
      if (c.selectedAvatar) setSelectedAvatar(c.selectedAvatar);
      if (c.imageBase64) setImageBase64(c.imageBase64);
      if (Array.isArray(c.productImages)) setProductImages(c.productImages);
      if (c.comboImage) setComboImage(c.comboImage);
      if (Array.isArray(c.messages) && c.messages.length > 1) setMessages(c.messages);
    }
    restored.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; return; } // no pisar el cache en el montaje
    ugcCache.s = { plan, runs, name, cmd, avatar, hd, selectedAvatar, imageBase64, productImages, comboImage, messages };
  }, [plan, runs, name, cmd, avatar, hd, selectedAvatar, imageBase64, productImages, comboImage, messages]);

  // Comandos recomendados según el producto (heurística, sin costo)
  const recCmds = (() => {
    const t = (name || '').toLowerCase();
    const c = new Set<string>(['/product', '/ad', '/appetite', '/studio', '/closeup']);
    if (/premium|luxury|elegante/.test(t)) ['/premium', '/dramatic'].forEach(x => c.add(x));
    if (/snack|papa|chip|comida|food|bebida|dulce|galle|pizza|hamburg|caf/.test(t)) ['/delicious', '/fresh', '/crispy'].forEach(x => c.add(x));
    c.add('/hyperreal'); c.add('/scroll-stopping');
    return [...c].slice(0, 9);
  })();

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
      const res = await creativeApi.ugcScene({ product: { name: name || 'Producto' }, scene, referenceImage: imageBase64 || avatarUrl, referenceImages: (!comboImage && productImages.length > 1) ? productImages : undefined, format, brief: cmd, quality: hd ? 'premium' : undefined, avatarDesc: avatar, avatarImage: selectedAvatar, videoQuality: vq });
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
    setPipe({});
  };
  const onCopilotAttach = async (files: File[]) => {
    const list = Array.isArray(files) ? files : [files];
    const b64s = await Promise.all(list.map(toBase64));
    setComboImage(undefined); // nuevas fotos → el combo anterior ya no aplica
    setProductImages(prev => {
      const all = [...prev, ...b64s];
      applyNewProduct(all[0], list[0]?.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
      return all;
    });
    pushMsg('user', `📎 ${list.map(f => f.name).join(', ')}`);
    const total = productImages.length + b64s.length;
    pushMsg('copilot', total > 1
      ? `Subiste ${total} artículos. Tocá "🧩 Generar combo" (arriba, junto a las miniaturas) para unirlos en UNA sola imagen con todos los productos juntos, y después la persona la muestra en el video. O escribí "ejecutá todo" para usarlos tal cual.`
      : `Listo, puse el artículo como referencia. Podés subir más para armar un combo, o escribí "ejecutá todo" para generar los videos.`);
  };

  // Genera UNA imagen combo con todos los productos → pasa a ser la referencia de las escenas
  const genCombo = async () => {
    if (productImages.length < 1) return;
    setComboLoading(true);
    try {
      const r = await creativeApi.combo({ product: { name: name || 'Producto' }, referenceImages: productImages, brief: cmd, quality: hd ? 'premium' : undefined, format });
      setComboImage(r.imageUrl);
      applyNewProduct(r.imageUrl); // el combo es ahora LA imagen de producto de las escenas
      setCredits(r.credits);
      pushMsg('copilot', '🧩 Listo, armé la imagen combo con todos los productos juntos. Ahora escribí "ejecutá todo" y la persona (avatar) muestra ese combo en cada escena.');
    } catch (e: any) {
      pushMsg('copilot', e?.response?.data?.message === 'SIN_CREDITOS' ? '🪫 Te quedaste sin créditos para armar el combo.' : 'No pude armar el combo (no se descontaron créditos). Probá de nuevo.');
    } finally { setComboLoading(false); }
  };

  // Combo PIXEL-PERFECT: recorta cada producto (fal birefnet) y los compone sobre fondo blanco
  // en un canvas del navegador → los productos quedan EXACTOS (no regenerados).
  const buildCleanCombo = async () => {
    if (productImages.length < 1) return;
    setComboLoading(true);
    pushMsg('copilot', '✂️ Recortando cada producto y armando el combo (fondo blanco, productos exactos)…');
    try {
      const clean = await Promise.all(productImages.map(img => creativeApi.removeBg(img).then(r => r.imageUrl).catch(() => img)));
      // fetch→dataURL para que el canvas no quede tainted al exportar
      const toData = async (src: string) => { if (src.startsWith('data:')) return src; try { const rb = await fetch(src); const bl = await rb.blob(); return await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(bl); }); } catch { return src; } };
      const loadImg = async (src: string) => { const d = await toData(src); return new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = d; }); };
      const imgs = await Promise.all(clean.map(loadImg));
      const W = 1080, H = 1350;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      const n = imgs.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const cw = W / cols, ch = H / rows, pad = cw * 0.10;
      imgs.forEach((im, i) => {
        const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
        const scale = Math.min((cw - pad * 2) / im.width, (ch - pad * 2) / im.height);
        const dw = im.width * scale, dh = im.height * scale;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10;
        ctx.drawImage(im, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh); ctx.restore();
      });
      const dataUrl = canvas.toDataURL('image/png');
      setComboImage(dataUrl); applyNewProduct(dataUrl);
      pushMsg('copilot', '✂️ Combo listo con los productos recortados (exactos, fondo blanco). Ya es la imagen de producto — generá cuando quieras.');
    } catch {
      pushMsg('copilot', 'No pude armar el combo recortado. Usá fotos de productos individuales (uno por foto), no un collage.');
    } finally { setComboLoading(false); }
  };

  // Paquete de ads: hooks + copy + guion + 3 variaciones (no genera video, solo texto — casi gratis)
  const genPkg = async () => {
    if (!name && productImages.length === 0) { pushMsg('copilot', 'Primero poné el nombre del producto o subí una foto.'); return; }
    setPkgLoading(true); setShowPkg(true);
    try {
      const r = await creativeApi.adPackage({ product: { name: name || 'Producto' }, referenceImage: comboImage || imageBase64, referenceImages: (!comboImage && productImages.length > 1) ? productImages : undefined, seconds: Number(videoDur) });
      setPkg(r);
    } catch {
      pushMsg('copilot', 'No pude armar el paquete de ads. Probá de nuevo.');
      setShowPkg(false);
    } finally { setPkgLoading(false); }
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
    // Ejecutar el pipeline (1 solo video)
    if (/\b(gener|ejecut|corr[ée]|render|dale ya|ensambl|video final)/.test(s)) { pushMsg('user', t); runOneShot(); return; }
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
        <div onClick={() => fileRef.current?.click()} title="Imágenes del producto (podés subir varias para armar combos)" style={{ position: 'relative', width: 44, height: 44, borderRadius: 10, border: `1.5px dashed ${C.borderBright}`, background: C.surface, display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden', flexShrink: 0 }}>
          {imageBase64 ? <img src={imageBase64} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18 }}>📷</span>}
          {productImages.length > 1 && <span style={{ position: 'absolute', bottom: -2, right: -2, background: C.accent, color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 5px' }}>{productImages.length}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={async e => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          const b64s = await Promise.all(files.map(toBase64));
          setProductImages(prev => [...prev, ...b64s]);
          setImageBase64(prev => prev ?? b64s[0]);
          e.target.value = '';
        }} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Producto…" style={{ width: 160, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
        <input value={cmd} onChange={e => setCmd(e.target.value)} title="Estilo o comandos /x que se aplican a TODAS las escenas (ej: /ad /appetite /studio)" placeholder="Estilo / comandos: /ad /appetite /studio…" style={{ width: 230, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
        <Btn onClick={() => startCampaign()} disabled={planning || (!name && !imageBase64)}>{planning ? 'Planeando…' : plan ? 'Replanificar' : '🤖 Planificar'}</Btn>
        <button onClick={genPkg} disabled={pkgLoading} title="Genera hooks, guion, copy y 3 variaciones (texto, casi gratis)" style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: pkgLoading ? 'wait' : 'pointer', border: 'none', background: C.grad, color: '#fff' }}>{pkgLoading ? 'Armando…' : '✨ Paquete de ads'}</button>
        {doneCount > 0 && <button onClick={saveProject} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}>{saved ? '✓ Guardado' : '💾 Guardar'}</button>}
      </div>

      {/* Guion elegido del paquete de ads (lo dice el video) */}
      {adScript && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: C.accentDim, border: `1px solid ${C.accent}55`, borderRadius: 10 }}>
          <span style={{ fontSize: 15 }}>🎙️</span>
          <span style={{ flex: 1, fontSize: 12.5, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Guion elegido: {adScript}</span>
          <button onClick={() => setAdScript('')} title="Quitar guion" style={{ background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* Combo: miniaturas de todas las imágenes del producto (subí varias para armar combos) */}
      {productImages.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 11.5, color: C.textMuted }}>🧩 Combo · {productImages.length} {productImages.length === 1 ? 'imagen' : 'imágenes'}:</span>
          {productImages.map((img, i) => (
            <div key={i} style={{ position: 'relative', width: 40, height: 40, borderRadius: 8, overflow: 'hidden', border: `1px solid ${i === 0 ? C.accent : C.border}` }} title={i === 0 ? 'Principal' : ''}>
              <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button onClick={() => setProductImages(prev => { const n = prev.filter((_, j) => j !== i); setImageBase64(n[0]); return n; })} style={{ position: 'absolute', top: -1, right: -1, width: 15, height: 15, lineHeight: '13px', textAlign: 'center', background: C.red, color: '#fff', border: 'none', borderRadius: '0 0 0 6px', fontSize: 10, cursor: 'pointer', padding: 0 }}>×</button>
            </div>
          ))}
          <button onClick={() => fileRef.current?.click()} style={{ width: 40, height: 40, borderRadius: 8, border: `1.5px dashed ${C.borderBright}`, background: C.surface, color: C.textMuted, fontSize: 18, cursor: 'pointer' }} title="Agregar más imágenes al combo">+</button>
          {productImages.length >= 2 && (
            <>
              <button onClick={buildCleanCombo} disabled={comboLoading} title="Recorta cada producto (exacto) y los compone sobre fondo blanco — pixel-perfect" style={{ marginLeft: 4, padding: '7px 12px', borderRadius: 9, border: 'none', background: C.grad, color: '#fff', fontSize: 12, fontWeight: 700, cursor: comboLoading ? 'wait' : 'pointer', opacity: comboLoading ? 0.6 : 1 }}>
                {comboLoading ? 'Armando…' : '✂️ Combo recortado (exacto)'}
              </button>
              <button onClick={genCombo} disabled={comboLoading} title="Combo generado por IA (escena/fondo lindo, puede variar un poco el producto)" style={{ padding: '7px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 12, fontWeight: 700, cursor: comboLoading ? 'wait' : 'pointer', opacity: comboLoading ? 0.6 : 1 }}>
                🧩 Combo IA
              </button>
            </>
          )}
          {comboImage && <span style={{ fontSize: 11, color: C.accent }}>usando imagen combo ✓</span>}
        </div>
      )}

      {/* Comandos recomendados según el producto (se aplican a todas las escenas) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: C.textMuted }}>✨ Comandos recomendados:</span>
        <button onClick={() => setCmd(recCmds.join(' '))} style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentDim, border: `1px solid ${C.accent}55`, borderRadius: 7, padding: '3px 10px', cursor: 'pointer' }}>Aplicar todos</button>
        {recCmds.map(cmd2 => (
          <button key={cmd2} onClick={() => setCmd((cmd.trim() + ' ' + cmd2).trim())} style={{ fontSize: 10.5, fontFamily: "'DM Mono',monospace", color: C.accent, background: C.accentDim, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>{cmd2}</button>
        ))}
      </div>

      {/* Avatar (galería + describir) + Producto exacto (HD) */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => selfAvatarRef.current?.click()} title="Subí tu propia foto para ser vos la persona del video" style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.grad, border: 'none', borderRadius: 10, padding: '7px 12px', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          🙋 Agregate como avatar
        </button>
        <input ref={selfAvatarRef} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { const b64 = await toBase64(f); setUploadedAvatars(l => [b64, ...l]); setSelectedAvatar(b64); pushMsg('copilot', '🙋 Listo, vas a ser vos la persona del video. Generá cuando quieras.'); } e.currentTarget.value = ''; }} />
        <button onClick={() => { loadAvatars(); setShowAvatars(true); }} style={{ display: 'flex', alignItems: 'center', gap: 8, background: selectedAvatar ? C.accentDim : C.surface, border: `1px solid ${selectedAvatar ? C.accent : C.border}`, borderRadius: 10, padding: '6px 12px', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          {selectedAvatar ? <img src={selectedAvatar} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} /> : <span style={{ fontSize: 15 }}>🧑</span>}
          {selectedAvatar ? 'Avatar elegido' : 'Plantillas / Avatares'}
        </button>
        <input value={avatar} onChange={e => setAvatar(e.target.value)} placeholder="Avatar (opcional): ej. mujer joven, pelo castaño, sonriente…" title="Describí cómo querés la persona/avatar de las escenas" style={{ flex: 1, minWidth: 200, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', color: C.text, fontSize: 12.5, outline: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${hd ? C.accent : C.border}`, borderRadius: 10, padding: '6px 10px' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Producto exacto:</span>
          <button onClick={() => setHd(false)} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: !hd ? C.accentDim : 'transparent', color: !hd ? C.accent : C.textMuted }}>Económico</button>
          <button onClick={() => setHd(true)} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: hd ? C.accentDim : 'transparent', color: hd ? C.accent : C.textMuted }}>HD · exacto</button>
        </div>
        {setVq && vqOptions.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 10px' }}>
            <span style={{ fontSize: 12, color: C.textMuted }}>Calidad del video:</span>
            <select value={vq} onChange={e => setVq(e.target.value)} title="Calidad del video (afecta cuántos créditos consume)" style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 12, fontWeight: 600, outline: 'none', cursor: 'pointer' }}>
              {vqOptions.map((o: any) => <option key={o.key} value={o.key} style={{ color: '#000' }}>{o.label} — 5s: {o.credits5} créd · 10s: {o.credits10} créd{o.key === 'economico' ? ' ⭐' : ''}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 10px' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Duración:</span>
          {(['5', '10'] as const).map(d => (
            <button key={d} onClick={() => setVideoDur(d)} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: videoDur === d ? C.accentDim : 'transparent', color: videoDur === d ? C.accent : C.textMuted }}>{d}s</button>
          ))}
        </div>
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
          <CampaignCanvas pipe={pipe} running={running} onRun={runOneShot} cost={oneShotCost}
            productImages={comboImage ? [comboImage] : productImages} productDesc={name || 'Tu producto'}
            characterDesc={selectedAvatar ? 'Avatar elegido' : (avatar || 'Persona UGC (sintética)')}
            onCancel={cancelRun} onTemplates={() => { loadAvatars(); setShowAvatars(true); }} />
        </div>
        <CopilotPanel messages={messages} running={running || planning} planned={true} onGenerate={runOneShot} onSend={handleCopilot} onAttach={onCopilotAttach} />
      </div>

      {/* Galería de Plantillas / Avatares */}
      {showAvatars && (() => {
        const all = [...uploadedAvatars, ...avatarLib];
        return (
          <div onClick={() => setShowAvatars(false)} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 'min(880px,95vw)', maxHeight: '85vh', overflowY: 'auto', background: '#0f0f1a', border: `1px solid ${C.borderBright}`, borderRadius: 16, padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>🧑 Plantillas / Avatares</div>
                <button onClick={() => avatarFileRef.current?.click()} className="btn btn-p" style={{ fontSize: 12, padding: '6px 12px' }}>⬆ Subir avatar</button>
                <input ref={avatarFileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.currentTarget.value = ''; }} />
                <button onClick={() => setShowAvatars(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>Elegí un avatar para usar en las escenas (se mantiene la MISMA persona). Se van sumando los que generás. Después solo cambiás la imagen del producto y ejecutás.</div>
              {selectedAvatar && <button onClick={() => setSelectedAvatar(undefined)} style={{ marginBottom: 12, background: 'transparent', border: `1px solid ${C.red}`, color: C.red, borderRadius: 8, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }}>Quitar avatar (usar persona automática)</button>}
              {all.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: C.textMuted }}><div style={{ fontSize: 30 }}>🧑</div>Todavía no hay avatares. Generá una campaña (se guardan solos) o subí uno.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 12 }}>
                  {all.map((url, i) => {
                    const sel = selectedAvatar === url;
                    return (
                      <button key={i} onClick={() => { setSelectedAvatar(url); setShowAvatars(false); }} style={{ padding: 0, border: `2px solid ${sel ? C.accent : C.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: C.surface, aspectRatio: '3/4' }}>
                        <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Paquete de ads (hooks + copy + guion + 3 variaciones) */}
      {showPkg && (
        <div onClick={() => setShowPkg(false)} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(720px,95vw)', maxHeight: '85vh', overflowY: 'auto', background: '#0f0f1a', border: `1px solid ${C.borderBright}`, borderRadius: 16, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>✨ Paquete de ads</div>
              <button onClick={() => setShowPkg(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            {pkgLoading || !pkg ? (
              <div style={{ padding: '48px 0', textAlign: 'center', color: C.textMuted }}>Armando el paquete… (hooks, guion, copy y 3 variaciones)</div>
            ) : (() => {
              const copyTxt = (t: string) => { try { navigator.clipboard.writeText(t); } catch { /* ignore */ } };
              const Sec = ({ title, children }: any) => <div style={{ marginBottom: 16 }}><div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{title}</div>{children}</div>;
              const Line = ({ t }: { t: string }) => <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}><div style={{ flex: 1, fontSize: 13, color: C.text, lineHeight: 1.5, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>{t}</div><button onClick={() => copyTxt(t)} title="Copiar" style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, cursor: 'pointer', fontSize: 12, padding: '8px 10px' }}>📋</button></div>;
              return (
                <>
                  {pkg.hooks?.length > 0 && <Sec title="Hooks">{pkg.hooks.map((h: string, i: number) => <Line key={i} t={h} />)}</Sec>}
                  {pkg.voice_script && <Sec title="Guion de voz">{<Line t={pkg.voice_script} />}</Sec>}
                  {pkg.copy && <Sec title="Copy">
                    {pkg.copy.headline && <Line t={pkg.copy.headline} />}
                    {pkg.copy.text && <Line t={pkg.copy.text} />}
                    {pkg.copy.cta && <Line t={pkg.copy.cta} />}
                  </Sec>}
                  {pkg.variations && <Sec title="Variaciones (guion)">
                    {(['ugc', 'demo', 'hard_sell'] as const).map(k => pkg.variations[k]?.voice_script && (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 3, textTransform: 'uppercase' }}>{k.replace('_', ' ')}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ flex: 1, fontSize: 12.5, color: C.text, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>{pkg.variations[k].voice_script}</div>
                          <button onClick={() => { setAdScript(pkg.variations[k].voice_script); setShowPkg(false); pushMsg('copilot', `🎙️ Guion "${k.replace('_', ' ')}" cargado. Tocá "▶ Generar video" y la persona lo va a decir (elegí calidad "con voz").`); }} style={{ background: C.accent, border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '8px 10px', whiteSpace: 'nowrap' }}>Usar</button>
                        </div>
                      </div>
                    ))}
                  </Sec>}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function CopilotPanel({ messages, running, planned, onGenerate, onSend, onAttach }: { messages: { role: 'user' | 'copilot'; text: string }[]; running: boolean; planned: boolean; onGenerate: () => void; onSend: (t: string) => void; onAttach: (files: File[]) => void }) {
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
        <input ref={attachRef} type="file" accept="image/*" multiple hidden onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onAttach(fs); e.currentTarget.value = ''; }} />
        <button onClick={() => attachRef.current?.click()} disabled={running} title="Adjuntar una o varias fotos de artículos (para combos)" style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, width: 38, height: 38, flexShrink: 0, cursor: 'pointer', fontSize: 16, opacity: running ? 0.5 : 1 }}>📎</button>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Pedile al Copiloto: crear, editar un nodo, o adjuntá un artículo…" style={{ flex: 1, minWidth: 0, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
        <button onClick={send} disabled={running || !text.trim()} style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '0 14px', height: 38, fontWeight: 700, cursor: 'pointer', opacity: running || !text.trim() ? 0.5 : 1 }}>↑</button>
      </div>
    </aside>
  );
}

function Btn({ children, onClick, disabled }: any) {
  return <button onClick={onClick} disabled={disabled} style={{ padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, border: 'none', background: C.accent, color: '#fff', whiteSpace: 'nowrap' }}>{children}</button>;
}
