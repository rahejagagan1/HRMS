import { clickupApi, WORKSPACE_ID } from "./api-client";

/**
 * Invites a user to the ClickUp workspace by email.
 *
 * On success ClickUp creates a pending invite and immediately returns the
 * workspace member record — importantly, it also returns a real numeric
 * ClickUp user id we can persist on our side. The invitee separately gets
 * an email from ClickUp to accept the invite; accepting it does NOT change
 * their id, so we can use the returned id right away.
 *
 * Docs: https://developer.clickup.com/reference/inviteusertoworkspace
 *
 * Returns `{ clickupUserId, username }` on success. Throws with the raw
 * ClickUp error text on failure so the caller can surface the message.
 */
export async function inviteUserToClickup(
  email: string,
  opts?: { admin?: boolean }
): Promise<{ clickupUserId: bigint; username: string; email: string }> {
  if (!email) throw new Error("Email is required for ClickUp invite");

  const data = await clickupApi<any>(`/team/${WORKSPACE_ID}/user`, {
    method: "POST",
    body: JSON.stringify({
      email,
      admin: Boolean(opts?.admin),
    }),
  });

  // ClickUp returns either { team: { members: [{ user: {...} }] } } or
  // { member: { user: {...} } } depending on API version. Handle both.
  const invited =
    data?.team?.members?.[0]?.user ??
    data?.member?.user ??
    data?.user ??
    null;

  if (!invited?.id) {
    throw new Error(
      `ClickUp invite succeeded but no user id returned: ${JSON.stringify(data).slice(0, 200)}`
    );
  }

  return {
    clickupUserId: BigInt(invited.id),
    username: invited.username ?? email,
    email: invited.email ?? email,
  };
}
