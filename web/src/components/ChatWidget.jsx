import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { getDeviceLocation } from '../lib/location';

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
  // Paper-plane / send glyph that matches the design mockup. Outline
  // style so it sits cleanly on a coloured (coral) circle background.
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 11.5L20 5l-6.5 16-3-7-7-2.5z" />
    <path d="M20 5l-9.5 9.5" />
  </svg>
);
const MicIcon = ({ className }) => (
  // Visual-parity with the design mockup. No voice-input wiring yet -
  // we surface the icon disabled so the layout matches and so we have
  // a stable spot to wire transcription into later.
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" />
  </svg>
);

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Safari private browsing */ }
}

// Member colour palette - canonical hex values mirroring the 16-theme
// system the rest of the app uses (Calendar.jsx is the source of truth).
// Kept inline so the chat widget has no extra dependencies; if a theme
// name is missing we fall back to plum so something always renders.
const COLOR_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  sage: '#7DAE82', plum: '#6B3FA0', coral: '#E8724A', pink: '#D4537E',
  lavender: '#6558C7', orange: '#E8A040', blue: '#4A9FCC', green: '#7DAE82', gray: '#7A8694',
};

function memberColor(member) {
  return (member?.color_theme && COLOR_HEX[member.color_theme]) || COLOR_HEX.plum;
}

