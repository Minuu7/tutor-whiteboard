import { supabase } from '@/lib/supabase';

const BUCKET = 'worksheets';

/** Recursively collect every file path under a storage prefix (uploads live in `${roomId}/${batch}/page-N.png`). */
async function listAllFiles(prefix: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths: string[] = [];
  for (const item of data) {
    const full = `${prefix}/${item.name}`;
    // Folders come back with id === null
    if (item.id === null) paths.push(...(await listAllFiles(full)));
    else paths.push(full);
  }
  return paths;
}

/** Deletes all worksheet files for a room from Storage, then removes the session row. */
export async function deleteRoomCompletely(roomId: string): Promise<void> {
  try {
    const files = await listAllFiles(roomId);
    if (files.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(files);
      if (error) console.warn('Worksheet cleanup failed:', error);
    }
  } catch (err) {
    console.warn('Worksheet cleanup exception:', err);
  }
  const { error } = await supabase.from('whiteboard_sessions').delete().eq('room_id', roomId);
  if (error) throw new Error(error.message);
}
