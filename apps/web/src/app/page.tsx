import { currentSession } from "@/lib/auth";
import Dashboard from "@/components/dashboard";
import { SpellbookBrand, SpellbookIcon } from "@/components/spellbook-ui";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  const { error } = await searchParams;
  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-card ds-card">
          <a className="auth-brand" href="/" aria-label="Spellbook 홈">
            <SpellbookBrand />
          </a>
          <div className="auth-copy">
            <p className="ds-kicker">AI POWERPOINT WORKSPACE</p>
            <h1>원본을 지키면서, 필요한 부분만 고칩니다.</h1>
            <p>
              PPTX를 실제 편집 화면에서 열고 직접 고치거나, 같은 화면을 보는
              AI에게 요청하세요. 변경 결과를 확인한 뒤 편집 가능한 파일로
              내려받습니다.
            </p>
          </div>
          <div className="auth-promise" aria-label="Spellbook의 작업 방식">
            <span>
              <SpellbookIcon name="file" /> 원본 PPTX 유지
            </span>
            <span>
              <SpellbookIcon name="sparkles" /> 화면을 보는 AI
            </span>
            <span>
              <SpellbookIcon name="shield" /> 검증 후 저장
            </span>
          </div>
          {error ? (
            <p className="system-alert is-danger" role="alert">
              로그인할 수 없습니다: {error}
            </p>
          ) : null}
          <a className="ds-button is-primary auth-login" href="/login">
            이 서버에 로그인
            <SpellbookIcon name="arrowRight" />
          </a>
          <p className="auth-note">
            설치할 때 만든 로컬 관리자 계정을 사용합니다.
          </p>
        </section>
        <aside className="auth-visual" aria-hidden="true">
          <div className="auth-slide">
            <span />
            <strong>원본 그대로</strong>
            <p>선택한 요소만 안전하게 수정</p>
            <i />
          </div>
          <div className="auth-ai-card">
            <SpellbookIcon name="sparkles" />
            <span>수정 화면 확인 완료</span>
          </div>
        </aside>
      </main>
    );
  }
  return <Dashboard email={session.email} />;
}
