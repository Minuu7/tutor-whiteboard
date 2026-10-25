---
name: tldraw-supabase-whiteboard
description: Expert rules for building, fixing, and extending Next.js + Tldraw + PDF.js + Supabase real-time collaborative whiteboards without SSR crashes, CORS errors, or autosave failures.
---

# Tldraw + PDF.js + Supabase Architecture Skill

Whenever working on the whiteboard, PDF upload, or Supabase synchronization, strictly enforce these rules:

## 1. Zero Next.js SSR Crashes
- NEVER import `tldraw` or `pdfjs-dist` inside a Next.js Server Component.
- Always wrap the whiteboard component using `next/dynamic` with `{ ssr: false }`.
- In `next.config.mjs`, ensure `config.resolve.alias.canvas = false` is set.

## 2. PDF.js & Supabase Storage (No Google Drive OAuth)
- Pin `pdfjs-dist@3.11.174` and set `pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'`.
- Never store huge base64 PNG strings inside the Tldraw JSON snapshot (it breaks Supabase payload limits).
- Always convert rendered PDF pages via `canvas.toBlob()`, upload the PNG blob to the Supabase Storage bucket `worksheets`, and pass the `publicUrl` into Tldraw's `AssetRecordType` `props.src`.

## 3. Reliable Tldraw v2/v3 Autosave & Next-Day Resume
- Use `getSnapshot(editor.store)` and `loadSnapshot(editor.store, snapshot)` imported directly from `tldraw`.
- Listen to changes with `editor.store.listen(callback, { source: 'user', scope: 'document' })`.
- Debounce database saves by 1200ms and `upsert` into `whiteboard_sessions` (`room_id`, `access_token`, `canvas_snapshot`, `updated_at`).
- Always verify the URL query parameter `?key=` matches `access_token` before allowing a user to view or edit a room.