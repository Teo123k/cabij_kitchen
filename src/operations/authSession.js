// Supabase can repeat SIGNED_IN during recovery and tab focus. Only identity changes
// should remount the workspace; otherwise unsaved project edits would be discarded.
export function observeAuthUser(client, { onUser, onError }) {
  let active = true, revision = 0, currentId;
  const emit = user => {
    const id = user?.id || null;
    if (!active || id === currentId) return;
    currentId = id;
    onUser(user || false);
  };
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (!active) return;
    if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' || session?.user) {
      revision++;
      emit(event === 'SIGNED_OUT' ? null : session?.user);
    }
  });
  const initialRevision = revision;
  Promise.resolve().then(() => client.auth.getUser()).then(({ data, error }) => {
    if (!active || revision !== initialRevision) return;
    if (error && error.name !== 'AuthSessionMissingError') onError(error);
    emit(data?.user);
  }).catch(error => {
    if (active && revision === initialRevision) { onError(error); emit(null); }
  });
  return () => { active = false; subscription.unsubscribe(); };
}
