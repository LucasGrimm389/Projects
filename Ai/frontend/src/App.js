import React, { useState } from 'react';
import './App.css';

function App() {
  const [messages, setMessages] = useState([
    { sender: 'popmodel', text: 'Hello! I am PopModel, your assistant. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const sendMessage = async () => {
    if (!input.trim()) return;
    setMessages([...messages, { sender: 'user', text: input }]);
    setLoading(true);
    // Call backend API
    const res = await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input })
    });
    const data = await res.json();
    setMessages(msgs => [...msgs, { sender: 'popmodel', text: data.reply || 'PopModel response error.' }]);
    setLoading(false);
    setInput('');
  };

  return (
    <div className="pm-root">
      <aside className={`pm-sidebar${sidebarOpen ? '' : ' closed'}`}>
        <div className="pm-logo">PopModel</div>
        <nav className="pm-nav">
          <button className="pm-nav-btn">New Chat</button>
          <button className="pm-nav-btn">History</button>
          <button className="pm-nav-btn">Settings</button>
        </nav>
        <div className="pm-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '<' : '>'}
        </div>
      </aside>
      <main className="pm-main">
        <div className="pm-header">PopModel Assistant</div>
        <div className="pm-chat-messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={msg.sender === 'popmodel' ? 'popmodel-message' : 'user-message'}>
              {msg.text}
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
          <button onClick={sendMessage} disabled={loading}>Send</button>
        </div>
      </main>
    </div>
  );
}

export default App;
