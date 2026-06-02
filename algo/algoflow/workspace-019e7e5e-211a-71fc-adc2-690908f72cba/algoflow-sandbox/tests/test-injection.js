/**
 * ============================================================================
 * Test: Shell Injection Neutralisation
 * ============================================================================
 *
 * Verifies that malicious payloads are blocked by the security middleware
 * BEFORE they reach the sandbox. Tests multiple attack vectors:
 *
 *   1. "; rm -rf /"        — shell command injection
 *   2. backtick expansion  — `whoami`
 *   3. $(command)          — $(cat /etc/passwd)
 *   4. child_process       — Node.js exec/spawn
 *   5. os.system           — Python system calls
 *   6. Runtime.exec        — Java process execution
 *   7. Directory traversal  — ../../../etc/passwd
 *   8. /proc/self          — process introspection
 *
 * PASS criteria: ALL payloads must be rejected (403 or 400 status).
 * ============================================================================
 */

const { INJECTION_PATTERNS } = require("../server/security");

const MALICIOUS_PAYLOADS = [
  {
    name: "Shell '; rm -rf /' injection",
    code: `#include <iostream>\nint main() { system("; rm -rf /"); return 0; }`,
    shouldBlock: true,
  },
  {
    name: "Backtick command substitution",
    code: "print(`whoami`)",
    shouldBlock: true,
  },
  {
    name: "$(…) command substitution",
    code: 'print($(cat /etc/passwd))',
    shouldBlock: true,
  },
  {
    name: "child_process require",
    code: 'const cp = require("child_process"); cp.execSync("id");',
    shouldBlock: true,
  },
  {
    name: "Python os.system",
    code: 'import os\nos.system("rm -rf /")',
    shouldBlock: true,
  },
  {
    name: "Python subprocess",
    code: 'import subprocess\nsubprocess.call(["ls", "/"])',
    shouldBlock: true,
  },
  {
    name: "Python __import__",
    code: '__import__("os").system("id")',
    shouldBlock: true,
  },
  {
    name: "Java Runtime.exec",
    code: 'Runtime.getRuntime().exec("rm -rf /");',
    shouldBlock: true,
  },
  {
    name: "Java ProcessBuilder",
    code: 'new ProcessBuilder("sh", "-c", "id").start();',
    shouldBlock: true,
  },
  {
    name: "Directory traversal",
    code: '#include <fstream>\nint main() { std::ifstream f("../../../../etc/passwd"); }',
    shouldBlock: true,
  },
  {
    name: "/proc/self access",
    code: 'with open("/proc/self/maps") as f: print(f.read())',
    shouldBlock: true,
  },
  {
    name: "/etc/passwd access",
    code: '#include <cstdio>\nint main() { FILE *f = fopen("/etc/passwd", "r"); }',
    shouldBlock: true,
  },
  {
    name: "Safe C++ (should NOT block)",
    code: '#include <iostream>\nint main() { std::cout << "Hello"; return 0; }',
    shouldBlock: false,
  },
  {
    name: "Safe Python (should NOT block)",
    code: 'n = int(input())\nprint(n * 2)',
    shouldBlock: false,
  },
  {
    name: "Safe Java (should NOT block)",
    code: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello");\n  }\n}',
    shouldBlock: false,
  },
];

function testInjections() {
  console.log("─── Shell Injection Neutralisation Tests ───\n");

  let passed = 0;
  let failed = 0;

  for (const payload of MALICIOUS_PAYLOADS) {
    let detected = false;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(payload.code)) {
        detected = true;
        break;
      }
    }

    const ok = detected === payload.shouldBlock;
    const icon = ok ? "✓" : "✗";

    console.log(
      `  ${icon} ${payload.name} | ` +
      `Expected: ${payload.shouldBlock ? "BLOCKED" : "ALLOWED"} | ` +
      `Got: ${detected ? "BLOCKED" : "ALLOWED"}`
    );

    if (ok) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${MALICIOUS_PAYLOADS.length}`);
  return failed === 0;
}

if (require.main === module) {
  const ok = testInjections();
  console.log(`\n${ok ? "✓ ALL INJECTION TESTS PASSED" : "✗ SOME INJECTION TESTS FAILED"}\n`);
  process.exit(ok ? 0 : 1);
}

module.exports = { testInjections };
