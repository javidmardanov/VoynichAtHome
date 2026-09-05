import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Better Auth's standard SQLite models. Application data references user IDs,
// never provider access tokens. Tokens are not exposed by our profile APIs.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false), image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
export const session = sqliteTable('session', {
  id: text('id').primaryKey(), expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(), token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
}, t => [index('session_user_idx').on(t.userId)]);
export const account = sqliteTable('account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }), refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }), scope: text('scope'), password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
}, t => [index('account_user_idx').on(t.userId), uniqueIndex('account_provider_idx').on(t.providerId, t.accountId)]);
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(), createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
}, t => [index('verification_identifier_idx').on(t.identifier)]);
export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(), lastRequest: integer('last_request', { mode: 'number' }).notNull()
});

export const guests = sqliteTable('guests', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').unique(), userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(), blocked: integer('blocked').notNull().default(0)
}, t => [index('guests_user_idx').on(t.userId)]);
export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }), displayName: text('display_name').notNull(),
  public: integer('public').notNull().default(0), moderated: integer('moderated').notNull().default(0), updatedAt: integer('updated_at').notNull()
});
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(), name: text('name').notNull(), ownerId: text('owner_id').unique().references(() => user.id, { onDelete: 'set null' }),
  moderated: integer('moderated').notNull().default(0), createdAt: integer('created_at').notNull()
});
export const membership = sqliteTable('membership', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }), teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }), joinedAt: integer('joined_at').notNull()
}, t => [index('membership_team_idx').on(t.teamId)]);
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), title: text('title').notNull(), question: text('question').notNull(), manifestDigest: text('manifest_digest').notNull().unique(),
  manifest: text('manifest').notNull(), status: text('status').notNull().default('draft'), scientificStatus: text('scientific_status').notNull().default('computation'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull()
}, t => [index('campaign_status_idx').on(t.status)]);
export const releases = sqliteTable('releases', {
  id: text('id').primaryKey(), moduleDigest: text('module_digest').notNull(), modulePath: text('module_path').notNull(), state: text('state').notNull().default('approved'), provenance: text('provenance').notNull(), createdAt: integer('created_at').notNull()
});
export const units = sqliteTable('units', {
  id: text('id').primaryKey(), campaignId: text('campaign_id').notNull().references(() => campaigns.id), releaseId: text('release_id').notNull().references(() => releases.id),
  specification: text('specification').notNull(), inputDigest: text('input_digest').notNull(), inputKey: text('input_key').notNull(),
  state: text('state').notNull().default('open'), credit: integer('credit').notNull(), reserveMs: integer('reserve_ms').notNull(), reserved: integer('reserved').notNull().default(0),
  trustedResult: text('trusted_result'), trustedHash: text('trusted_hash'), checkingUntil: integer('checking_until'), validationError: text('validation_error'), createdAt: integer('created_at').notNull()
}, t => [index('units_campaign_state_idx').on(t.campaignId, t.state)]);
export const attempts = sqliteTable('attempts', {
  id: text('id').primaryKey(), unitId: text('unit_id').notNull().references(() => units.id), guestId: text('guest_id').notNull().references(() => guests.id),
  expiresAt: integer('expires_at').notNull(), createdAt: integer('created_at').notNull(), submittedAt: integer('submitted_at'),
  resultHash: text('result_hash'), result: text('result'), state: text('state').notNull().default('leased')
}, t => [uniqueIndex('attempt_unit_guest_idx').on(t.unitId,t.guestId), index('attempt_unit_state_idx').on(t.unitId,t.state), index('attempt_guest_state_idx').on(t.guestId,t.state), index('attempt_expiry_idx').on(t.state,t.expiresAt)]);
export const credit = sqliteTable('credit', {
  attemptId: text('attempt_id').primaryKey().references(() => attempts.id), guestId: text('guest_id').notNull().references(() => guests.id),
  unitId: text('unit_id').notNull().references(() => units.id), amount: integer('amount').notNull(), checkedAt: integer('checked_at').notNull()
}, t => [uniqueIndex('credit_unit_guest_idx').on(t.unitId,t.guestId), index('credit_guest_idx').on(t.guestId)]);
export const limits = sqliteTable('limits', {
  window: text('window').primaryKey(), assignments: integer('assignments').notNull().default(0), reservedMs: integer('reserved_ms').notNull().default(0),
  maxAssignments: integer('max_assignments').notNull(), maxReservedMs: integer('max_reserved_ms').notNull(), maxInflight: integer('max_inflight').notNull()
});
export const controls = sqliteTable('controls', { id: text('id').primaryKey(), stopped: integer('stopped').notNull().default(1), reason: text('reason').notNull(), updatedAt: integer('updated_at').notNull() });
export const audit = sqliteTable('audit', {
  id: text('id').primaryKey(), actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }), action: text('action').notNull(), objectId: text('object_id').notNull(), detail: text('detail').notNull(), createdAt: integer('created_at').notNull()
});
