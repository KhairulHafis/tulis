/** The environment for every Tulis git call. Returns a new object; never mutates `env`. */
export function buildGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !key.toUpperCase().startsWith("GIT_")) {
      result[key] = value;
    }
  }
  // Never wait for a password on a terminal.
  result["GIT_TERMINAL_PROMPT"] = "0";
  // An empty list allows no transport, so a partial clone can never download.
  result["GIT_ALLOW_PROTOCOL"] = "";
  // Git 2.44+ does not even try a lazy fetch (older git ignores this).
  result["GIT_NO_LAZY_FETCH"] = "1";
  // Read commands must never write the index.
  result["GIT_OPTIONAL_LOCKS"] = "0";
  return result;
}
