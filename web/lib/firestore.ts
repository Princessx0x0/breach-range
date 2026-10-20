"use client";

/**
 * The dashboard's read path and the TypeScript side of the data contract.
 *
 * firestore-schema.json is the source of truth; these types mirror it, exactly as
 * agents/breach_range/shared/schema.py does on the Python side. Change the JSON first,
 * then both sides. The dashboard reads the graph, event log and rounds ONLY from
 * Firestore through the real-time listeners below -- never from the agent stream -- so
 * the panels keep moving even if the CopilotKit/agent bridge is flaky mid-demo.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";

// --- contract types (mirror firestore-schema.json) -----------------------

export type Agent = "recon" | "attacker" | "referee" | "defender";

export type Action =
  | "recon.complete"
  | "attacker.claim"
  | "referee.verified"
  | "referee.rejected"
  | "defender.proposed"
  | "approval.requested"
  | "approval.granted"
  | "defender.applied";

export type Status = "claimed" | "verified" | "rejected" | "pending" | "applied";

export type NodeKind =
  | "project"
  | "serviceAccount"
  | "key"
  | "bucket"
  | "firewall"
  | "instance"
  | "role";

export type Relation =
  | "hasKey"
  | "leaksKey"
  | "tokenCreator"
  | "actAs"
  | "hasRole"
  | "allowsIngress"
  | "readsBucket"
  | "writesBucket";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  reachable: boolean;
  fromMisconfig: string | null;
  labels: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: Relation;
  viaMisconfig: string | null;
}

export interface Graph {
  round: number;
  score: number;
  updatedAt?: unknown;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Path {
  id: string;
  edges: string[];
  startNode: string;
  targetNode: string;
  misconfigs: string[];
}

export interface EventDoc {
  id: string;
  round: number;
  agent: Agent;
  action: Action;
  target: string;
  status: Status;
  payload: Record<string, unknown>;
  result: string | null;
  ts?: unknown;
}

export interface Round {
  round: number;
  scoreBefore: number;
  scoreAfter: number;
  patchApplied: string | null;
}

// --- firebase client ------------------------------------------------------

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"] as const;

export class FirebaseConfigError extends Error {}

function firebaseApp(): FirebaseApp {
  const missing = REQUIRED.filter((k) => !config[k]);
  if (missing.length > 0) {
    // A missing value is a configuration error, surfaced loudly, never a silent demo mode.
    throw new FirebaseConfigError(
      `Firebase is not configured. Set ${missing
        .map((k) => `NEXT_PUBLIC_FIREBASE_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
        .join(", ")} in web/.env.local (see .env.example).`,
    );
  }
  return getApps().length ? getApp() : initializeApp(config);
}

let db: Firestore | undefined;
function firestore(): Firestore {
  db ??= getFirestore(firebaseApp());
  return db;
}

// --- real-time listeners (the read path) ----------------------------------

type Unsub = () => void;

/** Subscribe to graph/current. Fires with null until Recon writes it. */
export function watchGraph(cb: (graph: Graph | null) => void, onError?: (e: Error) => void): Unsub {
  return onSnapshot(
    doc(firestore(), "graph", "current"),
    (snap) => cb(snap.exists() ? (snap.data() as Graph) : null),
    (e) => onError?.(e),
  );
}

/** Subscribe to the append-only event log, oldest first. */
export function watchEvents(cb: (events: EventDoc[]) => void, onError?: (e: Error) => void): Unsub {
  const q = query(collection(firestore(), "events"), orderBy("ts"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventDoc, "id">) }))),
    (e) => onError?.(e),
  );
}

/** Subscribe to completed rounds, ascending -- the scoreboard's descending line. */
export function watchRounds(cb: (rounds: Round[]) => void, onError?: (e: Error) => void): Unsub {
  const q = query(collection(firestore(), "rounds"), orderBy("round"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as Round)),
    (e) => onError?.(e),
  );
}
