import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import BuyPage from './BuyPage';
import './App.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

function App() {
  const navigate = useNavigate();
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
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [systemPrompt, setSystemPrompt] = useState('');

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
        body: JSON.stringify({ message: userText, sessionId: activeSession, images: pendingImages, temperature, maxTokens, system: systemPrompt })
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
          <button className="pm-nav-btn" onClick={loadHistory}>History</button>
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
                  <button
                    className="pm-nav-btn"
                    style={{ fontSize: '0.9em', padding: '8px 12px', marginLeft: 6 }}
                    title="Rename"
                    onClick={() => { setRenaming(true); setActiveSession(s.id); setTitleInput(s.title || ''); }}
                  >✏️ Rename</button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="pm-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '<' : '>'}
        </div>
      </aside>
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
          <Route path="/" element={
            <>
              <div className="pm-header">
                <span>pop.ai</span>
                <span style={{ marginLeft: 8 }} className="pm-badge">{currentModel || 'model'}</span>
                {adminToken && <span className="pm-badge pm-badge-admin" title="Admin">Admin</span>}
              </div>
              <div className="pm-chat-messages">
                {messages.map((msg, idx) => (
                  <div key={idx} className={msg.sender === 'popmodel' ? 'popmodel-message' : 'user-message'}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={renderers}>
                      {msg.text || ''}
                    </ReactMarkdown>
                  </div>
                ))}
                {loading && <div className="popmodel-message loading">Thinking...</div>}
              </div>
              <div className="pm-chat-input">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Type your message..."
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    const next = [];
                    for (const f of files) {
                      const dataUrl = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(f); });
                      next.push({ dataUrl });
                    }
                    setPendingImages(next);
                  }}
                  style={{ maxWidth: 220 }}
                />
                <button onClick={sendMessage} disabled={loading}>Send</button>
              </div>
              {pendingImages.length > 0 && (
                <div className="pm-attachments" style={{ display: 'flex', gap: 6, padding: '0 16px 12px', flexWrap: 'wrap' }}>
                  {pendingImages.map((img, i) => (
                    <img key={i} src={img.dataUrl} alt={`preview-${i}`} style={{ maxHeight: 80, borderRadius: 6, border: '1px solid #e5e7eb' }} />
                  ))}
                  <button className="pm-mini-btn" onClick={() => setPendingImages([])}>Clear</button>
                </div>
              )}
            </>
          }/>
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
                <span>Temperature</span>
                <input type="range" min="0" max="1" step="0.05" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} />
                <span style={{ width: 36, textAlign: 'right' }}>{temperature.toFixed(2)}</span>
              </label>
              <label className="pm-field">
                <span>Max tokens</span>
                <input type="number" min="128" max="4096" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value || '0', 10) || 1024)} />
              </label>
              <label className="pm-field" style={{ alignItems: 'flex-start' }}>
                <span>System</span>
                <textarea rows={3} style={{ flex: 1 }} placeholder="Optional system prompt (tone/instructions)" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />
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
