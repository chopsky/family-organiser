/**
 * Event reminder processor.
 *
 * Runs on a schedule to find pending event reminders and send
 * WhatsApp notifications to assigned members (or all household
 * members if none assigned).
 */

const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');

/**
 * Format a date/time for display in a reminder message.
 * Uses the household timezone if available.
 */
function formatEventTime(startTime, timezone) {
  try {
    const date = new Date(startTime);
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  } catch {
    return new Date(startTime).toLocaleString('en-GB');
  }
}

/**
 * Process all pending event reminders.
 * Called every minute by the scheduler.
 */
async function processEventReminders() {
  if (!whatsapp.isConfigured()) return;

  try {
    const pendingReminders = await db.getPendingReminders();
    if (pendingReminders.length === 0) return;

    console.log(`[event-reminders] Processing ${pendingReminders.length} pending reminder(s)`);

    for (const reminder of pendingReminders) {
      try {
        const event = reminder.calendar_events;
        if (!event) {
          // Event was deleted; mark reminder as sent to avoid re-processing
          await db.markReminderSent(reminder.id);
          continue;
        }

        // Get the household timezone
        const household = await db.getHouseholdById(reminder.household_id);
        const timezone = household?.timezone || 'Europe/London';

        // Get assignees for this event
        const assignees = await db.getEventAssignees(reminder.event_id);

        // Get all household members
        const members = await db.getHouseholdMembers(reminder.household_id);

        // Determine who to notify:
        // - If there are assignees, notify only them
        // - Otherwise, notify all WhatsApp-connected household members
        let recipients;
        if (assignees.length > 0) {
          const assigneeIds = new Set(assignees.map((a) => a.member_id));
          recipients = members.filter(
            (m) => assigneeIds.has(m.id) && m.whatsapp_linked && m.whatsapp_phone
          );
        } else {
          recipients = members.filter(
            (m) => m.member_type !== 'dependent' && m.whatsapp_linked && m.whatsapp_phone
          );
        }

        if (recipients.length === 0) {
          await db.markReminderSent(reminder.id);
          continue;
        }

        const formattedTime = formatEventTime(event.start_time, timezone);
        const message = `🔔 *Reminder:* ${event.title}\nStarts in ${reminder.reminder_offset} (${formattedTime})`;

        for (const recipient of recipients) {
          try {
            await whatsapp.sendTemplate(recipient.whatsapp_phone, message);
          } catch (err) {
            console.error(
              `[event-reminders] Failed to send to ${recipient.name}:`,
              err.message
            );
          }
        }

        await db.markReminderSent(reminder.id);
        console.log(
          `[event-reminders] Sent reminder for "${event.title}" to ${recipients.length} recipient(s)`
        );
      } catch (err) {
        console.error(
          `[event-reminders] Error processing reminder ${reminder.id}:`,
          err.message
        );
        // Don't mark as sent on error — will retry next cycle
      }
    }
  } catch (err) {
    console.error('[event-reminders] processEventReminders failed:', err.message);
  }
}

module.exports = { processEventReminders };
