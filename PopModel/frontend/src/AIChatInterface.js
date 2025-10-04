import React, { useState, useRef, useEffect } from 'react';
import { Send, Settings, Upload, Menu, X, Clock, ShoppingCart, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AIChatInterface({ authHeaders, onAdminRequested }) {
  const [messages, setMessages] = useState([
    { id: 1, role: 'assistant', content: 'Hello! How can I assist you today?', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [adminClicks, setAdminClicks] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [chatSessions, setChatSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'normal');

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const logoRef = useRef(null);
  const navigate = useNavigate();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);
  useEffect(() => {
    const cls = `theme-${theme}`;
    document.body.classList.remove('theme-normal', 'theme-light', 'theme-dark');
    document.body.classList.add(cls);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Load sessions and models
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/history', { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          setChatSessions((data.sessions || []).map((s, i) => ({ id: s.id, title: s.title || s.id, active: i === 0 })));
          if ((data.sessions || []).length) setCurrentSessionId(data.sessions[0].id);
        }
      } catch {}
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          const list = (data.models || []).map(m => typeof m === 'string' ? { id: m, label: m } : m);
          setAvailableModels(list);
          if (list.length) setSelectedModel(list[0].id);
        }
      } catch {}
    })();
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;
    const newMessage = { id: Date.now(), role: 'user', content: input, timestamp: new Date() };
    setMessages(prev => [...prev, newMessage]);
    const text = input;
    setInput('');
    try {
      const res = await fetch('/api/message', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: text, sessionId: currentSessionId }) });
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

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const newMessage = { id: Date.now(), role: 'user', content: `📎 Uploaded: ${file.name}`, timestamp: new Date() };
      setMessages(prev => [...prev, newMessage]);
    }
  };

  const handleLogoClick = () => {
    setAdminClicks(prev => prev + 1);
    if (adminClicks + 1 >= 5) { setShowAdmin(true); setAdminClicks(0); onAdminRequested?.(); }
    setTimeout(() => setAdminClicks(0), 3000);
  };

  const createNewChat = async () => {
    try {
      const res = await fetch('/api/history/new', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title: 'New chat' }) });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(prev => prev.map(s => ({ ...s, active: false })).concat([{ id: data.id, title: 'New chat', active: true }]));
        setCurrentSessionId(data.id);
        setMessages([{ id: 1, role: 'assistant', content: 'Hello! How can I assist you today?', timestamp: new Date() }]);
      }
    } catch {}
  };

  const switchSession = async (sessionId) => {
    setChatSessions(prev => prev.map(s => ({ ...s, active: s.id === sessionId })));
    setCurrentSessionId(sessionId);
    try {
      const res = await fetch(`/api/history/${sessionId}`, { headers: authHeaders() });
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
      const res = await fetch(`/api/history/${sessionId}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== sessionId));
        if (currentSessionId === sessionId) setCurrentSessionId(null);
      }
    } catch {}
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Sidebar */}
      <div className={`${showSidebar ? 'w-64' : 'w-0'} transition-all duration-300 bg-gray-800 border-r border-gray-700 overflow-hidden flex flex-col`}>
        <div className="p-4 border-b border-gray-700">
          <button 
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={20} />
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-xs text-gray-400 px-3 py-2 font-semibold">CHAT HISTORY</div>
          {chatSessions.map(session => (
            <div
              key={session.id}
              onClick={() => switchSession(session.id)}
              className={`group flex items-center justify-between px-3 py-2 mb-1 rounded-lg cursor-pointer transition-colors ${
                session.active ? 'bg-gray-700' : 'hover:bg-gray-700/50'
              }`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Clock size={16} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm truncate">{session.title}</span>
              </div>
              {chatSessions.length > 1 && (
                <button
                  onClick={(e) => deleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-opacity"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-700 space-y-2">
          <button 
            onClick={() => navigate('/buy')}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <ShoppingCart size={18} />
            Upgrade Plan
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSidebar(!showSidebar)}
              className="text-gray-400 hover:text-gray-100 transition-colors"
            >
              <Menu size={24} />
            </button>
            <div 
              ref={logoRef}
              onClick={handleLogoClick}
              className="text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent cursor-pointer select-none"
            >
              pop.ai
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {showAdmin && (
              <button className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors">
                Admin Panel
              </button>
            )}
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="text-gray-400 hover:text-gray-100 transition-colors"
            >
              <Upload size={20} />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="text-gray-400 hover:text-gray-100 transition-colors"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.map(message => (
            <div key={message.id} className={`mb-6 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl ${message.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'} rounded-2xl px-5 py-3 shadow-lg`}>
                <div className="text-sm mb-1 opacity-70">
                  {message.role === 'user' ? 'You' : 'pop.ai'}
                </div>
                <div className="text-gray-100 whitespace-pre-wrap">{message.content}</div>
                <div className="text-xs opacity-50 mt-2">
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <div className="max-w-4xl mx-auto flex gap-3 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message here..."
              rows="1"
              className="flex-1 bg-gray-700 text-gray-100 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />
            <button 
              onClick={handleSend}
              className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl transition-colors flex-shrink-0"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-100">
                <X size={24} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Model</label>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} className="w-full bg-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/config/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selectedModel }) });
                      if (!res.ok) throw new Error(await res.text());
                    } catch {}
                  }}
                  className="mt-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
                >
                  Apply Model
                </button>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Theme</label>
                <select value={theme} onChange={(e) => setTheme(e.target.value)} className="w-full bg-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="normal">Normal</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );
}
