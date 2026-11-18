import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const organizers = sqliteTable('arena_organizers', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().unique(),
  name: text('name').notNull(), createdAt: text('created_at').notNull(),
});
export const memberships = sqliteTable('arena_memberships', {
  organizerId: text('organizer_id').notNull().references(() => organizers.id),
  userId: text('user_id').notNull(), role: text('role').notNull(),
}, t => [primaryKey({ columns: [t.organizerId, t.userId] })]);
export const profiles = sqliteTable('arena_profiles', {
  userId: text('user_id').primaryKey(), data: text('data').notNull(),
  version: integer('version').notNull().default(1), updatedAt: text('updated_at').notNull(),
});
export const events = sqliteTable('arena_events', {
  id: text('id').primaryKey(), organizerId: text('organizer_id').notNull().references(() => organizers.id),
  data: text('data').notNull(), status: text('status').notNull().default('draft'),
  kind: text('kind').notNull().default('test'), version: integer('version').notNull().default(1),
  rosterVersion: integer('roster_version').notNull().default(0),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const registrations = sqliteTable('arena_registrations', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(() => events.id),
  athleteId: text('athlete_id').notNull().references(() => profiles.userId),
  athleteData: text('athlete_data').notNull(), categoryId: text('category_id').notNull(),
  amountCents: integer('amount_cents').notNull(), currency: text('currency').notNull().default('BRL'),
  regulationVersion: text('regulation_version').notNull(), status: text('status').notNull().default('active'),
  paymentStatus: text('payment_status').notNull().default('pending'), paymentSource: text('payment_source'),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('arena_active_registration').on(t.eventId, t.athleteId).where(sql`${t.status} = 'active'`)]);
export const audit = sqliteTable('arena_audit', {
  id: text('id').primaryKey(), organizerId: text('organizer_id').notNull().references(() => organizers.id),
  eventId: text('event_id'), actorId: text('actor_id').notNull(), action: text('action').notNull(),
  resourceId: text('resource_id').notNull(), details: text('details').notNull(), at: text('at').notNull(),
});
export const competitions = sqliteTable('arena_competitions', {
  eventId: text('event_id').primaryKey().references(() => events.id),
  data: text('data').notNull(), version: integer('version').notNull().default(1),
  sourceRosterVersion: integer('source_roster_version').notNull(),
  publishedAt: text('published_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
