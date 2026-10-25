'use client';

import 'tldraw/tldraw.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AssetRecordType,
  Editor,
  TLAssetId,
  TLRecord,
  TLShapeId,
  Tldraw,
  createShapeId,
  getSnapshot,
  loadSnapshot,
} from 'tldraw';
import * as pdfjsLib from 'pdfjs-dist';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  Check,
  Copy,
  Eraser,
  FileUp,
  Home,
  Loader2,
  Save,
  ShieldX,
  SquarePlus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

type SyncStatus = 'Loading...' | 'Saving...' | 'Synced ✓' | 'Save failed';
type Gate = 'checking' | 'denied' | 'granted';

interface CanvasChangesPayload {
  added: TLRecord[];
  updated: TLRecord[];
  removed: TLRecord['id'][];
}

const SOLVING_SPACE = 600;
const SAVE_DEBOUNCE_MS = 1500;
const BUCKET = 'worksheets';

/** Fixed SVG syntax for the Solution Space box */
function buildGridBoxSvg(w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e2e8f0" stroke-width="1"/></pattern></defs>
<rect width="${w}" height="${h}" fill="#ffffff"/><rect width="${w}" height="${h}" fill="url(#g)"/>
<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="none" stroke="#a5b8d8" stroke-width="3" rx="6"/>
<text x="16" y="30" font-family="sans-serif" font-size="16" fill="#94a3b8">Solution space</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png')
  );
}

