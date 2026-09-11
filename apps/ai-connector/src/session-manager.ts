import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { AppServerClient } from "./app-server-client.js";
import { activeAiRuntime } from "./ai-runtime-contract.js";

interface ManagedSession {
  client: AppServerClient;
  home: string;
  email: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, Promise<ManagedSession>>();

  async status(rawEmail: string): Promise<{
    account: unknown;
    rateLimits: unknown;
    runtime: typeof activeAiRuntime;
  }> {
    const session = await this.get(rawEmail);
    const account = await session.client.accountRead(true);
    let rateLimits: unknown = null;
    if (account.account?.type === "chatgpt") {
      try {
        rateLimits = await session.client.rateLimitsRead();
      } catch {
        rateLimits = null;
      }
    }
    return { account, rateLimits, runtime: activeAiRuntime };
  }

  async startLogin(rawEmail: string): Promise<unknown> {
    return (await this.get(rawEmail)).client.startDeviceLogin();
  }

  async logout(rawEmail: string): Promise<void> {
    const session = await this.get(rawEmail);
    await session.client.logout();
  }

  async client(rawEmail: string): Promise<AppServerClient> {
    const session = await this.get(rawEmail);
    const status = await session.client.accountRead(true);
    if (status.account?.type !== "chatgpt")
      throw new Error("ChatGPT subscription is not connected.");
    return session.client;
  }

  private async get(rawEmail: string): Promise<ManagedSession> {
    const email = normalizeEmail(rawEmail);
    if (!isAllowedAiIdentity(email))
      throw new Error("This local account cannot connect an AI subscription.");
    const existing = this.sessions.get(email);
    if (existing) {
      const session = await existing;
      if (session.client.isRunning) return session;
      if (this.sessions.get(email) !== existing) return this.get(email);
      this.sessions.delete(email);
    }
    const created = this.create(email);
    this.sessions.set(email, created);
    try {
      return await created;
    } catch (error) {
      this.sessions.delete(email);
      throw error;
    }
  }

  private async create(email: string): Promise<ManagedSession> {
    const base = path.resolve(
      process.env.SPELLBOOK_CODEX_AUTH_DIR?.trim() || ".spellbook/ai-auth",
    );
    const home = path.join(base, stableIdentityKey(email));
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await fs.chmod(home, 0o700);
    return {
      client: await AppServerClient.start(home),
      home,
      email,
    };
  }
}

export function isAllowedAiIdentity(email: string): boolean {
  const allowed = process.env.SPELLBOOK_LOCAL_EMAIL?.trim().toLowerCase();
  return Boolean(allowed && normalizeEmail(email) === allowed);
}

export function stableIdentityKey(value: string): string {
  return createHash("sha256")
    .update(normalizeEmail(value))
    .digest("hex")
    .slice(0, 20);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
