---
name: ping-data-security
description: Ping Clean data and access security standard. Use whenever creating or changing a database table, migration, RLS policy, API route, server action, edge function, file upload, or anything that reads customer or cleaner personal data.
---
# Ping data security

1. RLS: every new table has `alter table ... enable row level security` and its policies
   in the same migration. Customers see their own rows; cleaners see offers and work they
   have claimed; admins see all. Write a test per role for every new table.
2. Service-role key: server-only (lib/db/admin.ts, supabase/functions). Never imported by
   anything under app/ that renders on the client.
3. Address privacy: before a cleaner claims a series they see town, postcode district,
   bedrooms and hours only. Full address, access notes and key codes unlock after claim.
4. Cleaner documents (DBS, ID, insurance, right-to-work) live in a private Storage bucket.
   Signed URLs only, 10-minute expiry, admin and the owning cleaner only.
5. Never log names, phone numbers, addresses, access notes or document contents.
6. Validate every input on the server with zod. Never trust a role, price or id sent
   from the browser.
7. Every admin action (approve, assign, refund, tier change) writes an audit row.

Run `bash scripts/check-secrets.sh && bash scripts/check-rls.sh` and include the output
in your summary.
