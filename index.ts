#!/usr/bin/env node

/**
 * Apple Mail MCP Server
 * Clean implementation using JXA - no string parsing!
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import mailJXA from "./lib/mail.js";
import {
  GetMailboxesSchema,
  GetUnreadSchema,
  GetInboxMessagesSchema,
  GetLatestSchema,
  GetMailByIdSchema,
  SearchMailsSchema,
  SearchInboxSchema,
  SearchInMailboxSchema,
  SearchByFlagSchema,
  SendMailSchema,
  MarkAsReadSchema,
  DeleteEmailsSchema,
  MoveEmailsSchema
} from "./lib/schemas.js";
import { config, filterAccounts } from "./lib/config.js";

// Tool definitions
const MAIL_TOOLS: Tool[] = [
  {
    name: "mail_get_accounts",
    description: "Get all email accounts configured in Apple Mail",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mail_get_mailboxes",
    description: "Get mailbox hierarchy for a specific account",
    inputSchema: {
      type: "object",
      properties: {
        accountName: {
          type: "string",
          description: "Name of the email account",
        },
      },
      required: ["accountName"],
    },
  },
  {
    name: "mail_get_unread",
    description: "Get unread emails across all mailboxes",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of unread emails to retrieve",
          default: 20,
        },
      },
    },
  },
  {
    name: "mail_get_inboxes",
    description: "Get recent messages from INBOX across all enabled accounts. Returns metadata only — use mail_read for full content.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of messages to retrieve (across all accounts)",
          default: 20,
        },
        accounts: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of account names to check (default: all enabled accounts)",
        },
      },
    },
  },
  {
    name: "mail_search",
    description: "Quick search in priority mailboxes (Inbox, Sent) - limited scope for performance",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: {
          type: "string",
          description: "Text to search for in emails",
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 20,
        },
      },
      required: ["searchTerm"],
    },
  },
  {
    name: "mail_search_inbox",
    description: "Search emails in all inbox folders (fast, focused search)",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: {
          type: "string",
          description: "Text to search for in inbox emails",
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 20,
        },
      },
      required: ["searchTerm"],
    },
  },
  {
    name: "mail_search_mailbox",
    description: "Search emails in a specific mailbox (includes content search)",
    inputSchema: {
      type: "object",
      properties: {
        mailboxName: {
          type: "string",
          description: "Name of the mailbox to search in",
        },
        searchTerm: {
          type: "string",
          description: "Text to search for",
        },
        accountName: {
          type: "string",
          description: "Account name (optional - searches all accounts if not specified)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 20,
        },
      },
      required: ["mailboxName", "searchTerm"],
    },
  },
  {
    name: "mail_search_by_flag",
    description: "Search emails by flag color across all accounts (0=red, 1=orange, 2=yellow, 3=green, 4=blue, 5=purple, 6=gray, -1=no flag)",
    inputSchema: {
      type: "object",
      properties: {
        flagIndex: {
          type: "number",
          description: "Flag color index: -1 (no flag), 0 (red), 1 (orange), 2 (yellow), 3 (green), 4 (blue), 5 (purple), 6 (gray)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 50,
        },
      },
      required: ["flagIndex"],
    },
  },
  {
    name: "mail_get_latest",
    description: "Get latest emails from a specific account",
    inputSchema: {
      type: "object",
      properties: {
        accountName: {
          type: "string",
          description: "Name of the email account",
        },
        limit: {
          type: "number",
          description: "Number of emails to retrieve",
          default: 10,
        },
      },
      required: ["accountName"],
    },
  },
  {
    name: "mail_read",
    description: "Read a specific email by its ID and return full content. Pass accountName and mailboxName from listing results for fast lookup.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The numeric ID or message-ID of the email to read",
        },
        accountName: {
          type: "string",
          description: "Account name hint (from listing results) for fast lookup",
        },
        mailboxName: {
          type: "string",
          description: "Mailbox name hint (from listing results) for fast lookup",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "mail_send",
    description: "Send an email from a specific account",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject",
        },
        body: {
          type: "string",
          description: "Email body content",
        },
        from: {
          type: "string",
          description: "Account name to send from (optional)",
        },
        cc: {
          type: "string",
          description: "CC recipients (optional)",
        },
        bcc: {
          type: "string",
          description: "BCC recipients (optional)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "mail_mark_read",
    description: "Mark emails as read by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of message IDs to mark as read",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "mail_delete",
    description: "Delete emails by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of message IDs to delete",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "mail_move",
    description: "Move emails to a different mailbox",
    inputSchema: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of message IDs to move",
        },
        targetMailbox: {
          type: "string",
          description: "Name of the target mailbox",
        },
        targetAccount: {
          type: "string",
          description: "Name of the target account (optional, searches all if not specified)",
        },
        searchInboxOnly: {
          type: "boolean",
          description: "When true, only searches INBOX mailboxes for performance (default: false)",
          default: false,
        },
      },
      required: ["messageIds", "targetMailbox"],
    },
  },
];

// Create server
const server = new Server(
  {
    name: "mcp-apple",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: MAIL_TOOLS,
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "mail_get_accounts": {
        const allAccounts = await mailJXA.getAccounts();
        const enabledAccounts = filterAccounts(allAccounts, config);

        // Add status to each account
        const accountsWithStatus = allAccounts.map(acc => ({
          ...acc,
          configStatus: enabledAccounts.includes(acc) ? 'enabled' : 'disabled'
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(accountsWithStatus, null, 2),
            },
          ],
        };
      }

      case "mail_get_mailboxes": {
        const validated = GetMailboxesSchema.parse(args);
        const { accountName } = validated;
        const hierarchy = await mailJXA.getMailboxHierarchy(accountName);

        // Format as tree for readability
        let output = `Mailbox Hierarchy for ${accountName}:\n`;
        output += `Total: ${hierarchy.total} mailboxes\n\n`;

        hierarchy.roots.forEach((rootName: string) => {
          const mailbox = hierarchy.tree[rootName];
          output += `📁 ${rootName} (${mailbox.messageCount} messages)\n`;

          mailbox.children.slice(0, 5).forEach((childName: string) => {
            const child = hierarchy.tree[childName];
            if (child) {
              output += `  └─ ${childName} (${child.messageCount} msgs)\n`;
            }
          });

          if (mailbox.children.length > 5) {
            output += `  └─ ... and ${mailbox.children.length - 5} more\n`;
          }
        });

        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "mail_get_unread": {
        const validated = GetUnreadSchema.parse(args);
        const { limit = 20 } = validated;
        const emails = await mailJXA.getUnreadMails(limit);

        if (emails.length === 0) {
          return {
            content: [{ type: "text", text: "No unread emails found." }],
          };
        }

        const output = emails.map((email: any) =>
          `📧 ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateSent).toLocaleString()}\n` +
          `   Mailbox: ${email.mailbox}\n` +
          `   Content: ${email.content || '[No content]'}\n`
        ).join('\n');

        return {
          content: [{ type: "text", text: `Found ${emails.length} unread emails:\n\n${output}` }],
        };
      }

      case "mail_get_inboxes": {
        const validated = GetInboxMessagesSchema.parse(args);
        const { limit = 20, accounts: requestedAccounts } = validated;

        // Use config filtering: if specific accounts requested, intersect with config
        const allAccounts = await mailJXA.getAccounts();
        const enabledAccounts = filterAccounts(allAccounts, config);
        const enabledNames = enabledAccounts.map(a => a.name);

        let accountFilter: string[] | undefined;
        if (requestedAccounts && requestedAccounts.length > 0) {
          accountFilter = requestedAccounts.filter(name => enabledNames.includes(name));
        } else {
          accountFilter = enabledNames;
        }

        const result = await mailJXA.getInboxMessages(limit, accountFilter);

        // Summary header with per-account counts
        const summary = result.accounts.map((acc: any) =>
          `${acc.name}: ${acc.inboxCount} messages (${acc.unreadCount} unread)`
        ).join(' | ');

        if (result.messages.length === 0) {
          return {
            content: [{ type: "text", text: `${summary}\n\nNo messages found in inboxes.` }],
          };
        }

        const output = result.messages.map((email: any, i: number) =>
          `${i + 1}. ${email.isRead ? ' ' : '*'} ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `   Account: ${email.accountName}\n` +
          `   ID: ${email.id}\n`
        ).join('\n');

        return {
          content: [{ type: "text", text: `${summary}\n\n${output}` }],
        };
      }

      case "mail_search": {
        const validated = SearchMailsSchema.parse(args);
        const { searchTerm, limit = 20 } = validated;
        const emails = await mailJXA.searchMails(searchTerm, limit);

        if (emails.length === 0) {
          return {
            content: [{ type: "text", text: `No emails found containing "${searchTerm}" in priority mailboxes` }],
          };
        }

        const output = emails.map((email: any) =>
          `📨 ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `   Read: ${email.isRead ? '✓' : '✗'}\n`
        ).join('\n');

        return {
          content: [{ type: "text", text: `Found ${emails.length} emails:\n\n${output}` }],
        };
      }

      case "mail_search_inbox": {
        const validated = SearchInboxSchema.parse(args);
        const { searchTerm, limit = 20 } = validated;
        const emails = await mailJXA.searchInbox(searchTerm, limit);

        if (emails.length === 0) {
          return {
            content: [{ type: "text", text: `No emails found containing "${searchTerm}" in inbox` }],
          };
        }

        const output = emails.map((email: any) =>
          `📧 ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `   Read: ${email.isRead ? '✓' : '✗'}\n`
        ).join('\n');

        return {
          content: [{ type: "text", text: `Found ${emails.length} emails in inbox:\n\n${output}` }],
        };
      }

      case "mail_search_mailbox": {
        const validated = SearchInMailboxSchema.parse(args);
        const { mailboxName, searchTerm, accountName, limit = 20 } = validated;
        const emails = await mailJXA.searchInMailbox(mailboxName, searchTerm, accountName, limit);

        if (emails.length === 0) {
          const location = accountName ? `${mailboxName} in ${accountName}` : mailboxName;
          return {
            content: [{ type: "text", text: `No emails found containing "${searchTerm}" in ${location}` }],
          };
        }

        const output = emails.map((email: any) =>
          `📨 ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `   Account: ${email.accountName}\n` +
          `   Message-ID: ${email.messageId}\n` +
          `   Numeric ID: ${email.id}\n`
        ).join('\n');

        const location = accountName ? `${mailboxName} (${accountName})` : mailboxName;
        return {
          content: [{ type: "text", text: `Found ${emails.length} emails in ${location}:\n\n${output}` }],
        };
      }

      case "mail_search_by_flag": {
        const validated = SearchByFlagSchema.parse(args);
        const { flagIndex, limit = 50 } = validated;
        const emails = await mailJXA.searchByFlag(flagIndex, limit);

        if (emails.length === 0) {
          const flagColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
          const flagName = flagIndex === -1 ? 'no flag' : flagColors[flagIndex] || `flag ${flagIndex}`;
          return {
            content: [{ type: "text", text: `No emails found with ${flagName}` }],
          };
        }

        const flagColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
        const flagName = flagIndex === -1 ? 'no flag' : flagColors[flagIndex] || `flag ${flagIndex}`;

        const output = emails.map((email: any) =>
          `📨 ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `   Account: ${email.accountName}\n` +
          `   Mailbox: ${email.mailbox}\n` +
          `   Message-ID: ${email.messageId}\n` +
          `   Numeric ID: ${email.id}\n`
        ).join('\n');

        return {
          content: [{ type: "text", text: `Found ${emails.length} emails with ${flagName}:\n\n${output}` }],
        };
      }

      case "mail_get_latest": {
        const validated = GetLatestSchema.parse(args);
        const { accountName, limit = 10 } = validated;
        const emails = await mailJXA.getLatestMails(accountName, limit);

        const output = emails.map((email: any, i: number) =>
          `${i + 1}. ${email.subject}\n` +
          `   From: ${email.sender}\n` +
          `   Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `   Content: ${email.content || '[No content]'}\n`
        ).join('\n');

        return {
          content: [{ type: "text", text: `Latest emails from ${accountName}:\n\n${output}` }],
        };
      }

      case "mail_read": {
        const validated = GetMailByIdSchema.parse(args);
        const { messageId, accountName: hintAccount, mailboxName: hintMailbox } = validated;
        const email = await mailJXA.getMailById(messageId, hintAccount, hintMailbox);

        if (!email) {
          return {
            content: [{ type: "text", text: `Email not found with ID: ${messageId}` }],
            isError: true,
          };
        }

        const output =
          `📧 ${email.subject}\n\n` +
          `From: ${email.sender}\n` +
          `To: ${email.recipients?.join(', ') || '[Unknown]'}\n` +
          (email.ccRecipients?.length ? `CC: ${email.ccRecipients.join(', ')}\n` : '') +
          `Date: ${new Date(email.dateReceived).toLocaleString()}\n` +
          `Mailbox: ${email.mailbox} (${email.accountName})\n` +
          `Read: ${email.isRead ? '✓' : '✗'} | Flagged: ${email.isFlagged ? '✓' : '✗'}\n` +
          `Message-ID: ${email.messageId}\n` +
          `\n---\n\n` +
          `${email.content || '[No content]'}`;

        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "mail_send": {
        const validated = SendMailSchema.parse(args);
        const { to, subject, body, from, cc, bcc } = validated;

        const result = await mailJXA.sendMail({
          to,
          subject,
          body,
          accountName: from,
          cc,
          bcc
        });
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "mail_mark_read": {
        const validated = MarkAsReadSchema.parse(args);
        const { messageIds } = validated;
        const count = await mailJXA.markAsRead(messageIds);
        return {
          content: [{ type: "text", text: `Marked ${count} emails as read.` }],
        };
      }

      case "mail_delete": {
        const validated = DeleteEmailsSchema.parse(args);
        const { messageIds } = validated;
        const count = await mailJXA.deleteEmails(messageIds);
        return {
          content: [{ type: "text", text: `Deleted ${count} emails.` }],
        };
      }

      case "mail_move": {
        const validated = MoveEmailsSchema.parse(args);
        const { messageIds, targetMailbox, targetAccount, searchInboxOnly = false } = validated;
        const result = await mailJXA.moveEmails(messageIds, targetMailbox, targetAccount, searchInboxOnly);

        let message = `Moved ${result.moved} email${result.moved !== 1 ? 's' : ''}`;
        if (targetAccount) {
          message += ` to ${targetMailbox} in ${targetAccount}`;
        } else {
          message += ` to ${targetMailbox}`;
        }

        if (result.errors.length > 0) {
          message += `\nErrors:\n${result.errors.join('\n')}`;
        }

        return {
          content: [{ type: "text", text: message }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// --- HTTP Transport ---

const PORT = parseInt(process.env.MCP_APPLE_MAIL_PORT ?? "8263", 10);
const AUTH_TOKEN = process.env.MCP_APPLE_MAIL_TOKEN ?? "";

const transports = new Map<string, StreamableHTTPServerTransport>();

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!AUTH_TOKEN) return true; // no token configured = no auth required
  const header = req.headers.authorization ?? "";
  if (header === `Bearer ${AUTH_TOKEN}`) return true;
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
  return false;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  // Health endpoint (no auth)
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // MCP endpoint
  if (url.pathname === "/mcp") {
    if (!checkAuth(req, res)) return;

    if (req.method === "POST") {
      try {
        const body = await parseBody(req);
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, transport!);
            },
          });

          transport.onclose = () => {
            const sid = [...transports.entries()].find(([, t]) => t === transport)?.[0];
            if (sid) transports.delete(sid);
          };

          await server.connect(transport);
        }

        await transport.handleRequest(req, res, body);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
      return;
    }

    if (req.method === "GET") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active session" }));
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handleRequest(req, res);
        transports.delete(sessionId!);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active session" }));
      }
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Fallback
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.error(`Apple Mail MCP Server (HTTP) listening on http://127.0.0.1:${PORT}`);
  console.error(`Health: http://127.0.0.1:${PORT}/health`);
  console.error(`MCP:    http://127.0.0.1:${PORT}/mcp`);
});