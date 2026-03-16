const { Telegraf } = require('telegraf');
const db = require('../db/queries');
const { classify, scanReceipt, matchReceiptToList } = require('../services/ai');
const { transcribeVoice } = require('../services/transcribe');
const sharedHandlers = require('./handlers');
const broadcast = require('../services/broadcast');

// ─── File download helper ─────────────────────────────────────────────────────

async function downloadFile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Format helpers (delegate to shared handlers) ─────────────────────────────

const { CATEGORY_EMOJI, formatShoppingList, formatTaskList, capitalise } = sharedHandlers;

// ─── Context middleware: load user + household for every update ───────────────

async function loadUserContext(ctx, next) {
  const chatId = ctx.from?.id;
  if (!chatId) return next();

  try {
    const user = await db.getUserByTelegramId(chatId);
    ctx.familyUser = user; // null if not registered yet
    if (user) {
      const members = await db.getHouseholdMembers(user.household_id);
      ctx.household = { id: user.household_id, members };
    }
  } catch (err) {
    console.error('loadUserContext error:', err.message);
  }
  return next();
}

// ─── Group chat gate ──────────────────────────────────────────────────────────
// In group chats, only process messages that mention the bot or reply to it.

function isGroupMessage(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

function isBotAddressed(ctx) {
  const text = ctx.message?.text || ctx.message?.caption || '';
  const botUsername = ctx.botInfo?.username;
  const mentionedBot = botUsername && text.includes(`@${botUsername}`);
  const replyToBot = ctx.message?.reply_to_message?.from?.is_bot &&
    ctx.message.reply_to_message.from.username === botUsername;
  return mentionedBot || replyToBot;
}

// ─── Bot factory ──────────────────────────────────────────────────────────────

function createBot(token) {
  const bot = new Telegraf(token);

  bot.use(loadUserContext);

  // ── /start ──────────────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    if (isGroupMessage(ctx)) return; // /start is DM only

    // Handle deep link for account linking: /start link_<token>
    const startParam = ctx.message.text.replace(/^\/start\s*/i, '').trim();
    if (startParam.startsWith('link_')) {
      const linkToken = startParam.replace('link_', '');
      try {
        const tokenRecord = await db.getTelegramLinkToken(linkToken);
        if (!tokenRecord) {
          return ctx.reply('This link has expired or is invalid. Please generate a new one from the Curata app Settings page.');
        }
        await db.updateUser(tokenRecord.user_id, {
          telegram_chat_id: String(ctx.from.id),
          telegram_username: ctx.from.username || null,
        });
        await db.markTelegramLinkTokenUsed(tokenRecord.id);
        return ctx.reply('✅ Your Telegram account has been linked to Curata! You can now use the bot to manage your household.');
      } catch (err) {
        console.error('/start link error:', err);
        return ctx.reply('Something went wrong linking your account. Please try again from the app.');
      }
    }

    if (ctx.familyUser) {
      return ctx.reply(
        `Welcome back, ${ctx.familyUser.name}! 👋\n\nYour household is set up and ready.\n\n` +
        `Use /list to see shopping, /tasks to see today's tasks, or just send me a message!`
      );
    }
    return ctx.reply(
      `👋 *Welcome to Curata!*\n\n` +
      `I help your whole household manage shopping lists and tasks through chat.\n\n` +
      `To get started:\n` +
      `• *Sign up at the Curata app* and link your Telegram from Settings\n` +
      `• *Or create a household here:* /create YourFamilyName\n` +
      `• *Or join one:* /join XXXXXX\n\n` +
      `Once set up, just message me naturally — _"We need milk and remind Jake to do homework by Friday"_ — and I'll sort it out.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /create <name> ──────────────────────────────────────────────────────────
  bot.command('create', async (ctx) => {
    if (isGroupMessage(ctx)) return ctx.reply('Please use /create in a private message with me.');

    const name = ctx.message.text.replace(/^\/create\s*/i, '').trim();
    if (!name) return ctx.reply('Please provide a household name.\nExample: /create The Smiths');

    if (ctx.familyUser) {
      return ctx.reply(`You're already part of a household. Share this code with family members: \`${(await db.getHouseholdById(ctx.familyUser.household_id)).join_code}\``, { parse_mode: 'Markdown' });
    }

    try {
      const displayName = ctx.from.first_name || ctx.from.username || 'Admin';
      const household = await db.createHousehold(name);
      await db.createUser({
        householdId: household.id,
        name: displayName,
        telegramChatId: ctx.from.id,
        telegramUsername: ctx.from.username,
        role: 'admin',
      });

      return ctx.reply(
        `🏠 *${name}* has been created!\n\n` +
        `Your join code is: \`${household.join_code}\`\n\n` +
        `Share this code with your family. They can join with:\n/join ${household.join_code}\n\n` +
        `You're all set! Just start chatting to add items and tasks.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('/create error:', err);
      return ctx.reply('Something went wrong creating your household. Please try again.');
    }
  });

  // ── /join <code> ────────────────────────────────────────────────────────────
  bot.command('join', async (ctx) => {
    if (isGroupMessage(ctx)) return ctx.reply('Please use /join in a private message with me.');

    const code = ctx.message.text.replace(/^\/join\s*/i, '').trim().toUpperCase();
    if (!code) return ctx.reply('Please provide a join code.\nExample: /join A3F9B2');

    if (ctx.familyUser) {
      return ctx.reply(`You're already part of a household! Use /list or /tasks to get started.`);
    }

    try {
      const household = await db.getHouseholdByCode(code);
      if (!household) return ctx.reply(`❌ No household found with code \`${code}\`. Please check and try again.`, { parse_mode: 'Markdown' });

      const displayName = ctx.from.first_name || ctx.from.username || 'Member';
      await db.createUser({
        householdId: household.id,
        name: displayName,
        telegramChatId: ctx.from.id,
        telegramUsername: ctx.from.username,
        role: 'member',
      });

      return ctx.reply(
        `✅ You've joined *${household.name}*!\n\nWelcome, ${displayName}! 🎉\n\nJust send me messages to add shopping items or tasks. Try:\n_"We need bread and milk"_\n_"Remind me to call the doctor tomorrow"_`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('/join error:', err);
      return ctx.reply('Something went wrong. Please try again.');
    }
  });

  // ── /list ────────────────────────────────────────────────────────────────────
  async function handleList(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    try {
      const items = await db.getShoppingList(ctx.household.id);
      return ctx.reply(formatShoppingList(items), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/list error:', err);
      return ctx.reply('Could not fetch shopping list. Please try again.');
    }
  }
  bot.command('list', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    return handleList(ctx);
  });

  // ── /shopping (alias of /list, formatted for a trip) ─────────────────────────
  async function handleShopping(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    try {
      const items = await db.getShoppingList(ctx.household.id);
      if (!items.length) return ctx.reply('✅ Nothing on the shopping list — enjoy the trip! 🛍️');
      const lines = ['🛒 *Shopping List*', ''];
      const grouped = {};
      for (const item of items) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }
      for (const [cat, catItems] of Object.entries(grouped)) {
        const emoji = CATEGORY_EMOJI[cat] || '📦';
        lines.push(`${emoji} *${capitalise(cat)}*`);
        for (const i of catItems) {
          const qty = i.quantity ? ` (${i.quantity})` : '';
          lines.push(`☐ ${i.item}${qty}`);
        }
        lines.push('');
      }
      return ctx.reply(lines.join('\n').trim(), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/shopping error:', err);
      return ctx.reply('Could not fetch shopping list. Please try again.');
    }
  }
  bot.command('shopping', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    return handleShopping(ctx);
  });

  // ── /tasks [all] ─────────────────────────────────────────────────────────────
  async function handleTasks(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    const showAll = ctx.message.text.toLowerCase().includes('all');
    try {
      const tasks = showAll
        ? await db.getAllIncompleteTasks(ctx.household.id)
        : await db.getTasks(ctx.household.id);
      const heading = showAll ? 'All Pending Tasks' : 'Tasks Due Today & Overdue';
      return ctx.reply(formatTaskList(tasks, heading), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/tasks error:', err);
      return ctx.reply('Could not fetch tasks. Please try again.');
    }
  }
  bot.command('tasks', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    return handleTasks(ctx);
  });

  // ── /mytasks ──────────────────────────────────────────────────────────────────
  async function handleMyTasks(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    try {
      const tasks = await db.getTasks(ctx.household.id, { assignedToId: ctx.familyUser.id });
      const heading = `${ctx.familyUser.name}'s Tasks`;
      return ctx.reply(formatTaskList(tasks, heading), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/mytasks error:', err);
      return ctx.reply('Could not fetch your tasks. Please try again.');
    }
  }
  bot.command('mytasks', async (ctx) => {
    if (isGroupMessage(ctx)) return; // DM only per spec
    return handleMyTasks(ctx);
  });

  // ── /outstanding [name] ──────────────────────────────────────────────────────
  async function handleOutstanding(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    const nameArg = ctx.message.text.replace(/^\/outstanding\s*/i, '').trim();

    try {
      let targetMember;

      if (nameArg) {
        // Look up the named member
        targetMember = ctx.household.members.find(
          (m) => m.name.toLowerCase() === nameArg.toLowerCase()
        );
        if (!targetMember) {
          const memberNames = ctx.household.members.map((m) => m.name).join(', ');
          return ctx.reply(
            `I couldn't find "${nameArg}" in your household.\n\nMembers: ${memberNames}\n\nTry: /outstanding ${ctx.household.members[0]?.name || 'Name'}`
          );
        }
      } else {
        // Default to the sender
        targetMember = ctx.familyUser;
      }

      const tasks = await db.getTasksForUser(ctx.household.id, targetMember.id);
      const today = new Date().toISOString().split('T')[0];

      if (!tasks.length) {
        const who = targetMember.id === ctx.familyUser.id ? "You don't" : `${targetMember.name} doesn't`;
        return ctx.reply(`✅ ${who} have any outstanding tasks!`);
      }

      const overdue = tasks.filter((t) => t.due_date < today);
      const dueToday = tasks.filter((t) => t.due_date === today);
      const upcoming = tasks.filter((t) => t.due_date > today);

      const who = targetMember.id === ctx.familyUser.id ? 'Your' : `${targetMember.name}'s`;
      const lines = [`📋 *${who} Outstanding Tasks* (${tasks.length} total)\n`];

      if (overdue.length) {
        lines.push(`🔴 *Overdue (${overdue.length}):*`);
        for (const t of overdue) {
          const daysOverdue = Math.floor((new Date(today) - new Date(t.due_date)) / 86400000);
          const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
          lines.push(`  • ${t.title}${rec} — ${daysOverdue}d overdue`);
        }
        lines.push('');
      }

      if (dueToday.length) {
        lines.push(`🟡 *Due Today (${dueToday.length}):*`);
        for (const t of dueToday) {
          const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
          lines.push(`  • ${t.title}${rec}`);
        }
        lines.push('');
      }

      if (upcoming.length) {
        lines.push(`⚪ *Upcoming (${upcoming.length}):*`);
        for (const t of upcoming.slice(0, 8)) {
          const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
          const dayName = new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
          lines.push(`  • ${t.title}${rec} — ${dayName} ${t.due_date}`);
        }
        if (upcoming.length > 8) lines.push(`  … and ${upcoming.length - 8} more`);
      }

      return ctx.reply(lines.join('\n').trim(), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/outstanding error:', err);
      return ctx.reply('Could not fetch outstanding tasks. Please try again.');
    }
  }
  bot.command('outstanding', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    return handleOutstanding(ctx);
  });

  // ── /done ──────────────────────────────────────────────────────────────────
  async function handleDone(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    try {
      const { tasks, shoppingItems } = await db.getCompletedThisWeek(ctx.household.id);
      const lines = [`✅ *Completed this week*\n`];
      lines.push(`🛒 *Shopping:* ${shoppingItems.length} item${shoppingItems.length !== 1 ? 's' : ''}`);
      lines.push(`📋 *Tasks:* ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`);
      if (tasks.length) {
        lines.push('');
        for (const t of tasks.slice(0, 10)) {
          const who = t.assigned_to_name || 'Everyone';
          lines.push(`  ✓ ${t.title} (${who})`);
        }
        if (tasks.length > 10) lines.push(`  … and ${tasks.length - 10} more`);
      }
      return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/done error:', err);
      return ctx.reply('Could not fetch completed items. Please try again.');
    }
  }
  bot.command('done', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    return handleDone(ctx);
  });

  // ── /undo ──────────────────────────────────────────────────────────────────
  async function handleUndo(ctx) {
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');

    try {
      const [recentTasks, recentShopping] = await Promise.all([
        db.getRecentlyCompletedTasks(ctx.household.id),
        db.getRecentlyCompletedShopping(ctx.household.id),
      ]);

      if (!recentTasks.length && !recentShopping.length) {
        return ctx.reply('✅ Nothing was completed in the last 24 hours to undo.');
      }

      const lines = ['*Recently Completed (last 24h)*\n'];
      const allItems = [];
      let index = 1;

      if (recentTasks.length) {
        lines.push('📋 *Tasks:*');
        for (const t of recentTasks) {
          const who = t.assigned_to_name ? ` (${t.assigned_to_name})` : '';
          lines.push(`  ${index}. ~~${t.title}~~${who}`);
          allItems.push({ type: 'task', id: t.id, name: t.title });
          index++;
        }
        lines.push('');
      }

      if (recentShopping.length) {
        lines.push('🛒 *Shopping:*');
        for (const i of recentShopping) {
          const cat = CATEGORY_EMOJI[i.category] || '📦';
          lines.push(`  ${index}. ~~${i.item}~~ ${cat}`);
          allItems.push({ type: 'shopping', id: i.id, name: i.item });
          index++;
        }
      }

      lines.push('\nReply with a number to restore, or "all" to restore everything.');

      // Store the undo context for the reply handler
      ctx.familyUser._undoItems = allItems;

      // Save undo context in a simple in-memory store keyed by chat id
      if (!bot.context) bot.context = {};
      if (!bot.context.undoSessions) bot.context.undoSessions = {};
      bot.context.undoSessions[ctx.from.id] = {
        items: allItems,
        expires: Date.now() + 5 * 60 * 1000, // 5 min expiry
      };

      return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/undo error:', err);
      return ctx.reply('Could not fetch recent completions. Please try again.');
    }
  }
  bot.command('undo', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    return handleUndo(ctx);
  });

  // ── /help ─────────────────────────────────────────────────────────────────
  async function handleHelp(ctx) {
    return ctx.reply(
      `*Family Organiser — Commands*\n\n` +
      `*Setup (DM only)*\n` +
      `/start — Welcome and setup\n` +
      `/create <name> — Create a new household\n` +
      `/join <code> — Join with a 6-letter code\n\n` +
      `*Lists*\n` +
      `/list — Shopping list by category\n` +
      `/shopping — Formatted list for a shopping trip\n` +
      `/tasks — Tasks due today and overdue\n` +
      `/tasks all — All pending tasks\n` +
      `/mytasks — Your tasks only (DM)\n` +
      `/outstanding [name] — What's outstanding for you or someone\n` +
      `/done — What was completed this week\n` +
      `/undo — Restore accidentally completed items\n\n` +
      `*Settings (admin, DM only)*\n` +
      `/settings — Adjust household settings\n\n` +
      `*Or just chat naturally!* 💬\n` +
      `_"We need milk, eggs and dog food"_\n` +
      `_"Remind Jake to do homework by Friday, weekly"_\n` +
      `_"We got the milk"_`,
      { parse_mode: 'Markdown' }
    );
  }
  bot.command('help', async (ctx) => {
    return handleHelp(ctx);
  });

  // ── /settings ─────────────────────────────────────────────────────────────
  async function handleSettings(ctx) {
    if (isGroupMessage(ctx)) return ctx.reply('Please use /settings in a private message.');
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');
    if (ctx.familyUser.role !== 'admin') return ctx.reply('Only the household admin can change settings.');
    const household = await db.getHouseholdById(ctx.familyUser.household_id);
    const members = ctx.household.members;
    return ctx.reply(
      `*Household Settings — ${household.name}*\n\n` +
      `Join code: \`${household.join_code}\`\n` +
      `Daily reminder: ${household.reminder_time}\n` +
      `Members (${members.length}): ${members.map((m) => m.name).join(', ')}\n\n` +
      `_Settings editing via the web app coming soon._`,
      { parse_mode: 'Markdown' }
    );
  }
  bot.command('settings', async (ctx) => {
    return handleSettings(ctx);
  });

  // ── Voice notes ───────────────────────────────────────────────────────────
  bot.on('voice', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;

    if (!ctx.familyUser) {
      return ctx.reply('Please set up your household first. Send /start for instructions.');
    }

    const processingMsg = await ctx.reply('🎙️ Transcribing your voice note…');

    try {
      // Download the OGG audio file from Telegram
      const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const audioBuffer = await downloadFile(fileLink.href);

      const result = await sharedHandlers.handleVoiceNote(audioBuffer, 'voice.ogg', ctx.familyUser, ctx.household);

      if (!result.transcription) {
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, result.response);
        return;
      }

      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
        result.response,
        { parse_mode: 'Markdown' }
      );

      // Broadcast to other members
      const notification = sharedHandlers.buildBroadcastMessage(ctx.familyUser.name, result.actions);
      if (notification) broadcast.toHousehold(ctx.familyUser.id, ctx.household.members, notification, ctx.telegram);
    } catch (err) {
      console.error('Voice handler error:', err.message, err.stack);
      let msg;
      if (err.message?.includes('OPENAI_API_KEY')) {
        msg = '⚠️ Voice transcription is not configured yet.';
      } else {
        msg = `❌ Voice note error: ${err.message?.substring(0, 150) || 'Unknown error'}`;
      }
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, msg);
    }
  });

  // ── Photos / receipt scanning ──────────────────────────────────────────────
  bot.on('photo', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;

    if (!ctx.familyUser) {
      return ctx.reply('Please set up your household first. Send /start for instructions.');
    }

    const processingMsg = await ctx.reply('🧾 Scanning receipt…');

    try {
      // Pick the highest-resolution photo Telegram provides
      const photos = ctx.message.photo;
      const bestPhoto = photos[photos.length - 1];
      const fileLink = await ctx.telegram.getFileLink(bestPhoto.file_id);
      const imageBuffer = await downloadFile(fileLink.href);

      const result = await sharedHandlers.handlePhoto(imageBuffer, 'image/jpeg', ctx.familyUser, ctx.household);

      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
        result.response, { parse_mode: 'Markdown' }
      );

      // Broadcast to other members
      const notification = sharedHandlers.buildBroadcastMessage(ctx.familyUser.name, result.actions);
      if (notification) broadcast.toHousehold(ctx.familyUser.id, ctx.household.members, notification, ctx.telegram);
    } catch (err) {
      console.error('Photo handler error:', err);
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
        '❌ Sorry, I had trouble scanning that receipt. Please try again with a clearer photo.'
      );
    }
  });

  // ── Natural language (any non-command text message) ────────────────────────
  bot.on('text', async (ctx) => {
    // Skip commands (already handled above)
    if (ctx.message.text.startsWith('/')) return;

    // Handle "@botname /command" pattern in groups — Telegraf doesn't recognise
    // commands that don't start the message, so we detect and re-route them here.
    const botUsername = ctx.botInfo?.username;
    if (botUsername) {
      const mentionCmdMatch = ctx.message.text.match(
        new RegExp(`^@${botUsername}\\s+/(\\w+)(.*)$`, 'i')
      );
      if (mentionCmdMatch) {
        // Rewrite so the rest of this handler (and any manual routing) sees a clean command
        const cmd = mentionCmdMatch[1].toLowerCase();
        const args = mentionCmdMatch[2].trim();
        ctx.message.text = `/${cmd}${args ? ' ' + args : ''}`;

        // Map of commands to their handler functions (same logic as bot.command blocks)
        const commandHandlers = {
          list: () => handleList(ctx),
          shopping: () => handleShopping(ctx),
          tasks: () => handleTasks(ctx),
          mytasks: () => handleMyTasks(ctx),
          outstanding: () => handleOutstanding(ctx),
          done: () => handleDone(ctx),
          undo: () => handleUndo(ctx),
          help: () => handleHelp(ctx),
          settings: () => handleSettings(ctx),
        };

        if (commandHandlers[cmd]) {
          return commandHandlers[cmd]();
        }
        // Unknown command — fall through to AI classification
      }
    }

    // In groups, only respond if addressed
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;

    if (!ctx.familyUser) {
      return ctx.reply(
        `Hi! I don't know you yet. Please send /start to set up or join a household first.`
      );
    }

    // Handle /undo reply (number or "all")
    const undoSession = bot.context?.undoSessions?.[ctx.from.id];
    if (undoSession && undoSession.expires > Date.now()) {
      const input = ctx.message.text.trim().toLowerCase();
      if (input === 'all' || /^\d+$/.test(input)) {
        try {
          let toRestore = [];
          if (input === 'all') {
            toRestore = undoSession.items;
          } else {
            const idx = parseInt(input, 10) - 1;
            if (idx >= 0 && idx < undoSession.items.length) {
              toRestore = [undoSession.items[idx]];
            } else {
              return ctx.reply(`Please pick a number between 1 and ${undoSession.items.length}, or "all".`);
            }
          }

          const restored = [];
          for (const item of toRestore) {
            if (item.type === 'task') {
              await db.uncompleteTask(item.id, ctx.household.id);
            } else {
              await db.uncompleteShoppingItem(item.id, ctx.household.id);
            }
            restored.push(item.name);
          }

          // Clear the session
          delete bot.context.undoSessions[ctx.from.id];

          return ctx.reply(`♻️ Restored: ${restored.join(', ')}`);
        } catch (err) {
          console.error('Undo restore error:', err);
          return ctx.reply('Could not restore. Please try again.');
        }
      }
    }

    // Strip bot @mention from group messages before sending to AI
    let text = ctx.message.text;
    if (botUsername) text = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
    if (!text) return;

    try {
      const result = await sharedHandlers.handleTextMessage(text, ctx.familyUser, ctx.household);
      await ctx.reply(result.response);

      // Broadcast to other members
      const notification = sharedHandlers.buildBroadcastMessage(ctx.familyUser.name, result.actions);
      if (notification) broadcast.toHousehold(ctx.familyUser.id, ctx.household.members, notification, ctx.telegram);
    } catch (err) {
      console.error('Natural language handler error:', err);
      return ctx.reply('Sorry, I had trouble understanding that. Please try again, or use /help to see commands.');
    }
  });

  return bot;
}

module.exports = { createBot };
