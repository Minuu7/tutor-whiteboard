'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Clock,
  Copy,
  GraduationCap,
  History,
  KeyRound,
  Loader2,
  Lock,
  PenTool,
  Plus,
  Sigma,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deleteRoomCompletely } from '@/lib/deleteRoom';

interface Classroom {
  room_id: string;
  access_token: string;
  updated_at: string | null;
}

const TUTOR_PIN = process.env.NEXT_PUBLIC_TUTOR_PIN || '1234';
const MY_ROOMS_KEY = 'apexmath:tutor-rooms';

const SUBJECTS = ['Calculus', 'Algebra', 'Geometry', 'SAT/ACT Prep'];
const FEATURES = [
  { icon: BookOpenCheck, title: 'Interactive Multi-Page PDF Workbook', text: 'Upload any worksheet. Every page lands on the canvas with generous blank space beneath for step-by-step solutions.' },
  { icon: PenTool, title: 'Real-Time Pen Sync', text: 'Tutor and student write on the same board at the same time — every stroke appears instantly on both screens.' },
  { icon: History, title: 'Next-Day Auto-Resume', text: 'Work is saved automatically. Reopen the classroom tomorrow and continue exactly where you stopped.' },
  { icon: Lock, title: 'Private Invite-Only Classrooms', text: 'Each classroom has a secret access key. No public room lists — only students with your link can enter.' },
];

function randomToken(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
}

function inviteUrl(c: { room_id: string; access_token: string }) {
  return `${window.location.origin}/room/${encodeURIComponent(c.room_id)}?key=${encodeURIComponent(c.access_token)}`;
}