// Format a date string (YYYY-MM-DD) into "Wednesday 27 May" for human
// reading. Falls back to the raw string if it can't be parsed.
function formatHumanDate(ymd) {
  if (!ymd) return '';
  try {
    const d = new Date(`${ymd}T12:00:00`);
    if (isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return ymd; }
}

function formatHumanDateTime(iso, allDay) {
  if (!iso) return '';
  if (allDay) {
    const datePart = String(iso).slice(0, 10);
    return formatHumanDate(datePart);
  }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} at ${time}`;
  } catch { return iso; }
}

// One row of stacked, coloured avatar chips - mirrors the visual the
// user is comparing us against. Each chip is a small filled circle with
// the member's initial; the colour comes from their canonical theme.
function AssigneeAvatars({ names, members }) {
  if (!Array.isArray(names) || names.length === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5 ml-1">
      {names.map((name, i) => {
        const m = members.find(x => x.name === name);
        const hex = memberColor(m);
        const initial = name?.[0]?.toUpperCase() || '?';
        return (
          <span
            key={`${name}-${i}`}
            title={name}
            className="inline-flex items-center justify-center"
            style={{
              width: 22, height: 22, borderRadius: '50%',
              background: hex, color: '#fff', fontSize: 11, fontWeight: 600,
              border: '1.5px solid #fff',
            }}
          >
            {initial}
          </span>
        );
      })}
    </div>
  );
}

function TaskCreatedCard({ task, members }) {
  if (!task) return null;
  const due = formatHumanDate(task.due_date);
  const time = task.due_time ? String(task.due_time).slice(0, 5) : null;
  const recurrence = task.recurrence
    ? task.recurrence.charAt(0).toUpperCase() + task.recurrence.slice(1)
    : null;
  return (
    <div
      className="rounded-xl px-3.5 py-3 mb-2"
      style={{
        background: 'var(--sage-light, #EDF5EE)',
        border: '1px solid rgba(125, 174, 130, 0.25)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 11, fontWeight: 600, color: 'var(--sage, #7DAE82)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        Task created
      </div>
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-charcoal" style={{ fontSize: 14 }}>{task.title}</div>
          <div className="flex items-center gap-2 mt-1" style={{ fontSize: 12, color: 'var(--warm-grey, #6B6774)' }}>
            {due && <span>{due}{time ? ` at ${time}` : ''}</span>}
            {recurrence && <span>· {recurrence}</span>}
          </div>
        </div>
        <AssigneeAvatars names={task.assigned_to_names} members={members} />
      </div>
    </div>
  );
}

function EventCreatedCard({ event, members }) {
  if (!event) return null;
  const when = formatHumanDateTime(event.start_time, event.all_day);
  const recurrence = event.recurrence
    ? event.recurrence.charAt(0).toUpperCase() + event.recurrence.slice(1)
    : null;
  return (
    <div
      className="rounded-xl px-3.5 py-3 mb-2"
      style={{
        background: 'var(--plum-light, #F3EDFC)',
        border: '1px solid rgba(107, 63, 160, 0.18)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 11, fontWeight: 600, color: 'var(--plum, #6B3FA0)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        Event added
      </div>
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-charcoal" style={{ fontSize: 14 }}>{event.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 mt-1" style={{ fontSize: 12, color: 'var(--warm-grey, #6B6774)' }}>
            {when && <span>{when}</span>}
            {recurrence && <span>· {recurrence}</span>}
            {event.location && <span>· {event.location}</span>}
          </div>
        </div>
        <AssigneeAvatars names={event.assigned_to_names} members={members} />
      </div>
    </div>
  );
}

function ActionCards({ actions, members }) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  return (
    <>
      {actions.map((a, i) => {
        if (a.type === 'task_created') return <TaskCreatedCard key={i} task={a.task} members={members} />;
        if (a.type === 'event_created') return <EventCreatedCard key={i} event={a.event} members={members} />;
        return null;
      })}
    </>
  );
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
  // Household members - loaded once on widget open so the confirmation
  // cards can render the right colour avatar per assignee.
  const [members, setMembers] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pendingMessageRef = useRef(null);
  const initializedRef = useRef(false);

  const WELCOME_MESSAGE = `Hey there! Welcome to Housemait - I'm your AI assistant, here to help your household stay organised.

Here are a few things to get you started:

**1. Set up your family** - Head to the **Family** page to add your household members.

**2. Connect your calendars** - Go to **Settings** to link your Google, Apple, or Outlook calendar so everything syncs automatically.

**3. Connect WhatsApp** - Also in **Settings**, link your WhatsApp so I can send you reminders and you can message me directly.

**4. Just ask me anything!** - I can create events, add to your shopping list, suggest recipes, manage tasks, and much more.

I'm always here if you need me!`;

  // On first mount (login), load the most recent conversation or start fresh
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    (async () => {
      // Load household members in parallel with chat history. Members
      // drive the colour + initial on each assignee avatar in the
      // confirmation cards. Silent-fail because the chat still works
      // (just shows a plum fallback) if this errors.
      api.get('/household')
        .then((r) => setMembers(Array.isArray(r.data?.members) ? r.data.members : []))
        .catch(() => {});
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
          // First-time user - show welcome bubble after a short delay
          const dismissed = safeGetItem('housemait_welcome_dismissed');
          if (!dismissed) {
            setTimeout(() => setShowWelcomeBubble(true), 1500);
          }
        }
      } catch {
        // API failed - still show welcome for new users
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

      // Attach the device's live location (iOS app) so location-aware
      // answers and weather use where the user actually is. Silent: only
      // reads when permission is already granted - never prompts mid-chat
      // (the weather widget + Settings own the permission request).
      try {
        const coords = await getDeviceLocation({ skipIfDenied: true });
        if (coords) payload.coords = coords;
      } catch { /* no location → backend falls back to the saved address */ }

      const { data } = await api.post('/chat', payload);

      // Set conversation ID from response (created on first message)
      if (data.conversation_id && !activeConversationId) {
        setActiveConversationId(data.conversation_id);
      }

      // Carry `actions` through to the message so the renderer can
      // show a confirmation card above the text (task_created /
      // event_created). The actions live only in-session - chat
      // history reload from DB returns text only - which is fine for
      // now: the user can find the actual task/event in the Tasks or
      // Calendar pages anyway.
      const assistantMsg = {
        role: 'assistant',
        content: data.message,
        actions: data.actions || null,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // The chat executed real actions (event created/deleted, task added,
      // items ticked…). Pages cache their data (Calendar's 5-min month
      // cache, Dashboard's digest query) and have no idea the chat changed
      // anything - broadcast so the mounted page refetches immediately
      // instead of the user staring at a stale view. ("I told the AI to
      // add Padel, it confirmed, but there's nothing there.")
      if (data.actions?.length) {
        window.dispatchEvent(new Event('housemait:data-changed'));
      }
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
      // Images and PDFs both come through as application/pdf or
      // image/<x>. Files dragged from a file-system pasteboard arrive
      // as item.kind === 'file' too.
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadAttachment(file);
        return;
      }
    }
  }

  async function uploadAttachment(file) {
    if (!file || loading) return;

    const isPdf = file.type === 'application/pdf';
    const placeholder = isPdf ? '📄 Reading PDF...' : '📷 Scanning image...';
    const userMsg = { role: 'user', content: placeholder, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const formData = new FormData();
      // Field name stays "image" so the backend route doesn't have to
      // care which it received - the mime-type branch handles routing.
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

      // Same stale-view broadcast as the text path: an attachment can
      // create events or tick off shopping items.
      if (data.actions?.length) {
        window.dispatchEvent(new Event('housemait:data-changed'));
      }
    } catch {
      const errorMsg = {
        role: 'assistant',
        content: isPdf
          ? 'Sorry, I had trouble processing that PDF. Please try again.'
          : 'Sorry, I had trouble processing that image. Please try again.',
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    uploadAttachment(file);
  }

  // Listen for external "open chat with message" events (from dashboard AI input)
  useEffect(() => {
    function handleOpenChat(e) {
      const msg = e.detail?.message?.trim();
      const attach = e.detail?.attach;
      setShowHistory(false);
      setIsOpen(true);

      if (msg) {
        // Send after a tick to let state settle
        setTimeout(() => sendMessage(msg), 100);
      }
      if (attach) {
        // Open the native file picker once the composer has mounted.
        setTimeout(() => document.querySelector('[data-chat-file-input]')?.click(), 200);
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
        <div className="hidden md:block fixed bottom-40 md:bottom-[88px] right-4 md:right-6 z-50 max-w-[300px] animate-fade-in">
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
          className="flex fixed ai-orb-bottom right-4 md:right-6 z-50 w-14 h-14 rounded-full text-white items-center justify-center transition-all hover:scale-105"
          style={{
            // Gradient AI orb from the floating-nav handoff. bottom-24
            // lands it just above the floating pill's right edge.
            background: 'linear-gradient(135deg, var(--color-plum) 0%, #8E5FFF 100%)',
            boxShadow: '0 12px 28px rgba(109,56,173,0.5), inset 0 2px 0 rgba(255,255,255,0.3)',
          }}
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

          <div className="fixed inset-0 md:left-auto w-full md:w-[380px] bg-white z-50 flex flex-col shadow-xl border-l border-light-grey safe-top safe-bottom">

            {/* Header */}
            <div className="px-4 py-3 border-b border-light-grey flex items-center gap-2 shrink-0">
              {showHistory ? (
                <>
                  <button onClick={() => setShowHistory(false)} className="p-1 text-warm-grey hover:text-charcoal transition-colors">
                    <ArrowLeftIcon className="h-5 w-5" />
                  </button>
                  <h2 className="flex-1 text-sm font-medium text-charcoal">Chat History</h2>
                </>
              ) : (
                <>
                  <button onClick={openHistory} className="p-1.5 text-warm-grey hover:text-plum rounded-lg hover:bg-plum-light/50 transition-colors" title="Chat history">
                    <HistoryIcon className="h-5 w-5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-medium text-charcoal truncate">
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
                    <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {/* When the assistant created tasks/events in
                          response to this turn, render confirmation
                          cards stacked above the text reply. Only
                          present on freshly-returned messages - chat
                          history reload returns text only. */}
                      {msg.role === 'assistant' && Array.isArray(msg.actions) && msg.actions.length > 0 && (
                        <div className="max-w-[85%] w-full">
                          <ActionCards actions={msg.actions} members={members} />
                        </div>
                      )}
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

                {/* Compose box. Layout mirrors the design mockup:
                    multi-line textarea on top, attach (+) bottom-left,
                    mic and coral send button bottom-right, all inside a
                    single rounded container. */}
                <form
                  onSubmit={handleSend}
                  className="px-4 py-3 border-t border-light-grey shrink-0"
                >
                  <div className="rounded-2xl border border-light-grey bg-white px-4 pt-3 pb-2 focus-within:border-plum focus-within:ring-2 focus-within:ring-plum/15 transition">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onPaste={handlePaste}
                      onKeyDown={(e) => {
                        // Plain Enter sends; Shift+Enter inserts a new
                        // line. Matches the convention of every modern
                        // chat compose box (WhatsApp, iMessage on Mac,
                        // Slack, etc.) so muscle memory transfers.
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder="Ask me anything..."
                      rows={1}
                      disabled={loading}
                      className="w-full resize-none bg-transparent text-base leading-relaxed placeholder:text-warm-grey/70 focus:outline-none disabled:opacity-50 overflow-y-auto"
                      style={{
                        // Auto-grow up to 3 lines. With ~26px line-height
                        // at text-base/leading-relaxed, that's ~78px. Past
                        // that the overflow becomes scrollable inside the
                        // box - the compose card itself stays the same
                        // height so the chat history doesn't jump around.
                        height: 'auto',
                        minHeight: '26px',
                        maxHeight: '78px',
                      }}
                      onInput={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 78)}px`;
                      }}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <label
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                          loading
                            ? 'opacity-50 cursor-not-allowed text-warm-grey'
                            : 'cursor-pointer text-warm-grey hover:text-plum hover:bg-cream'
                        }`}
                        title="Attach image or PDF"
                      >
                        <PlusIcon className="h-5 w-5" />
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleImageUpload}
                          disabled={loading}
                          className="hidden"
                          data-chat-file-input
                        />
                      </label>
                      <div className="flex items-center gap-1">
                        {/* Mic icon is here for visual parity with the
                            design - voice input isn't wired up yet, so
                            we render it disabled with a tooltip. */}
                        <button
                          type="button"
                          disabled
                          aria-label="Voice input (coming soon)"
                          title="Voice input coming soon"
                          className="w-9 h-9 rounded-full flex items-center justify-center text-warm-grey/60 cursor-not-allowed"
                        >
                          <MicIcon className="h-5 w-5" />
                        </button>
                        <button
                          type="submit"
                          disabled={!input.trim() || loading}
                          className="w-10 h-10 rounded-full bg-plum hover:bg-plum/90 disabled:bg-light-grey text-white flex items-center justify-center transition-colors shrink-0"
                          aria-label="Send"
                        >
                          <SendIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
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
