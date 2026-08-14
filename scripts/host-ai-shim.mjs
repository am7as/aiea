#!/usr/bin/env node
// AIEA host AI shim
// -----------------
// Exposes the host's already-logged-in `claude` / `gemini` CLIs behind an
// OpenAI-compatible HTTP API, so the containerized AIEA api can use your
// subscription without baking the CLI into the Docker image.
//
//   node scripts/host-ai-shim.mjs          # listens on :4023
//
// In AIEA, add a Subscription provider pointing at:
//   http://host.docker.internal:4023/v1
//
// Zero dependencies — Node stdlib only. Add a service by declaring its
// command shape in the CLIS table below.

import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.AIEA_SHIM_PORT || 4023);
const TIMEOUT_MS = Number(process.env.AIEA_SHIM_TIMEOUT_MS || 600_000);
const AGENT_TIMEOUT_MS = Number(process.env.AIEA_SHIM_AGENT_TIMEOUT_MS || 600_000);

const CLIS = {
  claude: {
    bin: "claude",
    models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
    args: (model, prompt) => ["-p", prompt, "--model", model, "--output-format", "json"],
    parse: (stdout) => {
      try {
        const j = JSON.parse(stdout);
        return {
          text: j.result ?? "",
          tokensIn: j.usage?.input_tokens ?? 0,
          tokensOut: j.usage?.output_tokens ?? 0,
        };
      } catch {
        return { text: stdout.trim(), tokensIn: 0, tokensOut: 0 };
      }
    },
  },
  gemini: {
    bin: "gemini",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    args: (model, prompt) => ["-m", model, "-p", prompt],
    parse: (stdout) => ({ text: stdout.trim(), tokensIn: 0, tokensOut: 0 }),
  },
};

function hasBin(bin) {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function cliFor(model) {
  for (const [name, c] of Object.entries(CLIS)) {
    if (c.models.includes(model) || model.startsWith(name)) return c;
  }
  return null;
}

function availableModels(service) {
  const entries = service && CLIS[service] ? [CLIS[service]] : Object.values(CLIS);
  const out = [];
  for (const c of entries) {
    if (hasBin(c.bin)) for (const m of c.models) out.push(m);
  }
  return out;
}

// A request path may be scoped to one service: /claude/v1/... or /gemini/v1/...
// Unscoped /v1/... serves every CLI and routes by model name.
function splitService(url) {
  const m = url.match(/^\/([a-z0-9_-]+)(\/v1\/.*)$/);
  if (m && CLIS[m[1]]) return { service: m[1], path: m[2] };
  return { service: null, path: url };
}

function extractText(content) {
  if (typeof content === "string") return content;
  // Multipart content blocks (vision tasks) — extract only text parts; images
  // are dropped since CLI providers are text-only.
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return String(content ?? "");
}

function flatten(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  if (messages.length === 1) return extractText(messages[0].content);
  return messages
    .map((m) => `## ${String(m.role ?? "user")}\n${extractText(m.content)}`)
    .join("\n\n");
}

function run(cli, model, prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cli.bin, cli.args(model, prompt), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("CLI timed out"));
    }, TIMEOUT_MS);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `exit ${code}`));
      else resolve(out);
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function resolveDir(d) {
  if (!d || d === "~") return homedir();
  if (d.startsWith("~/")) return join(homedir(), d.slice(2));
  return d;
}

const AGENT_CLAUDE_MD = `# AIEA agent workspace

This folder is the home of an AIEA agent provider. Claude Code runs here as the
agent, at the permission level set in AIEA. Files it creates, its project
config in .claude/, and these instructions persist across runs.

Edit this file to shape how the agent behaves for AIEA tasks.
`;

const AGENT_GEMINI_MD = AGENT_CLAUDE_MD.replace("Claude Code", "Gemini CLI").replace(
  ".claude/",
  ".gemini/",
);

// Provision the agent's working directory. AIEA-managed homes (paths under
// /.ai/) are scaffolded with the service's instructions file + config dir.
function provisionWorkspace(cwd, service) {
  mkdirSync(cwd, { recursive: true });
  if (!cwd.includes("/.ai/")) return;
  const [mdName, mdBody, dirName] =
    service === "gemini"
      ? ["GEMINI.md", AGENT_GEMINI_MD, ".gemini"]
      : ["CLAUDE.md", AGENT_CLAUDE_MD, ".claude"];
  const md = join(cwd, mdName);
  if (!existsSync(md)) writeFileSync(md, mdBody);
  const dir = join(cwd, dirName);
  if (!existsSync(dir)) mkdirSync(dir);
}

// Permission tiers — what the agent's toolset is cut down to.
//   read = explore only · edit = read + write files · full = everything incl. shell
function disallowedTools(permission) {
  if (permission === "read") return "Bash,Write,Edit,NotebookEdit";
  if (permission === "edit") return "Bash";
  return ""; // full
}

