# Telegram Message Relay — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Telegram bot that allows users to send plain-text messages to other Telegram accounts via phone number. Messages appear to originate from the bot, preserving sender privacy while reporting delivery success/failure with reasons. All UI is in Russian.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- regular Telegram users
- privacy-conscious messengers

## Success criteria

- User receives delivery confirmation with reason code
- Message successfully delivered to target account when reachable

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Show main menu with 'Send message by phone' button
- **Send message by phone** (button, actor: user, callback: send:start) — Initiates message sending flow
  - inputs: phone number, message text
  - outputs: delivery status report

## Flows

### message_delivery
_Trigger:_ /start or 'Send message by phone' button

1. Show main menu
2. Request phone number input
3. Validate E.164 format
4. Request message text input
5. Attempt Telegram message delivery
6. Report delivery status with reason

_Data touched:_ User, Target phone number, Outgoing message, Delivery status

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where delivery failure notifications are sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **MessageAttempt** _(retention: persistent)_ — Record of message delivery attempt
  - fields: timestamp, sender_id, target_phone, message_text, delivery_result

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- View audit logs of delivery attempts
- Configure language settings (currently Russian)

## Notifications

- Delivery success/failure reports to sender
- Admin notifications for persistent failures

## Permissions & privacy

- Messages appear to originate from bot account
- Sender phone number never exposed to recipient
- Message text stored 90 days for audit

## Edge cases

- Invalid phone number format
- Target not a Telegram user
- Recipient blocks bot messages
- Telegram API rate limiting

## Required tests

- End-to-end message delivery success flow
- Delivery failure with privacy-blocked recipient
- Invalid phone format validation

## Assumptions

- Telegram API will return standard error codes for delivery failures
- Users understand messages may fail due to recipient privacy settings
