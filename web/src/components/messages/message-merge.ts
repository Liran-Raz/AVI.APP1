import type { MessageDTO } from "@/lib/api-client";

// Pure list-merge helpers for the chat thread (extracted so they're unit-tested
// independently of the React component — this is the logic a review flagged for
// missing edits/deletes on a created_at-delta poll).

// Newest message time (ms) in a list, or 0. Gates mark-read (only a genuinely-new
// message should re-mark the conversation read).
export function newestMs(msgs: MessageDTO[]): number {
  let mx = 0;
  for (const m of msgs) {
    const t = Date.parse(m.createdAt);
    if (t > mx) mx = t;
  }
  return mx;
}

function sortByTime(msgs: MessageDTO[]): MessageDTO[] {
  return msgs.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Append fresh messages (by id) and re-sort chronologically. Used for the optimistic
// send: an earlier not-yet-polled message from someone else can still arrive AFTER
// mine, so sorting keeps order regardless of arrival.
export function mergeNew(
  prev: MessageDTO[],
  incoming: MessageDTO[],
): MessageDTO[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return prev;
  return sortByTime([...prev, ...fresh]);
}

// Reconcile a freshly-fetched window into the current list: upsert BY ID so EDITS and
// soft-DELETES by other users (which don't change created_at, so a created_at-delta
// poll would miss them) are reflected too. Returns the SAME reference when nothing
// changed, so React skips the re-render + the scroll-to-bottom.
export function reconcile(
  prev: MessageDTO[],
  incoming: MessageDTO[],
): MessageDTO[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    const cur = byId.get(m.id);
    if (
      !cur ||
      cur.body !== m.body ||
      cur.editedAt !== m.editedAt ||
      cur.deletedAt !== m.deletedAt
    ) {
      byId.set(m.id, m);
      changed = true;
    }
  }
  if (!changed) return prev;
  return sortByTime([...byId.values()]);
}
