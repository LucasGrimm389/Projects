import React, { useState, useRef, useEffect } from 'react';
import { Send, Settings, Upload, Plus, Trash2, X, MessageSquare, ShoppingCart, Edit2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';

export default function AIChatInterface({ authHeaders = () => ({ 'Content-Type': 'application/json' }), onAdminRequested }) {
  const [messages, setMessages] = useState([
    { id: 1, role: 'assistant', content: 'Hello! How can I assist you today?', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [adminClicks, setAdminClicks] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('pm_theme') || 'default');
  const [showTOS, setShowTOS] = useState(() => localStorage.getItem('pm_tosAccepted') !== 'true');
  const [tosAgreed, setTosAgreed] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]); // [{id, data, name}]
  const [chatSessions, setChatSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const [localAdminToken, setLocalAdminToken] = useState('');
  const [language, setLanguage] = useState(() => localStorage.getItem('pm_lang') || 'en');
  const [playingId, setPlayingId] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const navigate = useNavigate();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 52 * 4) + 'px';
    }
  }, [input]);

  // Paste handler: only PNG; keyboard shortcut Ctrl+A to open admin login
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type?.includes('image')) {
          const blob = items[i].getAsFile();
          if (blob && blob.type === 'image/png') {
            const reader = new FileReader();
            reader.onload = (ev) => {
              const img = { id: Date.now(), data: ev.target.result, name: `pasted-image-${Date.now()}.png` };
              setUploadedImages(prev => [...prev, img]);
            };
            reader.readAsDataURL(blob);
          } else {
            alert('Only PNG images are allowed');
          }
        }
      }
    };
    const handleKeyDown = (e) => {
      if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setShowAdminLogin(true);
      }
    };
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('paste', handlePaste); window.removeEventListener('keydown', handleKeyDown); };
  }, []);

  // Theme persistence
  useEffect(() => {
    localStorage.setItem('pm_theme', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('pm_lang', language);
  }, [language]);

  // Load sessions and models
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/history', { headers: headers() });
        if (res.ok) {
          const data = await res.json();
          const sessions = (data.sessions || []).map((s, i) => ({ id: s.id, title: s.title || s.id, active: i === 0, date: 'Today' }));
          setChatSessions(sessions);
          if (sessions.length) {
            setCurrentSessionId(sessions[0].id);
            // Load first session messages
            try {
              const res2 = await fetch(`/api/history/${sessions[0].id}`, { headers: headers() });
              if (res2.ok) {
                const d2 = await res2.json();
                const restored = (d2.messages || []).map((m, idx) => ({ id: idx + 1, role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text, timestamp: new Date(m.ts || Date.now()) }));
                if (restored.length) setMessages(restored);
              }
            } catch {}
          }
        }
      } catch {}
      try {
        const res = await fetch('/api/models', { headers: headers() });
        if (res.ok) {
          const data = await res.json();
          const list = (data.models || []).map(m => typeof m === 'string' ? { id: m, label: m } : m);
          setAvailableModels(list);
          // Try to sync with backend current model
          try {
            const cfg = await fetch('/api/config');
            if (cfg.ok) {
              const j = await cfg.json();
              const found = list.find(x => x.id === j.model);
              if (found) setSelectedModel(found.id);
              else if (list.length) setSelectedModel(list[0].id);
            } else if (list.length) setSelectedModel(list[0].id);
          } catch {
            if (list.length) setSelectedModel(list[0].id);
          }
        }
      } catch {}
    })();
  }, [localAdminToken]);

  // Merge headers from parent with local admin token
  const headers = () => {
    const h = { ...(authHeaders ? authHeaders() : { 'Content-Type': 'application/json' }) };
    if (localAdminToken) h['x-admin-token'] = localAdminToken;
    if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    return h;
  };

  const getThemeColors = () => {
    switch(theme) {
      case 'light':
        return {
          bg: 'bg-white',
          sidebar: 'bg-gray-100',
          messageBg: 'bg-gray-50',
          messageAlt: 'bg-white',
          text: 'text-gray-900',
          textSub: 'text-gray-600',
          border: 'border-gray-200',
          hover: 'hover:bg-gray-200',
          input: 'bg-white border-gray-300',
          modal: 'bg-white'
        };
      case 'dark':
        return {
          bg: 'bg-black',
          sidebar: 'bg-zinc-950',
          messageBg: 'bg-zinc-900',
          messageAlt: 'bg-black',
          text: 'text-white',
          textSub: 'text-gray-400',
          border: 'border-zinc-800',
          hover: 'hover:bg-zinc-900',
          input: 'bg-zinc-900 border-zinc-700',
          modal: 'bg-zinc-950'
        };
      default:
        return {
          bg: 'bg-[#343541]',
          sidebar: 'bg-[#202123]',
          messageBg: 'bg-[#444654]',
          messageAlt: 'bg-[#343541]',
          text: 'text-white',
          textSub: 'text-white/60',
          border: 'border-white/20',
          hover: 'hover:bg-[#2A2B32]',
          input: 'bg-[#40414F] border-black/10',
          modal: 'bg-[#202123]'
        };
    }
  };

  const colors = getThemeColors();

  const handleSend = async () => {
    if (!input.trim() && uploadedImages.length === 0) return;
    const newMessage = { id: Date.now(), role: 'user', content: input, images: [...uploadedImages], timestamp: new Date() };
    setMessages(prev => [...prev, newMessage]);
    const text = input;
    const imgs = uploadedImages.map(i => ({ dataUrl: i.data }));
    setInput('');
    setUploadedImages([]);
    try {
      // If admin, request faster responses by lowering maxTokens
      const body = { message: text, sessionId: currentSessionId, images: imgs };
      if (localAdminToken) { body.maxTokens = 256; }
      const res = await fetch('/api/message', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        if (!currentSessionId && data.sessionId) setCurrentSessionId(data.sessionId);
        setMessages(prev => [...prev, { id: Date.now()+1, role: 'assistant', content: data.reply || 'No response', timestamp: new Date() }]);
      } else {
        setMessages(prev => [...prev, { id: Date.now()+1, role: 'assistant', content: `Error: ${data.error || data.message || 'Unknown error'}`, timestamp: new Date() }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now()+1, role: 'assistant', content: `Error: ${String(e)}`, timestamp: new Date() }]);
    }
  };

  // Text to speech: fetch MP3 and play or download
  const tts = async (text, mode, id) => {
    try {
      const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: language }) });
      if (!res.ok) throw new Error('TTS request failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (mode === 'play') {
        const audio = new Audio(url);
        setPlayingId(id);
        audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
        await audio.play();
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'speech.mp3';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      alert('TTS failed: ' + (e?.message || e));
    }
  };

  // Simple client-side image generation using Canvas from a prompt (placeholder if no real API)
  const generateImageFromPrompt = async (prompt) => {
    const w = 512, h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1d4ed8');
    grad.addColorStop(1, '#9333ea');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Prompt text overlay
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 20px sans-serif';
    const words = (prompt || 'image').slice(0, 80);
    ctx.fillText(words, 16, h - 24);
    return canvas.toDataURL('image/png');
  };

  const handleGenerateImage = async () => {
    const p = prompt('Describe an image to generate');
    if (!p) return;
    const data = await generateImageFromPrompt(p);
    const msg = { id: Date.now(), role: 'assistant', content: `Generated image for: ${p}`, images: [{ id: Date.now()+1, data, name: 'generated.png' }], timestamp: new Date() };
    setMessages(prev => [...prev, msg]);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.includes('png')) { alert('Only PNG files are allowed'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = { id: Date.now(), data: ev.target.result, name: file.name };
      setUploadedImages(prev => [...prev, img]);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (id) => setUploadedImages(prev => prev.filter(img => img.id !== id));

  const handleLogoClick = () => {
    // Disabled per requested UI; use Ctrl+A to open admin login
  };

  const headerModelLabel = () => {
    const m = availableModels.find(x => x.id === selectedModel);
    return m?.label || 'pop';
  };

  const createNewChat = async () => {
    try {
      const res = await fetch('/api/history/new', { method: 'POST', headers: headers(), body: JSON.stringify({ title: 'New chat' }) });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(prev => prev.map(s => ({ ...s, active: false })).concat([{ id: data.id, title: 'New chat', active: true, date: 'Today' }]));
        setCurrentSessionId(data.id);
        setMessages([{ id: 1, role: 'assistant', content: 'Hello! How can I assist you today?', timestamp: new Date() }]);
      }
    } catch {}
  };

  const switchSession = async (sessionId) => {
    setChatSessions(prev => prev.map(s => ({ ...s, active: s.id === sessionId })));
    setCurrentSessionId(sessionId);
    try {
      const res = await fetch(`/api/history/${sessionId}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        const restored = (data.messages || []).map((m, i) => ({ id: i+1, role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text, timestamp: new Date(m.ts || Date.now()) }));
        setMessages(restored.length ? restored : [{ id: 1, role: 'assistant', content: 'Hello! How can I assist you today?', timestamp: new Date() }]);
      }
    } catch {}
  };

  const deleteSession = async (sessionId, e) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/history/${sessionId}`, { method: 'DELETE', headers: headers() });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== sessionId));
        if (currentSessionId === sessionId) setCurrentSessionId(null);
      }
    } catch {}
  };

  const startEditingChat = (sessionId, currentTitle, e) => {
    e.stopPropagation();
    setEditingChatId(sessionId);
    setEditingChatTitle(currentTitle || '');
  };
  const saveEditingChat = async (sessionId) => {
    try {
      const res = await fetch(`/api/history/${sessionId}/rename`, { method: 'POST', headers: headers(), body: JSON.stringify({ title: editingChatTitle || 'New chat' }) });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(cs => cs.map(s => s.id === sessionId ? { ...s, title: editingChatTitle || data.title || 'New chat' } : s));
      }
    } catch {}
    setEditingChatId(null);
    setEditingChatTitle('');
  };

  const handleAdminLogin = async () => {
    if (adminCode !== 'Pop91525') {
      alert('Incorrect admin code');
      setAdminCode('');
      return;
    }
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: adminCode }) });
      if (res.ok) {
        const data = await res.json();
        setLocalAdminToken(data.token);
        setShowAdmin(true);
        setShowAdminPanel(true);
        setShowAdminLogin(false);
        setAdminCode('');
      } else {
        alert('Admin login failed');
      }
    } catch {
      alert('Network error');
    }
  };

  const acceptTOS = () => {
    if (!tosAgreed) return;
    localStorage.setItem('pm_tosAccepted', 'true');
    setShowTOS(false);
  };

  return (
    <div className={`flex h-screen ${colors.bg} ${colors.text}`}>
      {/* Terms of Service Modal */}
      {showTOS && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className={`${colors.modal} rounded-lg p-6 max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh]`}>
            <h1 className="text-2xl font-bold mb-4">Terms of Service</h1>
            <div className="flex-1 overflow-y-auto border border-gray-600 rounded-lg p-4 mb-4">
              <div className="space-y-4 text-sm leading-relaxed">
                <p className="text-xs opacity-60">Last Updated: October 4, 2025</p>
                <section>
                  <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
                  <p className={colors.textSub}>By accessing and using this AI Assistant service, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to these terms, please do not use this service.</p>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">2. Use of Service</h2>
                  <p className={colors.textSub}>This service is provided for general information and assistance purposes. You agree to use this service responsibly and in accordance with all applicable laws and regulations.</p>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">3. Data Collection and Usage</h2>
                  <p className={colors.textSub}><strong>We collect and use your data for the following purposes:</strong></p>
                  <ul className={`list-disc ml-6 mt-2 space-y-1 ${colors.textSub}`}>
                    <li>To provide and improve our AI services</li>
                    <li>To train and enhance our AI models</li>
                    <li>To personalize your experience</li>
                    <li>To maintain chat history for your convenience</li>
                    <li>To analyze usage patterns and service performance</li>
                    <li>To detect and prevent abuse or fraudulent activity</li>
                    <li>To comply with legal obligations</li>
                  </ul>
                  <p className={`mt-3 ${colors.textSub}`}>Your conversations, uploaded files, and usage data may be stored and analyzed to improve our services. We implement appropriate security measures to protect your data.</p>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">4. Disclaimer of Liability</h2>
                  <p className={colors.textSub}><strong>We are NOT responsible for:</strong></p>
                  <ul className={`list-disc ml-6 mt-2 space-y-1 ${colors.textSub}`}>
                    <li>The accuracy, completeness, or reliability of any information provided by the AI</li>
                    <li>Any decisions made based on AI-generated content</li>
                    <li>Any damages, losses, or harm resulting from use of this service</li>
                    <li>Any errors, inaccuracies, or omissions in AI responses</li>
                    <li>Medical, legal, financial, or professional advice (AI responses are not professional advice)</li>
                    <li>Third-party content, links, or services accessed through our platform</li>
                    <li>Service interruptions, downtime, or data loss</li>
                    <li>Unauthorized access to your account or data breaches</li>
                    <li>Any consequences of sharing sensitive or confidential information with the AI</li>
                  </ul>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">5. User Responsibilities</h2>
                  <p className={colors.textSub}>You are responsible for maintaining the confidentiality of your account, the content you submit, and for all activities under your account. Do not share personal, sensitive, or confidential information.</p>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">6. Prohibited Uses</h2>
                  <p className={colors.textSub}>You may not use this service for illegal activities, to harm others, to generate malicious content, or to violate the rights of any third party.</p>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">7. Service Modifications</h2>
                  <p className={colors.textSub}>We reserve the right to modify, suspend, or discontinue the service at any time without notice. We may also update these terms periodically.</p>
                </section>
                <section>
                  <h2 className="text-lg font-semibold mb-2">8. No Warranty</h2>
                  <p className={colors.textSub}>This service is provided "as is" without any warranties, express or implied. We make no guarantees about the service's availability, reliability, or suitability for any purpose.</p>
                </section>
              </div>
            </div>
            <div className="space-y-3 border-t border-gray-600 pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={tosAgreed} onChange={(e) => setTosAgreed(e.target.checked)} className="w-5 h-5 rounded accent-blue-600 cursor-pointer" />
                <span className="text-sm">I have read and agree to the Terms of Service</span>
              </label>
              <button onClick={acceptTOS} disabled={!tosAgreed} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors">Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`${showSidebar ? 'w-64' : 'w-0'} transition-all duration-300 ${colors.sidebar} flex flex-col overflow-hidden`}>
        <div className="p-2">
          <button onClick={createNewChat} className={`w-full flex items-center gap-3 text-left px-3 py-3 text-sm ${colors.hover} rounded-md ${colors.border} border transition-colors`}>
            <Plus size={16} />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className={`text-xs ${colors.textSub} px-3 py-2 font-medium`}>Today</div>
          {chatSessions.map(session => (
            <div key={session.id} onClick={() => switchSession(session.id)} className={`group flex items-center gap-3 px-3 py-3 mb-1 rounded-md cursor-pointer transition-colors relative ${session.active ? colors.bg : colors.hover}`}>
              <MessageSquare size={16} className={`flex-shrink-0 ${colors.textSub}`} />
              {editingChatId === session.id ? (
                <input type="text" value={editingChatTitle} onChange={(e) => setEditingChatTitle(e.target.value)} onBlur={() => saveEditingChat(session.id)} onKeyPress={(e) => e.key === 'Enter' && saveEditingChat(session.id)} className={`flex-1 bg-transparent border-b ${colors.border} focus:outline-none text-sm`} autoFocus onClick={(e) => e.stopPropagation()} />
              ) : (
                <span className="text-sm flex-1 truncate">{session.title}</span>
              )}
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                <button onClick={(e) => startEditingChat(session.id, session.title, e)} className={`${colors.textSub} hover:text-current transition-opacity`}>
                  <Edit2 size={14} />
                </button>
                {chatSessions.length > 1 && (
                  <button onClick={(e) => deleteSession(session.id, e)} className={`${colors.textSub} hover:text-red-400 transition-opacity`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className={`${colors.border} border-t p-2 space-y-1`}>
          <button onClick={() => setShowUpgrade(true)} className={`w-full flex items-center gap-3 text-left px-3 py-3 text-sm ${colors.hover} rounded-md transition-colors`}>
            <ShoppingCart size={16} />
            Upgrade to Plus V2
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className={`w-full flex items-center gap-3 text-left px-3 py-3 text-sm ${colors.hover} rounded-md transition-colors`}>
            <Settings size={16} />
            Settings
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 ${colors.border} border-b`}>
          <button onClick={() => setShowSidebar(!showSidebar)} className={`p-1 ${colors.hover} rounded-md transition-colors`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
          <div onClick={handleLogoClick} className="absolute left-1/2 transform -translate-x-1/2 font-semibold text-sm cursor-pointer select-none">{headerModelLabel()}</div>
          <div className="flex items-center gap-2">
            {showAdmin && (
              <button onClick={() => setShowAdminPanel(true)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs transition-colors">Admin</button>
            )}
            <button onClick={() => fileInputRef.current?.click()} className={`p-1 ${colors.hover} rounded-md transition-colors`}>
              <Upload size={20} />
            </button>
            <button onClick={handleGenerateImage} className={`p-1 ${colors.hover} rounded-md transition-colors`} title="Generate image">
              {/* simple stars icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.2 4.5L19 7l-3.5 3.4L16.2 15 12 12.8 7.8 15l.7-4.6L5 7l4.8-.5L12 2z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.map(message => (
            <div key={message.id} className={`${message.role === 'assistant' ? colors.messageBg : colors.messageAlt} px-4 py-6`}>
              <div className="max-w-3xl mx-auto flex gap-6">
                <div className="w-8 h-8 flex-shrink-0 rounded-sm bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold">{message.role === 'user' ? 'U' : 'P'}</div>
                <div className="flex-1 space-y-2">
                  {message.images && message.images.length > 0 && (
                    <div className="flex flex-wrap gap-3 mb-2">
                      {message.images.map(img => (
                        <div key={img.id} className="flex flex-col items-start gap-1">
                          <img src={img.data} alt={img.name} className="max-w-xs max-h-48 rounded-lg border border-gray-600" />
                          {/* Download PNG button only for images */}
                          <button onClick={() => { try { const a = document.createElement('a'); a.href = img.data; a.download = (img.name || 'image') + (img.data.startsWith('data:image/png') ? '' : '.png'); document.body.appendChild(a); a.click(); a.remove(); } catch {} }} className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/10">Download PNG</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.content && (
                    <div className="space-y-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
                        {String(message.content || '')}
                      </ReactMarkdown>
                      {message.role === 'assistant' && (
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => tts(String(message.content||''), 'play', message.id)} className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/10">Play audio</button>
                          <button onClick={() => tts(String(message.content||''), 'download', message.id)} className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/10">Download MP3</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="px-4 pb-6 pt-4">
          <div className="max-w-3xl mx-auto">
            {uploadedImages.length > 0 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-2">
                {uploadedImages.map(img => (
                  <div key={img.id} className="relative flex-shrink-0 group">
                    <img src={img.data} alt={img.name} className="h-20 w-20 object-cover rounded-lg border border-gray-600" />
                    <button onClick={() => removeImage(img.id)} className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className={`relative flex items-end ${colors.input} rounded-lg shadow-lg border`}>
              <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={handleKeyPress} placeholder="Send a message..." rows="1" className={`flex-1 bg-transparent ${colors.text} rounded-lg px-4 py-3 pr-12 resize-none focus:outline-none ${theme === 'light' ? 'placeholder-gray-400' : 'placeholder-white/40'} max-h-52`} />
              {/* Speech-to-text mic (Web Speech API) */}
              <button onClick={() => {
                try {
                  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                  if (!SR) return alert('Speech recognition not supported in this browser.');
                  const rec = new SR();
                  rec.lang = language || 'en-US';
                  rec.interimResults = false;
                  rec.maxAlternatives = 1;
                  rec.onresult = (ev) => { const text = ev.results?.[0]?.[0]?.transcript; if (text) setInput(prev => (prev ? prev + ' ' : '') + text); };
                  rec.onerror = () => {};
                  rec.start();
                } catch (e) { alert('Could not start speech recognition'); }
              }} className={`absolute right-11 bottom-2 p-2 ${theme === 'light' ? 'bg-gray-200 hover:bg-gray-300' : 'bg-white/10 hover:bg-white/20'} ${colors.text} rounded-md transition-colors`} title="Speak">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 14a3 3 0 003-3V7a3 3 0 10-6 0v4a3 3 0 003 3z" stroke="currentColor"/><path d="M19 11a7 7 0 01-14 0" stroke="currentColor"/><path d="M12 19v3" stroke="currentColor"/></svg>
              </button>
              <button onClick={handleSend} disabled={!input.trim() && uploadedImages.length === 0} className={`absolute right-2 bottom-2 p-2 ${theme === 'light' ? 'bg-gray-200 hover:bg-gray-300' : 'bg-white/10 hover:bg-white/20'} disabled:opacity-40 disabled:hover:bg-white/10 ${colors.text} rounded-md transition-colors`}>
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className={`${colors.modal} rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className={colors.textSub}><X size={20} /></button>
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`w-full ${colors.input} rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 border`}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                  <option value="it">Italiano</option>
                  <option value="pt">Português</option>
                  <option value="ru">Русский</option>
                  <option value="zh-CN">中文 (简体)</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="ar">العربية</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Model</label>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} className={`w-full ${colors.input} rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 border`}>
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <button onClick={async () => { try { const res = await fetch('/api/config/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selectedModel }) }); if (!res.ok) throw new Error(await res.text()); } catch {} }} className="mt-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded">Apply Model</button>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Theme</label>
                <select value={theme} onChange={(e) => setTheme(e.target.value)} className={`w-full ${colors.input} rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 border`}>
                  <option value="default">Default (System)</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgrade && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowUpgrade(false)}>
          <div className={`${colors.modal} rounded-2xl p-8 max-w-4xl w-full shadow-2xl`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold">Upgrade to Plus V2</h2>
              <button onClick={() => setShowUpgrade(false)} className={colors.textSub}><X size={24} /></button>
            </div>
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className={`${colors.input} border-2 rounded-xl p-6`}>
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold mb-2">Free</h3>
                  <div className="text-4xl font-bold mb-2">$0</div>
                  <div className={`text-sm ${colors.textSub}`}>per month</div>
                </div>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Access to pop v1.5</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Standard response speed</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Basic chat history</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">PNG image uploads</span></li>
                  <li className="flex items-start gap-2"><span className="text-red-500 mt-1">✗</span><span className="text-sm opacity-50">Priority access during high traffic</span></li>
                  <li className="flex items-start gap-2"><span className="text-red-500 mt-1">✗</span><span className="text-sm opacity-50">Advanced AI models (pop v2)</span></li>
                </ul>
                <button className={`w-full ${colors.input} border py-3 rounded-lg font-medium`} disabled>Current Plan</button>
              </div>
              <div className="border-2 border-blue-500 rounded-xl p-6 bg-gradient-to-br from-blue-500/10 to-purple-500/10 relative overflow-hidden">
                <div className="absolute top-4 right-4 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">RECOMMENDED</div>
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold mb-2">Plus V2</h3>
                  <div className="text-4xl font-bold mb-2">$20</div>
                  <div className={`text-sm ${colors.textSub}`}>per month</div>
                </div>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Access to pop v2</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Priority response speed (~4x)</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Unlimited history & exports</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Advanced image analysis</span></li>
                  <li className="flex items-start gap-2"><span className="text-green-500 mt-1">✓</span><span className="text-sm">Early features access</span></li>
                </ul>
                <button onClick={() => { setShowUpgrade(false); navigate('/buy'); }} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-3 rounded-lg font-medium transition-all shadow-lg">Upgrade Now</button>
              </div>
            </div>
            <div className={`${colors.input} border rounded-xl p-4`}>
              <p className="text-sm text-center">🔒 Secure payment powered by Stripe • Cancel anytime • 30-day money-back guarantee</p>
            </div>
          </div>
        </div>
      )}

      {/* Admin Login Modal */}
      {showAdminLogin && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowAdminLogin(false)}>
          <div className={`${colors.modal} rounded-xl p-6 max-w-sm w-full shadow-2xl`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-red-500">Admin Access</h2>
              <button onClick={() => setShowAdminLogin(false)} className={colors.textSub}><X size={20} /></button>
            </div>
            <p className={`text-sm ${colors.textSub} mb-4`}>Enter the admin code to access the admin panel</p>
            <input type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleAdminLogin()} placeholder="Enter admin code" className={`w-full ${colors.input} border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-4`} autoFocus />
            <button onClick={handleAdminLogin} className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-lg font-medium transition-colors">Access Admin Panel</button>
            <p className="text-xs opacity-50 mt-3 text-center">Default code: Pop91525</p>
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {showAdminPanel && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowAdminPanel(false)}>
          <div className={`${colors.modal} rounded-xl p-6 max-w-2xl w-full shadow-2xl`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-red-500">Admin Panel</h2>
              <button onClick={() => setShowAdminPanel(false)} className={colors.textSub}><X size={24} /></button>
            </div>
            <div className="space-y-4">
              <div className={`${colors.input} border rounded-lg p-4`}>
                <h3 className="font-semibold mb-2">System Status</h3>
                <div className="text-sm ${colors.textSub}">Admin mode active. You have access to all models and faster responses.</div>
              </div>
            </div>
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".png" onChange={handleFileUpload} className="hidden" />
    </div>
  );
}
