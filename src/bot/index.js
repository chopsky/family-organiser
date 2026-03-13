const { Telegraf } = require('telegraf');
const db = require('../db/queries');
const { classify, scanReceipt, matchReceiptToList } = require('../services/ai');
const { transcribeVoice } = require('../services/transcribe');

// ─── File download helper ─────────────────────────────────────────────────────

async function downloadFile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Format helpers ───────────────────────────────────────────────────────────

const CATEGORY_EMOJI = {
  groceries: '🛒',
  clothing:  '👕',
  household: '🏠',
  school:    '🎒',
  pets:      '🐾',
  other:     '📦',
};

function formatShoppingList(items) {
  if (!items.length) return '✅ Shopping list is empty!';

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  const lines = [];
  for (const [cat, catItems] of Object.entries(grouped)) {
    const emoji = CATEGORY_EMOJI[cat] || '📦';
    lines.push(`\n${emoji} *${capitalise(cat)}*`);
    for (const i of catItems) {
      const qty = i.quantity ? ` (${i.quantity})` : '';
      lines.push(`  • ${i.item}${qty}`);
    }
  }
  return lines.join('\n').trim();
}

function formatTaskList(tasks, heading = 'Tasks') {
  if (!tasks.length) return `✅ No ${heading.toLowerCase()}!`;

  const today = new Date().toISOString().split('T')[0];
  const lines = [`*${heading}*`];

  for (const t of tasks) {
    const overdue = t.due_date < today;
    const dueToday = t.due_date === today;
    const statusIcon = overdue ? '🔴' : dueToday ? '🟡' : '⚪';
    const who = t.assigned_to_name ? ` — ${t.assigned_to_name}` : ' — Everyone';
    const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
    const dateLabel = overdue
      ? ` _(overdue: ${t.due_date})_`
      : dueToday ? ' _(today)_' : ` _(${t.due_date})_`;
    lines.push(`${statusIcon} ${t.title}${who}${rec}${dateLabel}`);
  }
  return lines.join('\n');
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

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
  bot.command('list', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');

    try {
      const items = await db.getShoppingList(ctx.household.id);
      return ctx.reply(formatShoppingList(items), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/list error:', err);
      return ctx.reply('Could not fetch shopping list. Please try again.');
    }
  });

  // ── /shopping (alias of /list, formatted for a trip) ─────────────────────────
  bot.command('shopping', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
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
  });

  // ── /tasks [all] ─────────────────────────────────────────────────────────────
  bot.command('tasks', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
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
  });

  // ── /mytasks ──────────────────────────────────────────────────────────────────
  bot.command('mytasks', async (ctx) => {
    if (isGroupMessage(ctx)) return; // DM only per spec
    if (!ctx.familyUser) return ctx.reply('Please set up your household first. Send /start for instructions.');

    try {
      const tasks = await db.getTasks(ctx.household.id, { assignedToId: ctx.familyUser.id });
      const heading = `${ctx.familyUser.name}'s Tasks`;
      return ctx.reply(formatTaskList(tasks, heading), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('/mytasks error:', err);
      return ctx.reply('Could not fetch your tasks. Please try again.');
    }
  });

  // ── /outstanding [name] ──────────────────────────────────────────────────────
  bot.command('outstanding', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
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
  });

  // ── /done ──────────────────────────────────────────────────────────────────
  bot.command('done', async (ctx) => {
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;
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
  });

  // ── /help ─────────────────────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
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
      `/done — What was completed this week\n\n` +
      `*Settings (admin, DM only)*\n` +
      `/settings — Adjust household settings\n\n` +
      `*Or just chat naturally!* 💬\n` +
      `_"We need milk, eggs and dog food"_\n` +
      `_"Remind Jake to do homework by Friday, weekly"_\n` +
      `_"We got the milk"_`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /settings ─────────────────────────────────────────────────────────────
  bot.command('settings', async (ctx) => {
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

      // Transcribe with Whisper
      const transcribedText = await transcribeVoice(audioBuffer, 'voice.ogg');

      if (!transcribedText) {
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, "🎙️ Couldn't hear anything in that voice note. Please try again.");
        return;
      }

      // Echo the transcription so the user knows what was understood
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `🎙️ _"${transcribedText}"_\n\nProcessing…`, { parse_mode: 'Markdown' });

      // Feed into the same classify pipeline as text messages
      const memberNames = ctx.household.members.map((m) => m.name);
      const result = await classify(transcribedText, memberNames);

      // Handle shopping items
      if (result.shopping_items?.length) {
        const toAdd = result.shopping_items.filter((i) => i.action === 'add');
        const toRemove = result.shopping_items.filter((i) => i.action === 'remove');
        if (toAdd.length) await db.addShoppingItems(ctx.household.id, toAdd, ctx.familyUser.id);
        if (toRemove.length) await db.completeShoppingItemsByName(ctx.household.id, toRemove.map((i) => i.item));
      }

      // Handle tasks
      if (result.tasks?.length) {
        const toAdd = result.tasks.filter((t) => t.action === 'add');
        const toComplete = result.tasks.filter((t) => t.action === 'complete');
        if (toAdd.length) await db.addTasks(ctx.household.id, toAdd, ctx.familyUser.id, ctx.household.members);
        for (const t of toComplete) {
          const done = await db.completeTasksByName(ctx.household.id, [t.title], t.assigned_to_name);
          for (const completedTask of done) {
            if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
          }
        }
      }

      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
        `🎙️ _"${transcribedText}"_\n\n${result.response_message || 'Done! ✅'}`,
        { parse_mode: 'Markdown' }
      );
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

      // Extract items from receipt using Claude Vision
      const extracted = await scanReceipt(imageBuffer, 'image/jpeg');

      if (!extracted.items?.length) {
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
          "🧾 I couldn't find any items on that receipt. Is this a grocery receipt? Try sending a clearer photo."
        );
        return;
      }

      // Fuzzy-match against the household shopping list
      const shoppingList = await db.getShoppingList(ctx.household.id);
      const matchResult = await matchReceiptToList(extracted.items, shoppingList);

      // Complete matched items
      const checkedOff = [];
      for (const match of matchResult.matches || []) {
        if (match.confidence >= 0.7) {
          await db.completeShoppingItemById(match.list_item_id);
          checkedOff.push(match.list_item_name);
        }
      }

      // Build confirmation message
      const store = extracted.store_name ? ` from *${extracted.store_name}*` : '';
      const lines = [`🧾 Receipt scanned${store}`];

      if (checkedOff.length) {
        lines.push(`\n✅ *Checked off:* ${checkedOff.join(', ')}`);
      } else {
        lines.push('\n✅ No shopping list items matched this receipt.');
      }

      if (matchResult.unmatched_receipt_items?.length) {
        lines.push(`\n❓ *Not on your list:* ${matchResult.unmatched_receipt_items.join(', ')}`);
      }

      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
        lines.join('\n'), { parse_mode: 'Markdown' }
      );
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

    // In groups, only respond if addressed
    if (isGroupMessage(ctx) && !isBotAddressed(ctx)) return;

    if (!ctx.familyUser) {
      return ctx.reply(
        `Hi! I don't know you yet. Please send /start to set up or join a household first.`
      );
    }

    // Strip bot @mention from group messages before sending to AI
    const botUsername = ctx.botInfo?.username;
    let text = ctx.message.text;
    if (botUsername) text = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
    if (!text) return;

    try {
      const memberNames = ctx.household.members.map((m) => m.name);
      const result = await classify(text, memberNames);

      const added = { shopping: [], tasks: [] };
      const completed = { shopping: [], tasks: [] };

      // Handle shopping items
      if (result.shopping_items?.length) {
        const toAdd = result.shopping_items.filter((i) => i.action === 'add');
        const toRemove = result.shopping_items.filter((i) => i.action === 'remove');

        if (toAdd.length) {
          const saved = await db.addShoppingItems(ctx.household.id, toAdd, ctx.familyUser.id);
          added.shopping.push(...saved.map((i) => i.item));
        }
        if (toRemove.length) {
          const names = toRemove.map((i) => i.item);
          const done = await db.completeShoppingItemsByName(ctx.household.id, names);
          completed.shopping.push(...done.map((i) => i.item));
        }
      }

      // Handle tasks
      if (result.tasks?.length) {
        const toAdd = result.tasks.filter((t) => t.action === 'add');
        const toComplete = result.tasks.filter((t) => t.action === 'complete');

        if (toAdd.length) {
          const saved = await db.addTasks(ctx.household.id, toAdd, ctx.familyUser.id, ctx.household.members);
          added.tasks.push(...saved.map((t) => t.title));
        }
        if (toComplete.length) {
          for (const t of toComplete) {
            const done = await db.completeTasksByName(ctx.household.id, [t.title], t.assigned_to_name);
            completed.tasks.push(...done.map((d) => d.title));
            // Generate next recurrence for completed recurring tasks
            for (const completedTask of done) {
              if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
            }
          }
        }
      }

      return ctx.reply(result.response_message || 'Done! ✅');
    } catch (err) {
      console.error('Natural language handler error:', err);
      return ctx.reply('Sorry, I had trouble understanding that. Please try again, or use /help to see commands.');
    }
  });

  return bot;
}

module.exports = { createBot };
