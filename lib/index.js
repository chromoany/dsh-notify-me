/**
 * dsh-notify-me — host half (no-op).
 *
 * Everything this plugin does lives in the browser half (lib/client.js):
 * desktop notifications and sounds when the agent needs the user's input or a
 * reply finishes. This module exists only so the loader entry mounts the
 * package, letting dsh-client-modules pick up the dsh.client declaration and
 * serve /plugins/dsh-notify-me/client.js to the page.
 */

/** Plugin identity for cordis.yml rows. */
export const name = "dsh-notify-me";

/**
 * Host loader entry: nothing to mount on the server side.
 * @param ctx - host cordis context.
 */
export function apply() {}
