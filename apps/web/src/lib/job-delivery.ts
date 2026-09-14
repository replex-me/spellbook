const DEFAULT_JOB_REDELIVERY_SECONDS = 15;
const MIN_JOB_REDELIVERY_SECONDS = 5;
const MAX_JOB_REDELIVERY_SECONDS = 900;

// Native AI tools can mutate the live canvas before the final callback. A
// different process may take over a delivery only before the native worker
// claims it. Once any connector starts a native turn, an expired lease must
// fail visibly instead of replaying a possibly applied canvas edit.
export const NATIVE_AGENT_LEASE_SECONDS = 60;

export function jobRedeliverySeconds(
  value = process.env.SPELLBOOK_JOB_REDELIVERY_SECONDS,
): number {
  if (value === undefined || value.trim() === "")
    return DEFAULT_JOB_REDELIVERY_SECONDS;
  const seconds = Number(value);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < MIN_JOB_REDELIVERY_SECONDS ||
    seconds > MAX_JOB_REDELIVERY_SECONDS
  )
    throw new Error(
      `SPELLBOOK_JOB_REDELIVERY_SECONDS must be an integer from ${MIN_JOB_REDELIVERY_SECONDS} to ${MAX_JOB_REDELIVERY_SECONDS}.`,
    );
  return seconds;
}
