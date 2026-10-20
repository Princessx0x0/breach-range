import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

/**
 * CopilotKit AG-UI endpoint for the agent-native path (step mode and the approval
 * action, per the architecture). It is deliberately NOT on the data path: the graph,
 * scoreboard and event feed all read Firestore directly, so if this bridge is flaky the
 * demo still moves. It proxies to the deployed ADK Runner at AGENT_URL.
 */
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({ url: process.env.AGENT_URL ?? "http://127.0.0.1:8000" }),
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