// Tell the agent its constraints so it doesn't attempt — or falsely claim —
// actions its toolset no longer allows.
function permNote(permission) {
  if (permission === "read")
    return "[AIEA permission: READ-ONLY. You may read and search files but cannot create, edit or write files and cannot run shell commands. If a task needs those, say so plainly — do not claim success.]\n\n";
  if (permission === "edit")
    return "[AIEA permission: EDIT. You may read and write files in this directory but cannot run shell commands.]\n\n";
  return "";
}

// Gemini's --approval-mode equivalent of the AIEA permission tiers.
function geminiApproval(permission) {
  if (permission === "read") return "plan"; // read-only
  if (permission === "edit") return "auto_edit"; // auto-approve edits
  return "yolo"; // approve everything
}

// Agent mode — runs the full agent (Claude Code or Gemini CLI) headless,
// with tools, in the given working directory.
function runAgent(service, model, prompt, cwd, permission) {
  return new Promise((resolve, reject) => {
    const fullPrompt = permNote(permission) + prompt;
    let bin;
    let argv;
    if (service === "gemini") {
      bin = "gemini";
      argv = ["-m", model, "-p", fullPrompt, "--approval-mode", geminiApproval(permission)];
    } else {
      bin = "claude";
      argv = [
        "-p",
        fullPrompt,
        "--model",
        model,
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
      ];
      const disallow = disallowedTools(permission);
      if (disallow) argv.push("--disallowedTools", disallow);
    }
    let proc;
    try {
      proc = spawn(bin, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("agent run timed out"));
    }, AGENT_TIMEOUT_MS);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `exit ${code}`));
      else resolve(out);
    });
  });
}

const server = createServer((req, res) => {
  const url = req.url || "";

  if (req.method === "GET" && (url === "/" || url.startsWith("/health"))) {
    return json(res, 200, { status: "ok", models: availableModels() });
  }

  const { service, path } = splitService(url);

  if (req.method === "POST" && path.startsWith("/agent")) {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return json(res, 400, { error: { message: "invalid JSON body" } });
      }
      const svc = body.service === "gemini" ? "gemini" : "claude";
      const bin = svc === "gemini" ? "gemini" : "claude";
      if (!hasBin(bin)) {
        return json(res, 503, { error: { message: `\`${bin}\` not installed on host` } });
      }
      const cwd = resolveDir(body.working_dir);
      try {
        provisionWorkspace(cwd, svc);
      } catch (e) {
        return json(res, 400, {
          error: { message: `cannot prepare working dir ${cwd}: ${e?.message || e}` },
        });
      }
      try {
        const model =
          body.model || (svc === "gemini" ? "gemini-2.5-flash" : "claude-sonnet-4-6");
        const stdout = await runAgent(
          svc,
          model,
          String(body.prompt || ""),
          cwd,
          body.permission || "edit",
        );
        let text = stdout.trim();
        let tokensIn = 0;
        let tokensOut = 0;
        if (svc === "claude") {
          try {
            const j = JSON.parse(stdout);
            text = j.result ?? text;
            tokensIn = j.usage?.input_tokens ?? 0;
            tokensOut = j.usage?.output_tokens ?? 0;
          } catch {
            /* keep raw text */
          }
        }
        return json(res, 200, { text, model, tokens_in: tokensIn, tokens_out: tokensOut, cwd });
      } catch (e) {
        return json(res, 502, { error: { message: String(e?.message || e) } });
      }
    });
    return;
  }

  if (req.method === "GET" && path.startsWith("/v1/models")) {
    return json(res, 200, {
      object: "list",
      data: availableModels(service).map((id) => ({ id, object: "model" })),
    });
  }

  if (req.method === "POST" && path.startsWith("/v1/chat/completions")) {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return json(res, 400, { error: { message: "invalid JSON body" } });
      }
      const model = body.model;
      const cli = service ? CLIS[service] : model && cliFor(model);
      if (!cli) {
        return json(res, 404, { error: { message: `no CLI for model '${model}'` } });
      }
      if (!hasBin(cli.bin)) {
        return json(res, 503, { error: { message: `\`${cli.bin}\` not installed on host` } });
      }
      try {
        const stdout = await run(cli, model, flatten(body.messages));
        const { text, tokensIn, tokensOut } = cli.parse(stdout);
        return json(res, 200, {
          id: "chatcmpl-shim",
          object: "chat.completion",
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: tokensIn,
            completion_tokens: tokensOut,
            total_tokens: tokensIn + tokensOut,
          },
        });
      } catch (e) {
        return json(res, 502, { error: { message: String(e?.message || e) } });
      }
    });
    return;
  }

  json(res, 404, { error: { message: "not found" } });
});

server.listen(PORT, () => {
  const avail = availableModels();
  console.log(`AIEA host AI shim listening on http://localhost:${PORT}`);
  console.log(`  containers reach it at http://host.docker.internal:${PORT}/v1`);
  console.log(
    `  available models: ${avail.length ? avail.join(", ") : "(none — no CLI found on PATH)"}`,
  );
});
