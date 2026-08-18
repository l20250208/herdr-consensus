const DANGEROUS_TOKENS = new Set([
  "sudo",
  "su",
  "rm",
  "rmdir",
  "mkfs",
  "dd",
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "kubectl",
  "terraform",
  "ansible",
]);

const DANGEROUS_SUBSTRINGS = ["--force", "-rf", "production", "prod", "migrate", "deploy", "format"];

export interface SafetyCheck {
  safe: boolean;
  reasons: string[];
}

export function checkValidationCommandSafety(argv: readonly string[]): SafetyCheck {
  const reasons: string[] = [];
  const command = argv[0];
  if (command === undefined) reasons.push("empty command");
  for (const token of argv) {
    const lower = token.toLowerCase();
    if (DANGEROUS_TOKENS.has(lower)) reasons.push(`dangerous command token: ${token}`);
    if (lower.includes("curl|sh") || lower.includes("curl | sh")) reasons.push("curl pipe to shell is forbidden");
    for (const needle of DANGEROUS_SUBSTRINGS) {
      if (lower.includes(needle)) reasons.push(`requires extra confirmation: ${token}`);
    }
  }
  return { safe: reasons.length === 0, reasons };
}
