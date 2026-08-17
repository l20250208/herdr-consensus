#!/usr/bin/env node
// Fake `herdr` executable for integration tests.
//
// Driven by the FAKE_HERDR_SCENARIO environment variable (a JSON object).
// Dispatches on argv[2] (top command) and argv[3] (subcommand). Success
// responses use Herdr's `{result: ...}` envelope; failures use
// `{error: {code, message}}` with a non-zero exit.
import { readFileSync } from "node:fs";

function loadScenario() {
  const raw = process.env.FAKE_HERDR_SCENARIO ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const scenario = loadScenario();

function agentJson(status = "idle", name = "claude") {
  return {
    agent: name,
    agent_status: status,
    pane_id: "w9:p1",
    workspace_id: "w9",
    tab_id: "w9:t1",
  };
}

function envelope(result) {
  return JSON.stringify({ id: "cli:fake", result });
}

function errorEnvelope(code, message) {
  return JSON.stringify({ id: "cli:fake", error: { code, message } });
}

function writeOut(text) {
  process.stdout.write(`${text}\n`);
  process.exit(0);
}

function writeErr(code, message) {
  process.stdout.write(`${errorEnvelope(code, message)}\n`);
  process.exit(1);
}

function handleAgent() {
  switch (process.argv[3]) {
    case "start": {
      if (scenario.start === "fail") writeErr("agent_start_failed", "agent failed to start");
      writeOut(envelope({ agent: agentJson("idle", scenario.agentName ?? "claude") }));
      break;
    }
    case "prompt": {
      if (scenario.prompt === "timeout") writeErr("timeout", "timed out");
      if (scenario.prompt === "stalled") writeErr("agent_prompt_stalled", "prompt stalled");
      if (scenario.prompt === "exit") writeErr("agent_not_found", "agent not found");
      if (scenario.prompt === "blocked") {
        writeOut(envelope({ agent: agentJson("blocked") }));
      }
      writeOut(envelope({ agent: agentJson("idle") }));
      break;
    }
    case "wait": {
      if (scenario.wait === "timeout") writeErr("timeout", "timed out");
      writeOut(envelope({ agent: agentJson("idle") }));
      break;
    }
    case "get": {
      if (scenario.get === "missing") writeErr("agent_not_found", "agent not found");
      writeOut(envelope({ agent: agentJson(scenario.getStatus ?? "idle") }));
      break;
    }
    case "read": {
      process.stdout.write(scenario.read ?? "fake terminal output\n");
      process.exit(0);
      break;
    }
    case "list": {
      writeOut(
        envelope({
          agents: [agentJson("idle", "claude"), agentJson("working", "pi")],
          type: "agent_list",
        }),
      );
      break;
    }
    default:
      writeErr("unknown_command", `unknown agent subcommand ${process.argv[3]}`);
  }
}

function handlePane() {
  if (process.argv[3] === "split") {
    writeOut(envelope({ pane: { pane_id: "w9:p9" } }));
  } else {
    writeErr("unknown_command", `unknown pane subcommand ${process.argv[3]}`);
  }
}

switch (process.argv[2]) {
  case "agent":
    handleAgent();
    break;
  case "pane":
    handlePane();
    break;
  default:
    writeErr("unknown_command", `unknown command ${process.argv[2]}`);
}
