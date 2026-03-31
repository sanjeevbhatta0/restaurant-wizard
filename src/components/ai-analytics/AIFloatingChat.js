import React, { useState, useRef, useEffect } from 'react';

const AIFloatingChat = ({ messages, loading, onSend }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <button className="ai-chat-fab" onClick={() => setOpen(!open)}>
        <i className={`bi ${open ? 'bi-x-lg' : 'bi-chat-dots'}`}></i>
      </button>

      {open && (
        <div className="ai-chat-panel">
          <div className="ai-chat-header">
            <h6><i className="bi bi-stars"></i> AI Assistant</h6>
            <button className="ai-chat-close" onClick={() => setOpen(false)}>
              <i className="bi bi-x-lg"></i>
            </button>
          </div>

          <div className="ai-chat-messages">
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem', padding: '2rem 0' }}>
                Ask anything about your restaurant data...
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`ai-chat-msg ${msg.role}${msg.error ? ' error' : ''}`}>
                  {msg.content}
                </div>
                {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                  <div className="ai-chat-followups">
                    {msg.followUpQuestions.map((q, j) => (
                      <button key={j} className="ai-chat-followup" onClick={() => onSend(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="ai-chat-msg ai" style={{ display: 'flex', gap: 4 }}>
                <span className="ai-skeleton" style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }}></span>
                <span className="ai-skeleton" style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', animationDelay: '0.2s' }}></span>
                <span className="ai-skeleton" style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', animationDelay: '0.4s' }}></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-chat-input-area">
            <input
              className="ai-chat-input"
              placeholder="Ask about your business..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button className="ai-chat-send" onClick={handleSend} disabled={loading || !input.trim()}>
              <i className="bi bi-send"></i>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default AIFloatingChat;
