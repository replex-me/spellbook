import { redirect } from "next/navigation";

import { SpellbookBrand, SpellbookIcon } from "@/components/spellbook-ui";
import { currentSession, safeRedirect } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const params = await searchParams;
  const destination = safeRedirect(params.redirect);
  if (await currentSession()) redirect(destination);
  return (
    <main className="auth-shell">
      <section className="auth-card ds-card">
        <a className="auth-brand" href="/" aria-label="Spellbook 홈">
          <SpellbookBrand />
        </a>
        <div className="auth-copy">
          <p className="ds-kicker">SELF-HOSTED DOCUMENT WORKSPACE</p>
          <h1>이 Spellbook 인스턴스에 로그인하세요.</h1>
          <p>
            설치 과정에서 설정한 로컬 관리자 계정을 사용합니다. 문서와 AI 연결
            정보는 이 인스턴스의 저장소 밖으로 자동 전송되지 않습니다.
          </p>
        </div>
        {params.error ? (
          <p className="system-alert is-danger" role="alert">
            이메일 또는 비밀번호가 올바르지 않습니다.
          </p>
        ) : null}
        <form className="auth-form" action="/auth/login" method="post">
          <input type="hidden" name="redirect" value={destination} />
          <label>
            <span>이메일</span>
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            <span>비밀번호</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={12}
              required
            />
          </label>
          <button className="ds-button is-primary auth-login" type="submit">
            계속
            <SpellbookIcon name="arrowRight" />
          </button>
        </form>
        <p className="auth-note">
          계정 값은 서버의 <code>.env</code>에서 관리합니다.
        </p>
      </section>
    </main>
  );
}
