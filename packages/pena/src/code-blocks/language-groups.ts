export interface LanguageGroup {
  readonly id: string;
  readonly names: readonly string[];
}

export const LANGUAGE_GROUPS: readonly LanguageGroup[] = [
  {
    id: "shell",
    names: [
      "sh",
      "bash",
      "shell",
      "console",
      "zsh",
      "shell-session",
      "shellsession",
    ],
  },
  { id: "text", names: ["text", "plaintext", "plain", "txt", "none"] },
  { id: "yaml", names: ["yaml", "yml"] },
  { id: "javascript", names: ["javascript", "js"] },
  { id: "typescript", names: ["typescript", "ts"] },
  { id: "python", names: ["python", "py", "python3"] },
  { id: "go", names: ["go", "golang"] },
  { id: "ruby", names: ["ruby", "rb"] },
  { id: "markdown", names: ["markdown", "md"] },
  { id: "dockerfile", names: ["dockerfile", "docker"] },
  { id: "powershell", names: ["powershell", "ps1", "pwsh", "ps"] },
  { id: "diff", names: ["diff", "patch"] },
  { id: "protobuf", names: ["protobuf", "proto"] },
  { id: "csharp", names: ["csharp", "cs", "c#"] },
  { id: "kotlin", names: ["kotlin", "kt"] },
  { id: "hcl", names: ["hcl", "terraform", "tf"] },
];

const GROUP_BY_NAME: ReadonlyMap<string, string> = new Map(
  LANGUAGE_GROUPS.flatMap((group) =>
    group.names.map((name): [string, string] => [name, group.id]),
  ),
);

/** The group id for a language as written (lower-cased inside), or undefined. */
export function languageGroup(lang: string): string | undefined {
  return GROUP_BY_NAME.get(lang.toLowerCase());
}
