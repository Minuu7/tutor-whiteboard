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

// Isolate <Tldraw /> inside React.memo so parent state changes NEVER touch it
const MemoizedTldraw = React.memo(function MemoizedTldraw({
  onMount,
}: {
  onMount: (editor: Editor) => void;
}) {
  return <Tldraw onMount={onMount} />;
});

export default function WhiteboardClient({ roomId }: { roomId: string }) {
  const [gate, setGate] = useState<Gate>('checking');
  const accessKeyRef = useRef('');
  const initialSnapshotRef = useRef<unknown>(null);

  const editorRef = useRef<Editor | null>(null);
  const statusBadgeRef = useRef<HTMLSpanElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update badge text directly in DOM so drawing causes 0 React re-renders!
  const updateStatusBadge = useCallback((text: SyncStatus) => {
    const el = statusBadgeRef.current;
    if (!el) return;
    el.textContent = text;
    if (text === 'Synced ✓') {
      el.style.background = 'rgba(16, 185, 129, 0.2)';
      el.style.color = '#6ee7b7';
    } else if (text === 'Saving...') {
      el.style.background = 'rgba(245, 158, 11, 0.2)';
      el.style.color = '#fcd34d';
    } else if (text === 'Save failed') {
      el.style.background = 'rgba(244, 63, 94, 0.2)';
      el.style.color = '#fda4af';
    }
  }, []);

  // ---------- 1. Invite-key gate ----------
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key')?.trim() ?? '';
    accessKeyRef.current = key;
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
      initialSnapshotRef.current = data.canvas_snapshot ?? null;
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
      updateStatusBadge('Saving...');

      try {
        const snapshot = getSnapshot(ed.store);
        const { error } = await supabase.from('whiteboard_sessions').upsert(
          {
            room_id: roomId,
            access_token: accessKeyRef.current,
            canvas_snapshot: snapshot,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'room_id' }
        );
        savingRef.current = false;
        if (error) {
          console.error('Autosave failed:', error);
          updateStatusBadge('Save failed');
          return;
        }
        if (dirtyRef.current) {
          void saveNow(ed);
        } else {
          updateStatusBadge('Synced ✓');
        }
      } catch (err) {
        savingRef.current = false;
        console.error('Autosave exception:', err);
        updateStatusBadge('Save failed');
      }
    },
    [roomId, updateStatusBadge]
  );

  const scheduleSave = useCallback(
    (ed: Editor) => {
      updateStatusBadge('Saving...');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void saveNow(ed), SAVE_DEBOUNCE_MS);
    },
    [saveNow, updateStatusBadge]
  );

  // ---------- 3. Mount: resume + realtime ----------
  const handleMount = useCallback(
    (ed: Editor) => {
      editorRef.current = ed;

      if (initialSnapshotRef.current) {
        try {
          loadSnapshot(
            ed.store,
            initialSnapshotRef.current as Parameters<typeof loadSnapshot>[1]
          );
        } catch (e) {
          console.error('Snapshot load failed (starting fresh):', e);
        }
      }
      updateStatusBadge('Synced ✓');

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
        unlisten();
        if (saveTimerRef.current) void saveNow(ed);
        void supabase.removeChannel(channel);
        channelRef.current = null;
      };
    },
    [roomId, scheduleSave, saveNow, updateStatusBadge]
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
          placed.push({
            src,
            w: canvas.width / 2,
            h: canvas.height / 2,
            name: `${file.name} p${i}`,
          });
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
                props: {
                  name: p.name,
                  src: p.src,
                  w: p.w,
                  h: p.h,
                  mimeType: 'image/png',
                  isAnimated: false,
                },
                meta: {},
              },
            ]);
            const shapeId = createShapeId();
            ed.createShape({
              id: shapeId,
              type: 'image',
              x,
              y,
              isLocked: true,
              props: { assetId, w: p.w, h: p.h },
            });
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
          props: {
            name: 'solution-space.svg',
            src: buildGridBoxSvg(w, h),
            w,
            h,
            mimeType: 'image/svg+xml',
            isAnimated: false,
          },
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
    const url = `${window.location.origin}/room/${encodeURIComponent(roomId)}?key=${encodeURIComponent(accessKeyRef.current)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this invite link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [roomId]);

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
          <a
            href="/"
            className="mt-6 inline-block rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            Back to ApexMath Live
          </a>
        </div>
      </div>
    );
  }

  const btn =
    'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#020617', overflow: 'hidden' }}>
      {/* Top Header with fixed 56px height */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '56px',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 12px',
          background: '#0f172a',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <a href="/" className={`${btn} text-slate-300 hover:bg-white/10`} title="Home">
          <Home size={16} />
        </a>
        <span className="rounded-full bg-indigo-500/20 px-3 py-1 font-mono text-xs text-indigo-200 ring-1 ring-indigo-400/30">
          Room: {roomId}
        </span>
        <button onClick={copyInvite} className={`${btn} bg-white/5 text-slate-200 hover:bg-white/10`}>
          {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy Student Invite Link'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handlePdfUpload}
        />
        <button
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
          {uploading ? uploadMsg || 'Working…' : '+ Upload Math PDF'}
        </button>
        <button
          onClick={addSolutionSpace}
          className={`${btn} bg-white/5 text-slate-200 hover:bg-white/10`}
        >
          <SquarePlus size={16} /> + Add Solution Space
        </button>
        <button
          onClick={clearDrawings}
          className={`${btn} bg-white/5 text-slate-200 hover:bg-rose-500/20 hover:text-rose-200`}
        >
          <Eraser size={16} /> Clear Drawings
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => editorRef.current && void saveNow(editorRef.current)}
            className={`${btn} bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25`}
          >
            <Save size={16} /> Save Now
          </button>
          <span
            ref={statusBadgeRef}
            style={{
              padding: '4px 12px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'rgba(16, 185, 129, 0.2)',
              color: '#6ee7b7',
            }}
          >
            Synced ✓
          </span>
        </div>
      </header>

      {/* Fixed Canvas Container that can NEVER collapse to 0px or black */}
      <div
        style={{
          position: 'fixed',
          top: '56px',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: 'calc(100vh - 56px)',
          background: '#ffffff',
          zIndex: 1,
        }}
      >
        <MemoizedTldraw onMount={handleMount} />
      </div>
    </div>
  );
}