import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import BuyPage from './BuyPage';
import AIChatInterface from './AIChatInterface';
import './App.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState([
    { sender: 'popmodel', text: 'Hello! I am pop.ai, your assistant. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [googleClientId, setGoogleClientId] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState(null);
  const idTokenRef = useRef('');
  const [adminToken, setAdminToken] = useState('');
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  // New UI states
  const [pendingImages, setPendingImages] = useState([]); // [{dataUrl}]
  const [renaming, setRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  // Generation controls
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'normal');

  useEffect(() => {
    // Load current config on mount
    const loadConfig = async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          setCurrentModel(data.model);
          setSelectedModel(data.model);
          if (data.clientId) setGoogleClientId(data.clientId);
          setAuthRequired(!!data.authRequired);
        }
      } catch {
        // ignore
      }
    };
    const loadModels = async () => {
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          const list = (data.models || []).map(m => typeof m === 'string' ? { id: m, label: m } : m);
          setAvailableModels(list);
          // Keep selection in sync if current not present
          if (list.length && !list.find(x => x.id === selectedModel || x.label === selectedModel)) {
            setSelectedModel(list[0].id);
          }
        }
      } catch {
        // ignore
      }
    };
    loadConfig();
    loadModels();
  }, []);

  // Apply theme to document
  useEffect(() => {
    const cls = `theme-${theme}`;
    document.body.classList.remove('theme-normal', 'theme-light', 'theme-dark');
    document.body.classList.add(cls);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Initialize Google Sign-In (retry until script loads)
  const gsiInitRef = useRef(false);
  useEffect(() => {
    if (!googleClientId || gsiInitRef.current) return;
    const tryInit = () => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        gsiInitRef.current = true;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (resp) => {
            idTokenRef.current = resp.credential;
            try { const payload = JSON.parse(atob(resp.credential.split('.')[1])); setUser({ email: payload.email, name: payload.name }); } catch {}
            loadHistory();
          }
        });
        const el = document.getElementById('googleSignInBtn');
        if (el) window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large' });
      } else {
        setTimeout(tryInit, 400);
      }
    };
    tryInit();
  }, [googleClientId]);

  const authHeaders = () => {
    const h = { 'Content-Type': 'application/json' };
    if (idTokenRef.current) h['Authorization'] = `Bearer ${idTokenRef.current}`;
    if (adminToken) h['x-admin-token'] = adminToken;
    return h;
  };

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/history', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
        if (!activeSession && (data.sessions || []).length) {
          setActiveSession((data.sessions || [])[0].id);
        }
      }
    } catch {}
  };

  const promptAdminLogin = async () => {
    const code = prompt('Enter admin code');
    if (!code) return;
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      if (res.ok) {
        const data = await res.json();
        setAdminToken(data.token);
        setMessages(msgs => [...msgs, { sender: 'popmodel', text: 'Admin mode enabled.' }]);
      } else {
        alert('Invalid code');
      }
    } catch {}
  };

  // Keyboard shortcut: Shift + A for admin
  useEffect(() => {
    const onKey = (e) => {
      if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        promptAdminLogin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() && pendingImages.length === 0) return;
    const userText = input;
    setMessages(msgs => [...msgs, { sender: 'user', text: userText }]);
    setLoading(true);

    try {
      const res = await fetch('/api/message', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: userText, sessionId: activeSession, images: pendingImages })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Expected JSON, received:', text.slice(0, 300));
        throw new Error('Received non-JSON response from API');
      }

      const data = await res.json();
      if (!res.ok) {
        const upstreamMsg = data?.data?.error?.message || data?.error || data?.message || JSON.stringify(data).slice(0, 200);
        throw new Error(upstreamMsg);
      }
      if (!activeSession && data.sessionId) {
        setActiveSession(data.sessionId);
        loadHistory();
        // Auto-title the chat based on the first user message
        const titleBase = (userText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (titleBase) {
          try {
            await fetch(`/api/history/${data.sessionId}/rename`, {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ title: titleBase })
            });
            setTitleInput(titleBase);
          } catch {}
        }
      }
      setMessages(msgs => [...msgs, { sender: 'popmodel', text: (data.admin ? '[ADMIN] ' : '') + (data.reply || 'PopModel response error.') }]);
    } catch (err) {
      const hint = String(err?.message || err);
      setMessages(msgs => [
        ...msgs,
        { sender: 'popmodel', text: `Sorry, I ran into an issue: ${hint}` }
      ]);
    } finally {
      setLoading(false);
      setInput('');
      setPendingImages([]);
    }
  };

  // Code block with improved copy UI
  const CodeBlock = ({ inline, className, children, ...props }) => {
    const [copied, setCopied] = useState(false);
    const txt = String(children || '');
    if (inline) return <code className={className} {...props}>{txt}</code>;
    const lang = (className || '').replace('language-', '') || 'text';
    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(txt);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {}
    };
    return (
      <div className="pm-codeblock">
        <button className="pm-copy" onClick={onCopy} title="Copy code" aria-label="Copy code">
          {/* clipboard icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 3h6a2 2 0 012 2v1h-2V5H9v1H7V5a2 2 0 012-2z" fill="currentColor"/>
            <path d="M7 7h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
        </button>
        {copied && <span className="pm-copied">Copied!</span>}
        <pre className={className}><code className={`language-${lang}`}>{txt}</code></pre>
      </div>
    );
  };

  // Markdown renderers: use CodeBlock
  const renderers = {
    code: CodeBlock
  };

  return (
    <div className="pm-root">
      <aside className={`pm-sidebar${sidebarOpen ? '' : ' closed'}`}>
  <div className="pm-logo">pop.ai</div>
  <nav className="pm-nav">
          <button className="pm-nav-btn" onClick={async () => {
            try {
              const res = await fetch('/api/history/new', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title: 'New chat' }) });
              if (res.ok) {
                const data = await res.json();
                setActiveSession(data.id);
                loadHistory();
                setMessages([{ sender: 'popmodel', text: 'New chat started.' }]);
              }
            } catch {}
          }}>New Chat</button>
          <button className="pm-nav-btn" onClick={() => navigate('/history')}>History</button>
          <button className="pm-nav-btn" onClick={() => setSettingsOpen(true)}>Settings</button>
          <Link className="pm-nav-btn" to="/buy">Buy pop.ai</Link>
          <div style={{ padding: '8px' }}>
            {!user && authRequired && <div id="googleSignInBtn"></div>}
            {user && <div className="pm-note">Signed in as {user.name || user.email}</div>}
          </div>
          <div style={{ padding: '8px' }}>
            <button className="pm-nav-btn" onClick={promptAdminLogin}>Admin</button>
          </div>
          <div style={{ padding: '8px' }}>
            <div className="pm-note">Sessions:</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 180, overflowY: 'auto' }}>
              {sessions.map(s => (
                <li key={s.id}>
                  <button className="pm-nav-btn" onClick={async () => {
                    setActiveSession(s.id);
                    try {
                      const res = await fetch(`/api/history/${s.id}`, { headers: authHeaders() });
                      if (res.ok) {
                        const data = await res.json();
                        const restored = (data.messages || []).map(m => ({ sender: m.role === 'assistant' ? 'popmodel' : 'user', text: (m.admin ? '[ADMIN] ' : '') + m.text }));
                        setMessages(restored.length ? restored : [{ sender: 'popmodel', text: 'Loaded chat.' }]);
                        setTitleInput(data.title || '');
                      }
                    } catch {}
                  }}>{s.title || s.id}</button>
                  <div style={{ display: 'inline-flex', gap: 6, marginLeft: 6 }}>
                    <button
                      className="pm-nav-btn"
                      style={{ fontSize: '0.9em', padding: '8px 12px' }}
                      title="Rename"
                      onClick={() => { setRenaming(true); setActiveSession(s.id); setTitleInput(s.title || ''); }}
                    >✏️ Rename</button>
                    <button
                      className="pm-nav-btn"
                      style={{ fontSize: '0.9em', padding: '8px 12px' }}
                      title="Rename"
                      onClick={() => { setRenaming(true); setActiveSession(s.id); setTitleInput(s.title || ''); }}
                    >✏️ Rename</button>
                    <button
                      className="pm-nav-btn"
                      style={{ fontSize: '0.9em', padding: '8px 12px' }}
                      title="Delete chat"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm('Delete this chat permanently?')) return;
                        try {
                          const res = await fetch(`/api/history/${s.id}`, { method: 'DELETE', headers: authHeaders() });
                          if (res.ok) {
                            setSessions(ss => ss.filter(x => x.id !== s.id));
                            if (activeSession === s.id) {
                              setActiveSession(null);
                              setMessages([{ sender: 'popmodel', text: 'Chat deleted.' }]);
                            }
                          }
                        } catch {}
                      }}
                    >🗑️ Delete</button>
                  </div>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
              <button className="pm-nav-btn" onClick={async () => {
                if (!confirm('Clear ALL chats? This cannot be undone.')) return;
                try { const res = await fetch('/api/history/clear', { method: 'POST', headers: authHeaders() }); if (res.ok) { setSessions([]); setActiveSession(null); setMessages([{ sender: 'popmodel', text: 'All chats cleared.' }]); } } catch {}
              }}>Clear All</button>
            </div>
          </div>
        </nav>
        <div className="pm-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '<' : '>'}
        </div>
  </aside>
      {/* Hide the sidebar on the History page for a clean full-page view */}
      <main
        className="pm-main"
        onPaste={async (e) => {
          try {
            const items = Array.from(e.clipboardData?.items || []);
            const imgs = [];
            for (const it of items) {
              if (it.type && it.type.startsWith('image/')) {
                const file = it.getAsFile();
                if (file) {
                  const dataUrl = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
                  imgs.push({ dataUrl });
                }
              }
            }
            if (imgs.length) setPendingImages(prev => [...prev, ...imgs]);
          } catch {}
        }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={async (e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer?.files || []);
          const imgs = [];
          for (const f of files) {
            if (f.type && f.type.startsWith('image/')) {
              const dataUrl = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(f); });
              imgs.push({ dataUrl });
            }
          }
          if (imgs.length) setPendingImages(prev => [...prev, ...imgs]);
        }}
      >
        <Routes>
          {/* Classic UI removed per request; only Tailwind UI at '/' */}
          <Route path="/" element={<AIChatInterface authHeaders={authHeaders} onAdminRequested={promptAdminLogin} />} />
          <Route path="/history" element={
            <HistoryPage
              sessions={sessions}
              authHeaders={authHeaders}
              reloadSessions={loadHistory}
              openSession={async (sid) => {
                try {
                  const res = await fetch(`/api/history/${sid}`, { headers: authHeaders() });
                  if (res.ok) {
                    const data = await res.json();
                    setActiveSession(data.id);
                    const restored = (data.messages || []).map(m => ({ sender: m.role === 'assistant' ? 'popmodel' : 'user', text: (m.admin ? '[ADMIN] ' : '') + m.text }));
                    setMessages(restored.length ? restored : [{ sender: 'popmodel', text: 'Loaded chat.' }]);
                    setTitleInput(data.title || '');
                    navigate('/');
                  }
                } catch {}
              }}
              onClose={() => {
                if (window.history.length > 1) navigate(-1);
                else navigate('/');
              }}
            />
          } />
          <Route path="/buy" element={<BuyPage />} />
        </Routes>
      </main>
      
      {settingsOpen && (
        <div className="pm-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <div className="pm-modal-body">
              <label className="pm-field">
                <span>Model</span>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
              <div className="pm-note">Current: {currentModel || 'unknown'}</div>
              <hr />
              <label className="pm-field">
                <span>Theme</span>
                <select value={theme} onChange={e => setTheme(e.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>
            <div className="pm-modal-footer">
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button className="pm-primary" onClick={async () => {
                try {
                  const res = await fetch('/api/config/model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: selectedModel })
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setCurrentModel(data.model);
                    setSettingsOpen(false);
                    setMessages(msgs => [...msgs, { sender: 'popmodel', text: `Model switched to: ${data.model}.` }]);
                    // Only redirect to Buy if selecting the payment model AND not in admin mode
                    const chosen = availableModels.find(m => m.id === selectedModel);
                    if (chosen && /payment/i.test(chosen.label) && !adminToken) {
                      navigate('/buy');
                    }
                  } else {
                    const ct = res.headers.get('content-type') || '';
                    let text = await res.text();
                    if (ct.includes('application/json')) {
                      try { const j = JSON.parse(text); text = j.message || JSON.stringify(j); } catch {}
                    }
                    setMessages(msgs => [...msgs, { sender: 'popmodel', text: `Failed to set model: ${res.status} ${text}` }]);
                  }
                } catch (e) {
                  setMessages(msgs => [...msgs, { sender: 'popmodel', text: `Failed to set model: ${String(e)}` }]);
                }
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {renaming && (
        <div className="pm-modal-backdrop" onClick={() => setRenaming(false)}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <div className="pm-modal-header">Rename chat</div>
            <div className="pm-modal-body">
              <input type="text" value={titleInput} onChange={e => setTitleInput(e.target.value)} placeholder="Chat title" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }} />
            </div>
            <div className="pm-modal-footer">
              <button onClick={() => setRenaming(false)}>Cancel</button>
              <button className="pm-primary" onClick={async () => {
                try {
                  if (!activeSession) return setRenaming(false);
                  const res = await fetch(`/api/history/${activeSession}/rename`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title: titleInput }) });
                  if (res.ok) {
                    const data = await res.json();
                    setSessions(ss => ss.map(x => x.id === data.id ? { ...x, title: data.title } : x));
                  }
                } catch {}
                setRenaming(false);
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

// Full-screen History page component
function HistoryPage({ sessions, authHeaders, reloadSessions, openSession, onClose }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { reloadSessions(); }, []); // load sessions on mount

  const handleDelete = async (id) => {
    if (!confirm('Delete this chat? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/history/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) {
        await reloadSessions();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Clear ALL chats? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/history/clear', { method: 'POST', headers: authHeaders() });
      if (res.ok) await reloadSessions();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pm-history-root">
      <div className="pm-history-header">
        <div className="pm-history-title">History</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="pm-history-delete" disabled={busy} onClick={handleClearAll} title="Clear all">Clear All</button>
          <button className="pm-history-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <div className="pm-history-list">
        {(sessions || []).length === 0 && (
          <div className="pm-history-empty">No chats yet.</div>
        )}
        <ul>
          {sessions.map(s => (
            <li key={s.id} className="pm-history-item">
              <button className="pm-history-open" onClick={() => openSession(s.id)} title={s.title || s.id}>
                <div className="pm-history-title-text">{s.title || s.id}</div>
                {s.updatedAt && <div className="pm-history-sub">{new Date(s.updatedAt).toLocaleString()}</div>}
              </button>
              <div style={{ display: 'inline-flex', gap: 8 }}>
                <button className="pm-history-delete" disabled={busy} onClick={() => handleDelete(s.id)} title="Delete">🗑️</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
