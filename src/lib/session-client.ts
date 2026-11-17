/**
 * 画面からのログイン・ログアウト（サーバーは src/lib/session.ts）。URL はここにだけ書く。
 * どちらも画面の遷移で行う（Auth0 へのリダイレクトが続くので、ページごと移る）。
 */

/** いまの画面に戻ってくるログイン */
export function startLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/api/v1/session/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** ログアウトは POST（GET だと他のサイトのリンクでログアウトさせられる） */
export function logout(): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/v1/session/logout";
  document.body.appendChild(form);
  form.submit();
}

/** session.ts がログインに失敗したときに付けて戻す `?login_error=` を読んで、URL から消す */
export function takeLoginError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("login_error");
  if (!code) return null;
  url.searchParams.delete("login_error");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return code === "no_user" ? "This Google account is not allowed." : `Sign-in failed (${code}).`;
}
