(function(){
  const listeners = [];
  window.__upserts = JSON.parse(sessionStorage.getItem('__ups') || '[]');
  window.__remoteRow = JSON.parse(sessionStorage.getItem('__row') || 'null');
  function sess(){ try { return JSON.parse(sessionStorage.getItem('__mock_session')); } catch(_) { return null; } }
  function setSess(s){ if (s) sessionStorage.setItem('__mock_session', JSON.stringify(s)); else sessionStorage.removeItem('__mock_session'); }
  window.__fireAuth = function(evt, s){ setSess(s); listeners.forEach(cb => cb(evt, s)); };
  window.supabase = { createClient: function(){
    return {
      auth: {
        getSession: async () => ({ data: { session: sess() }, error: null }),
        getUser: async () => ({ data: { user: sess() ? sess().user : null }, error: null }),
        onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
        signOut: async () => { setSess(null); listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
        signInWithOAuth: async () => ({ error: null }),
        signInWithOtp: async () => ({ error: null })
      },
      from: (table) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: window.__remoteRow, error: null }) }) }),
        upsert: async (payload) => { window.__upserts.push(JSON.parse(JSON.stringify(payload))); window.__remoteRow = payload; sessionStorage.setItem('__ups', JSON.stringify(window.__upserts)); sessionStorage.setItem('__row', JSON.stringify(payload)); return { error: null }; }
      })
    };
  }};
})();
