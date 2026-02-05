/**
 * Mail Messages module - handle message retrieval operations
 */

import { runJXA, escapeJXAString } from './jxa-executor.js';
import { EmailMessage } from './types.js';

const DEFAULT_PRIORITY_MAILBOXES = ['INBOX', 'Sent Messages', 'Sent', 'Drafts'];

/**
 * Helper to create message object from JXA
 */
function createMessageJXA(includeContent = true, contentLimit = 500): string {
  const contentExpression = includeContent
    ? `(msg.content() || '').substring(0, ${contentLimit})`
    : `''`;

  return `(function() {
    var recipients = [];
    try {
      var toRecipients = msg.toRecipients();
      for (var k = 0; k < toRecipients.length; k++) {
        recipients.push(toRecipients[k].address());
      }
    } catch (e) {}

    return {
      id: msg.id(),
      subject: msg.subject() || '[No Subject]',
      sender: (msg.sender() || '[Unknown]').toString(),
      recipients: recipients,
      dateSent: msg.dateSent().toISOString(),
      dateReceived: msg.dateReceived().toISOString(),
      content: ${contentExpression},
      isRead: msg.readStatus(),
      isFlagged: msg.flaggedStatus(),
      mailbox: mailbox.name(),
      accountName: mailbox.account().name()
    };
  })()`;
}

/**
 * Get unread emails across all account INBOXes
 */
export async function getUnreadMails(limit = 20): Promise<EmailMessage[]> {
  return runJXA<EmailMessage[]>(`
    var Mail = Application('Mail');
    var emails = [];
    var collected = 0;
    var maxEmails = ${limit};

    // Iterate account mailboxes, not application-level mailboxes
    var accounts = Mail.accounts();

    for (var a = 0; a < accounts.length && collected < maxEmails; a++) {
      try {
        var account = accounts[a];
        if (!account.enabled()) continue;

        var mailboxes = account.mailboxes();

        // Check INBOX first, then other priority mailboxes
        var priorityNames = ['INBOX', 'Sent Messages', 'Sent'];
        var inboxes = [];
        var others = [];

        for (var i = 0; i < mailboxes.length; i++) {
          var mbName = mailboxes[i].name();
          var isPriority = false;
          for (var p = 0; p < priorityNames.length; p++) {
            if (mbName.toUpperCase() === priorityNames[p].toUpperCase()) {
              isPriority = true;
              break;
            }
          }
          if (isPriority) {
            inboxes.push(mailboxes[i]);
          } else {
            others.push(mailboxes[i]);
          }
        }

        // Only check INBOX and priority mailboxes for unread
        var toCheck = inboxes.concat(others.slice(0, 3));

        for (var i = 0; i < toCheck.length && collected < maxEmails; i++) {
          var mailbox = toCheck[i];

          try {
            var messages = mailbox.messages();
            // Check from newest
            var checkCount = Math.min(100, messages.length);
            for (var j = messages.length - 1; j >= messages.length - checkCount && j >= 0 && collected < maxEmails; j--) {
              var msg = messages[j];

              if (!msg.readStatus()) {
                emails.push(${createMessageJXA(false)});
                collected++;
              }
            }
          } catch (e) {
            // Skip problematic mailboxes
          }
        }
      } catch (e) {
        // Skip problematic accounts
      }
    }

    return emails;
  `, { timeout: 60000 });
}

/**
 * Get latest emails from specific account
 * IMPORTANT: Results are sorted by date with newest first
 */
export async function getLatestMails(accountName: string, limit = 10): Promise<EmailMessage[]> {
  const escapedName = escapeJXAString(accountName);

  return runJXA<EmailMessage[]>(`
    var Mail = Application('Mail');
    var allMessages = [];

    // Find account
    var accounts = Mail.accounts();
    var targetAccount = null;

    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].name() === "${escapedName}") {
        targetAccount = accounts[i];
        break;
      }
    }

    if (!targetAccount) {
      return [];
    }

    var mailboxes = targetAccount.mailboxes();
    var accountName = "${escapedName}";

    // Prioritize INBOX and common mailboxes for recent emails
    var priorityNames = ${JSON.stringify(DEFAULT_PRIORITY_MAILBOXES)};
    var priorityMailboxes = [];
    var otherMailboxes = [];

    // Sort mailboxes by priority
    for (var i = 0; i < mailboxes.length; i++) {
      var mailbox = mailboxes[i];
      var name = mailbox.name().toUpperCase();

      var isPriority = false;
      for (var j = 0; j < priorityNames.length; j++) {
        if (name === priorityNames[j].toUpperCase() || name.includes(priorityNames[j].toUpperCase())) {
          isPriority = true;
          break;
        }
      }

      if (isPriority) {
        priorityMailboxes.push(mailbox);
      } else {
        otherMailboxes.push(mailbox);
      }
    }

    // Check priority mailboxes first, then a few others
    var orderedMailboxes = priorityMailboxes.concat(otherMailboxes);
    var checkLimit = Math.min(6, orderedMailboxes.length);

    for (var i = 0; i < checkLimit; i++) {
      var mailbox = orderedMailboxes[i];

      try {
        var messages = mailbox.messages();

        // Get recent messages — metadata only, no content extraction
        var checkCount = Math.min(30, messages.length);

        for (var j = messages.length - 1; j >= messages.length - checkCount && j >= 0; j--) {
          var msg = messages[j];
          allMessages.push(${createMessageJXA(false)});
        }
      } catch (e) {
        // Skip problematic mailboxes
      }
    }

    // Sort ALL collected messages by date (newest first)
    allMessages.sort(function(a, b) {
      return new Date(b.dateReceived).getTime() - new Date(a.dateReceived).getTime();
    });

    // Return only the requested number of most recent emails
    return allMessages.slice(0, ${limit});
  `, { timeout: 60000 });
}

