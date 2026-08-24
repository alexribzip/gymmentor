// Pure chat logic shared by the client view and the coach inbox — kept out of
// the components so it can be unit-tested like the rest of lib/.

// Merge a polled page into the existing list without duplicates, ordered by id.
// Returns the existing array untouched when nothing is new (cheap re-renders).
export function mergeMessages(existing, incoming) {
  if (!incoming?.length) return existing
  const seen = new Set(existing.map(m => m.id))
  const add = incoming.filter(m => !seen.has(m.id))
  return add.length ? [...existing, ...add].sort((a, b) => a.id - b.id) : existing
}

export const lastId = messages => (messages.length ? messages[messages.length - 1].id : 0)
