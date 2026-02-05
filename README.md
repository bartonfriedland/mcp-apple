# MCP Apple Mail Desktop Extension

A desktop extension for Claude that provides seamless Apple Mail integration through the Model Context Protocol (MCP) using JXA (JavaScript for Automation).

## Features

✨ **No String Parsing** - Uses JXA to return native JavaScript objects
🎯 **Type-Safe** - Full TypeScript support with interfaces
📧 **Complete Mail Support** - Read, search, send, manage emails
🔐 **Account-Specific Sending** - Send from any configured account
📁 **Hierarchical Mailboxes** - Full mailbox tree structure support

## Installation

### As a Desktop Extension (Recommended)

1. Download the `apple-mail.mcpb` extension package
2. Double-click to install in Claude Desktop
3. Configure your preferences in the Claude Desktop settings

### Manual Installation

For development or manual setup:

```bash
# Clone the repository
git clone https://github.com/LionSR/mcp-apple-mail
cd mcp-apple-mail

# Install dependencies
npm install

# Build the extension
npm run build

# Create the MCPB package
npm run pack
```

Then add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "node",
      "args": ["/path/to/mcp-apple/dist/index.js"],
      "env": {
        "MAIL_ENABLED_ACCOUNTS": "${user_config.enabled_accounts}",
        "MAIL_DISABLED_ACCOUNTS": "${user_config.disabled_accounts}",
        "MAIL_SEARCH_DEFAULT_LIMIT": "${user_config.search_limit}",
        "MAIL_PRIORITY_MAILBOXES": "${user_config.priority_mailboxes}",
        "MAIL_JXA_TIMEOUT": "${user_config.jxa_timeout}",
        "MAIL_MAX_MAILBOXES_CHECK": "${user_config.max_mailboxes_check}",
        "MAIL_MESSAGES_PER_MAILBOX": "${user_config.messages_per_mailbox}"
      }
    }
  }
}
```

## Configuration

When installed as a desktop extension, you can configure the following settings through the Claude Desktop UI:

| Setting | Description | Default |
|---------|-------------|---------|
| **Enabled Accounts** | Comma-separated list of account names to enable | All accounts |
| **Disabled Accounts** | Comma-separated list of account names to disable | None |
| **Search Limit** | Default number of results for search operations | 20 |
| **Priority Mailboxes** | Comma-separated list of priority mailbox names | INBOX, Sent Messages, Sent, Drafts |
| **JXA Timeout** | Timeout for JXA operations (ms) | 30000 |
| **Max Mailboxes** | Maximum mailboxes to check in operations | 10 |
| **Messages per Mailbox** | Messages to check per mailbox | 50 |

**Note:** If both `MAIL_ENABLED_ACCOUNTS` and `MAIL_DISABLED_ACCOUNTS` are specified, only accounts in the enabled list will be active.

## Available Tools

### Reading & Searching

#### `mail_get_accounts`
Get all configured email accounts.

#### `mail_get_mailboxes`
Get mailbox hierarchy for a specific account.

#### `mail_get_unread`
Get unread emails across all mailboxes (with configurable limit).

#### `mail_get_latest`
Get latest emails from a specific account.

#### `mail_read`
Read a specific email by its numeric ID or message-ID. Returns full content including body text.

**Parameters:**
- `messageId` (required): The numeric ID or message-ID of the email

**Note:** This tool searches through mailboxes to find the email. For large mailboxes, this may take time. See Task #32 for optimization plans.

#### `mail_search`
Quick search in priority mailboxes (Inbox, Sent) - limited scope for performance.

#### `mail_search_inbox`
Search emails in all inbox folders across accounts. Fast, focused search.

**Parameters:**
- `searchTerm` (required): Text to search for
- `limit` (optional): Maximum results (default: 20)

#### `mail_search_mailbox`
Search emails in a specific mailbox (includes content search).

**Parameters:**
- `mailboxName` (required): Name of the mailbox to search
- `searchTerm` (required): Text to search for
- `accountName` (optional): Account name (searches all if not specified)
- `limit` (optional): Maximum results (default: 20)

#### `mail_search_by_flag`
Search emails by flag color across all accounts.

**Parameters:**
- `flagIndex` (required): Flag color index
  - `-1` = no flag
  - `0` = red, `1` = orange, `2` = yellow, `3` = green, `4` = blue, `5` = purple, `6` = gray
- `limit` (optional): Maximum results (default: 50)

### Composing & Sending

#### `mail_send`
Send email from a specific account.

**Parameters:**
- `to` (required): Recipient email address
- `subject` (required): Email subject
- `body` (required): Email body content
- `from` (optional): Account name to send from
- `cc` (optional): CC recipients
- `bcc` (optional): BCC recipients

### Managing

#### `mail_mark_read`
Mark emails as read by their IDs.

#### `mail_delete`
Delete emails by their IDs.

#### `mail_move`
Move emails to a different mailbox by Message-ID.

**Parameters:**
- `messageIds` (required): Array of Message-IDs (GUIDs) to move
- `targetMailbox` (required): Name of destination mailbox
- `targetAccount` (optional): Name of destination account
- `searchInboxOnly` (optional, default: false): When true, only searches INBOX mailboxes for performance

**Performance Note:** When `searchInboxOnly=false` (default), this operation searches through ALL mailboxes in ALL accounts to find the source emails. If you have accounts with many mailboxes (e.g., 240+ folders), this can cause significant delays (10-30 seconds or more) even when moving emails from accounts with few mailboxes. Use `searchInboxOnly=true` for faster performance when you know emails are in INBOX folders.

## Performance Considerations

### Mail Operations Performance

**Problem:** The `mail_move`, `mail_mark_read`, and `mail_delete` operations search through ALL mailboxes in ALL configured accounts to find emails by Message-ID. This means:

- If you have one account with 240+ mailboxes (e.g., iCloud with extensive folder structure)
- Even operations on emails in other accounts (e.g., moving an email in your "Work" account with only 10 folders)
- Will still search through all 240+ mailboxes in the large account
- This causes significant performance degradation and Mail.app may become unresponsive for 10-30+ seconds

**Impact:**
- Operations that should take 1-2 seconds can take 10-30+ seconds
- Mail.app becomes unresponsive during the search (this is normal - JXA blocks user access while running)
- The performance penalty applies to ALL accounts, not just the account with many mailboxes

**Workarounds:**
1. **For INBOX operations:** Use `searchInboxOnly: true` parameter with `mail_move` to search only INBOX folders (typically 2-5 mailboxes instead of 240+)
2. **Future enhancement:** Consider adding a `sourceAccount` parameter to limit search scope to specific accounts

**Example:**
```javascript
// Fast: Only searches INBOX folders across all accounts
mail_move({
  messageIds: ["<message-id@example.com>"],
  targetMailbox: "Archive",
  targetAccount: "Work",
  searchInboxOnly: true  // Fast!
})

// Slow: Searches all 240+ mailboxes if you have large accounts
mail_move({
  messageIds: ["<message-id@example.com>"],
  targetMailbox: "Archive",
  targetAccount: "Work",
  searchInboxOnly: false  // Default, but slow!
})
```

## Technical Details

### JXA Implementation

This implementation uses JavaScript for Automation (JXA) instead of traditional AppleScript, which provides:

- Direct JavaScript object returns (no parsing!)
- Clean error handling
- Type safety with TypeScript
- ISO date formats
- Proper arrays and nested structures

### Example Response

```javascript
// getAccounts() returns:
[
  {
    name: "Work",
    emailAddresses: ["user@company.com"],
    enabled: true,
    id: "ABC-123-DEF"
  },
  // ...
]

// No string parsing needed!
```

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm run test

# Build for production
npm run build

# Create MCPB package
npm run pack
```

## Requirements

- macOS (for Apple Mail access)
- Node.js 16+ and npm
- Apple Mail configured with at least one account

## License

MIT

## Credits

Clean implementation without string parsing, built with JXA for maximum reliability and performance.