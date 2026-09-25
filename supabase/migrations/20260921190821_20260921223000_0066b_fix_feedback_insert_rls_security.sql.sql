/*
# Fix feedback INSERT RLS policy security bug

## Problem
The feedback_insert RLS policy had an operator precedence bug:
  `auth.uid() = user_id AND type <> 'security_report' OR is_public = false`
Due to SQL precedence (AND binds tighter than OR), this evaluated as:
  `(auth.uid() = user_id AND type <> 'security_report') OR (is_public = false)`
This meant ANY authenticated user could insert feedback with is_public = false
into the table as ANY user_id — the ownership check was bypassed
whenever is_public was false (which is the default).

## Fix
Replace the policy with a correct ownership-first check:
  `auth.uid() = user_id`
Security reports are forced private by the DB CHECK constraint
(fb_security_never_public) and by the create_feedback RPC, so the
INSERT policy only needs to enforce ownership. The RPC (create_feedback)
is the intended insert path and sets is_public correctly.

## Security impact
Before: any authenticated user could create feedback rows impersonating
other users (setting arbitrary user_id with is_public = false).
After: only the authenticated owner can insert their own feedback rows.
*/

DROP POLICY IF EXISTS "feedback_insert" ON feedback;
CREATE POLICY "feedback_insert"
ON feedback FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