/** Error Boundary so Tldraw never vanishes silently into a black screen */
class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 p-6 text-white">
          <h2 className="text-lg font-bold text-rose-400">Whiteboard Render Error</h2>
          <pre className="mt-2 max-w-xl overflow-auto rounded bg-black/50 p-4 text-xs text-slate-300">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            Reload Whiteboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function WhiteboardClient({ roomId }: { roomId: string }) {
  const [gate, setGate] = useState<Gate>('checking');
  const [accessKey, setAccessKey] = useState('');
  const [initialSnapshot, setInitialSnapshot] = useState<unknown>(null);

  const editorRef = useRef<Editor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('Loading...');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);

  // ---------- 1. Invite-key gate ----------
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key')?.trim() ?? '';
    setAccessKey(key);
    (async () => {
      const { data, error } = await supabase
        .from('whiteboard_sessions')
        .select('access_token, canvas_snapshot')
        .eq('room_id', roomId)
        .maybeSingle();
      if (error || !data || !key || data.access_token !== key) {
        if (error) console.error('Room lookup failed:', error);
        setGate('denied');
        return;
      }
      setInitialSnapshot(data.canvas_snapshot ?? null);
      setGate('granted');
    })();
  }, [roomId]);

  // ---------- 2. Autosave ----------
  const saveNow = useCallback(
    async (ed: Editor) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (savingRef.current) {
        dirtyRef.current = true;
        return;
      }
      savingRef.current = true;
      dirtyRef.current = false;
      setStatus((prev) => (prev === 'Saving...' ? prev : 'Saving...'));

      try {
        const snapshot = getSnapshot(ed.store);
        const { error } = await supabase.from('whiteboard_sessions').upsert(
          {
            room_id: roomId,
            access_token: accessKey,
            canvas_snapshot: snapshot,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'room_id' }
        );
        savingRef.current = false;
        if (error) {
          console.error('Autosave failed:', error);
          setStatus('Save failed');
          return;
        }
        if (dirtyRef.current) {
          void saveNow(ed);
        } else {
          setStatus('Synced ✓');
        }
      } catch (err) {
        savingRef.current = false;
        console.error('Autosave exception:', err);
        setStatus('Save failed');
      }
    },
    [roomId, accessKey]
  );

  const scheduleSave = useCallback(
    (ed: Editor) => {
      // Prevent 60fps React re-renders while drawing a stroke
      setStatus((prev) => (prev === 'Saving...' ? prev : 'Saving...'));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void saveNow(ed), SAVE_DEBOUNCE_MS);
    },
    [saveNow]
  );

  // ---------- 3. Mount: resume + realtime ----------
  const handleMount = useCallback(
    (ed: Editor) => {
      editorRef.current = ed;
      setEditorReady(true);

      if (mountedRef.current) return;
      mountedRef.current = true;

      if (initialSnapshot) {
        try {
          loadSnapshot(ed.store, initialSnapshot as Parameters<typeof loadSnapshot>[1]);
        } catch (e) {
          console.error('Snapshot load failed (starting fresh):', e);
        }
      }
      setStatus('Synced ✓');

      const channel = supabase.channel(`room:${roomId}`, {
        config: { broadcast: { self: false } },
      });
      channel
        .on('broadcast', { event: 'canvas-changes' }, ({ payload }) => {
          try {
            const { added, updated, removed } = payload as CanvasChangesPayload;
            ed.store.mergeRemoteChanges(() => {
              const toPut = [...(added ?? []), ...(updated ?? [])];
              if (toPut.length) ed.store.put(toPut);
              const toRemove = (removed ?? []).filter((id) => ed.store.has(id));
              if (toRemove.length) ed.store.remove(toRemove);
            });
          } catch (err) {
            console.error('Remote merge error:', err);
          }
        })
        .subscribe();
      channelRef.current = channel;

      const unlisten = ed.store.listen(
        ({ changes }) => {
          try {
            const payload: CanvasChangesPayload = {
              added: Object.values(changes.added),
              updated: Object.values(changes.updated).map(([, to]) => to),
              removed: Object.keys(changes.removed) as TLRecord['id'][],
            };
            void channel.send({ type: 'broadcast', event: 'canvas-changes', payload });
            scheduleSave(ed);
          } catch (err) {
            console.error('Listen broadcast error:', err);
          }
        },
        { source: 'user', scope: 'document' }
      );

      return () => {
        mountedRef.current = false;
        unlisten();
        if (saveTimerRef.current) void saveNow(ed);
        void supabase.removeChannel(channel);
        channelRef.current = null;
      };
    },
    [initialSnapshot, roomId, scheduleSave, saveNow]
  );

  // ---------- 4. PDF upload → Supabase Storage ----------
  const handlePdfUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      const ed = editorRef.current;
      if (!file || !ed) return;
      if (file.type !== 'application/pdf') {
        alert('Please choose a PDF file.');
        return;
      }

      setUploading(true);
      try {
        setUploadMsg('Reading PDF…');
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const batch = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const placed: { src: string; w: number; h: number; name: string }[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          setUploadMsg(`Page ${i}/${pdf.numPages}: rendering…`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas not supported');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          page.cleanup();

          setUploadMsg(`Page ${i}/${pdf.numPages}: uploading…`);
          const blob = await canvasToPngBlob(canvas);
          const filePath = `${roomId}/${batch}/page-${i}.png`;
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(filePath, blob, { upsert: true, contentType: 'image/png' });
          if (error) throw new Error(`Storage upload failed: ${error.message}`);
          const src = supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
          placed.push({ src, w: canvas.width / 2, h: canvas.height / 2, name: `${file.name} p${i}` });
        }
        await pdf.destroy();

        setUploadMsg('Placing pages…');
        let firstShape: TLShapeId | null = null;
        ed.run(() => {
          const bounds = ed.getCurrentPageBounds();
          const x = bounds ? bounds.minX : 0;
          let y = bounds ? bounds.maxY + SOLVING_SPACE : 0;
          for (const p of placed) {
            const assetId: TLAssetId = AssetRecordType.createId();
            ed.createAssets([
              {
                id: assetId,
                typeName: 'asset',
                type: 'image',
                props: { name: p.name, src: p.src, w: p.w, h: p.h, mimeType: 'image/png', isAnimated: false },
                meta: {},
              },
            ]);
            const shapeId = createShapeId();
            ed.createShape({ id: shapeId, type: 'image', x, y, isLocked: true, props: { assetId, w: p.w, h: p.h } });
            ed.sendToBack([shapeId]);
            if (!firstShape) firstShape = shapeId;
            y += p.h + SOLVING_SPACE;
          }
        });

        if (firstShape) {
          const b = ed.getShapePageBounds(firstShape);
          if (b) ed.zoomToBounds(b, { inset: 48, animation: { duration: 400 } });
        }
        await saveNow(ed);
      } catch (err) {
        console.error(err);
        alert(`PDF upload failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setUploading(false);
        setUploadMsg('');
      }
    },
    [roomId, saveNow]
  );

  // ---------- Tools ----------
  const addSolutionSpace = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const w = 760;
    const h = 500;
    const vp = ed.getViewportPageBounds();
    const assetId: TLAssetId = AssetRecordType.createId();
    ed.run(() => {
      ed.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: { name: 'solution-space.svg', src: buildGridBoxSvg(w, h), w, h, mimeType: 'image/svg+xml', isAnimated: false },
          meta: { solutionSpace: true },
        },
      ]);
      const shapeId = createShapeId();
      ed.createShape({
        id: shapeId,
        type: 'image',
        x: vp.center.x - w / 2,
        y: vp.maxY + 40,
        isLocked: true,
        props: { assetId, w, h },
      });
      ed.sendToBack([shapeId]);
    });
    ed.centerOnPoint({ x: vp.center.x, y: vp.maxY + 40 + h / 2 }, { animation: { duration: 400 } });
    ed.setCurrentTool('draw');
  }, []);

  const clearDrawings = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!confirm('Erase all pen strokes and notes on this page? The PDF worksheet stays.')) return;
    const ids = ed
      .getCurrentPageShapes()
      .filter((s) => !(s.type === 'image' && s.isLocked))
      .map((s) => s.id);
    if (ids.length) ed.deleteShapes(ids);
  }, []);

  const copyInvite = useCallback(async () => {
    const url = `${window.location.origin}/room/${encodeURIComponent(roomId)}?key=${encodeURIComponent(accessKey)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this invite link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [roomId, accessKey]);

  // ---------- Render ----------
  if (gate === 'checking') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
        <Loader2 className="mr-3 animate-spin" /> Verifying invite link…
      </div>
    );
  }

  if (gate === 'denied') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md rounded-2xl border border-rose-500/20 bg-white/5 p-8 text-center shadow-2xl backdrop-blur">
          <ShieldX className="mx-auto mb-4 text-rose-400" size={48} />
          <h1 className="text-2xl font-bold text-white">Access Denied</h1>
          <p className="mt-3 text-slate-400">
            You need a valid invite link from the tutor to join this classroom.
          </p>
          <a href="/" className="mt-6 inline-block rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">
            Back to ApexMath Live
          </a>
        </div>
      </div>
    );
  }

  const statusStyle =
    status === 'Synced ✓'
      ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
      : status === 'Saving...'
        ? 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
        : status === 'Save failed'
          ? 'bg-rose-500/15 text-rose-300 ring-rose-400/30'
          : 'bg-sky-500/15 text-sky-300 ring-sky-400/30';

  const btn =
    'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col bg-slate-950" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <header className="z-10 flex flex-wrap items-center gap-2 border-b border-white/10 bg-gradient-to-r from-slate-950 via-indigo-950/80 to-slate-950 px-3 py-2 shadow-lg shadow-black/40">
        <a href="/" id="home-link" className={`${btn} text-slate-300 hover:bg-white/10`} title="Home">
          <Home size={16} />
        </a>
        <span className="rounded-full bg-indigo-500/20 px-3 py-1 font-mono text-xs text-indigo-200 ring-1 ring-indigo-400/30">
          Room: {roomId}
        </span>
        <button id="copy-invite-btn" onClick={copyInvite} className={`${btn} bg-white/5 text-slate-200 hover:bg-white/10`}>
          {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy Student Invite Link'}
        </button>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <input ref={fileInputRef} id="pdf-input" type="file" accept="application/pdf" className="hidden" onChange={handlePdfUpload} />
        <button
          id="upload-pdf-btn"
          disabled={!editorReady || uploading}
          onClick={() => fileInputRef.current?.click()}
          className={`${btn} bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-900/50 hover:from-indigo-400 hover:to-violet-400`}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
          {uploading ? uploadMsg || 'Working…' : '+ Upload Math PDF'}
        </button>
        <button id="add-solution-btn" disabled={!editorReady} onClick={addSolutionSpace} className={`${btn} bg-white/5 text-slate-200 hover:bg-white/10`}>
          <SquarePlus size={16} /> + Add Solution Space
        </button>
        <button id="clear-drawings-btn" disabled={!editorReady} onClick={clearDrawings} className={`${btn} bg-white/5 text-slate-200 hover:bg-rose-500/20 hover:text-rose-200`}>
          <Eraser size={16} /> Clear Drawings (Keep PDF)
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            id="save-now-btn"
            disabled={!editorReady || status === 'Saving...'}
            onClick={() => editorRef.current && void saveNow(editorRef.current)}
            className={`${btn} bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25`}
          >
            <Save size={16} /> Save Now
          </button>
          <span id="sync-status" className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusStyle}`}>
            {status}
          </span>
        </div>
      </header>

      <main className="relative flex-1" style={{ touchAction: 'none', overflow: 'hidden' }}>
        <div className="tl-container absolute inset-0" style={{ width: '100%', height: '100%' }}>
          <CanvasErrorBoundary>
            <Tldraw onMount={handleMount} />
          </CanvasErrorBoundary>
        </div>
      </main>
    </div>
  );
}