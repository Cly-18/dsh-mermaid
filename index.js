/**
 * dsh-mermaid, host half.
 *
 * Pure UI plugin: this half registers nothing. The row exists so the Host
 * Loader has an entry to scan, and `dsh-client-modules` finds the package's
 * `dsh.client` declaration through it and serves the browser artifact at
 * `/plugins/dsh-mermaid/client.js`.
 *
 * The returned plugin declares no `inject`, so it activates in any profile that
 * mounts it and cannot park on a missing service.
 */
export const name = 'dsh-mermaid'

export function apply() {}
