"use client";

import { useCallback, useEffect, useState } from "react";

export const CHATGPT_SECURITY_URL = "https://chatgpt.com/#settings/Security";

export interface AiAccount {
  type: string;
  email?: string | null;
  planType?: string | null;
}

export interface AiDeviceLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

type AccountResponse = {
  account?: { account?: AiAccount | null } | null;
  runtime?: {
    provider: string;
    displayName: string;
    runtime: string;
    version: string;
  };
};

export function useAiAccount() {
  const [accountResponse, setAccountResponse] =
    useState<AccountResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [deviceLogin, setDeviceLogin] = useState<AiDeviceLogin | null>(null);
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/account/status", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("account_status_unavailable");
      const value = (await response.json()) as AccountResponse;
      setAccountResponse(value);
      setStatus("ready");
      if (value.account?.account?.type === "chatgpt") {
        setDeviceLogin(null);
        setMessage("");
      }
      return value;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  useEffect(() => {
    if (!deviceLogin) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [deviceLogin, load]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setMessage("");
    setCodeCopied(false);
    try {
      const response = await fetch("/api/ai/account/login", { method: "POST" });
      const value = (await response.json()) as AiDeviceLogin & {
        error?: string;
      };
      if (!response.ok) {
        setMessage(
          "OpenAI 보안 설정에서 ‘Codex용 장치 코드 인증’을 켠 뒤 다시 시도해 주세요.",
        );
        return;
      }
      setDeviceLogin(value);
    } catch {
      setMessage("OpenAI 연결 상태를 확인하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const copyCode = useCallback(async () => {
    if (!deviceLogin) return;
    await navigator.clipboard.writeText(deviceLogin.userCode);
    setCodeCopied(true);
  }, [deviceLogin]);

  const disconnect = useCallback(async () => {
    await fetch("/api/ai/account/logout", { method: "POST" });
    setAccountResponse(null);
    setDeviceLogin(null);
    await load();
  }, [load]);

  const account =
    accountResponse?.account?.account?.type === "chatgpt"
      ? accountResponse.account.account
      : null;
  return {
    account,
    codeCopied,
    connect,
    connecting,
    copyCode,
    deviceLogin,
    disconnect,
    load,
    message,
    runtime: accountResponse?.runtime ?? null,
    status,
  };
}
