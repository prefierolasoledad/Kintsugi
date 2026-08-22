/**
 * No email provider is configured yet, so "sending" an email just logs the
 * link to the backend console. Swap this out for a real provider (Resend,
 * SES, etc.) later — every caller already treats this as async.
 */
export async function sendVerificationEmail(email: string, verifyUrl: string) {
  console.log("\n" + "=".repeat(70));
  console.log(`[dev-mode email] Verification link for ${email}`);
  console.log(verifyUrl);
  console.log("=".repeat(70) + "\n");
}
