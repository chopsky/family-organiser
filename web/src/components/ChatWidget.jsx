import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';

/**
 * Format markdown-style text into React elements.
 */
function formatMessage(text) {
  if (!text) return text;
  return text.split('\n').map((line, lineIdx) => {
    const parts = [];
    let key = 0;
    const boldParts = line.split(/\*\*(.+?)\*\*/g);
    for (let i = 0; i < boldParts.length; i++) {
      if (i % 2 === 1) {
        parts.push(<strong key={`b${key++}`}>{boldParts[i]}</strong>);
      } else if (boldParts[i]) {
        const italicParts = boldParts[i].split(/\*(.+?)\*/g);
        for (let j = 0; j < italicParts.length; j++) {
          if (j % 2 === 1) {
            parts.push(<em key={`i${key++}`}>{italicParts[j]}</em>);
          } else if (italicParts[j]) {
            parts.push(italicParts[j]);
          }
        }
      }
    }
    return (
      <span key={lineIdx}>
        {lineIdx > 0 && '\n'}
        {parts}
      </span>
    );
  });
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <div className="flex gap-1">
        <span className="w-2 h-2 rounded-full bg-warm-grey animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 rounded-full bg-warm-grey animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 rounded-full bg-warm-grey animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// Icons
const SparklesIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
  </svg>
);
const CloseIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);
const HistoryIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const PlusIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);
const ArrowLeftIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);
const TrashIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);
const SendIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
  </svg>
);
const ImageIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
  </svg>
);

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Safari private browsing */ }
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showWelcomeBubble, setShowWelcomeBubble] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pendingMessageRef = useRef(null);
  const initializedRef = useRef(false);

  const WELCOME_MESSAGE = `Hey there! Welcome to Housemait — I'm your AI assistant, here to help your household stay organised.

Here are a few things to get you started:

**1. Set up your family** — Head to the **Family** page to add your household members.

**2. Connect your calendars** — Go to **Settings** to link your Google, Apple, or Outlook calendar so everything syncs automatically.

**3. Connect WhatsApp** — Also in **Settings**, link your WhatsApp so I can send you reminders and you can message me directly.

**4. Just ask me anything!** — I can create events, add to your shopping list, suggest recipes, manage tasks, and much more.

I'm always here if you need me!`;

  // On first mount (login), load the most recent conversation or start fresh
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    (async () => {
      try {
        const { data } = await api.get('/chat/conversations');
        const convs = data.conversations || [];
        setConversations(convs);
        if (convs.length > 0) {
          // Load the most recent conversation
          const latest = convs[0];
          const histRes = await api.get('/chat/history', { params: { conversation_id: latest.id } });
          setMessages(histRes.data.messages || []);
          setActiveConversationId(latest.id);
        } else {
          // First-time user — show welcome bubble after a short delay
          const dismissed = safeGetItem('housemait_welcome_dismissed');
          if (!dismissed) {
            setTimeout(() => setShowWelcomeBubble(true), 1500);
          }
        }
      } catch {
        // API failed — still show welcome for new users
        const dismissed = safeGetItem('housemait_welcome_dismissed');
        if (!dismissed) {
          setTimeout(() => setShowWelcomeBubble(true), 1500);
        }
      }
    })();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input when opened (and not showing history)
  useEffect(() => {
    if (isOpen && !showHistory) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, showHistory]);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/chat/conversations');
      setConversations(data.conversations || []);
    } catch {
      // ignore
    }
  }, []);

  // Load messages for a specific conversation
  async function loadConversation(conversationId) {
    try {
      const { data } = await api.get('/chat/history', { params: { conversation_id: conversationId } });
      setMessages(data.messages || []);
      setActiveConversationId(conversationId);
      setShowHistory(false);
    } catch {
      // ignore
    }
  }

  // Start a new conversation (clear state)
  function startNewConversation() {
    setMessages([]);
    setActiveConversationId(null);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // Open history panel
  async function openHistory() {
    setLoadingHistory(true);
    setShowHistory(true);
    await loadConversations();
    setLoadingHistory(false);
  }

  // Delete a conversation
  async function deleteConversation(convId, e) {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation?')) return;
    try {
      await api.delete(`/chat/conversations/${convId}`);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeConversationId === convId) {
        startNewConversation();
      }
    } catch {
      // ignore
    }
  }

  // Send a message (creates conversation if needed)
  async function sendMessage(text) {
    if (!text?.trim() || loading) return;
    const trimmed = text.trim();

    const userMsg = { role: 'user', content: trimmed, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const payload = { message: trimmed };
      if (activeConversationId) payload.conversation_id = activeConversationId;

      const { data } = await api.post('/chat', payload);

      // Set conversation ID from response (created on first message)
      if (data.conversation_id && !activeConversationId) {
        setActiveConversationId(data.conversation_id);
      }

      const assistantMsg = { role: 'assistant', content: data.message, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      const errorMsg = { role: 'assistant', content: 'Sorry, I had trouble responding. Please try again.', created_at: new Date().toISOString() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendMessage(text);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadImageFile(file);
        return;
      }
    }
  }

  async function uploadImageFile(file) {
    if (!file || loading) return;

    const userMsg = { role: 'user', content: '📷 Scanning image...', created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('image', file);
      if (activeConversationId) formData.append('conversation_id', activeConversationId);

      const { data } = await api.post('/chat/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (data.conversation_id && !activeConversationId) {
        setActiveConversationId(data.conversation_id);
      }

      const assistantMsg = { role: 'assistant', content: data.message, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      const errorMsg = { role: 'assistant', content: 'Sorry, I had trouble processing that image. Please try again.', created_at: new Date().toISOString() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    uploadImageFile(file);
  }

  // Listen for external "open chat with message" events (from dashboard AI input)
  useEffect(() => {
    function handleOpenChat(e) {
      const msg = e.detail?.message?.trim();
      setShowHistory(false);
      setIsOpen(true);

      if (msg) {
        // Send after a tick to let state settle
        setTimeout(() => sendMessage(msg), 100);
      }
    }
    window.addEventListener('openChatWidget', handleOpenChat);
    return () => window.removeEventListener('openChatWidget', handleOpenChat);
  }, []);

  // Format relative time
  function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  return (
    <>
      {/* Welcome speech bubble for first-time users */}
      {!isOpen && showWelcomeBubble && (
        <div className="fixed bottom-40 md:bottom-[88px] right-4 md:right-6 z-50 max-w-[300px] animate-fade-in">
          <div className="relative bg-white rounded-2xl shadow-lg border border-light-grey p-4">
            <button
              onClick={(e) => { e.stopPropagation(); setShowWelcomeBubble(false); safeSetItem('housemait_welcome_dismissed', '1'); }}
              className="absolute top-2 right-2 text-warm-grey hover:text-charcoal p-1"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
            <p className="text-sm text-charcoal pr-4">
              <span className="font-semibold">Hey there!</span> I'm your AI assistant. Tap here to get started with setting up your household!
            </p>
            {/* Speech bubble tail */}
            <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-b border-r border-light-grey transform rotate-45" />
          </div>
        </div>
      )}

      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => {
            if (showWelcomeBubble) {
              setShowWelcomeBubble(false);
              safeSetItem('housemait_welcome_dismissed', '1');
              // Open chat with the full welcome message
              setMessages([{ role: 'assistant', content: WELCOME_MESSAGE, created_at: new Date().toISOString() }]);
            }
            setIsOpen(true);
          }}
          className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 w-14 h-14 rounded-full bg-plum hover:bg-plum/90 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
          title="Chat with AI Assistant"
        >
          <SparklesIcon className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div className="md:hidden fixed inset-0 bg-black/30 z-50" onClick={() => setIsOpen(false)} />

          <div className="fixed top-0 right-0 bottom-0 w-full md:w-[380px] bg-white z-50 flex flex-col shadow-xl border-l border-light-grey">

            {/* Header */}
            <div className="px-4 py-3 border-b border-light-grey flex items-center gap-2 shrink-0">
              {showHistory ? (
                <>
                  <button onClick={() => setShowHistory(false)} className="p-1 text-warm-grey hover:text-charcoal transition-colors">
                    <ArrowLeftIcon className="h-5 w-5" />
                  </button>
                  <h2 className="flex-1 text-sm font-semibold text-charcoal">Chat History</h2>
                </>
              ) : (
                <>
                  <button onClick={openHistory} className="p-1.5 text-warm-grey hover:text-plum rounded-lg hover:bg-plum-light/50 transition-colors" title="Chat history">
                    <HistoryIcon className="h-5 w-5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-charcoal truncate">
                      {activeConversationId ? (conversations.find(c => c.id === activeConversationId)?.title || 'Chat') : 'New conversation'}
                    </h2>
                  </div>
                  <button onClick={startNewConversation} className="p-1.5 text-warm-grey hover:text-plum rounded-lg hover:bg-plum-light/50 transition-colors" title="New conversation">
                    <PlusIcon className="h-5 w-5" />
                  </button>
                </>
              )}
              <button onClick={() => setIsOpen(false)} className="p-1.5 text-warm-grey hover:text-charcoal transition-colors" title="Close">
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            {showHistory ? (
              /* ── History Panel ── */
              <div className="flex-1 overflow-y-auto">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-plum/30 border-t-plum rounded-full animate-spin" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="text-center text-warm-grey text-sm py-12 px-4">
                    <HistoryIcon className="h-8 w-8 mx-auto mb-2 text-light-grey" />
                    <p>No previous conversations</p>
                  </div>
                ) : (
                  <div className="divide-y divide-light-grey">
                    {conversations.map(conv => (
                      <div
                        key={conv.id}
                        onClick={() => loadConversation(conv.id)}
                        className={`px-4 py-3 cursor-pointer hover:bg-cream transition-colors group ${
                          conv.id === activeConversationId ? 'bg-plum-light/30' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-charcoal truncate">{conv.title}</p>
                            {conv.lastMessage && (
                              <p className="text-xs text-warm-grey truncate mt-0.5">{conv.lastMessage}</p>
                            )}
                            <p className="text-[10px] text-warm-grey/60 mt-1">{timeAgo(conv.updated_at)}</p>
                          </div>
                          <button
                            onClick={(e) => deleteConversation(conv.id, e)}
                            className="p-1 text-warm-grey/0 group-hover:text-warm-grey hover:!text-red-500 transition-colors shrink-0"
                            title="Delete conversation"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* ── Chat Messages ── */
              <>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {messages.length === 0 && !loading && (
                    <div className="text-center text-warm-grey text-sm py-12">
                      <div className="w-12 h-12 rounded-full bg-plum-light mx-auto mb-3 flex items-center justify-center">
                        <SparklesIcon className="h-6 w-6 text-plum" />
                      </div>
                      <p className="font-medium text-charcoal mb-1">How can I help?</p>
                      <p className="text-xs">Ask me about your shopping list, tasks, calendar, meals, or anything family-related.</p>
                    </div>
                  )}

                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-plum text-white rounded-br-md'
                          : 'bg-cream text-charcoal rounded-bl-md'
                      }`}>
                        {msg.role === 'assistant' ? formatMessage(msg.content) : msg.content}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-cream rounded-2xl rounded-bl-md">
                        <TypingIndicator />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <form onSubmit={handleSend} className="px-4 py-3 border-t border-light-grey shrink-0">
                  <div className="flex items-center gap-2">
                    <label className={`w-10 h-10 rounded-full border border-light-grey flex items-center justify-center transition-colors shrink-0 ${loading ? 'opacity-50' : 'hover:bg-cream cursor-pointer text-warm-grey hover:text-plum'}`}>
                      <ImageIcon className="h-5 w-5" />
                      <input type="file" accept="image/*" onChange={handleImageUpload} disabled={loading} className="hidden" data-chat-file-input />
                    </label>
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onPaste={handlePaste}
                      placeholder="Ask me anything..."
                      disabled={loading}
                      className="flex-1 border border-light-grey rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-plum/30 focus:border-plum bg-cream disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || loading}
                      className="w-10 h-10 rounded-full bg-plum hover:bg-plum/90 disabled:bg-light-grey text-white flex items-center justify-center transition-colors shrink-0"
                    >
                      <SendIcon className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
