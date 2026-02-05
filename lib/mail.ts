/**
 * Complete Mail implementation using modular architecture
 * Uses separate modules for better organization and type safety
 */

// Import types
export type {
  MailAccount,
  MailboxInfo,
  EmailMessage,
  MailboxHierarchy,
  SendMailOptions,
  SearchOptions,
  MoveEmailResult,
  JXAError,
  MailboxSearchConfig,
  EmailSortOptions
} from './types.js';

// Import account operations
import { getAccounts, getMailboxHierarchy } from './mail-accounts.js';

// Import message operations
import { getUnreadMails, getLatestMails, getInboxMessages, getMailById } from './mail-messages.js';

// Import search operations
import { searchMails, searchInbox, searchInMailbox, searchByFlag } from './mail-search.js';

// Import mail operations
import { sendMail, markAsRead, deleteEmails, moveEmails } from './mail-operations.js';

// Export all functions
export {
  // Account operations
  getAccounts,
  getMailboxHierarchy,

  // Message retrieval
  getUnreadMails,
  getLatestMails,
  getInboxMessages,
  getMailById,

  // Search operations
  searchMails,
  searchInbox,
  searchInMailbox,
  searchByFlag,

  // Mail operations
  sendMail,
  markAsRead,
  deleteEmails,
  moveEmails
};

// Default export for backward compatibility
const mailJXA = {
  getAccounts,
  getMailboxHierarchy,
  getUnreadMails,
  getInboxMessages,
  getMailById,
  searchMails,
  searchInbox,
  searchInMailbox,
  searchByFlag,
  getLatestMails,
  sendMail,
  markAsRead,
  deleteEmails,
  moveEmails
};

export default mailJXA;