export default function Home() {
  const router = useRouter();
  const [joinOpen, setJoinOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-indigo-600/30 blur-3xl" />
      <div className="pointer-events-none absolute right-[-12rem] top-40 h-[30rem] w-[30rem] rounded-full bg-fuchsia-600/20 blur-3xl" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-5">
        <a href="/" className="flex items-center gap-2 text-lg font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-900/50">
            <Sigma size={20} />
          </span>
          <span className="hidden min-[400px]:inline">ApexMath <span className="text-indigo-300">Live</span></span>
        </a>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a href="#features" className="hidden rounded-lg px-3 py-2.5 text-slate-300 hover:text-white md:block">Features</a>
          <button id="nav-join-btn" onClick={() => setJoinOpen(true)} className="min-h-[44px] rounded-lg px-3 py-2.5 text-slate-300 hover:text-white">Join Class</button>
          <button id="nav-tutor-btn" onClick={() => setTutorOpen(true)} className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2.5 font-medium hover:bg-white/20 sm:px-4">Tutor Portal</button>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 text-center sm:px-6 sm:pb-20 sm:pt-16 md:px-8 md:pt-24">
          <div className="mx-auto mb-6 flex flex-wrap justify-center gap-2">
            {SUBJECTS.map((s) => (
              <span key={s} className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-indigo-200 ring-1 ring-white/10">{s}</span>
            ))}
          </div>
          <h1 className="mx-auto max-w-4xl bg-gradient-to-r from-white via-indigo-100 to-fuchsia-200 bg-clip-text text-3xl font-extrabold leading-tight tracking-tight text-transparent sm:text-5xl lg:text-6xl">
            ApexMath Live — 1-on-1 Interactive Math Tutoring
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-slate-400 sm:mt-6 sm:text-lg">
            A shared digital notebook for tutor and student. Upload a worksheet, solve problems together with live pen sync, and resume tomorrow right where you left off.
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-3 sm:mt-10 md:grid-cols-2">
            <button
              id="hero-tutor-btn"
              onClick={() => setTutorOpen(true)}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3.5 font-semibold shadow-xl shadow-indigo-900/40 transition hover:scale-[1.02] active:scale-[0.99]"
            >
              <GraduationCap size={18} /> Tutor Portal (Create/Manage Classrooms)
            </button>
            <button
              id="hero-join-btn"
              onClick={() => setJoinOpen(true)}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 font-semibold backdrop-blur transition hover:bg-white/10"
            >
              <KeyRound size={18} /> Student: Join Classroom with Link/Code
            </button>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24 md:px-8">
          <h2 className="mb-8 text-center text-2xl font-bold sm:mb-10 sm:text-3xl">Everything a math lesson needs</h2>
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 transition hover:-translate-y-1 hover:border-indigo-400/40 hover:bg-white/[0.06]">
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20 transition group-hover:bg-indigo-500 group-hover:text-white">
                  <Icon size={22} />
                </div>
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} ApexMath Live
      </footer>

      {joinOpen && <JoinModal onClose={() => setJoinOpen(false)} onJoin={(url) => router.push(url)} />}
      {tutorOpen && <TutorModal onClose={() => setTutorOpen(false)} onOpen={(url) => router.push(url)} />}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[90dvh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl sm:p-6 md:p-8`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-white/10 bg-slate-950/80 min-h-[44px] px-4 py-2.5 text-base outline-none ring-indigo-500/50 placeholder:text-slate-500 focus:ring-2';

function JoinModal({ onClose, onJoin }: { onClose: () => void; onJoin: (url: string) => void }) {
  const [link, setLink] = useState('');
  const [roomId, setRoomId] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (link.trim()) {
      try {
        const u = new URL(link.trim());
        const m = u.pathname.match(/^\/room\/([^/]+)/);
        const k = u.searchParams.get('key');
        if (!m || !k) throw new Error();
        onJoin(`/room/${m[1]}?key=${encodeURIComponent(k)}`);
      } catch {
        setError('That invite link looks invalid. Paste the full link from your tutor.');
      }
      return;
    }
    if (!roomId.trim() || !key.trim()) {
      setError('Paste an invite link, or enter both Room ID and Access Key.');
      return;
    }
    onJoin(`/room/${encodeURIComponent(roomId.trim())}?key=${encodeURIComponent(key.trim().toUpperCase())}`);
  };

  return (
    <Modal title="Join your classroom" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Invite link</label>
          <input id="join-link-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="http://…/room/…?key=…" className={inputCls} />
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-white/10" />OR<span className="h-px flex-1 bg-white/10" /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input id="join-room-input" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="Room ID" className={inputCls} />
          <input id="join-key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="6-digit Access Key" maxLength={6} className={`${inputCls} font-mono uppercase tracking-widest`} />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button id="join-submit-btn" type="submit" className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-2.5 font-semibold transition hover:opacity-90">
          Enter Classroom <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}

function TutorModal({ onClose, onOpen }: { onClose: () => void; onOpen: (url: string) => void }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [rooms, setRooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem('apexmath:tutor') === '1') setUnlocked(true);
  }, []);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error } = await supabase
      .from('whiteboard_sessions')
      .select('room_id, access_token, updated_at')
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    else setRooms((data ?? []) as Classroom[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (unlocked) void loadRooms();
  }, [unlocked, loadRooms]);

  const tryPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === TUTOR_PIN) {
      sessionStorage.setItem('apexmath:tutor', '1');
      setUnlocked(true);
    } else {
      setPinError(true);
    }
  };

  const createRoom = async () => {
    setCreating(true);
    setError('');
    const base = slugify(newName) || 'math-class';
    const room = { room_id: `${base}-${randomToken(4).toLowerCase()}`, access_token: randomToken(6), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('whiteboard_sessions').insert({ ...room, canvas_snapshot: null });
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    const mine = JSON.parse(localStorage.getItem(MY_ROOMS_KEY) || '[]') as string[];
    localStorage.setItem(MY_ROOMS_KEY, JSON.stringify([room.room_id, ...mine]));
    setNewName('');
    setRooms((r) => [room, ...r]);
  };

  const copy = async (c: Classroom) => {
    const url = inviteUrl(c);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this invite link:', url);
    }
    setCopiedId(c.room_id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const removeRoom = async (c: Classroom) => {
    if (!confirm('Delete this classroom and all its worksheets permanently?')) return;
    setDeletingId(c.room_id);
    setError('');
    try {
      await deleteRoomCompletely(c.room_id);
      setRooms((r) => r.filter((x) => x.room_id !== c.room_id));
      const mine = JSON.parse(localStorage.getItem(MY_ROOMS_KEY) || '[]') as string[];
      localStorage.setItem(MY_ROOMS_KEY, JSON.stringify(mine.filter((id) => id !== c.room_id)));
    } catch (err) {
      setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  if (!unlocked) {
    return (
      <Modal title="Tutor Portal" onClose={onClose}>
        <form onSubmit={tryPin} className="space-y-4">
          <p className="text-sm text-slate-400">Enter your tutor PIN to manage classrooms.</p>
          <input
            id="tutor-pin-input"
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(false); }}
            placeholder="Tutor PIN"
            className={`${inputCls} text-center font-mono tracking-[0.5em]`}
          />
          {pinError && <p className="text-sm text-rose-400">Incorrect PIN.</p>}
          <button id="tutor-pin-submit" type="submit" className="min-h-[44px] w-full rounded-xl bg-indigo-500 py-2.5 font-semibold hover:bg-indigo-400">Unlock</button>
        </form>
      </Modal>
    );
  }

  return (
    <Modal title="Tutor Dashboard" onClose={onClose} wide>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="new-room-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Classroom name (optional), e.g. calculus-sarah" className={inputCls} />
        <button
          id="create-room-btn"
          onClick={createRoom}
          disabled={creating}
          className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm sm:w-auto font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} New Classroom
        </button>
      </div>
      {error && <p className="mt-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      <h3 className="mb-3 mt-6 flex items-center gap-2 text-sm font-semibold text-slate-300"><Sparkles size={14} /> Your classrooms</h3>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-slate-500">No classrooms yet — create your first one above.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {rooms.map((c) => (
            <li key={c.room_id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-white">{c.room_id}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="font-mono text-indigo-300">Key: {c.access_token}</span>
                  {c.updated_at && <span className="flex items-center gap-1"><Clock size={11} /> {new Date(c.updated_at).toLocaleString()}</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
                <button onClick={() => copy(c)} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-2.5 text-xs hover:bg-white/10 sm:flex-none">
                  {copiedId === c.room_id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copiedId === c.room_id ? 'Copied!' : 'Copy Student Invite Link'}
                </button>
                <button
                  onClick={() => onOpen(`/room/${encodeURIComponent(c.room_id)}?key=${encodeURIComponent(c.access_token)}`)}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2.5 text-xs font-semibold hover:bg-indigo-400 sm:flex-none"
                >
                  Resume Classroom <ArrowRight size={14} />
                </button>
                <button
                  onClick={() => removeRoom(c)}
                  disabled={deletingId === c.room_id}
                  aria-label={`Delete classroom ${c.room_id}`}
                  title="Delete classroom"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-rose-500/15 px-3 py-2.5 text-rose-300 ring-1 ring-rose-400/30 transition hover:bg-rose-500 hover:text-white disabled:opacity-50"
                >
                  {deletingId === c.room_id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
