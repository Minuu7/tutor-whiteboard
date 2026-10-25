'use client';

import dynamic from 'next/dynamic';

const WhiteboardClient = dynamic(() => import('@/components/WhiteboardClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-ping rounded-full bg-indigo-400" />
        Loading whiteboard…
      </div>
    </div>
  ),
});

export default function RoomPage({ params }: { params: { roomId: string } }) {
  return <WhiteboardClient roomId={decodeURIComponent(params.roomId)} />;
}