export interface InboxResult {
  accounts: { name: string; inboxCount: number; unreadCount: number }[];
  messages: EmailMessage[];
}

/**
 * Get recent INBOX messages across all enabled accounts.
 * Optionally filter to specific account names.
 * Returns metadata only — use getMailById for full content.
 * Includes per-account inbox counts.
 */
export async function getInboxMessages(
  limit = 20,
  accountNames?: string[]
): Promise<InboxResult> {
  const accountFilter = accountNames && accountNames.length > 0
    ? `var allowedAccounts = ${JSON.stringify(accountNames)};`
    : `var allowedAccounts = null;`;

  return runJXA<InboxResult>(`
    var Mail = Application('Mail');
    var allMessages = [];
    var accountSummaries = [];
    ${accountFilter}

    var accounts = Mail.accounts();

    for (var a = 0; a < accounts.length; a++) {
      try {
        var account = accounts[a];
        if (!account.enabled()) continue;

        var accountName = account.name();

        // Skip if not in allowed list
        if (allowedAccounts !== null) {
          var allowed = false;
          for (var f = 0; f < allowedAccounts.length; f++) {
            if (allowedAccounts[f] === accountName) {
              allowed = true;
              break;
            }
          }
          if (!allowed) continue;
        }

        // Find INBOX only
        var mailboxes = account.mailboxes();
        var inbox = null;

        for (var i = 0; i < mailboxes.length; i++) {
          if (mailboxes[i].name() === 'INBOX') {
            inbox = mailboxes[i];
            break;
          }
        }

        if (!inbox) continue;

        var mailbox = inbox;
        var messages = mailbox.messages();
        var totalCount = messages.length;

        // Count unread
        var unread = 0;
        var countLimit = Math.min(totalCount, 200);
        for (var u = 0; u < countLimit; u++) {
          if (!messages[u].readStatus()) unread++;
        }
        if (totalCount > 200 && unread > 0) {
          unread = Math.round(unread * totalCount / 200);
        }

        accountSummaries.push({
          name: accountName,
          inboxCount: totalCount,
          unreadCount: unread
        });

        var checkCount = Math.min(${limit}, totalCount);

        for (var j = messages.length - 1; j >= messages.length - checkCount && j >= 0; j--) {
          var msg = messages[j];
          allMessages.push(${createMessageJXA(false)});
        }
      } catch (e) {
        // Skip problematic accounts
      }
    }

    // Sort by date, newest first
    allMessages.sort(function(a, b) {
      return new Date(b.dateReceived).getTime() - new Date(a.dateReceived).getTime();
    });

    return {
      accounts: accountSummaries,
      messages: allMessages.slice(0, ${limit})
    };
  `, { timeout: 60000 });
}

/**
 * Get a single email by its numeric ID with full content
 */
export async function getMailById(messageId: string): Promise<EmailMessage | null> {
  const escapedId = escapeJXAString(messageId);

  return runJXA<EmailMessage | null>(`
    var Mail = Application('Mail');
    var targetId = "${escapedId}";
    var result = null;
    var found = false;

    // Search all accounts and mailboxes for the message
    var accounts = Mail.accounts();

    for (var a = 0; a < accounts.length && !found; a++) {
      try {
        var mailboxes = accounts[a].mailboxes();

        for (var i = 0; i < mailboxes.length && !found; i++) {
          var mailbox = mailboxes[i];

          try {
            var messages = mailbox.messages();

            for (var j = 0; j < messages.length && !found; j++) {
              var msg = messages[j];

              // Check both numeric ID and message-ID header
              if (String(msg.id()) === targetId || msg.messageId() === targetId) {
                var recipients = [];
                try {
                  var toRecipients = msg.toRecipients();
                  for (var k = 0; k < toRecipients.length; k++) {
                    recipients.push(toRecipients[k].address());
                  }
                } catch (e) {}

                var ccRecipients = [];
                try {
                  var cc = msg.ccRecipients();
                  for (var k = 0; k < cc.length; k++) {
                    ccRecipients.push(cc[k].address());
                  }
                } catch (e) {}

                result = {
                  id: String(msg.id()),
                  messageId: msg.messageId(),
                  subject: msg.subject() || '[No Subject]',
                  sender: (msg.sender() || '[Unknown]').toString(),
                  recipients: recipients,
                  ccRecipients: ccRecipients,
                  dateSent: msg.dateSent().toISOString(),
                  dateReceived: msg.dateReceived().toISOString(),
                  content: msg.content() || '',
                  isRead: msg.readStatus(),
                  isFlagged: msg.flaggedStatus(),
                  flagIndex: msg.flagIndex(),
                  mailbox: mailbox.name(),
                  accountName: accounts[a].name()
                };
                found = true;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    return result;
  `, { timeout: 60000 });
}